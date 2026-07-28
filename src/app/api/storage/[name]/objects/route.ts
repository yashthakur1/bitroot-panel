import { NextRequest, NextResponse } from 'next/server';
import { assertBucketName, ensureUploadAccess, findBucketByName, GIB } from '@/lib/garage';
import { deleteObject, listObjects, putObject } from '@/lib/s3';

// Objects served from the edge want a long lifetime, and the panel writes
// content-addressed-ish keys rather than mutating them in place, so a year is
// safe. Cloudflare respects this for the extensions it caches by default; a
// Cache Rule is only needed to widen that set.
// Always the long public lifetime, even for a private bucket. A private bucket
// is not reachable publicly at all, so the header changes nothing there - but
// stamping "private, max-age=0" instead meant every object uploaded before a
// bucket was published stayed permanently uncacheable afterwards, which is
// exactly the case that made publishing pointless.
const PUBLIC_CACHE = 'public, max-age=31536000, immutable';

// An object key may contain slashes but must not climb out of the bucket or
// carry control characters into a URL.
function assertKey(value: unknown): string {
  const key = String(value ?? '').trim().replace(/^\/+/, '');
  if (!key || key.length > 512) throw new Error('object key must be 1-512 characters');
  if (key.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) {
    throw new Error('object key may not contain empty or relative path segments');
  }
  if (/[\x00-\x1f\x7f]/.test(key)) throw new Error('object key contains control characters');
  return key;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const name = assertBucketName((await params).name);
    const bucket = await findBucketByName(name);
    if (!bucket) return NextResponse.json({ error: `no bucket "${name}"` }, { status: 404 });

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'no file in request' }, { status: 400 });
    }

    const key = assertKey(form.get('key') || file.name);
    const contentType = String(form.get('contentType') || file.type || 'application/octet-stream');
    // Set when the browser gzipped the bytes before sending. Stored as object
    // metadata so readers transparently decompress - the object stays byte
    // identical to the original once decoded.
    const contentEncoding = form.get('contentEncoding')
      ? String(form.get('contentEncoding'))
      : undefined;

    const body = Buffer.from(await file.arrayBuffer());

    // Fail before uploading rather than letting Garage reject it half way: the
    // quota is on stored bytes, which is what we are about to add.
    const quota = bucket.quotaBytes;
    if (quota !== null && bucket.bytes + body.length > quota) {
      const over = (bucket.bytes + body.length - quota) / GIB;
      return NextResponse.json(
        {
          error: `over quota by ${over < 0.01 ? '<0.01' : over.toFixed(2)} GB — the ${(
            quota / GIB
          ).toFixed(0)} GB tier already holds ${(bucket.bytes / GIB).toFixed(2)} GB`,
        },
        { status: 413 },
      );
    }

    const cred = await ensureUploadAccess(bucket.id);
    await putObject(cred.accessKeyId, cred.secretAccessKey, name, key, body, {
      contentType,
      contentEncoding,
      cacheControl: PUBLIC_CACHE,
    });

    return NextResponse.json({
      ok: true,
      key,
      bytes: body.length,
      contentEncoding: contentEncoding ?? null,
      url: bucket.websiteAccess
        ? `https://${name}.${process.env.DOMAIN_SUFFIX ?? 'bitroot.in'}/${key}`
        : null,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}


export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const name = assertBucketName((await params).name);
    const bucket = await findBucketByName(name);
    if (!bucket) return NextResponse.json({ error: `no bucket "${name}"` }, { status: 404 });
    const cred = await ensureUploadAccess(bucket.id);
    const objects = await listObjects(cred.accessKeyId, cred.secretAccessKey, name);
    return NextResponse.json({ ok: true, objects });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const name = assertBucketName((await params).name);
    const key = assertKey(req.nextUrl.searchParams.get('key'));
    const bucket = await findBucketByName(name);
    if (!bucket) return NextResponse.json({ error: `no bucket "${name}"` }, { status: 404 });
    const cred = await ensureUploadAccess(bucket.id);
    await deleteObject(cred.accessKeyId, cred.secretAccessKey, name, key);
    return NextResponse.json({ ok: true, output: `deleted ${key}` });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
