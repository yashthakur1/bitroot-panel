// First-run configuration.
//
// The panel is useless until a handful of credentials exist, and every one of
// them is easy to get subtly wrong - a Cloudflare token missing one permission
// looks identical to a correct one until a cache rule fails with a bare 403.
// So each value is verified by calling the thing it configures, and the wizard
// reports what it actually found rather than accepting what was typed.

import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { run } from './runner';

const ENV_PATH = process.env.BITPANEL_ENV_PATH ?? path.join(process.cwd(), '.env');

export interface SetupState {
  complete: boolean;
  panel: { password: boolean; secret: boolean };
  domain: string | null;
  cloudflare: { token: boolean; zone: string | null };
  tailscale: { host: string | null; detected: string | null };
  garage: { token: boolean; reachable: boolean };
}

async function readEnv(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(ENV_PATH, 'utf8');
    const out: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) out[m[1]] = m[2].trim();
    }
    return out;
  } catch {
    return {};
  }
}

// Rewrites in place: an existing key is replaced where it sits, so comments and
// ordering survive and the file stays readable after the wizard has run.
export async function writeEnv(updates: Record<string, string>): Promise<void> {
  let raw = '';
  try {
    raw = await readFile(ENV_PATH, 'utf8');
  } catch {
    /* first write */
  }
  const lines = raw ? raw.split('\n') : [];
  for (const [key, value] of Object.entries(updates)) {
    const idx = lines.findIndex((l) => l.match(new RegExp(`^\\s*${key}\\s*=`)));
    if (idx >= 0) lines[idx] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  }
  await writeFile(ENV_PATH, lines.join('\n').replace(/\n{3,}/g, '\n\n'), { mode: 0o600 });
}

export async function setupState(): Promise<SetupState> {
  const env = { ...(await readEnv()), ...process.env } as Record<string, string>;

  // Ask Tailscale rather than asking the user: it knows its own name, and a
  // typo here produces links that quietly do not resolve.
  let detected: string | null = null;
  try {
    const r = await run('tailscale status --json 2>/dev/null || true', 10_000);
    const json = JSON.parse(r.output.slice(r.output.indexOf('{')));
    detected = (json?.Self?.DNSName ?? '').replace(/\.$/, '') || null;
  } catch {
    detected = null;
  }

  let garageReachable = false;
  if (env.GARAGE_ADMIN_TOKEN) {
    try {
      const res = await fetch(`${env.GARAGE_ADMIN_URL ?? 'http://127.0.0.1:3903'}/health`, {
        headers: { Authorization: `Bearer ${env.GARAGE_ADMIN_TOKEN}` },
        cache: 'no-store',
      });
      garageReachable = res.ok;
    } catch {
      garageReachable = false;
    }
  }

  const state: SetupState = {
    complete: false,
    panel: { password: Boolean(env.DASHBOARD_PASSWORD), secret: Boolean(env.SESSION_SECRET) },
    domain: env.DOMAIN_SUFFIX && env.DOMAIN_SUFFIX !== 'example.com' ? env.DOMAIN_SUFFIX : null,
    cloudflare: { token: Boolean(env.CF_API_TOKEN), zone: env.CF_ZONE_ID || null },
    tailscale: { host: env.TAILNET_HOST || null, detected },
    garage: { token: Boolean(env.GARAGE_ADMIN_TOKEN), reachable: garageReachable },
  };
  // Cloudflare and Tailscale are optional: a panel that only runs local
  // services is a legitimate configuration, so they do not block completion.
  state.complete = state.panel.password && state.panel.secret && Boolean(state.domain);
  return state;
}

export interface TokenCheck {
  ok: boolean;
  zoneName?: string;
  permissions: Array<{ name: string; ok: boolean; why: string }>;
}

// Probes each capability the panel actually uses. Reporting "token invalid"
// when only one permission is missing is what cost hours the first time.
export async function checkCloudflare(token: string, zoneId: string): Promise<TokenCheck> {
  const api = 'https://api.cloudflare.com/client/v4';
  const head = { Authorization: `Bearer ${token}` };
  const permissions: TokenCheck['permissions'] = [];
  let zoneName: string | undefined;

  const probe = async (name: string, url: string, why: string) => {
    try {
      const res = await fetch(url, { headers: head, cache: 'no-store' });
      permissions.push({ name, ok: res.ok, why });
      return res;
    } catch {
      permissions.push({ name, ok: false, why });
      return null;
    }
  };

  const zone = await probe('Zone read', `${api}/zones/${zoneId}`, 'confirms the zone id is right');
  if (zone?.ok) {
    const d = await zone.json().catch(() => null);
    zoneName = d?.result?.name;
  }
  await probe('DNS edit', `${api}/zones/${zoneId}/dns_records?per_page=1`, 'creates route records');
  await probe(
    'Cache rules',
    `${api}/zones/${zoneId}/rulesets`,
    'needs Zone:Cache Rules:Edit AND Account:Account Rulesets:Edit — the account-level one is the one people miss',
  );

  return { ok: permissions.every((p) => p.ok), zoneName, permissions };
}
