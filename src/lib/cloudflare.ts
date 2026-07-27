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
