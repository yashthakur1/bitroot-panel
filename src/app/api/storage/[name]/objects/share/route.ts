import { NextRequest, NextResponse } from 'next/server';
import { assertBucketName, ensureUploadAccess, findBucketByName } from '@/lib/garage';
import { presignGetObject } from '@/lib/s3';

// SigV4 caps a presigned URL at seven days; anything longer is rejected by the
// signature itself rather than by us, so the ceiling is stated here.
const MAX_SECONDS = 7 * 24 * 3600;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const name = assertBucketName((await params).name);
    const body = await req.json();
    const key = String(body.key ?? '').replace(/^\/+/, '');
    const seconds = Number(body.expiresIn);

    if (!key || key.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) {
      return NextResponse.json({ error: 'invalid object key' }, { status: 400 });
    }
    if (!Number.isInteger(seconds) || seconds < 60 || seconds > MAX_SECONDS) {
      return NextResponse.json(
        { error: 'expiry must be between 60 seconds and 7 days' },
        { status: 400 },
      );
    }

    const bucket = await findBucketByName(name);
    if (!bucket) return NextResponse.json({ error: `no bucket "${name}"` }, { status: 404 });

    const cred = await ensureUploadAccess(bucket.id);
    const url = presignGetObject(cred.accessKeyId, cred.secretAccessKey, name, key, seconds);

    return NextResponse.json({
      ok: true,
      url,
      expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
