// Garage object storage, driven through its admin API rather than its CLI.
//
// The API answers in JSON, so usage and quotas arrive as numbers instead of
// being scraped out of formatted text - and the panel runs on the same device,
// so this is a loopback call rather than a shell round trip.

const ADMIN = process.env.GARAGE_ADMIN_URL ?? 'http://127.0.0.1:3903';
const TOKEN = process.env.GARAGE_ADMIN_TOKEN ?? '';

// The only sizes a bucket may be given. Garage enforces these itself, so a
// bucket cannot quietly outgrow its tier while the panel looks away.
export const TIERS_GB = [5, 10, 20, 25] as const;
export type TierGb = (typeof TIERS_GB)[number];

export const GIB = 1024 ** 3;

// Garage serves buckets as websites on this port; the tunnel points at it when
// a bucket is made public.
export const WEB_PORT = 3902;

export interface BucketKey {
  accessKeyId: string;
  name: string;
  permissions: { read: boolean; write: boolean; owner: boolean };
}

export interface Bucket {
  id: string;
  name: string;
  created: string;
  bytes: number;
  objects: number;
  quotaBytes: number | null;
  unfinishedUploads: number;
  websiteAccess: boolean;
  keys: BucketKey[];
}

export function garageConfigured(): boolean {
  return Boolean(TOKEN);
}

async function ga(path: string, init: RequestInit = {}) {
  if (!TOKEN) throw new Error('Garage admin token not configured');
  const res = await fetch(`${ADMIN}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text.trim() || `Garage admin API HTTP ${res.status}`);
  }
  return text ? JSON.parse(text) : null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function toBucket(b: any): Bucket {
  return {
    id: b.id,
    // A bucket can carry several aliases; the first global one is its name.
    name: b.globalAliases?.[0] ?? b.id.slice(0, 12),
    created: b.created ?? '',
    bytes: b.bytes ?? 0,
    objects: b.objects ?? 0,
    quotaBytes: b.quotas?.maxSize ?? null,
    unfinishedUploads: b.unfinishedUploads ?? 0,
    websiteAccess: Boolean(b.websiteAccess),
    keys: (b.keys ?? []).map((k: any) => ({
      accessKeyId: k.accessKeyId,
      name: k.name ?? '',
      permissions: {
        read: Boolean(k.permissions?.read),
        write: Boolean(k.permissions?.write),
        owner: Boolean(k.permissions?.owner),
      },
    })),
  };
}

// ListBuckets omits usage, so each bucket is then read individually. With a
// handful of buckets that is cheaper than it sounds - all loopback - and it is
// the only way to show real bytes against the quota.
export async function listBuckets(): Promise<Bucket[]> {
  const list = await ga('/v2/ListBuckets');
  const full = await Promise.all(
    (list as any[]).map((b) => ga(`/v2/GetBucketInfo?id=${encodeURIComponent(b.id)}`)),
  );
  return full.map(toBucket).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getBucket(id: string): Promise<Bucket> {
  return toBucket(await ga(`/v2/GetBucketInfo?id=${encodeURIComponent(id)}`));
}

export async function findBucketByName(name: string): Promise<Bucket | null> {
  const list = (await ga('/v2/ListBuckets')) as any[];
  const hit = list.find((b) => (b.globalAliases ?? []).includes(name));
  return hit ? getBucket(hit.id) : null;
}

export async function createBucket(name: string, tierGb: TierGb): Promise<Bucket> {
  const created = await ga('/v2/CreateBucket', {
    method: 'POST',
    body: JSON.stringify({ globalAlias: name }),
  });
  await setQuota(created.id, tierGb);
  return getBucket(created.id);
}

export async function setQuota(id: string, tierGb: TierGb): Promise<void> {
  await ga(`/v2/UpdateBucket?id=${encodeURIComponent(id)}`, {
    method: 'POST',
    body: JSON.stringify({ quotas: { maxSize: tierGb * GIB, maxObjects: null } }),
  });
}

export async function setWebsite(id: string, enabled: boolean): Promise<void> {
  await ga(`/v2/UpdateBucket?id=${encodeURIComponent(id)}`, {
    method: 'POST',
    body: JSON.stringify({
      websiteAccess: enabled
        ? { enabled: true, indexDocument: 'index.html', errorDocument: '404.html' }
        : { enabled: false },
    }),
  });
}

export async function deleteBucket(id: string): Promise<void> {
  await ga(`/v2/DeleteBucket?id=${encodeURIComponent(id)}`, { method: 'POST' });
}

export interface CreatedKey {
  accessKeyId: string;
  secretAccessKey: string;
  name: string;
}

// The secret is returned once, at creation, and Garage will not show it again.
export async function createKey(name: string): Promise<CreatedKey> {
  const k = await ga('/v2/CreateKey', { method: 'POST', body: JSON.stringify({ name }) });
  return { accessKeyId: k.accessKeyId, secretAccessKey: k.secretAccessKey, name: k.name };
}

export async function deleteKey(accessKeyId: string): Promise<void> {
  await ga(`/v2/DeleteKey?id=${encodeURIComponent(accessKeyId)}`, { method: 'POST' });
}

export async function allowKey(
  bucketId: string,
  accessKeyId: string,
  permissions: { read: boolean; write: boolean; owner: boolean },
): Promise<void> {
  await ga('/v2/AllowBucketKey', {
    method: 'POST',
    body: JSON.stringify({ bucketId, accessKeyId, permissions }),
  });
}

export interface ClusterInfo {
  available: number;
  capacity: number;
  healthy: boolean;
}

export async function clusterInfo(): Promise<ClusterInfo> {
  const h = await ga('/v2/GetClusterHealth');
  return {
    available: h.partitionsAllOk ?? 0,
    capacity: h.knownNodes ?? 0,
    healthy: h.status === 'healthy',
  };
}

// A bucket that is public is reachable by hostname, so its name has to be a
// legal DNS label whether or not it is public yet - renaming later is not
// something Garage offers.
const BUCKET_NAME = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;

export function assertBucketName(value: unknown): string {
  const name = String(value ?? '').trim();
  if (!BUCKET_NAME.test(name)) {
    throw new Error(
      'bucket name must be 3-32 characters, lowercase letters, digits and hyphens, not starting or ending with a hyphen',
    );
  }
  return name;
}

export function assertTier(value: unknown): TierGb {
  const gb = Number(value);
  if (!TIERS_GB.includes(gb as TierGb)) {
    throw new Error(`tier must be one of ${TIERS_GB.join(', ')} GB`);
  }
  return gb as TierGb;
}
