import { NextRequest, NextResponse } from 'next/server';
import { run, runStream } from '@/lib/runner';
import { assertName, assertPort, assertRepo, shq, ValidationError } from '@/lib/validate';
import { assertBranch, assertRepoFullName, getGithubToken } from '@/lib/github';

const SYSTEM_APPS = new Set(['cloudflared', 'deploy-webhook', 'bitroot-panel']);
const DOMAIN_SUFFIX = process.env.DOMAIN_SUFFIX ?? 'bitroot.in';

export interface Project {
  name: string;
  status: string;
  cpu: number;
  memoryMb: number;
  uptimeMs: number;
  restarts: number;
  port: number | null;
  url: string | null;
  system: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET() {
  const [pm2, ports, tunnel, listeners] = await Promise.all([
    run('pm2 jlist'),
    run('cat "$HOME/bin/ports.conf" 2>/dev/null || true'),
    run('cat "$HOME/.cloudflared/config.yml" 2>/dev/null || true'),
    run('ss -tln 2>/dev/null || netstat -tln 2>/dev/null || true'),
  ]);

  const portMap: Record<string, number> = {};
  for (const line of ports.output.split('\n')) {
    const m = line.match(/^([\w-]+)=(\d+)\s*$/);
    if (m) portMap[m[1]] = Number(m[2]);
  }

  // Every port that is spoken for, with a human label of who holds it.
  // Sources in order of label quality: ports.conf, tunnel routes, pm2 env,
  // raw listening sockets.
  const portsInUse: Record<number, string> = {};
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
      if (pendingHost) portsInUse[p] ??= `tunnel route ${pendingHost}`;
      pendingHost = null;
    }
  }

  let apps: any[] = [];
  try {
    // pm2 can print daemon-startup noise before the JSON array
    const start = pm2.output.indexOf('[');
    if (start >= 0) apps = JSON.parse(pm2.output.slice(start));
  } catch {
    // fall through with empty list
  }

  for (const a of apps) {
    const envPort = Number(a.pm2_env?.env?.PORT);
    if (envPort) portsInUse[envPort] ??= `pm2 app "${a.name}"`;
  }
  for (const line of listeners.output.split('\n')) {
    if (!/LISTEN/.test(line)) continue;
    const m = line.match(/[:*](\d{2,5})\s/);
    if (m) portsInUse[Number(m[1])] ??= 'a listening process';
  }

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
    port: portMap[a.name] ?? null,
    url: portMap[a.name] ? `https://${a.name}.${DOMAIN_SUFFIX}` : null,
    system: SYSTEM_APPS.has(a.name),
  }));

  // Registered in ports.conf but not present in pm2 (e.g. removed from pm2 by hand)
  for (const [name, port] of Object.entries(portMap)) {
    if (!projects.some((p) => p.name === name)) {
      projects.push({
        name,
        status: 'stopped',
        cpu: 0,
        memoryMb: 0,
        uptimeMs: 0,
        restarts: 0,
        port,
        url: `https://${name}.${DOMAIN_SUFFIX}`,
        system: false,
      });
    }
  }

  return NextResponse.json({ projects, portsInUse });
}

// Create a new project: runs `project clone <name> <repo> <port> [branch] [--no-tunnel]`
// on the phone — clone, install deps, register with pm2, and (for public
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
      repoUrl = `https://github.com/${full}.git`;
    } else {
      repoUrl = assertRepo(body.repo);
    }

    // GIT_TERMINAL_PROMPT=0: fail fast on missing credentials instead of
    // hanging on a username prompt that can never be answered.
    const cmd =
      `GIT_TERMINAL_PROMPT=0 project clone ${name} ${shq(repoUrl)} ${port} ${shq(branch)}` +
      (internal ? ' --no-tunnel' : '');
    // Stream the phone's output live so the UI can render a step timeline.
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
