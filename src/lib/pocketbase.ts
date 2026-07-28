import { randomBytes } from 'node:crypto';
import { run } from './runner';
import { shq, ValidationError } from './validate';

// Authenticated access to the PocketBase admin API. Credentials live on the
// server at ~/apps/pocketbase/.superuser (600) and never reach the browser.

export const PB_URL = process.env.POCKETBASE_URL ?? 'http://127.0.0.1:8090';
export const PB_PUBLIC_URL = process.env.POCKETBASE_PUBLIC_URL ?? `https://pocketbase.${process.env.DOMAIN_SUFFIX ?? 'example.com'}`;
const REGISTRY = '"$HOME/apps/pocketbase/databases.json"';

let cached: { token: string; until: number } | null = null;

const PB_BIN = '"$HOME/apps/pocketbase/pocketbase"';
const PB_DATA = '"$HOME/apps/pocketbase/pb_data"';
const PB_CRED = '"$HOME/apps/pocketbase/.superuser"';

// The panel's own service account, deliberately separate from any human's.
const PANEL_EMAIL = process.env.POCKETBASE_EMAIL ?? 'panel@bitpanel.local';

// PocketBase ships with no account at all. The panel used to treat that as a
// hard error, which meant Databases and Backups were dead on every fresh
// install until someone ran the CLI by hand - while the UI told them the panel
// resets this account itself. Creating it is the same local-CLI operation as
// repairing it, so do that instead of reporting a dead end.
async function bootstrap(): Promise<{ email: string; password: string }> {
  const installed = await run(`test -x ${PB_BIN} && echo yes || true`);
  if (!installed.output.includes('yes')) {
    throw new Error('PocketBase is not installed on this server');
  }

  const password = randomBytes(18).toString('base64url');
  const r = await run(
    `${PB_BIN} superuser upsert ${shq(PANEL_EMAIL)} ${shq(password)} --dir ${PB_DATA}`,
    60_000,
  );

  // umask before the redirect, so the password is never briefly world-readable
  // between creating the file and chmod-ing it.
  const w = await run(
    `umask 077 && printf 'PB_EMAIL=%s\\nPB_PASSWORD=%s\\n' ${shq(PANEL_EMAIL)} ${shq(password)} > ${PB_CRED}`,
  );
  if (!w.ok) {
    throw new Error(`could not record the PocketBase credential: ${w.output.trim() || 'write failed'}`);
  }
  if (!r.ok) {
    throw new Error(`could not create the PocketBase superuser: ${r.output.trim() || 'upsert failed'}`);
  }
  return { email: PANEL_EMAIL, password };
}

async function credentials(): Promise<{ email: string; password: string }> {
  const r = await run(`cat ${PB_CRED} 2>/dev/null || true`);
  const email = r.output.match(/^PB_EMAIL=(.*)$/m)?.[1]?.trim();
  const password = r.output.match(/^PB_PASSWORD=(.*)$/m)?.[1]?.trim();
  if (!email || !password) return bootstrap();
  return { email, password };
}

async function authenticate(email: string, password: string): Promise<string | null> {
  try {
    const res = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: email, password }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()).token ?? null;
  } catch {
    return null;
  }
}

export async function pbToken(): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;
  const { email, password } = await credentials();

  let token = await authenticate(email, password);

  // Self-heal: this is the panel's own service account, so when the stored
  // password stops working (data dir restored from a backup, credentials
  // edited by hand) the panel can reset it through the local CLI, which talks
  // to the data directory directly and needs no password of its own. A human's
  // superuser account is never touched.
  if (!token) {
    await run(
      `"$HOME/apps/pocketbase/pocketbase" superuser upsert ${shq(email)} ${shq(password)} --dir "$HOME/apps/pocketbase/pb_data"`,
      60_000,
    );
    token = await authenticate(email, password);
  }

  if (!token) {
    throw new Error(
      'PocketBase admin API unavailable — the panel service account could not be restored',
    );
  }

  cached = { token, until: Date.now() + 10 * 60 * 1000 };
  return token;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function pbFetch(path: string, init: RequestInit = {}): Promise<any> {
  const token = await pbToken();
  const res = await fetch(`${PB_URL}${path}`, {
    ...init,
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.message ?? `PocketBase API HTTP ${res.status}`);
  }
  return data;
}

export interface DbEntry {
  name: string;
  created: string;
  withAuth: boolean;
}

export function assertDbName(name: unknown): string {
  if (typeof name !== 'string' || !/^[a-z][a-z0-9_]{1,30}$/.test(name)) {
    throw new ValidationError(
      'database name must be lowercase letters, digits or underscores (2-31 chars)',
    );
  }
  return name;
}

export async function readRegistry(): Promise<DbEntry[]> {
  const r = await run(`cat ${REGISTRY} 2>/dev/null || echo "[]"`);
  try {
    const parsed = JSON.parse(r.output.trim() || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function writeRegistry(entries: DbEntry[]): Promise<void> {
  await run(`printf %s ${shq(JSON.stringify(entries, null, 2))} > ${REGISTRY}`);
}

// Collection scaffolding for a new project database.
export function starterCollections(name: string, withAuth: boolean) {
  const base = {
    name: `${name}_items`,
    type: 'base',
    fields: [
      { name: 'title', type: 'text' },
      { name: 'data', type: 'json', maxSize: 2000000 },
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ],
  };
  return withAuth ? [base, { name: `${name}_users`, type: 'auth' }] : [base];
}
