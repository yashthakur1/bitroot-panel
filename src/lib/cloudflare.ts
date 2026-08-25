// Cloudflare DNS for the tunnel's hostnames.
//
// Records that point a hostname at the tunnel outlive the ingress rule that
// gave them meaning, so the panel reads them straight from Cloudflare (rather
// than trusting a local list) and can delete the ones nothing serves.

import { run } from './runner';

const ZONE = process.env.CF_ZONE_ID ?? '';
const TOKEN = process.env.CF_API_TOKEN ?? '';

export interface DnsRecord {
  id: string;
  name: string;
  type: string;
  content: string;
}

export interface ZoneRecord extends DnsRecord {
  ttl: number;
  proxied: boolean;
  /** Points at the tunnel this machine runs, rather than someone else's. */
  mine: boolean;
}

export interface ZoneView {
  zone: string;
  records: ZoneRecord[];
  /** null when config.yml names no tunnel - then nothing can be called ours. */
  tunnelId: string | null;
}

async function cf(path: string, init: RequestInit = {}) {
  if (!ZONE || !TOKEN) throw new Error('Cloudflare credentials not configured');
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE}${path}`, {
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
    throw new Error(data?.errors?.[0]?.message ?? `Cloudflare API HTTP ${res.status}`);
  }
  return data.result;
}

// The tunnel this machine runs, read from its own config. A zone is shared by
// every device pointed at it, so each machine must only judge its own records.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Exported because publishing needs it too, and .env is not where it lives.
 * On the machine this was written against, TUNNEL_ID is absent and the id is
 * only in the tunnel's own config — so an endpoint that required the env var
 * refused to run on a correctly configured server.
 */
export async function localTunnelId(): Promise<string | null> {
  if (UUID.test(process.env.TUNNEL_ID ?? '')) return process.env.TUNNEL_ID!;

  // config.yml may name the tunnel either way. `tunnel: oneplus-tunnel` is
  // perfectly valid and is what cloudflared writes when a tunnel is created by
  // name - but a DNS record's content carries the UUID, so a name cannot be
  // compared against it. The credentials file is named for the UUID, which
  // makes it the reliable source when the config gives a name.
  const r = await run(
    'cfg="$HOME/.cloudflared/config.yml"; ' +
      `grep -E "^[[:space:]]*tunnel:" "$cfg" 2>/dev/null | head -1 | awk '{print "tunnel=" $2}'; ` +
      `grep -E "^[[:space:]]*credentials-file:" "$cfg" 2>/dev/null | head -1 | awk '{print "creds=" $2}'; ` +
      // Last resort: whatever credentials exist on disk, when the config names
      // neither - one file is unambiguous, several are not.
      'ls -1 "$HOME"/.cloudflared/*.json 2>/dev/null | head -2 | sed "s|^|file=|"; true',
    15_000,
  );

  const named = /^tunnel=(.+)$/m.exec(r.output)?.[1]?.trim() ?? '';
  if (UUID.test(named)) return named;

  const creds = /^creds=(.+)$/m.exec(r.output)?.[1]?.trim() ?? '';
  const fromCreds = creds.split('/').pop()?.replace(/\.json$/i, '') ?? '';
  if (UUID.test(fromCreds)) return fromCreds;

  const files = [...r.output.matchAll(/^file=(.+)$/gm)].map((m) => m[1].trim());
  if (files.length === 1) {
    const only = files[0].split('/').pop()?.replace(/\.json$/i, '') ?? '';
    if (UUID.test(only)) return only;
  }
  return null;
}

// Only records that resolve to *this machine's* tunnel are ours to reason
// about; A records, MX, verification TXTs and anything else are left alone.
//
// This used to match every CNAME in the zone ending in .cfargotunnel.com. With
// two devices on one zone - the normal case as soon as there is a second
// machine - each saw the other's hostnames as served by nothing and offered to
// delete them. A second panel could have taken the first off the internet from
// the page whose entire purpose is tidying up.
//
// When the local tunnel cannot be identified this returns nothing rather than
// everything: refusing to act beats offering to delete records we cannot prove
// belong to us.
export async function listTunnelRecords(): Promise<DnsRecord[]> {
  const id = await localTunnelId();
  if (!id) return [];
  const target = `${id}.cfargotunnel.com`.toLowerCase();
  const all = await cf('/dns_records?per_page=200');
  return (all as DnsRecord[]).filter(
    (r) => r.type === 'CNAME' && r.content.toLowerCase() === target,
  );
}

/**
 * Every record in the zone, with the ones belonging to this machine marked.
 *
 * A zone is shared by every device pointed at it, so a flat list from the
 * Cloudflare dashboard cannot tell you which hostnames this box is actually
 * answering for. That mapping is the only thing the panel knows that the
 * dashboard does not, so it is the thing worth showing.
 */
export async function zoneView(): Promise<ZoneView> {
  const [zone, tunnelId] = await Promise.all([
    cf('') as Promise<{ name?: string }>,
    localTunnelId(),
  ]);

  const target = tunnelId ? `${tunnelId}.cfargotunnel.com` : null;
  const raw = (await cf('/dns_records?per_page=500')) as Array<{
    id: string;
    name: string;
    type: string;
    content: string;
    ttl: number;
    proxied?: boolean;
  }>;

  const records: ZoneRecord[] = raw.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    content: r.content,
    ttl: r.ttl,
    proxied: !!r.proxied,
    mine: !!target && r.type === 'CNAME' && r.content.toLowerCase() === target,
  }));

  records.sort((a, b) => (a.mine === b.mine ? a.name.localeCompare(b.name) : a.mine ? -1 : 1));
  return { zone: zone?.name ?? '', records, tunnelId };
}

export async function deleteDnsRecord(id: string): Promise<void> {
  await cf(`/dns_records/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// Delete the tunnel CNAMEs for the given hostnames. Returns what it removed,
// so the caller can report precisely rather than claiming a clean sweep.
export async function deleteRecordsForHosts(hosts: string[]): Promise<string[]> {
  if (hosts.length === 0 || !dnsConfigured()) return [];
  const wanted = new Set(hosts);
  const removed: string[] = [];
  for (const rec of await listTunnelRecords()) {
    if (!wanted.has(rec.name)) continue;
    await deleteDnsRecord(rec.id);
    removed.push(rec.name);
  }
  return removed;
}

export function dnsConfigured(): boolean {
  return Boolean(ZONE && TOKEN);
}

// Cache rule for published storage buckets.
//
// Cloudflare caches a handful of file extensions by default and ignores the
// rest, so a bucket of .json or extensionless keys would keep reaching the
// device on every read. One rule scoped to the published hostnames makes the
// edge cache everything they serve, honouring the Cache-Control the objects
// already carry rather than overriding it.
const CACHE_PHASE = 'http_request_cache_settings';
const RULE_DESCRIPTION = 'BitPanel storage: cache published bucket objects at the edge';

export async function syncStorageCacheRule(hosts: string[]): Promise<string> {
  if (!dnsConfigured()) return 'Cloudflare not configured';

  // No published bucket means no rule: an empty host set is not a valid
  // expression, and leaving a stale one would match nothing anyway.
  if (hosts.length === 0) {
    try {
      await cf(`/rulesets/phases/${CACHE_PHASE}/entrypoint`, {
        method: 'PUT',
        body: JSON.stringify({ rules: [] }),
      });
      return 'cleared the edge cache rule (no published buckets)';
    } catch (e) {
      return `could not clear the cache rule: ${(e as Error).message}`;
    }
  }

  const expression = `(http.host in {${hosts.map((h) => JSON.stringify(h)).join(' ')}})`;
  try {
    await cf(`/rulesets/phases/${CACHE_PHASE}/entrypoint`, {
      method: 'PUT',
      body: JSON.stringify({
        rules: [
          {
            action: 'set_cache_settings',
            description: RULE_DESCRIPTION,
            expression,
            action_parameters: {
              cache: true,
              edge_ttl: { mode: 'respect_origin' },
              browser_ttl: { mode: 'respect_origin' },
            },
          },
        ],
      }),
    });
    return `edge cache rule now covers ${hosts.length} host${hosts.length === 1 ? '' : 's'}`;
  } catch (e) {
    return `could not update the cache rule: ${(e as Error).message}`;
  }
}


/**
 * Drop cached copies of these URLs from Cloudflare's edge.
 *
 * Making a bucket private closes the origin — Garage answers 404 — but the edge
 * goes on serving whatever it already holds. Publishing stamps objects
 * `public, max-age=31536000, immutable` so they cache well, which means a
 * bucket taken private stayed readable by anyone with the URL for up to a year.
 * Measured, not theorised: after the origin returned 404, the edge still
 * returned the object with `cf-cache-status: HIT`.
 *
 * Purge by URL rather than by hostname on purpose: `hosts` is an Enterprise
 * field, and the zone this was written against is on the Free plan, where a
 * hostname purge fails with a permissions error that reads like a bad token.
 *
 * Returns the number of URLs accepted for purging.
 */
export async function purgeCachedUrls(urls: string[]): Promise<number> {
  if (urls.length === 0 || !dnsConfigured()) return 0;

  // The API takes at most 30 URLs per call on non-Enterprise plans.
  let purged = 0;
  for (let i = 0; i < urls.length; i += 30) {
    const batch = urls.slice(i, i + 30);
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${ZONE}/purge_cache`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ files: batch }),
      },
    );
    const d = (await res.json().catch(() => null)) as { success?: boolean } | null;
    if (!d?.success) {
      throw new Error(
        `Cloudflare refused to purge ${batch.length} URL(s). The token needs Zone:Cache Purge.`,
      );
    }
    purged += batch.length;
  }
  return purged;
}
