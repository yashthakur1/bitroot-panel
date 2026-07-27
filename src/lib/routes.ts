import { run } from './runner';

// Hostnames whose ingress rule points at a given local port. Removal needs
// this because a route's hostname is not required to match the service name.
export async function hostsForPort(port: number): Promise<string[]> {
  const cfg = await run('cat "$HOME/.cloudflared/config.yml" 2>/dev/null || true');
  const hosts: string[] = [];
  let pending: string | null = null;
  for (const raw of cfg.output.split('\n')) {
    const line = raw.trim();
    const h = line.match(/^-\s*hostname:\s*(\S+)/);
    if (h) {
      pending = h[1];
      continue;
    }
    const svc = line.match(/^(?:-\s*)?service:\s*\w+:\/\/localhost:(\d+)/);
    if (svc) {
      if (pending && Number(svc[1]) === port) hosts.push(pending);
      pending = null;
    }
  }
  return hosts;
}

export async function portForService(name: string): Promise<number | null> {
  const r = await run(`grep "^${name}=" "$HOME/bin/ports.conf" 2>/dev/null | cut -d= -f2 || true`);
  const port = Number(r.output.trim());
  return Number.isInteger(port) && port > 0 ? port : null;
}
