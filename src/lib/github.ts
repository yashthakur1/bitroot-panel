import { run } from './runner';
import { shq, ValidationError } from './validate';

// GitHub connection for the panel. The token is a fine-grained (or classic)
// personal access token, stored on the phone at ~/.config/bitroot-panel/github-token
// with 600 perms. Never committed, never sent to the browser.

const TOKEN_PATH = '"$HOME/.config/bitroot-panel/github-token"';

export async function getGithubToken(): Promise<string | null> {
  const r = await run(`cat ${TOKEN_PATH} 2>/dev/null || true`);
  const t = r.output.trim();
  return t || null;
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
  await run(
    `mkdir -p "$HOME/.config/bitroot-panel" && printf %s ${shq(token)} > ${TOKEN_PATH} && chmod 600 ${TOKEN_PATH}`,
  );
  // Register with git's credential store (standard mechanism) so clone/pull of
  // private repos over https://github.com/... authenticates automatically.
  const credLine = shq(`https://x-access-token:${token}@github.com`);
  await run(
    `touch "$HOME/.git-credentials" && sed -i "/github.com/d" "$HOME/.git-credentials" && printf "%s\\n" ${credLine} >> "$HOME/.git-credentials" && chmod 600 "$HOME/.git-credentials" && git config --global credential.helper store`,
  );
}

export async function deleteGithubToken(): Promise<void> {
  await run(`rm -f ${TOKEN_PATH}`);
  await run(`sed -i "/github.com/d" "$HOME/.git-credentials" 2>/dev/null || true`);
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
