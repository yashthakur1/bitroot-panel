import { NextResponse } from 'next/server';
import { ghFetch } from '@/lib/github';
import { getConnectionToken, listConnections } from '@/lib/git-connections';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Repositories from every connected account. Each entry carries the connection
// it came from, so the deploy can clone with that account's credential.
export async function GET() {
  const conns = await listConnections();
  if (conns.length === 0) {
    return NextResponse.json({ error: 'GitHub not connected' }, { status: 400 });
  }

  const seen = new Set<string>();
  const repos: any[] = [];
  const errors: string[] = [];

  for (const c of conns) {
    const token = await getConnectionToken(c.id);
    if (!token) continue;
    try {
      const list = await ghFetch(
        token,
        '/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member',
      );
      for (const r of list) {
        if (seen.has(r.full_name)) continue;
        seen.add(r.full_name);
        repos.push({
          fullName: r.full_name,
          private: r.private,
          defaultBranch: r.default_branch,
          pushedAt: r.pushed_at,
          description: r.description,
          connectionId: c.id,
          connectionLabel: c.label,
        });
      }
    } catch (e) {
      errors.push(`${c.label}: ${(e as Error).message}`);
    }
  }

  if (repos.length === 0 && errors.length > 0) {
    return NextResponse.json({ error: errors.join('; ') }, { status: 502 });
  }
  return NextResponse.json({ repos, errors });
}
