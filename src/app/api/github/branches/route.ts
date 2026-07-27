import { NextRequest, NextResponse } from 'next/server';
import { assertRepoFullName, ghFetch } from '@/lib/github';
import { ValidationError } from '@/lib/validate';
import {
  assertConnectionId,
  getConnectionToken,
  getPrimaryToken,
  listConnections,
} from '@/lib/git-connections';

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET(req: NextRequest) {
  try {
    const repo = assertRepoFullName(req.nextUrl.searchParams.get('repo'));
    const connectionParam = req.nextUrl.searchParams.get('connection');

    let token: string | null = null;
    if (connectionParam) {
      token = await getConnectionToken(assertConnectionId(connectionParam));
    }
    // Fall back to trying each connection: whichever can see the repo wins.
    if (!token) {
      token = await getPrimaryToken();
    }
    if (!token) {
      return NextResponse.json({ error: 'GitHub not connected' }, { status: 400 });
    }

    const load = async (t: string) => {
      const [meta, branches] = await Promise.all([
        ghFetch(t, `/repos/${repo}`),
        ghFetch(t, `/repos/${repo}/branches?per_page=100`),
      ]);
      return {
        defaultBranch: meta.default_branch,
        branches: branches.map((b: any) => b.name),
      };
    };

    try {
      return NextResponse.json(await load(token));
    } catch {
      for (const c of await listConnections()) {
        const alt = await getConnectionToken(c.id);
        if (!alt || alt === token) continue;
        try {
          return NextResponse.json(await load(alt));
        } catch {
          // try the next connection
        }
      }
      throw new Error('no connected account can read that repository');
    }
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
