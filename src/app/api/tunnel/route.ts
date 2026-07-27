import { NextRequest, NextResponse } from 'next/server';
import { run, runCached } from '@/lib/runner';
import { assertPort, ValidationError } from '@/lib/validate';
import { recordResidue } from '@/lib/residue';

const DOMAIN_SUFFIX = process.env.DOMAIN_SUFFIX ?? 'bitroot.in';
const TS_HOST = process.env.TAILSCALE_HOST ?? 'oneplus-6';
const TS_IP = process.env.TAILSCALE_IP ?? '100.127.137.83';

function assertSubdomain(name: unknown): string {
  if (typeof name !== 'string' || !/^[a-z0-9-]{1,40}$/.test(name)) {
    throw new ValidationError('invalid subdomain (lowercase letters, digits, dashes)');
  }
  return name;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

// Tunnel overview: cloudflared state, ingress routes annotated with the
// service each one points at, and the private (Tailscale) side of the picture.
export async function GET() {
  const [cfg, pm2, ports] = await Promise.all([
    run('cat "$HOME/.cloudflared/config.yml" 2>/dev/null || true'),
    runCached('pm2 jlist'),
    run('cat "$HOME/bin/ports.conf" 2>/dev/null || true'),
  ]);

  // port -> service name, from the registry first then pm2 env
  const portToService: Record<number, string> = {};
  for (const line of ports.output.split('\n')) {
    const m = line.match(/^([\w-]+)=(\d+)\s*$/);
    if (m) portToService[Number(m[2])] = m[1];
  }

  let apps: any[] = [];
  try {
    const start = pm2.output.indexOf('[');
    if (start >= 0) apps = JSON.parse(pm2.output.slice(start));
  } catch {
    // ignore
  }
  for (const a of apps) {
    const p = Number(a.pm2_env?.env?.PORT);
    if (p && !portToService[p]) portToService[p] = a.name;
  }

  const routes: Array<{
    hostname: string;
    service: string;
    port: number | null;
    attachedTo: string | null;
  }> = [];
  let pendingHost: string | null = null;
  for (const raw of cfg.output.split('\n')) {
    const line = raw.trim();
    const h = line.match(/^-\s*hostname:\s*(\S+)/);
    if (h) {
      pendingHost = h[1];
      continue;
    }
    const s = line.match(/^(?:-\s*)?service:\s*(\S+)/);
    if (s) {
      if (pendingHost) {
        const portMatch = s[1].match(/:(\d+)$/);
        const port = portMatch ? Number(portMatch[1]) : null;
        routes.push({
          hostname: pendingHost,
          service: s[1],
          port,
          attachedTo: port ? (portToService[port] ?? null) : null,
        });
      }
      pendingHost = null;
    }
  }

  let daemon = { status: 'unknown', uptimeMs: 0, restarts: 0 };
  try {
    const cf = apps.find((a: any) => a.name === 'cloudflared');
    if (cf) {
      daemon = {
        status: cf.pm2_env?.status ?? 'unknown',
        uptimeMs:
          cf.pm2_env?.status === 'online' && cf.pm2_env?.pm_uptime
            ? Date.now() - cf.pm2_env.pm_uptime
            : 0,
        restarts: cf.pm2_env?.restart_time ?? 0,
      };
    }
  } catch {
    // leave unknown
  }

  // Everything reachable privately over the tailnet, no route required.
  const services = Object.entries(portToService)
    .map(([port, name]) => ({ name, port: Number(port) }))
    .sort((a, b) => a.port - b.port);

  return NextResponse.json({
    daemon,
    routes,
    services,
    domain: DOMAIN_SUFFIX,
    tailscale: { host: TS_HOST, ip: TS_IP },
  });
}

// Add a route: runs the existing `tunnel-add <name> <port>` script
// (Cloudflare DNS record + config.yml ingress entry), then restarts cloudflared.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = assertSubdomain(body.name);
    const port = assertPort(body.port);

    const existing = await run(
      `grep -c "hostname: ${name}.${DOMAIN_SUFFIX}" "$HOME/.cloudflared/config.yml" 2>/dev/null || true`,
    );
    if (existing.output.trim() !== '0') {
      return NextResponse.json(
        { error: `${name}.${DOMAIN_SUFFIX} is already routed` },
        { status: 400 },
      );
    }

    const add = await run(`tunnel-add ${name} ${port}`, 120_000);
    if (!add.ok) {
      return NextResponse.json({ ok: false, output: add.output }, { status: 500 });
    }
    const restart = await run('pm2 restart cloudflared', 60_000);
    return NextResponse.json({
      ok: restart.ok,
      output: `${add.output}\n${restart.output}`.trim(),
    });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

// Detach a route (ingress entry only; the DNS CNAME stays).
export async function DELETE(req: NextRequest) {
  try {
    const name = assertSubdomain(req.nextUrl.searchParams.get('name'));
    const r = await run(`tunnel-remove ${name}`, 60_000);
    if (!r.ok) {
      return NextResponse.json({ ok: false, output: r.output }, { status: 500 });
    }
    const restart = await run('pm2 restart cloudflared', 60_000);

    await recordResidue([
      {
        action: `detached route "${name}.${DOMAIN_SUFFIX}"`,
        kind: 'dns',
        what: 'Cloudflare DNS record still points at this tunnel',
        target: `${name}.${DOMAIN_SUFFIX}`,
        hint: 'Harmless (the hostname now returns 404) and re-attaching is instant. Delete the CNAME in Cloudflare to fully retire it.',
      },
    ]);

    return NextResponse.json({ ok: true, output: `${r.output}\n${restart.output}`.trim() });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
