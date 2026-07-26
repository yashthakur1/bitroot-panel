import { NextRequest, NextResponse } from 'next/server';
import { assertRepoFullName, getGithubToken, ghFetch } from '@/lib/github';
import { ValidationError } from '@/lib/validate';

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET(req: NextRequest) {
  try {
    const repo = assertRepoFullName(req.nextUrl.searchParams.get('repo'));
    const token = await getGithubToken();
    if (!token) return NextResponse.json({ error: 'GitHub not connected' }, { status: 400 });

    const [meta, branches] = await Promise.all([
      ghFetch(token, `/repos/${repo}`),
      ghFetch(token, `/repos/${repo}/branches?per_page=100`),
    ]);
    return NextResponse.json({
      defaultBranch: meta.default_branch,
      branches: branches.map((b: any) => b.name),
    });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
