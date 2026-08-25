// The panel's own accounts, in SQLite.
//
// Until now the panel had one credential: DASHBOARD_PASSWORD, shared by
// everyone who could reach it. Three people used the same password, so nothing
// could be attributed to anyone and removing one person's access meant changing
// everyone's.
//
// node:sqlite is built into Node, so this adds no dependency and no second
// process — it was tested on the OnePlus (aarch64, Node 26) and on neev-stag
// (Node 22) before being chosen, because a store the phone cannot open is no
// store at all.

import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

export type Role = 'superadmin' | 'member';

export interface User {
  email: string;
  role: Role;
  /** False for an Access-only account that has no local password. */
  hasPassword: boolean;
  createdAt: number;
  disabledAt: number | null;
  /** Bumped to invalidate every session already issued to this person. */
  epoch: number;
}

export function dbPath(): string {
  if (process.env.BITPANEL_DB_PATH) return process.env.BITPANEL_DB_PATH;
  return path.join(os.homedir(), '.config', 'bitroot-panel', 'users.db');
}

let handle: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (handle) return handle;
  const file = dbPath();
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const d = new DatabaseSync(file);
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      email         TEXT PRIMARY KEY,
      password_hash TEXT,
      role          TEXT NOT NULL DEFAULT 'member',
      created_at    INTEGER NOT NULL,
      disabled_at   INTEGER,
      epoch         INTEGER NOT NULL DEFAULT 1
    );
  `);
  // The file holds password hashes. 0600 is set after creation because the
  // process umask decides the mode SQLite creates it with, and a permissive
  // umask would otherwise leave it world-readable.
  try {
    chmodSync(file, 0o600);
  } catch {
    /* a filesystem without POSIX modes; nothing better to do */
  }
  handle = d;
  return d;
}

/** Only for tests: drops the cached handle so a new path takes effect. */
export function resetDb(): void {
  try {
    handle?.close();
  } catch {
    /* already closed */
  }
  handle = null;
}

// ─── passwords ───────────────────────────────────────────────────────────────

const N = 16384;
const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN);
  return `scrypt$${N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[2], 'base64');
  const expected = Buffer.from(parts[3], 'base64');
  const actual = await scrypt(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ─── accounts ────────────────────────────────────────────────────────────────

interface Row {
  email: string;
  password_hash: string | null;
  role: string;
  created_at: number;
  disabled_at: number | null;
  epoch: number;
}

function toUser(r: Row): User {
  return {
    email: r.email,
    role: r.role === 'superadmin' ? 'superadmin' : 'member',
    hasPassword: Boolean(r.password_hash),
    createdAt: r.created_at,
    disabledAt: r.disabled_at,
    epoch: r.epoch,
  };
}

const norm = (email: string) => email.trim().toLowerCase();

/** True once at least one account exists; false means fall back to .env. */
export function storeInUse(): boolean {
  const row = db().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  return row.n > 0;
}

export function listUsers(): User[] {
  const rows = db()
    // Single quotes: SQLite reads a double-quoted token as an identifier
    // first, so "superadmin" was parsed as a column name and the query failed.
    .prepare("SELECT * FROM users ORDER BY role = 'superadmin' DESC, email")
    .all() as unknown as Row[];
  return rows.map(toUser);
}

export function getUser(email: string): User | null {
  const row = db().prepare('SELECT * FROM users WHERE email = ?').get(norm(email)) as
    | Row
    | undefined;
  return row ? toUser(row) : null;
}

export class UserExistsError extends Error {}

export async function createUser(opts: {
  email: string;
  password?: string;
  role?: Role;
}): Promise<User> {
  const email = norm(opts.email);
  // Checked rather than left to the primary key, which raises a bare
  // "constraint failed" that would reach the operator as a SQL error where
  // "that address already has an account" is the whole of what they need.
  if (getUser(email)) {
    throw new UserExistsError(`${email} already has an account`);
  }
  const hash = opts.password ? await hashPassword(opts.password) : null;
  db()
    .prepare(
      'INSERT INTO users (email, password_hash, role, created_at, epoch) VALUES (?, ?, ?, ?, 1)',
    )
    .run(email, hash, opts.role ?? 'member', Math.floor(Date.now() / 1000));
  return getUser(email)!;
}

export async function setPassword(email: string, password: string): Promise<void> {
  const hash = await hashPassword(password);
  // Changing a password ends the sessions opened with the old one. Leaving them
  // alive is how a password change fails to lock anybody out.
  db()
    .prepare('UPDATE users SET password_hash = ?, epoch = epoch + 1 WHERE email = ?')
    .run(hash, norm(email));
}

export function setRole(email: string, role: Role): void {
  db().prepare('UPDATE users SET role = ? WHERE email = ?').run(role, norm(email));
}

export function setDisabled(email: string, disabled: boolean): void {
  db()
    .prepare('UPDATE users SET disabled_at = ?, epoch = epoch + 1 WHERE email = ?')
    .run(disabled ? Math.floor(Date.now() / 1000) : null, norm(email));
}

export function deleteUser(email: string): void {
  db().prepare('DELETE FROM users WHERE email = ?').run(norm(email));
}

export function superadminCount(): number {
  const row = db()
    .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'superadmin' AND disabled_at IS NULL")
    .get() as { n: number };
  return row.n;
}

/**
 * Sign in with a local password.
 *
 * Returns the user, or null. Null for a missing account, a disabled one, one
 * with no local password, and a wrong password alike: telling them apart tells
 * an attacker which addresses exist.
 */
export async function authenticate(email: string, password: string): Promise<User | null> {
  const row = db().prepare('SELECT * FROM users WHERE email = ?').get(norm(email)) as
    | Row
    | undefined;
  if (!row || row.disabled_at || !row.password_hash) return null;
  return (await passwordMatches(password, row.password_hash)) ? toUser(row) : null;
}

/**
 * Turn the single shared credential into the first real account.
 *
 * Runs only when the store is empty, so an install that predates accounts keeps
 * working on .env alone until somebody chooses to migrate.
 */
export async function migrateFromEnv(): Promise<User | null> {
  if (storeInUse()) return null;
  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.DASHBOARD_PASSWORD;
  if (!email || !password || email === 'admin@example.com') return null;
  return createUser({ email, password, role: 'superadmin' });
}
