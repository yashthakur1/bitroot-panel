import { NextResponse } from 'next/server';
import { getGithubToken, ghFetch } from '@/lib/github';

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET() {
  const token = await getGithubToken();
  if (!token) return NextResponse.json({ error: 'GitHub not connected' }, { status: 400 });
  try {
    const repos = await ghFetch(
      token,
      '/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member',
    );
    return NextResponse.json({
      repos: repos.map((r: any) => ({
        fullName: r.full_name,
        private: r.private,
        defaultBranch: r.default_branch,
        pushedAt: r.pushed_at,
        description: r.description,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
