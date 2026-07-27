import { NextRequest, NextResponse } from 'next/server';
import { assertBranch, assertRepoFullName, ghFetch } from '@/lib/github';
import { ValidationError } from '@/lib/validate';
import {
  assertConnectionId,
  getConnectionToken,
  getPrimaryToken,
  listConnections,
} from '@/lib/git-connections';
import { detectFramework } from '@/lib/detect';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Reads a few files from the repository to work out what it is. Everything is
// best-effort: a missing file simply narrows the guess.
async function readFile(
  token: string,
  repo: string,
  path: string,
  ref?: string,
): Promise<string | null> {
  try {
    const res = await ghFetch(
      token,
      `/repos/${repo}/contents/${path}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`,
    );
    if (!res?.content) return null;
    return Buffer.from(res.content, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const repo = assertRepoFullName(req.nextUrl.searchParams.get('repo'));
    const branchParam = req.nextUrl.searchParams.get('branch');
    const branch = branchParam ? assertBranch(branchParam) : undefined;
    const connectionParam = req.nextUrl.searchParams.get('connection');

    let token = connectionParam
      ? await getConnectionToken(assertConnectionId(connectionParam))
      : null;
    if (!token) token = await getPrimaryToken();
    if (!token) {
      return NextResponse.json({ error: 'GitHub not connected' }, { status: 400 });
    }

    // If the chosen connection cannot see the repo, try the others.
    let rootListing: any = null;
    try {
      rootListing = await ghFetch(
        token,
        `/repos/${repo}/contents${branch ? `?ref=${encodeURIComponent(branch)}` : ''}`,
      );
    } catch {
      for (const c of await listConnections()) {
        const alt = await getConnectionToken(c.id);
        if (!alt || alt === token) continue;
        try {
          rootListing = await ghFetch(
            alt,
            `/repos/${repo}/contents${branch ? `?ref=${encodeURIComponent(branch)}` : ''}`,
          );
          token = alt;
          break;
        } catch {
          // keep trying
        }
      }
    }
    if (!Array.isArray(rootListing)) {
      return NextResponse.json({ error: 'could not read that repository' }, { status: 502 });
    }

    const rootFiles: string[] = rootListing
      .filter((e: any) => e.type === 'file')
      .map((e: any) => e.name);

    const has = (n: string) => rootFiles.includes(n);
    const configName = (base: string) =>
      ['.ts', '.js', '.mjs', '.cjs'].map((e) => `${base}${e}`).find(has);

    const [pkgRaw, nextConfig, astroConfig, svelteConfig, nuxtConfig] = await Promise.all([
      has('package.json') ? readFile(token, repo, 'package.json', branch) : null,
      configName('next.config')
        ? readFile(token, repo, configName('next.config')!, branch)
        : null,
      configName('astro.config')
        ? readFile(token, repo, configName('astro.config')!, branch)
        : null,
      configName('svelte.config')
        ? readFile(token, repo, configName('svelte.config')!, branch)
        : null,
      configName('nuxt.config')
        ? readFile(token, repo, configName('nuxt.config')!, branch)
        : null,
    ]);

    let pkg: any = null;
    try {
      pkg = pkgRaw ? JSON.parse(pkgRaw) : null;
    } catch {
      pkg = null;
    }

    return NextResponse.json(
      detectFramework({
        pkg,
        rootFiles,
        nextConfig: nextConfig ?? undefined,
        astroConfig: astroConfig ?? undefined,
        svelteConfig: svelteConfig ?? undefined,
        nuxtConfig: nuxtConfig ?? undefined,
      }),
    );
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
