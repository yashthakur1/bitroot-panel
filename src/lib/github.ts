import { run } from './runner';
import { shq, ValidationError } from './validate';
import { addConnection, getPrimaryToken, listConnections, removeConnection } from './git-connections';

// GitHub access for the panel. Tokens live in the git-connections registry on
// the server (600 files, never sent to the browser); this module is the thin
// GitHub-specific layer over it.

// Git operations use whichever connection is marked primary.
export async function getGithubToken(): Promise<string | null> {
  return getPrimaryToken();
}

export function assertGithubToken(token: unknown): string {
  if (
    typeof token !== 'string' ||
    token.length > 300 ||
    !/^(ghp_|github_pat_)[A-Za-z0-9_]+$/.test(token)
  ) {
    throw new ValidationError('that does not look like a GitHub personal access token');
  }
  return token;
}

export async function saveGithubToken(token: string): Promise<void> {
  await addConnection(token);
}

export async function deleteGithubToken(): Promise<void> {
  for (const c of await listConnections()) {
    await removeConnection(c.id);
  }
}

export function assertRepoFullName(full: unknown): string {
  if (typeof full !== 'string' || !/^[\w.-]{1,100}\/[\w.-]{1,100}$/.test(full)) {
    throw new ValidationError('invalid repository (expected owner/name)');
  }
  return full;
}

export function assertBranch(branch: unknown): string {
  if (
    typeof branch !== 'string' ||
    branch.length > 120 ||
    branch.startsWith('-') ||
    !/^[\w][\w./-]*$/.test(branch)
  ) {
    throw new ValidationError('invalid branch name');
  }
  return branch;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function ghFetch(token: string, path: string): Promise<any> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.message ?? `GitHub API HTTP ${res.status}`);
  }
  return data;
}
