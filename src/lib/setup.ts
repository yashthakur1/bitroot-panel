// First-run configuration.
//
// The panel is useless until a handful of credentials exist, and every one of
// them is easy to get subtly wrong - a Cloudflare token missing one permission
// looks identical to a correct one until a cache rule fails with a bare 403.
// So each value is verified by calling the thing it configures, and the wizard
// reports what it actually found rather than accepting what was typed.

import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import dns from 'dns/promises';
import { run } from './runner';
import { applyEnvEdits, parseEnv } from './env';
import { zoneFor } from './routes';

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
    return Object.fromEntries(parseEnv(raw).map((v) => [v.key, v.value]));
  } catch {
    return {};
  }
}

// Rewrites in place: an existing key is replaced where it sits, so comments and
// ordering survive and the file stays readable after the wizard has run.
//
// Values are quoted by lib/env rather than written raw. The raw version silently
// corrupted anything the .env format treats as special, and the wizard writes
// DASHBOARD_PASSWORD straight from user input: a password containing `#` was
// truncated at the hash when read back, locking the operator out of the panel
// they had just configured, with the file looking perfectly reasonable on disk.
export async function writeEnv(updates: Record<string, string>): Promise<void> {
  let raw = '';
  try {
    raw = await readFile(ENV_PATH, 'utf8');
  } catch {
    /* first write */
  }
  const next = applyEnvEdits(
    raw,
    Object.entries(updates).map(([key, value]) => ({ key, value })),
  );
  await writeFile(ENV_PATH, next, { mode: 0o600 });
}

export interface TailnetInfo {
  /** Full .ts.net name, when it can be established. */
  host: string | null;
  /** The CGNAT address on this machine, when there is one. */
  address: string | null;
  /** Whether the CLI answered, or this was inferred. */
  viaCli: boolean;
}

// Tailscale hands out addresses from 100.64.0.0/10. Anything outside
// 100.64-100.127 is ordinary public space and must not be taken for a tailnet.
export async function tailnetAddress(): Promise<string | null> {
  const r = await run('ip -4 addr 2>/dev/null || ifconfig 2>/dev/null || true', 15_000);
  for (const m of r.output.matchAll(/\b100\.(\d{1,3})\.\d{1,3}\.\d{1,3}\b/g)) {
    const second = Number(m[1]);
    if (second >= 64 && second <= 127) return m[0];
  }
  return null;
}

// The CLI is authoritative where it exists. Where it does not - Android runs
// Tailscale as the system app and exposes nothing inside Termux - the address
// is still on an interface, and MagicDNS will name it. That covers the machine
// this panel was built for, which reported "no Tailscale" while sitting on the
// tailnet.
export async function detectTailnet(): Promise<TailnetInfo> {
  try {
    const r = await run('tailscale status --json 2>/dev/null || true', 10_000);
    const json = JSON.parse(r.output.slice(r.output.indexOf('{')));
    const host = (json?.Self?.DNSName ?? '').replace(/\.$/, '') || null;
    const address = (json?.Self?.TailscaleIPs ?? [])[0] ?? null;
    if (host) return { host, address, viaCli: true };
  } catch {
    /* no CLI, or it answered with nothing usable */
  }

  const address = await tailnetAddress();
  if (!address) return { host: null, address: null, viaCli: false };

  try {
    // lookupService, not dns.reverse: reverse() goes through c-ares and needs
    // /etc/resolv.conf, which Termux has no equivalent of - it fails there with
    // ENOTFOUND. lookupService uses getnameinfo, the system resolver, which is
    // exactly the path MagicDNS installs itself on.
    const { hostname } = await dns.lookupService(address, 0);
    const host = hostname.replace(/\.$/, '');
    return { host: /\.ts\.net$/i.test(host) ? host : null, address, viaCli: false };
  } catch {
    return { host: null, address, viaCli: false };
  }
}

export async function setupState(): Promise<SetupState> {
  const env = { ...(await readEnv()), ...process.env } as Record<string, string>;

  const detected = (await detectTailnet()).host;

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


/**
 * Can this domain actually be used as a suffix for published services?
 *
 * Setting a domain used to be a string write with a shape check. Nothing asked
 * whether Cloudflare could issue a certificate for `<name>.<domain>`, so a
 * suffix two levels below the zone was accepted, every service published under
 * it failed the TLS handshake, and the failure looked like a broken server
 * rather than an unsupported name.
 *
 * Returns the zone when usable, and an actionable reason when not.
 */
export async function checkDomainUsable(
  domain: string,
  token?: string,
): Promise<{ ok: boolean; zone?: string; reason?: string }> {
  if (!token) {
    // Without a token the zone cannot be established. Say so rather than
    // guessing: guessing is what put a two-level suffix into .env.
    return {
      ok: true,
      zone: domain,
      reason:
        "No Cloudflare token yet, so the certificate check was skipped. " +
        "Add the token and re-check before publishing anything.",
    };
  }

  // The label walk lives in lib/routes: the panel, the CLI and this check must
  // agree about which zone owns a name, and three copies did not.
  const zone = await zoneFor(domain, token);
  if (zone) {
    const depth =
      domain === zone.name
        ? 0
        : domain.slice(0, -(zone.name.length + 1)).split('.').length;
    // Services are published at <name>.<domain>, so the name is one level
    // deeper than the domain itself. Cloudflare covers *.zone and no more.
    if (depth >= 1) {
      return {
        ok: false,
        zone: zone.name,
        reason:
          `Services would be published at <name>.${domain}, which is ` +
          `${depth + 1} levels below ${zone.name}. Cloudflare's certificate covers ` +
          `only *.${zone.name}, so every service would fail its TLS handshake. ` +
          `Use ${zone.name} as the domain, or add Advanced Certificate Manager.`,
      };
    }
    return { ok: true, zone: zone.name };
  }
  return {
    ok: false,
    reason:
      `No Cloudflare zone found for ${domain}. Add the domain to this Cloudflare ` +
      "account first, or check the API token.",
  };
}
