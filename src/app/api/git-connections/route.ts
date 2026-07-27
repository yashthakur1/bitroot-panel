import { NextRequest, NextResponse } from 'next/server';
import { ValidationError } from '@/lib/validate';
import { assertGithubToken } from '@/lib/github';
import {
  addConnection,
  assertConnectionId,
  connectionScope,
  getConnectionToken,
  listConnections,
  removeConnection,
  setPrimary,
} from '@/lib/git-connections';

// Each connection is reported with what it can actually reach, so a deploy
// failing with "repository not found" is explainable from this page alone.
export async function GET() {
  const conns = await listConnections();
  const detailed = await Promise.all(
    conns.map(async (c) => {
      const token = await getConnectionToken(c.id);
      const scope = token
        ? await connectionScope(token)
        : { repos: 0, privateRepos: 0, valid: false };
      return { ...c, ...scope };
    }),
  );
  return NextResponse.json({ connections: detailed });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const token = assertGithubToken(body.token);
    const connection = await addConnection(token, body.label);
    return NextResponse.json({ ok: true, connection });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id } = await req.json();
    await setPrimary(assertConnectionId(id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = assertConnectionId(req.nextUrl.searchParams.get('id'));
    await removeConnection(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
