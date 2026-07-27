import { NextRequest, NextResponse } from 'next/server';
import { run } from '@/lib/runner';
import {
  GIB,
  TIERS_GB,
  WEB_PORT,
  assertBucketName,
  assertTier,
  createBucket,
  findBucketByName,
  garageConfigured,
  listBuckets,
} from '@/lib/garage';
import { hostsForPort } from '@/lib/routes';

const DOMAIN_SUFFIX = process.env.DOMAIN_SUFFIX ?? 'bitroot.in';
const TAILNET_HOST = process.env.TAILNET_HOST ?? 'oneplus-6.tailf9a49f.ts.net';
const S3_PORT = 3900;

export async function GET() {
  if (!garageConfigured()) {
    return NextResponse.json({ configured: false, buckets: [], tiers: TIERS_GB });
  }
  try {
    const [buckets, publicHosts, disk] = await Promise.all([
      listBuckets(),
      // Which buckets are actually routed, read from the tunnel rather than
      // assumed from Garage's website flag - the two can disagree if a route
      // was removed by hand, and the honest answer is what the tunnel says.
      hostsForPort(WEB_PORT),
      run("df -k \"$HOME\" | tail -1 | awk '{print $4}'"),
    ]);

    const routed = new Set(publicHosts.map((h) => h.split('.')[0]));
    const freeBytes = Number(disk.output.trim()) * 1024;

    return NextResponse.json({
      configured: true,
      tiers: TIERS_GB,
      freeBytes: Number.isFinite(freeBytes) ? freeBytes : null,
      // Committed is what the tiers promise, which can exceed what is actually
      // stored - worth showing so the device is not oversubscribed silently.
      committedBytes: buckets.reduce((n, b) => n + (b.quotaBytes ?? 0), 0),
      s3Endpoint: `http://${TAILNET_HOST}:${S3_PORT}`,
      buckets: buckets.map((b) => ({
        ...b,
        access: routed.has(b.name) && b.websiteAccess ? 'public' : 'private',
        publicUrl: routed.has(b.name) ? `https://${b.name}.${DOMAIN_SUFFIX}` : null,
      })),
    });
  } catch (e) {
    return NextResponse.json({ configured: true, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = assertBucketName(body.name);
    const tierGb = assertTier(body.tierGb);

    if (await findBucketByName(name)) {
      return NextResponse.json({ error: `bucket "${name}" already exists` }, { status: 400 });
    }

    // Refuse to promise more than the device can hold. Garage would happily
    // accept the quota and only fail later, mid-upload, with the disk full.
    const [buckets, disk] = await Promise.all([
      listBuckets(),
      run("df -k \"$HOME\" | tail -1 | awk '{print $4}'"),
    ]);
    const free = Number(disk.output.trim()) * 1024;
    const committed = buckets.reduce((n, b) => n + (b.quotaBytes ?? 0), 0);
    if (Number.isFinite(free) && committed + tierGb * GIB > free) {
      return NextResponse.json(
        {
          error: `${tierGb} GB would over-commit the device: ${Math.round(
            committed / GIB,
          )} GB already promised to other buckets and only ${Math.round(free / GIB)} GB free`,
        },
        { status: 400 },
      );
    }

    const bucket = await createBucket(name, tierGb);
    return NextResponse.json({ ok: true, bucket });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
