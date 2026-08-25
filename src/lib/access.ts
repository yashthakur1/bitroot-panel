import { run } from './runner';
import { shq, ValidationError } from './validate';
import { zoneFor } from './routes';

// Cloudflare Access: who may pass the email-OTP gate on the public hostnames.
//
// A superadmin is recorded locally and kept in every application's allow list;
// the panel refuses to remove them, because removing the last person with
// access to a hostname locks everyone out of it permanently.

const ZONE = process.env.CF_ZONE_ID ?? '';
const TOKEN = process.env.CF_API_TOKEN ?? '';
const IAM_CONFIG = '"$HOME/.config/bitroot-panel/iam.json"';
// Overridden by ~/.config/bitroot-panel/iam.json on a configured install;
// this is only what an unconfigured checkout falls back to.
const DEFAULT_SUPERADMIN = process.env.SUPERADMIN_EMAIL ?? 'admin@example.com';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface AccessPolicy {
  id: string;
  name: string;
  decision: string;
  precedence?: number;
  emails: string[];
  otherRules: any[];
}

export interface AccessApp {
  id: string;
  name: string;
  domain: string;
  sessionDuration: string;
  /**
   * The audience tag baked into every JWT Access mints for this application.
   * Verifying it is what stops a token for one application opening another.
   */
  aud: string;
  policies: AccessPolicy[];
}

export function assertEmail(email: unknown): string {
  if (
    typeof email !== 'string' ||
    email.length > 120 ||
    !/^[^\s@'"`<>]+@[^\s@'"`<>]+\.[^\s@'"`<>]+$/.test(email)
  ) {
    throw new ValidationError('invalid email address');
  }
  return email.toLowerCase();
}

export function assertUuid(id: unknown): string {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) {
    throw new ValidationError('invalid identifier');
  }
  return id;
}

/**
 * The zone holding *this machine's* applications.
 *
 * Not CF_ZONE_ID. On neev-stag that variable names bitroot.in while the machine
 * serves neevpanel.bitroot.club, so IAM listed the OnePlus's applications and
 * reported that nothing matched a hostname this machine serves — both true, and
 * both useless. The zone is worked out from the hostnames the machine actually
 * publishes, which is the only thing that identifies it.
 */
let zoneCache: { at: number; id: string } | null = null;

async function zoneId(): Promise<string> {
  if (zoneCache && Date.now() - zoneCache.at < 5 * 60_000) return zoneCache.id;

  const cfg = await run('cat "$HOME/.cloudflared/config.yml" 2>/dev/null || true', 15_000);
  const hosts = [...cfg.output.matchAll(/^\s*-?\s*hostname:\s*(\S+)/gm)].map((m) => m[1]);
  for (const host of hosts) {
    const zone = await zoneFor(host, TOKEN);
    if (zone) {
      zoneCache = { at: Date.now(), id: zone.id };
      return zone.id;
    }
  }
  // A machine with no public hostname yet has nothing to work from, so the
  // configured zone is the only answer available.
  if (!ZONE) throw new Error('no Cloudflare zone found for this machine');
  zoneCache = { at: Date.now(), id: ZONE };
  return ZONE;
}

async function cf(path: string, init: RequestInit = {}) {
  if (!TOKEN) throw new Error('Cloudflare credentials not configured');
  const zone = await zoneId();
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => null);
  if (!data?.success) {
    const msg = data?.errors?.[0]?.message ?? `Cloudflare API HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data.result;
}

export async function listApps(): Promise<AccessApp[]> {
  const apps = await cf('/access/apps');
  return (apps as any[]).map((a) => ({
    id: a.id,
    name: a.name,
    domain: a.domain,
    sessionDuration: a.session_duration,
    aud: a.aud,
    policies: (a.policies ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      decision: p.decision,
      precedence: p.precedence,
      emails: (p.include ?? [])
        .filter((i: any) => i.email?.email)
        .map((i: any) => i.email.email as string),
      // domain rules, groups, service tokens… preserved untouched on write
      otherRules: (p.include ?? []).filter((i: any) => !i.email?.email),
    })),
  }));
}

// Cloudflare has no capability endpoint, so probe by writing to a policy id
// that cannot exist: 403 means the token lacks permission, 404 means it has
// permission and the record simply is not there. This never modifies a real
// policy — an earlier version re-wrote a live one on every page load, which
// worked but filled the audit log with phantom edits.
let writeProbe: { at: number; result: boolean } | null = null;

export async function canWritePolicies(): Promise<boolean> {
  if (writeProbe && Date.now() - writeProbe.at < 60_000) return writeProbe.result;
  let result = false;
  try {
    const apps = await listApps();
    const app = apps.find((a) => a.policies.length > 0);
    if (app) {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${await zoneId()}/access/apps/${app.id}/policies/00000000-0000-0000-0000-000000000000`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'probe', decision: 'allow', include: [] }),
          cache: 'no-store',
        },
      );
      result = res.status !== 403;
    }
  } catch {
    result = false;
  }
  writeProbe = { at: Date.now(), result };
  return result;
}

async function writePolicy(
  appId: string,
  policy: AccessPolicy,
  emails: string[],
): Promise<void> {
  await cf(`/access/apps/${appId}/policies/${policy.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: policy.name,
      decision: policy.decision,
      precedence: policy.precedence ?? 1,
      include: [...emails.map((e) => ({ email: { email: e } })), ...policy.otherRules],
    }),
  });
}

export async function getSuperadmin(): Promise<string> {
  const r = await run(`cat ${IAM_CONFIG} 2>/dev/null || true`);
  try {
    const parsed = JSON.parse(r.output.trim() || '{}');
    if (parsed.superadmin) return String(parsed.superadmin).toLowerCase();
  } catch {
    // fall through to the default
  }
  return DEFAULT_SUPERADMIN;
}

export async function setSuperadmin(email: string): Promise<void> {
  const safe = assertEmail(email);
  await run(
    `mkdir -p "$HOME/.config/bitroot-panel" && printf %s ${shq(
      JSON.stringify({ superadmin: safe }, null, 2),
    )} > ${IAM_CONFIG} && chmod 600 ${IAM_CONFIG}`,
  );
}

export async function grantAccess(email: string, appIds: string[]): Promise<string[]> {
  const safe = assertEmail(email);
  const apps = await listApps();
  const touched: string[] = [];

  for (const appId of appIds.map(assertUuid)) {
    const app = apps.find((a) => a.id === appId);
    if (!app) continue;
    const policy = app.policies.find((p) => p.decision === 'allow') ?? app.policies[0];
    if (!policy) continue;
    if (policy.emails.includes(safe)) continue;
    await writePolicy(appId, policy, [...policy.emails, safe]);
    touched.push(app.name);
  }
  return touched;
}

export async function revokeAccess(email: string, appId: string): Promise<void> {
  const safe = assertEmail(email);
  const superadmin = await getSuperadmin();
  if (safe === superadmin) {
    throw new ValidationError(
      'that is the superadmin account — reassign the superadmin before removing it',
    );
  }

  const apps = await listApps();
  const app = apps.find((a) => a.id === assertUuid(appId));
  if (!app) throw new ValidationError('no such application');
  const policy = app.policies.find((p) => p.emails.includes(safe));
  if (!policy) return;

  const remaining = policy.emails.filter((e) => e !== safe);
  if (remaining.length === 0 && policy.otherRules.length === 0) {
    throw new ValidationError(
      `removing ${safe} would leave "${app.name}" with nobody allowed, locking it permanently`,
    );
  }
  await writePolicy(app.id, policy, remaining);
}

// Keep the superadmin present on every application.
export async function syncSuperadmin(): Promise<string[]> {
  const superadmin = await getSuperadmin();
  const apps = await listApps();
  const missing = apps
    .filter((a) => !a.policies.some((p) => p.emails.includes(superadmin)))
    .map((a) => a.id);
  if (missing.length === 0) return [];
  return grantAccess(superadmin, missing);
}


/**
 * The Access application in front of this panel, and the team that signs it.
 *
 * Both are needed before an Access token can be believed, and neither can be
 * guessed: the team names the signing keys, the audience ties a token to this
 * application. Discovered from the hostname the panel is actually published on,
 * so a machine configures itself rather than needing values typed in.
 */
export async function discoverAccessIdentity(
  hostnames: string[],
): Promise<{ team: string; aud: string; app: string } | null> {
  const apps = await listApps().catch(() => []);
  const app = apps.find((a) => hostnames.includes(a.domain.split('/')[0].toLowerCase()));
  if (!app?.aud) return null;

  // The team name is not on the application record. It is in the redirect
  // Access itself issues, which is the authoritative source and costs one
  // unauthenticated request.
  const res = await fetch(`https://${app.domain.split('/')[0]}/`, {
    redirect: 'manual',
    cache: 'no-store',
  }).catch(() => null);
  const location = res?.headers.get('location') ?? '';
  const team = /https:\/\/([a-z0-9-]+)\.cloudflareaccess\.com/i.exec(location)?.[1];
  if (!team) return null;

  return { team, aud: app.aud, app: app.name };
}
