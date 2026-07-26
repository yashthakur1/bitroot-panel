import { NextRequest, NextResponse } from 'next/server';
import { run } from '@/lib/runner';
import { assertName, assertPort, assertRepo, shq, ValidationError } from '@/lib/validate';

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
  const [pm2, ports] = await Promise.all([
    run('pm2 jlist'),
    run('cat "$HOME/bin/ports.conf" 2>/dev/null || true'),
  ]);

  const portMap: Record<string, number> = {};
  for (const line of ports.output.split('\n')) {
    const m = line.match(/^([\w-]+)=(\d+)\s*$/);
    if (m) portMap[m[1]] = Number(m[2]);
  }

  let apps: any[] = [];
  try {
    // pm2 can print daemon-startup noise before the JSON array
    const start = pm2.output.indexOf('[');
    if (start >= 0) apps = JSON.parse(pm2.output.slice(start));
  } catch {
    // fall through with empty list
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

  return NextResponse.json({ projects });
}

// Create a new project: runs `project clone <name> <repo> <port>` on the phone,
// which clones, installs deps, registers with pm2, and adds the tunnel route.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = assertName(body.name);
    const port = assertPort(body.port);
    const repo = assertRepo(body.repo);

    const r = await run(`project clone ${name} ${shq(repo)} ${port}`, 600_000);
    return NextResponse.json({ ok: r.ok, output: r.output }, { status: r.ok ? 200 : 500 });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
