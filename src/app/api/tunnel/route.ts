import { NextRequest, NextResponse } from "next/server";
import { parseIngress, portOf } from "@/lib/routes";
import { detectTailnet } from "@/lib/setup";
import { ownedPorts, reachableOn } from "@/lib/ports";
import { run, runCached } from "@/lib/runner";
import { assertPort, ValidationError } from "@/lib/validate";
import { recordResidue } from "@/lib/residue";

const DOMAIN_SUFFIX = process.env.DOMAIN_SUFFIX ?? "example.com";
const TS_HOST = process.env.TAILNET_HOST ?? process.env.TAILSCALE_HOST ?? "";
const TS_IP = process.env.TAILNET_IP ?? process.env.TAILSCALE_IP ?? "";

function assertSubdomain(name: unknown): string {
  if (typeof name !== "string" || !/^[a-z0-9-]{1,40}$/.test(name)) {
    throw new ValidationError(
      "invalid subdomain (lowercase letters, digits, dashes)",
    );
  }
  return name;
}

// Ports served by something other than a pm2 app or registry entry.
const WELL_KNOWN: Record<number, string> = {
  8022: "sshd (Termux)",
};

/* eslint-disable @typescript-eslint/no-explicit-any */

// Tunnel overview: cloudflared state, ingress routes annotated with the
// service each one points at, and the private (Tailscale) side of the picture.
export async function GET() {
  const [cfg, pm2, ports] = await Promise.all([
    run('cat "$HOME/.cloudflared/config.yml" 2>/dev/null || true'),
    runCached("pm2 jlist"),
    run('cat "$HOME/bin/ports.conf" 2>/dev/null || true'),
  ]);

  let apps: any[] = [];
  try {
    const start = pm2.output.indexOf("[");
    if (start >= 0) apps = JSON.parse(pm2.output.slice(start));
  } catch {
    // ignore
  }
  // Shared with the services list, so the two pages cannot disagree about which
  // process owns which port - and so a port stated in a process's arguments,
  // like PocketBase's, is seen at all.
  const { byPort: portToService } = ownedPorts(apps, ports.output, {
    name: "bitroot-panel",
    port: Number(process.env.PORT),
  });

  const routes: Array<{
    hostname: string;
    service: string;
    port: number | null;
    scheme: string;
    attachedTo: string | null;
  }> = [];
  // parseIngress from lib/routes, not another copy of this format. There
  // were five: this route, api/projects, api/residue, api/static and
  // hostsForPort — each with its own regex and its own blind spots. This one
  // could not see a route whose entry used a scheme it did not expect.
  for (const e of parseIngress(cfg.output)) {
    if (!e.hostname) continue;
    const port = portOf(e.service);
    routes.push({
      hostname: e.hostname,
      service: e.service,
      port,
      scheme: e.service.split("://")[0],
      attachedTo: port
        ? (portToService[port] ?? WELL_KNOWN[port] ?? null)
        : null,
    });
  }

  let daemon = { status: "unknown", uptimeMs: 0, restarts: 0 };
  try {
    const cf = apps.find((a: any) => a.name === "cloudflared");
    if (cf) {
      daemon = {
        status: cf.pm2_env?.status ?? "unknown",
        uptimeMs:
          cf.pm2_env?.status === "online" && cf.pm2_env?.pm_uptime
            ? Date.now() - cf.pm2_env.pm_uptime
            : 0,
        restarts: cf.pm2_env?.restart_time ?? 0,
      };
    }
  } catch {
    // leave unknown
  }

  // Everything on the tailnet, and whether it actually answers there. A service
  // bound to loopback is listed but marked, rather than given a link that
  // cannot open - PocketBase binds to 127.0.0.1 by design.
  const net = await detectTailnet();
  const allPorts = Object.keys(portToService).map(Number);
  const reachable = await reachableOn(net.address ?? TS_IP, allPorts);
  const services = Object.entries(portToService)
    .map(([port, name]) => ({
      name,
      port: Number(port),
      reachable: reachable.has(Number(port)),
    }))
    .sort((a, b) => a.port - b.port);

  return NextResponse.json({
    daemon,
    routes,
    services,
    domain: DOMAIN_SUFFIX,
    // Resolved live rather than read from variables that may never have been
    // set: the page showed "localhost.ts.net" on a machine whose tailnet name
    // the panel already knew how to find.
    tailscale: {
      host: net.host || TS_HOST || null,
      ip: net.address || TS_IP || null,
    },
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
    if (existing.output.trim() !== "0") {
      return NextResponse.json(
        { error: `${name}.${DOMAIN_SUFFIX} is already routed` },
        { status: 400 },
      );
    }

    const add = await run(`tunnel-add ${name} ${port}`, 120_000);
    if (!add.ok) {
      return NextResponse.json(
        { ok: false, output: add.output },
        { status: 500 },
      );
    }
    // SIGHUP, not a restart: cloudflared re-reads its ingress rules in place.
    // Restarting would drop the tunnel carrying this very request, and the
    // browser would see a Cloudflare 530 even though the change succeeded.
    const reload = await run("pkill -HUP -x cloudflared || true", 30_000);
    return NextResponse.json({
      ok: true,
      output:
        `${add.output}\n  cloudflared reloaded${reload.output ? `\n${reload.output}` : ""}`.trim(),
    });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

// Detach a route (ingress entry only; the DNS CNAME stays).
export async function DELETE(req: NextRequest) {
  try {
    const name = assertSubdomain(req.nextUrl.searchParams.get("name"));
    const r = await run(`tunnel-remove ${name}`, 60_000);
    if (!r.ok) {
      return NextResponse.json(
        { ok: false, output: r.output },
        { status: 500 },
      );
    }
    const reload = await run("pkill -HUP -x cloudflared || true", 30_000);

    await recordResidue([
      {
        action: `detached route "${name}.${DOMAIN_SUFFIX}"`,
        kind: "dns",
        what: "Cloudflare DNS record still points at this tunnel",
        target: `${name}.${DOMAIN_SUFFIX}`,
        hint: "Harmless (the hostname now returns 404) and re-attaching is instant. Delete the CNAME in Cloudflare to fully retire it.",
      },
    ]);

    return NextResponse.json({
      ok: true,
      output:
        `${r.output}\n  cloudflared reloaded${reload.output ? `\n${reload.output}` : ""}`.trim(),
    });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
