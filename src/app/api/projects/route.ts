import { NextRequest, NextResponse } from 'next/server';
import { run, runCached, runStream } from '@/lib/runner';
import { assertName, assertPort, assertRepo, shq, ValidationError } from '@/lib/validate';
import { assertBranch, assertRepoFullName, getGithubToken } from '@/lib/github';
import { assertConnectionId, cloneUrlFor } from '@/lib/git-connections';

const SYSTEM_APPS = new Set([
  'cloudflared',
  'deploy-webhook',
  'bitroot-panel',
  'nginx',
  'pocketbase',
]);
const DOMAIN_SUFFIX = process.env.DOMAIN_SUFFIX ?? 'example.com';
const TAILNET_HOST = process.env.TAILNET_HOST ?? 'localhost';
const TAILNET_IP = process.env.TAILNET_IP ?? '127.0.0.1';

// Installed CLI apps and packages are not processes and are reported by
// /api/system instead; this endpoint stays about things pm2 and nginx run.
export interface Project {
  name: string;
  status: string;
  cpu: number;
  memoryMb: number;
  uptimeMs: number;
  restarts: number;
  port: number | null;
  /** Node, Go, C, Binary - from pm2 rather than the service's name. */
  runtime?: string;
  url: string | null;
  // Reachable over Tailscale but not published. Null when the service binds to
  // loopback only, so the panel never offers a link that cannot open.
  privateUrl: string | null;
  system: boolean;
  type?: 'node' | 'static';
}

/* eslint-disable @typescript-eslint/no-explicit-any */

// pm2 knows whether it launched an interpreter or a binary. Beyond that only
// the daemons the panel installs itself can be named honestly - nginx is C, and
// calling it Go because it sat in a list beside three Go programs is the kind
// of detail that quietly teaches people the panel is guessing.
const DAEMON_RUNTIME: Record<string, string> = {
  nginx: 'C',
  garage: 'Go',
  cloudflared: 'Go',
  pocketbase: 'Go',
};

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
function runtimeOf(a: any): string {
  const interp = a?.pm2_env?.exec_interpreter;
  if (interp && interp !== 'none') return interp === 'node' ? 'Node' : interp;
  return DAEMON_RUNTIME[a?.name] ?? 'Binary';
}

export async function GET() {
  const [pm2, ports, tunnel, statics] = await Promise.all([
    runCached('pm2 jlist'),
    run('cat "$HOME/bin/ports.conf" 2>/dev/null || true'),
    run('cat "$HOME/.cloudflared/config.yml" 2>/dev/null || true'),
    run('static-site list 2>/dev/null || true'),
  ]);

  // Static sites are served by the shared nginx, so they have no pm2 entry.
  const staticSites = statics.output
    .split('\n')
    .map((l) => l.split('|'))
    .filter((p) => p.length === 5 && p[0])
    .map(([name, port, , state]) => ({
      name,
      port: Number(port),
      served: state === 'served',
    }));
  const staticNames = new Set(staticSites.map((s) => s.name));

  const portMap: Record<string, number> = {};
  for (const line of ports.output.split('\n')) {
    const m = line.match(/^([\w-]+)=(\d+)\s*$/);
    if (m) portMap[m[1]] = Number(m[2]);
  }

  // Every port that is spoken for, with a human label of who holds it.
  // Sources in order of label quality: ports.conf, tunnel routes, pm2 env,
  // raw listening sockets.
  // Which ports answer on the tailnet address. Android denies netlink, so the
  // bind address cannot be enumerated - connecting to it is the only honest
  // test, and it is what decides whether a private link is offered at all.
  const candidatePorts = new Set<number>();
  const portsInUse: Record<number, string> = {};
  // The hostname the tunnel actually serves for a port. A project's public URL
  // is derived from this rather than assumed from its name: without a route
  // there is no URL, and with one the hostname need not match the name.
  const hostForPort: Record<number, string> = {};
  for (const [pname, pport] of Object.entries(portMap)) {
    portsInUse[pport] = `project "${pname}"`;
  }
  let pendingHost: string | null = null;
  for (const raw of tunnel.output.split('\n')) {
    const line = raw.trim();
    const h = line.match(/^-\s*hostname:\s*(\S+)/);
    if (h) {
      pendingHost = h[1];
      continue;
    }
    const s = line.match(/^(?:-\s*)?service:\s*\w+:\/\/localhost:(\d+)/);
    if (s) {
      const p = Number(s[1]);
      if (pendingHost) {
        portsInUse[p] ??= `tunnel route ${pendingHost}`;
        hostForPort[p] ??= pendingHost;
      }
      pendingHost = null;
    }
  }

  for (const p of Object.values(portMap)) candidatePorts.add(p);
  for (const s of staticSites) candidatePorts.add(s.port);
  // pm2 knows a port for services that were never written to ports.conf - the
  // panel and the deploy webhook among them - so take that as a third source.
  const pm2Port: Record<string, number> = {};
  let apps: any[] = [];
  try {
    // pm2 can print daemon-startup noise before the JSON array
    const start = pm2.output.indexOf('[');
    if (start >= 0) apps = JSON.parse(pm2.output.slice(start));
  } catch {
    // fall through with empty list
  }

  // pm2 records the environment a process was started with, and a child
  // inherits PORT from whatever shell launched it. cloudflared started from a
  // shell that had sourced .env carried PORT=3210 and was then credited with
  // the panel's own address. A port claimed by more than one process is
  // inherited, not owned, and proves nothing about either.
  const envPortClaims: Record<number, string[]> = {};
  for (const a of apps) {
    const envPort = Number(a.pm2_env?.env?.PORT);
    if (envPort) (envPortClaims[envPort] ??= []).push(a.name);
  }
  for (const [portStr, names] of Object.entries(envPortClaims)) {
    if (names.length !== 1) continue;
    const envPort = Number(portStr);
    portsInUse[envPort] ??= `pm2 app "${names[0]}"`;
    pm2Port[names[0]] = envPort;
  }

  for (const p of Object.values(pm2Port)) candidatePorts.add(p);
  const probe = candidatePorts.size
    ? await run(
        [...candidatePorts]
          .map(
            // nc, not /dev/tcp: commands run under sh, which on Termux is dash,
            // and /dev/tcp is a bash-ism. Under dash every probe fails silently
            // and every service looks unreachable.
            (p) => `nc -z -w 2 ${TAILNET_IP} ${p} >/dev/null 2>&1 && echo ${p}:up || echo ${p}:down`,
          )
          .join('; '),
        20_000,
      )
    : { ok: true, output: '' };
  const reachable = new Set(
    probe.output
      .split('\n')
      .filter((l) => l.trim().endsWith(':up'))
      .map((l) => Number(l.trim().split(':')[0])),
  );
  const privateUrlFor = (port: number | null) =>
    port && reachable.has(port) ? `http://${TAILNET_HOST}:${port}` : null;

  // Note: enumerating listening sockets is impossible here — Android denies
  // netlink to apps, so ss/netstat return nothing. Ports are therefore tracked
  // from what the panel manages (registry, tunnel routes, pm2), and liveness is
  // probed directly where it matters (see the residue scan).

  const projects: Project[] = apps.map((a: any) => ({
    name: a.name,
    status: a.pm2_env?.status ?? 'unknown',
    cpu: a.monit?.cpu ?? 0,
    memoryMb: Math.round((a.monit?.memory ?? 0) / 1024 / 1024),
    uptimeMs:
      a.pm2_env?.status === 'online' && a.pm2_env?.pm_uptime
        ? Date.now() - a.pm2_env.pm_uptime
        : 0,
    restarts: a.pm2_env?.restart_time ?? 0,
    // ports.conf first, then what pm2 was started with: the panel and the
    // deploy webhook were never written to the registry, so the column sat
    // empty for services whose port is plainly known.
    port: portMap[a.name] ?? pm2Port[a.name] ?? null,
    url: hostForPort[portMap[a.name] ?? pm2Port[a.name]]
      ? `https://${hostForPort[portMap[a.name] ?? pm2Port[a.name]]}`
      : null,
    // An app may listen on more than one port - an API plus a dashboard. Prefer
    // whichever is actually reachable, since the registered port is often the
    // internal one.
    privateUrl:
      privateUrlFor(portMap[a.name] ?? null) ??
      privateUrlFor(
        Object.entries(portMap).find(([n]) => n.startsWith(`_${a.name}-`))?.[1] ?? null,
      ) ??
      privateUrlFor(pm2Port[a.name] ?? null),
    system: SYSTEM_APPS.has(a.name),
    runtime: runtimeOf(a),
    type: 'node' as const,
  }));

  const nginxOnline = apps.some(
    (a: any) => a.name === 'nginx' && a.pm2_env?.status === 'online',
  );
  for (const s of staticSites) {
    projects.push({
      name: s.name,
      status: s.served && nginxOnline ? 'online' : 'stopped',
      cpu: 0,
      memoryMb: 0,
      uptimeMs: 0,
      restarts: 0,
      port: s.port,
      url: hostForPort[s.port] ? `https://${hostForPort[s.port]}` : null,
      privateUrl: privateUrlFor(s.port),
      system: false,
      type: 'static',
    });
  }

  // Registered in ports.conf but not present in pm2 (e.g. removed from pm2 by hand).
  // A leading underscore marks a port reserved by a service that already has an
  // entry - a second port for the same app - so it holds the port without
  // appearing as a project of its own.
  for (const [name, port] of Object.entries(portMap)) {
    if (staticNames.has(name) || name.startsWith('_')) continue;
    if (!projects.some((p) => p.name === name)) {
      projects.push({
        name,
        status: 'stopped',
        cpu: 0,
        memoryMb: 0,
        uptimeMs: 0,
        restarts: 0,
        port,
        url: hostForPort[port] ? `https://${hostForPort[port]}` : null,
        privateUrl: privateUrlFor(port),
        system: false,
        type: 'node',
      });
    }
  }

  return NextResponse.json({ projects, portsInUse });
}

// Create a new project: runs `project clone <name> <repo> <port> [branch] [--no-tunnel]`
// on the server — clone, install deps, register with pm2, and (for public
// environment) add the Cloudflare tunnel route.
//
// Two sources: `github` (repo = "owner/name"; private repos authenticate via
// git's credential store, set up when GitHub was connected) or `url` (any git
// URL, as before).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = assertName(body.name);
    const port = assertPort(body.port);
    const branch = body.branch ? assertBranch(body.branch) : '';
    const internal = body.environment === 'private';

    let repoUrl: string;
    if (body.source === 'github') {
      const full = assertRepoFullName(body.repo);
      if (!(await getGithubToken())) {
        return NextResponse.json({ error: 'GitHub not connected' }, { status: 400 });
      }
      // Pin the connection so git picks that account's stored credential.
      const connectionId = body.connectionId
        ? assertConnectionId(body.connectionId)
        : undefined;
      repoUrl = connectionId
        ? cloneUrlFor(connectionId, full)
        : `https://github.com/${full}.git`;
    } else {
      repoUrl = assertRepo(body.repo);
    }

    // GIT_TERMINAL_PROMPT=0: fail fast on missing credentials instead of
    // hanging on a username prompt that can never be answered.
    const cmd =
      `GIT_TERMINAL_PROMPT=0 project clone ${name} ${shq(repoUrl)} ${port} ${shq(branch)}` +
      (internal ? ' --no-tunnel' : '');
    // Stream the server's output live so the UI can render a step timeline.
    return new Response(runStream(cmd, 600_000), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
