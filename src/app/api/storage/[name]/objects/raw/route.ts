import { NextRequest, NextResponse } from 'next/server';
import { assertBucketName, ensureUploadAccess, findBucketByName } from '@/lib/garage';
import { getObject } from '@/lib/s3';

// Streams one object back through the panel. A private bucket has no public
// URL, so this is the only way the browser can preview or download its
// contents - the panel holds the credential and the bytes pass straight
// through rather than being buffered.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const name = assertBucketName((await params).name);
    const key = (req.nextUrl.searchParams.get('key') ?? '').replace(/^\/+/, '');
    if (!key || key.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) {
      return NextResponse.json({ error: 'invalid object key' }, { status: 400 });
    }

    const bucket = await findBucketByName(name);
    if (!bucket) return NextResponse.json({ error: `no bucket "${name}"` }, { status: 404 });

    const cred = await ensureUploadAccess(bucket.id);
    const res = await getObject(cred.accessKeyId, cred.secretAccessKey, name, key);
    if (!res.ok || !res.body) {
      return NextResponse.json({ error: `HTTP ${res.status}` }, { status: res.status });
    }

    const headers = new Headers();
    // Deliberately not content-encoding or content-length. Node's fetch has
    // already decompressed a gzipped object by the time we see the body, so
    // forwarding "gzip" makes the browser try to decode plain bytes a second
    // time - the object arrives corrupt - and the stored length no longer
    // describes what is being sent.
    for (const h of ['content-type', 'etag', 'last-modified']) {
      const v = res.headers.get(h);
      if (v) headers.set(h, v);
    }
    if (req.nextUrl.searchParams.get('download') === '1') {
      headers.set('Content-Disposition', `attachment; filename="${key.split('/').pop()}"`);
    }
    return new Response(res.body, { headers });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
