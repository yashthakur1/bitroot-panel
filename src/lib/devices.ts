// The other machines on this tailnet, and what is answering on them.
//
// The panel manages one machine. A team running several needs to know the rest
// exist, which are reachable, and what each is for - and today that lives in
// somebody's head. This does not manage anything remote: it reports.
//
// Discovery goes through the Tailscale API rather than the CLI, because the
// device that most needs this cannot run the CLI. On Android, Tailscale is the
// app; there is no `tailscale` binary in Termux, so `tailscale status` is not
// an option on the phone. The API works from anywhere with a key.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from './runner';
import { detectTailnet } from './setup';

const API = 'https://api.tailscale.com/api/v2';

const KEY = () => process.env.TS_API_KEY ?? '';
const TAILNET = () => process.env.TS_TAILNET ?? '-';

export function devicesConfigured(): boolean {
  return !!KEY();
}

/**
 * absent  - no key anywhere
 * stale   - the key is in .env, but this process was started without it
 * loaded  - the running process has it
 *
 * The middle state is worth naming. pm2 replays the environment it captured
 * when a process was first created and never re-reads .env, so a key added
 * afterwards is on disk and invisible at the same time - and a page that only
 * says "not configured" sends you to re-do the step you already did.
 */
export async function keyState(): Promise<'loaded' | 'stale' | 'absent'> {
  if (KEY()) return 'loaded';
  const txt = await readFile(join(process.cwd(), '.env'), 'utf8').catch(() => '');
  return /^TS_API_KEY=\S/m.test(txt) ? 'stale' : 'absent';
}

/** A port worth knowing about, and what answering on it implies. */
const SIGNATURES: Array<{ port: number; role: string }> = [
  { port: 3210, role: 'BitPanel' },
  { port: 3000, role: 'Dokploy' },
  { port: 8090, role: 'PocketBase' },
  { port: 443, role: 'https' },
  { port: 80, role: 'http' },
  { port: 22, role: 'ssh' },
];

export interface Device {
  id: string;
  name: string;
  hostname: string;
  os: string;
  address: string;
  online: boolean;
  lastSeen: string;
  /** Tailscale client version, and whether it is behind. */
  clientVersion: string;
  updateAvailable: boolean;
  /** This panel's own machine. */
  self: boolean;
  /** Roles inferred from which ports answer. Empty when unreachable. */
  roles: string[];
  ports: number[];
}

async function ts(path: string): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${KEY()}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      res.status === 401 || res.status === 403
        ? 'Tailscale rejected the API key. It may be expired — keys default to 90 days.'
        : `Tailscale API HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ''}`,
    );
  }
  return res.json();
}

/**
 * Which of these ports answer, for every address, in one shell round trip.
 *
 * nc rather than /dev/tcp: commands run under sh, which is dash on both Termux
 * and Debian, where /dev/tcp is a bash-ism that fails silently. A short timeout
 * matters more than completeness here - an offline phone should not hold the
 * page for thirty seconds.
 */
async function probe(addresses: string[]): Promise<Record<string, number[]>> {
  const targets = addresses.filter(Boolean);
  if (!targets.length) return {};

  // Backgrounded, not sequential. Six ports across four machines is 24 probes;
  // run in series with a 2s timeout each, an offline device alone costs 12s and
  // the whole sweep can outlast its own timeout. In parallel the sweep costs
  // about as long as the slowest single probe.
  const cmd =
    targets
      .flatMap((a) =>
        SIGNATURES.map(
          (s) => `(nc -z -w 2 ${a} ${s.port} >/dev/null 2>&1 && echo "${a}:${s.port}") &`,
        ),
      )
      .join('\n') + '\nwait';

  const r = await run(cmd, 25_000);
  const open: Record<string, number[]> = {};
  for (const line of r.output.split('\n')) {
    const m = /^(\S+):(\d+)$/.exec(line.trim());
    if (!m) continue;
    (open[m[1]] ??= []).push(Number(m[2]));
  }
  return open;
}

interface TsDevice {
  id?: string;
  name?: string;
  hostname?: string;
  os?: string;
  addresses?: string[];
  lastSeen?: string;
  clientVersion?: string;
  updateAvailable?: boolean;
}

export async function listDevices(): Promise<Device[]> {
  if (!KEY()) throw new Error('TS_API_KEY is not set');

  const data = (await ts(`/tailnet/${encodeURIComponent(TAILNET())}/devices`)) as {
    devices?: TsDevice[];
  };
  const raw = data.devices ?? [];

  // Identifying this machine is a solved problem in setup.ts, so use that
  // rather than inventing a third answer. `hostname` in particular is wrong:
  // Termux reports "localhost" no matter what the tailnet calls the device, so
  // matching on it fails on the one machine guaranteed to be in the list.
  // detectTailnet() prefers the CLI and falls back to a reverse lookup, which
  // is the path that works on Android.
  const net = await detectTailnet().catch(() => ({ host: null, address: null }));
  const selfAddr = net.address ?? '';
  const selfHost = (net.host ?? process.env.TAILNET_HOST ?? '').toLowerCase();

  const v4 = (d: TsDevice) => (d.addresses ?? []).find((a) => /^100\./.test(a)) ?? '';
  const open = await probe(raw.map(v4));

  return raw
    .map((d): Device => {
      const address = v4(d);
      const ports = (open[address] ?? []).sort((a, b) => a - b);
      // Tailscale's own `online` field is not in every API response shape, so
      // reachability is taken from whether anything answered. A device with no
      // listening ports reads as offline here even if the tailnet knows it is
      // up - which is the more useful statement for a page about services.
      return {
        id: d.id ?? address,
        name: (d.name ?? '').split('.')[0] || d.hostname || address,
        hostname: d.hostname ?? '',
        os: d.os ?? '',
        address,
        online: ports.length > 0,
        lastSeen: d.lastSeen ?? '',
        clientVersion: (d.clientVersion ?? '').split('-')[0],
        updateAvailable: !!d.updateAvailable,
        // Address first - it is exact. The MagicDNS name is the fallback for
        // machines where the address could not be read.
        self:
          (!!selfAddr && address === selfAddr) ||
          (!!selfHost && (d.name ?? '').toLowerCase().replace(/\.$/, '') === selfHost),
        roles: SIGNATURES.filter((s) => ports.includes(s.port))
          .map((s) => s.role)
          .filter((r) => !['http', 'https', 'ssh'].includes(r)),
        ports,
      };
    })
    .sort((a, b) => {
      if (a.self !== b.self) return a.self ? -1 : 1;
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}
