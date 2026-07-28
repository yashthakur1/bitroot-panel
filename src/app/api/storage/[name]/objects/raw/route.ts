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
    for (const h of ['content-type', 'content-length', 'content-encoding', 'etag', 'last-modified']) {
      const v = res.headers.get(h);
      if (v) headers.set(h, v);
    }
    // Objects uploaded compressed carry Content-Encoding, and the browser
    // decodes them itself - so the response is passed on untouched.
    if (req.nextUrl.searchParams.get('download') === '1') {
      headers.set('Content-Disposition', `attachment; filename="${key.split('/').pop()}"`);
    }
    return new Response(res.body, { headers });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
