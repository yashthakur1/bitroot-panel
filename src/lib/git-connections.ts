import { run } from './runner';
import { shq, ValidationError } from './validate';

// Git provider connections.
//
// Each connection keeps its token in its own 600 file; the registry holds only
// non-secret metadata. One connection is marked primary — git itself matches
// stored credentials by host, so clones and pulls use the primary token. The
// others are still usable for browsing repositories through the provider API.

const DIR = '"$HOME/.config/bitroot-panel"';
const REGISTRY = `${DIR}/connections.json`;
const LEGACY_TOKEN = `${DIR}/github-token`;

export interface GitConnection {
  id: string;
  provider: 'github';
  label: string;
  login: string;
  avatarUrl?: string;
  profileUrl?: string;
  createdAt: string;
  primary: boolean;
}

export function assertConnectionId(id: unknown): string {
  if (typeof id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(id)) {
    throw new ValidationError('invalid connection id');
  }
  return id;
}

async function readRegistry(): Promise<GitConnection[]> {
  const r = await run(`cat ${REGISTRY} 2>/dev/null || echo "[]"`);
  try {
    const parsed = JSON.parse(r.output.trim() || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeRegistry(entries: GitConnection[]): Promise<void> {
  await run(
    `mkdir -p ${DIR} && printf %s ${shq(JSON.stringify(entries, null, 2))} > ${REGISTRY} && chmod 600 ${REGISTRY}`,
  );
}

export async function getConnectionToken(id: string): Promise<string | null> {
  const safe = assertConnectionId(id);
  const r = await run(`cat ${DIR}/tokens/${safe} 2>/dev/null || true`);
  return r.output.trim() || null;
}

async function saveConnectionToken(id: string, token: string): Promise<void> {
  await run(
    `mkdir -p ${DIR}/tokens && printf %s ${shq(token)} > ${DIR}/tokens/${id} && chmod 600 ${DIR}/tokens/${id}`,
  );
}

// git resolves stored credentials by host, so only the primary connection's
// token is written into ~/.git-credentials.
async function syncGitCredentials(token: string): Promise<void> {
  const line = shq(`https://x-access-token:${token}@github.com`);
  await run(
    `touch "$HOME/.git-credentials" && cp "$HOME/.git-credentials" "$HOME/.git-credentials.bak" 2>/dev/null; ` +
      `sed -i "/github.com/d" "$HOME/.git-credentials" && printf "%s\\n" ${line} >> "$HOME/.git-credentials" && ` +
      `chmod 600 "$HOME/.git-credentials" && git config --global credential.helper store`,
  );
}

// Pull a pre-existing single-token setup into the registry so nothing is lost.
export async function migrateLegacyToken(): Promise<void> {
  const existing = await readRegistry();
  if (existing.length > 0) return;
  const legacy = await run(`cat ${LEGACY_TOKEN} 2>/dev/null || true`);
  const token = legacy.output.trim();
  if (!token) return;
  try {
    const user = await githubUser(token);
    const id = 'github-' + user.login.toLowerCase().replace(/[^a-z0-9-]/g, '');
    await saveConnectionToken(id, token);
    await writeRegistry([
      {
        id,
        provider: 'github',
        label: `GitHub · ${user.login}`,
        login: user.login,
        avatarUrl: user.avatar_url,
        profileUrl: user.html_url,
        createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
        primary: true,
      },
    ]);
  } catch {
    // Token no longer valid (typically: it was regenerated on GitHub, which
    // mints a new value and kills the old one). Leave it unregistered — but
    // legacyTokenStatus() reports it so the UI can explain the gap.
  }
}

// Distinguishes "never connected" from "connected, but the stored token has
// since been revoked or regenerated" — very different problems for the user.
export async function legacyTokenStatus(): Promise<'none' | 'invalid'> {
  const conns = await readRegistry();
  if (conns.length > 0) return 'none';
  const legacy = await run(`cat ${LEGACY_TOKEN} 2>/dev/null || true`);
  const token = legacy.output.trim();
  if (!token) return 'none';
  try {
    await githubUser(token);
    return 'none';
  } catch {
    return 'invalid';
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function githubUser(token: string): Promise<any> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(
      res.status === 401 ? 'token rejected by GitHub' : `GitHub API HTTP ${res.status}`,
    );
  }
  return res.json();
}

export async function listConnections(): Promise<GitConnection[]> {
  await migrateLegacyToken();
  return readRegistry();
}

export async function getPrimaryToken(): Promise<string | null> {
  const conns = await listConnections();
  const primary = conns.find((c) => c.primary) ?? conns[0];
  return primary ? getConnectionToken(primary.id) : null;
}

export async function addConnection(token: string, label?: string): Promise<GitConnection> {
  const user = await githubUser(token); // validate before storing anything
  const conns = await readRegistry();
  const base = 'github-' + user.login.toLowerCase().replace(/[^a-z0-9-]/g, '');
  let id = base;
  let n = 2;
  while (conns.some((c) => c.id === id)) id = `${base}-${n++}`;

  const connection: GitConnection = {
    id,
    provider: 'github',
    label: label?.trim() || `GitHub · ${user.login}`,
    login: user.login,
    avatarUrl: user.avatar_url,
    profileUrl: user.html_url,
    createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
    primary: conns.length === 0,
  };

  await saveConnectionToken(id, token);
  await writeRegistry([...conns, connection]);
  if (connection.primary) await syncGitCredentials(token);
  return connection;
}

export async function removeConnection(id: string): Promise<void> {
  const safe = assertConnectionId(id);
  const conns = await readRegistry();
  const remaining = conns.filter((c) => c.id !== safe);
  // never leave the set without a primary
  if (remaining.length > 0 && !remaining.some((c) => c.primary)) {
    remaining[0].primary = true;
    const token = await getConnectionToken(remaining[0].id);
    if (token) await syncGitCredentials(token);
  }
  await writeRegistry(remaining);
  await run(`rm -f ${DIR}/tokens/${safe}`);
  if (remaining.length === 0) {
    await run(`sed -i "/github.com/d" "$HOME/.git-credentials" 2>/dev/null || true`);
  }
}

export async function setPrimary(id: string): Promise<void> {
  const safe = assertConnectionId(id);
  const conns = await readRegistry();
  if (!conns.some((c) => c.id === safe)) throw new ValidationError('no such connection');
  await writeRegistry(conns.map((c) => ({ ...c, primary: c.id === safe })));
  const token = await getConnectionToken(safe);
  if (token) await syncGitCredentials(token);
}

// What a connection can actually reach — the question that matters when a
// deploy fails with a 404.
export async function connectionScope(token: string): Promise<{
  repos: number;
  privateRepos: number;
  valid: boolean;
}> {
  try {
    const res = await fetch(
      'https://api.github.com/user/repos?per_page=100&affiliation=owner,collaborator,organization_member',
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        cache: 'no-store',
      },
    );
    if (!res.ok) return { repos: 0, privateRepos: 0, valid: false };
    const repos = await res.json();
    return {
      repos: repos.length,
      privateRepos: repos.filter((r: any) => r.private).length,
      valid: true,
    };
  } catch {
    return { repos: 0, privateRepos: 0, valid: false };
  }
}
