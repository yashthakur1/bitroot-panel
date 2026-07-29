// Which process owns which port, and whether that port is reachable.
//
// Two pages ask this and both used to answer it differently: the services list
// read only ports.conf, the routes page read ports.conf plus pm2's environment.
// Neither looked at the arguments a process was actually started with, so
// PocketBase - whose port is in --http=127.0.0.1:8090 and nowhere else - was
// missing from both.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { run } from './runner';

/** A port named in the process's own arguments is stated, not inherited. */
export function portFromArgs(app: any): number | null {
  const args: string[] = Array.isArray(app?.pm2_env?.args) ? app.pm2_env.args : [];
  const joined = args.join(' ');
  const m =
    /--(?:http|addr|listen)[= ]\S*?:(\d{2,5})/.exec(joined) ??
    /--port[= ](\d{2,5})/.exec(joined) ??
    /(?:^|\s)-p\s+(\d{2,5})/.exec(joined);
  const port = m ? Number(m[1]) : NaN;
  return Number.isFinite(port) && port > 0 && port < 65536 ? port : null;
}

export interface PortOwnership {
  /** service name -> port */
  byName: Record<string, number>;
  /** port -> service name */
  byPort: Record<number, string>;
}

/**
 * Sources in increasing order of how much they prove:
 *  - ports.conf, the registry the panel maintains
 *  - a PORT in pm2's recorded environment, but only if exactly one process
 *    claims it; a child inherits PORT from whatever shell launched it, and a
 *    shared value proves nothing about either process
 *  - a port written into the process's own arguments, which is stated outright
 */
export function ownedPorts(apps: any[], portsConf: string): PortOwnership {
  const byName: Record<string, number> = {};
  const byPort: Record<number, string> = {};

  for (const line of portsConf.split('\n')) {
    const m = line.match(/^([\w-]+)=(\d+)\s*$/);
    if (m) {
      byName[m[1]] = Number(m[2]);
      byPort[Number(m[2])] = m[1];
    }
  }

  const claims: Record<number, string[]> = {};
  for (const a of apps) {
    const p = Number(a?.pm2_env?.env?.PORT);
    if (p) (claims[p] ??= []).push(a.name);
  }
  for (const [portStr, names] of Object.entries(claims)) {
    if (names.length !== 1) continue;
    const port = Number(portStr);
    byName[names[0]] ??= port;
    byPort[port] ??= names[0];
  }

  for (const a of apps) {
    const p = portFromArgs(a);
    if (!p) continue;
    byName[a.name] = p;
    byPort[p] = a.name;
  }

  return { byName, byPort };
}

/**
 * Which of these ports answer on the tailnet address.
 *
 * nc, not /dev/tcp: commands run under sh, which is dash on both Termux and
 * Debian, and /dev/tcp is a bash-ism that fails silently there. A service bound
 * to loopback will not answer, which is the point - offering a private URL for
 * it would be offering a link that cannot open.
 */
export async function reachableOn(host: string, ports: number[]): Promise<Set<number>> {
  const unique = [...new Set(ports)].filter((p) => Number.isFinite(p) && p > 0);
  if (unique.length === 0 || !host) return new Set();
  const probe = await run(
    unique.map((p) => `nc -z -w 2 ${host} ${p} >/dev/null 2>&1 && echo ${p}:up || echo ${p}:down`).join('; '),
    20_000,
  );
  return new Set(
    probe.output
      .split('\n')
      .filter((l) => l.trim().endsWith(':up'))
      .map((l) => Number(l.trim().split(':')[0]))
      .filter((n) => Number.isFinite(n)),
  );
}
