import { NextRequest, NextResponse } from 'next/server';
import { run } from '@/lib/runner';
import { recordResidue } from '@/lib/residue';
import {
  deleteRecordsForHosts,
  purgeCachedUrls,
  syncStorageCacheRule,
} from '@/lib/cloudflare';
import {
  WEB_PORT,
  assertBucketName,
  assertTier,
  deleteBucket,
  ensureUploadAccess,
  findBucketByName,
  setQuota,
  setWebsite,
} from '@/lib/garage';
import { listObjects, restampObject } from '@/lib/s3';
import { hostsForPort } from '@/lib/routes';

const PUBLIC_CACHE = 'public, max-age=31536000, immutable';

/**
 * Take a bucket's objects out of Cloudflare's cache.
 *
 * Closing the origin is not enough. Objects are published with a one-year
 * immutable cache header, so without this a bucket made private keeps serving
 * to anyone holding a URL — confirmed on a live bucket, where the origin
 * returned 404 while the edge returned the file with cf-cache-status: HIT.
 *
 * Never throws: the caller has already made the bucket private, and reporting
 * what is still cached is more useful than failing the whole operation.
 */
async function purgeBucket(name: string, bucketId: string): Promise<string> {
  try {
    const cred = await ensureUploadAccess(bucketId);
    const objects = await listObjects(cred.accessKeyId, cred.secretAccessKey, name);
    if (objects.length === 0) return 'nothing was cached to purge';
    const urls = objects.map(
      (o) => `https://${name}.${DOMAIN_SUFFIX}/${o.key.split('/').map(encodeURIComponent).join('/')}`,
    );
    const purged = await purgeCachedUrls(urls);
    return `purged ${purged} cached object${purged === 1 ? '' : 's'} from Cloudflare`;
  } catch (e) {
    return (
      'WARNING: the objects could not be purged from Cloudflare, so they stay ' +
      `readable at the edge until the cache expires — ${(e as Error).message}`
    );
  }
}

const DOMAIN_SUFFIX = process.env.DOMAIN_SUFFIX ?? 'example.com';

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
      if (tierGb !== null && bucket.bytes > tierGb * 1024 ** 3) {
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
      done.push(tierGb === null ? 'cap removed — grows with use' : `cap set to ${tierGb} GB`);
    }

    if (body.access === 'public') {
      await setWebsite(bucket.id, true);
      // Publishing an already-published bucket must not append a second ingress
      // rule for the same hostname; cloudflared matches the first and the rest
      // are dead weight that also skew the cache rule's host list.
      const alreadyRouted = (await hostsForPort(WEB_PORT)).includes(
        `${name}.${DOMAIN_SUFFIX}`,
      );
      const add = alreadyRouted
        ? { ok: true, output: 'route already present' }
        : await run(`tunnel-add ${name} ${WEB_PORT}`, 120_000);
      if (!add.ok) {
        // Leave no half-public bucket behind: if the route failed, the website
        // flag goes back off so the panel and the tunnel agree.
        await setWebsite(bucket.id, false);
        return NextResponse.json({ error: `route failed: ${add.output}` }, { status: 500 });
      }
      // SIGHUP is not enough: cloudflared re-reads the file but does not pick up
      // a hostname that was not there when it started, so the request falls
      // through to the catch-all 404. It needs a real restart - detached and
      // slightly delayed, so this response is already on its way out before the
      // tunnel carrying it blinks.
      await run('(sleep 2; pm2 restart cloudflared >/dev/null 2>&1) >/dev/null 2>&1 &', 10_000);
      done.push(`published at https://${name}.${DOMAIN_SUFFIX}`);

      // Objects uploaded before this point may carry a non-cacheable header,
      // which would make Cloudflare BYPASS them for ever and send every read to
      // the device - defeating the reason for publishing. Re-stamp them.
      try {
        const cred = await ensureUploadAccess(bucket.id);
        const objects = await listObjects(cred.accessKeyId, cred.secretAccessKey, name);
        let fixed = 0;
        for (const o of objects) {
          await restampObject(cred.accessKeyId, cred.secretAccessKey, name, o.key, {
            cacheControl: PUBLIC_CACHE,
          });
          fixed++;
        }
        if (fixed) done.push(`made ${fixed} existing object${fixed === 1 ? '' : 's'} cacheable`);
      } catch (e) {
        done.push(`could not update cache headers on existing objects: ${(e as Error).message}`);
      }

      // The rule is scoped to the published hostnames, so it has to follow them
      // - otherwise a newly published bucket is served uncached for ever.
      done.push(await syncStorageCacheRule(await hostsForPort(WEB_PORT)));
    }

    if (body.access === 'private') {
      // Purge before closing the origin. The other order leaves a window in
      // which a request can re-populate the cache from a still-public bucket.
      const purge = await purgeBucket(name, bucket.id);
      await setWebsite(bucket.id, false);
      done.push(purge);
      await run(`tunnel-remove ${name}`, 60_000);
      await run('(sleep 2; pm2 restart cloudflared >/dev/null 2>&1) >/dev/null 2>&1 &', 10_000);
      done.push('unpublished; objects are reachable over Tailscale only');
      done.push(await syncStorageCacheRule(await hostsForPort(WEB_PORT)));
      await recordResidue([
        {
          action: `made bucket "${name}" private`,
          kind: 'dns',
          what: 'Cloudflare DNS record was kept',
          target: `${name}.${DOMAIN_SUFFIX}`,
          hint: 'The hostname now returns 404 at the origin. Delete it from the Residue page to retire it, or keep it to republish instantly.',
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
      // Same reason as making a bucket private: deleting the objects does not
      // reach the copies Cloudflare is holding.
      done.push(await purgeBucket(name, bucket.id));
      await run(`tunnel-remove ${name}`, 60_000);
      await run('(sleep 2; pm2 restart cloudflared >/dev/null 2>&1) >/dev/null 2>&1 &', 10_000);
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
