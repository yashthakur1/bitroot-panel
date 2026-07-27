import { NextRequest, NextResponse } from 'next/server';
import { allowKey, assertBucketName, createKey, deleteKey, findBucketByName } from '@/lib/garage';

const KEY_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,40}$/;

// Mint a key and grant it on one bucket. The secret comes back exactly once —
// Garage does not store it in retrievable form — so the caller has to surface
// it immediately or lose it.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const bucketName = assertBucketName(body.bucket);
    const name = String(body.name ?? '').trim();
    if (!KEY_NAME.test(name)) {
      return NextResponse.json(
        { error: 'key name must be 2-41 characters of letters, digits, dot, underscore or hyphen' },
        { status: 400 },
      );
    }
    const readOnly = body.readOnly === true;

    const bucket = await findBucketByName(bucketName);
    if (!bucket) {
      return NextResponse.json({ error: `no bucket "${bucketName}"` }, { status: 404 });
    }

    const key = await createKey(name);
    try {
      await allowKey(bucket.id, key.accessKeyId, {
        read: true,
        write: !readOnly,
        owner: false,
      });
    } catch (e) {
      // A key that exists but grants nothing is just litter; take it back.
      await deleteKey(key.accessKeyId).catch(() => {});
      throw e;
    }

    return NextResponse.json({
      ok: true,
      key: { ...key, bucket: bucketName, readOnly },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id') ?? '';
    if (!/^GK[0-9a-f]{24}$/.test(id)) {
      return NextResponse.json({ error: 'invalid access key id' }, { status: 400 });
    }
    await deleteKey(id);
    return NextResponse.json({ ok: true, output: `deleted access key ${id}` });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
