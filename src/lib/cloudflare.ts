// Cloudflare DNS for the tunnel's hostnames.
//
// Records that point a hostname at the tunnel outlive the ingress rule that
// gave them meaning, so the panel reads them straight from Cloudflare (rather
// than trusting a local list) and can delete the ones nothing serves.

const ZONE = process.env.CF_ZONE_ID ?? '';
const TOKEN = process.env.CF_API_TOKEN ?? '';

export interface DnsRecord {
  id: string;
  name: string;
  type: string;
  content: string;
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

// Only records that resolve to a tunnel are ours to reason about; A records,
// MX, verification TXTs and anything else are left strictly alone.
export async function listTunnelRecords(): Promise<DnsRecord[]> {
  const all = await cf('/dns_records?per_page=200');
  return (all as DnsRecord[]).filter(
    (r) => r.type === 'CNAME' && r.content.endsWith('.cfargotunnel.com'),
  );
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
