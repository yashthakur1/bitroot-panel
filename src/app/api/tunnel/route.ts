import { NextRequest, NextResponse } from 'next/server';
import { run } from '@/lib/runner';
import { assertPort, ValidationError } from '@/lib/validate';

const DOMAIN_SUFFIX = process.env.DOMAIN_SUFFIX ?? 'bitroot.in';

function assertSubdomain(name: unknown): string {
  if (typeof name !== 'string' || !/^[a-z0-9-]{1,40}$/.test(name)) {
    throw new ValidationError('invalid subdomain (lowercase letters, digits, dashes)');
  }
  return name;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

// Tunnel overview: cloudflared daemon state + ingress routes from config.yml.
export async function GET() {
  const [cfg, pm2] = await Promise.all([
    run('cat "$HOME/.cloudflared/config.yml" 2>/dev/null || true'),
    run('pm2 jlist'),
  ]);

  const routes: Array<{ hostname: string; service: string }> = [];
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
      if (pendingHost) routes.push({ hostname: pendingHost, service: s[1] });
      pendingHost = null;
    }
  }

  let daemon = { status: 'unknown', uptimeMs: 0, restarts: 0 };
  try {
    const start = pm2.output.indexOf('[');
    const apps = JSON.parse(pm2.output.slice(start));
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
    // leave daemon as unknown
  }

  return NextResponse.json({ daemon, routes, domain: DOMAIN_SUFFIX });
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
