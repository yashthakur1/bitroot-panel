import { NextRequest, NextResponse } from 'next/server';
import { run } from '@/lib/runner';
import { recordResidue } from '@/lib/residue';
import { deleteRecordsForHosts } from '@/lib/cloudflare';
import {
  WEB_PORT,
  assertBucketName,
  assertTier,
  deleteBucket,
  findBucketByName,
  setQuota,
  setWebsite,
} from '@/lib/garage';

const DOMAIN_SUFFIX = process.env.DOMAIN_SUFFIX ?? 'bitroot.in';

// Change a bucket's tier, or move it between private and public.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const name = assertBucketName((await params).name);
    const body = await req.json();
    const bucket = await findBucketByName(name);
    if (!bucket) return NextResponse.json({ error: `no bucket "${name}"` }, { status: 404 });

    const done: string[] = [];

    if (body.tierGb !== undefined) {
      const tierGb = assertTier(body.tierGb);
      // Garage accepts a quota below current usage: existing objects stay and
      // further writes are refused. That is a legitimate way to freeze a
      // bucket, but it should not happen by accident.
      if (bucket.bytes > tierGb * 1024 ** 3) {
        return NextResponse.json(
          {
            error: `bucket already holds ${(bucket.bytes / 1024 ** 3).toFixed(
              1,
            )} GB, which is more than the ${tierGb} GB tier — delete objects first`,
          },
          { status: 400 },
        );
      }
      await setQuota(bucket.id, tierGb);
      done.push(`tier set to ${tierGb} GB`);
    }

    if (body.access === 'public') {
      await setWebsite(bucket.id, true);
      const add = await run(`tunnel-add ${name} ${WEB_PORT}`, 120_000);
      if (!add.ok) {
        // Leave no half-public bucket behind: if the route failed, the website
        // flag goes back off so the panel and the tunnel agree.
        await setWebsite(bucket.id, false);
        return NextResponse.json({ error: `route failed: ${add.output}` }, { status: 500 });
      }
      // SIGHUP rather than restart: cloudflared rereads ingress in place, and a
      // restart would drop the tunnel carrying this very request.
      await run('pkill -HUP -x cloudflared || true', 30_000);
      done.push(`published at https://${name}.${DOMAIN_SUFFIX}`);
    }

    if (body.access === 'private') {
      await setWebsite(bucket.id, false);
      await run(`tunnel-remove ${name}`, 60_000);
      await run('pkill -HUP -x cloudflared || true', 30_000);
      done.push('unpublished; objects are reachable over Tailscale only');
      await recordResidue([
        {
          action: `made bucket "${name}" private`,
          kind: 'dns',
          what: 'Cloudflare DNS record was kept',
          target: `${name}.${DOMAIN_SUFFIX}`,
          hint: 'Harmless — the hostname now returns 404. Delete it from the Residue page to retire it, or keep it to republish instantly.',
        },
      ]);
    }

    return NextResponse.json({ ok: true, output: done.join('\n') });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const name = assertBucketName((await params).name);
    const deleteDns = req.nextUrl.searchParams.get('deleteDns') !== 'false';
    const bucket = await findBucketByName(name);
    if (!bucket) return NextResponse.json({ error: `no bucket "${name}"` }, { status: 404 });

    // Garage refuses to delete a bucket with objects in it, which is the right
    // default — say so plainly rather than surfacing the raw API error.
    if (bucket.objects > 0) {
      return NextResponse.json(
        {
          error: `bucket still holds ${bucket.objects} object${
            bucket.objects === 1 ? '' : 's'
          } — empty it first (rclone delete, or the S3 client of your choice)`,
        },
        { status: 400 },
      );
    }

    const done: string[] = [];
    const kept: Array<Parameters<typeof recordResidue>[0][number]> = [];

    const wasPublic = bucket.websiteAccess;
    if (wasPublic) {
      await run(`tunnel-remove ${name}`, 60_000);
      await run('pkill -HUP -x cloudflared || true', 30_000);
      done.push('removed the tunnel route');
    }

    if (wasPublic && deleteDns) {
      try {
        const removed = await deleteRecordsForHosts([`${name}.${DOMAIN_SUFFIX}`]);
        if (removed.length) done.push(`deleted DNS record: ${removed.join(', ')}`);
      } catch (e) {
        kept.push({
          action: `removed bucket "${name}"`,
          kind: 'dns',
          what: 'Cloudflare DNS record could not be deleted',
          target: `${name}.${DOMAIN_SUFFIX}`,
          hint: `Delete it from the Residue page once Cloudflare is reachable (${(e as Error).message}).`,
        });
      }
    } else if (wasPublic) {
      kept.push({
        action: `removed bucket "${name}"`,
        kind: 'dns',
        what: 'Cloudflare DNS record was kept',
        target: `${name}.${DOMAIN_SUFFIX}`,
        hint: 'Delete it from the Residue page if the hostname is not coming back.',
      });
    }

    await deleteBucket(bucket.id);
    done.push('deleted the bucket');

    // Access keys outlive their bucket in Garage: dropping the bucket revokes
    // the grant but leaves the credential able to authenticate.
    for (const k of bucket.keys) {
      kept.push({
        action: `removed bucket "${name}"`,
        kind: 'files',
        what: 'Access key was kept',
        target: `${k.name || k.accessKeyId} (${k.accessKeyId})`,
        hint: 'It can no longer reach this bucket, but it still exists. Delete it on the Storage page if nothing else uses it.',
      });
    }

    // Garage reclaims deleted blocks on a delay, so the disk does not shrink
    // the moment a bucket goes.
    kept.push({
      action: `removed bucket "${name}"`,
      kind: 'files',
      what: 'Disk space is reclaimed on Garage’s schedule',
      target: '~/storage/garage',
      hint: 'Block garbage collection runs on a delay; free space returns without any action.',
    });

    if (kept.length) await recordResidue(kept);
    return NextResponse.json({ ok: true, output: done.join('\n') });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
