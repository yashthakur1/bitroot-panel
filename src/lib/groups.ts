// Projects: a named group of the things that make up one piece of work.
//
// The UI calls these "Projects". In code they are "groups", because `/api/projects`
// and the `project` script already use that word for one deployed service, and
// two meanings of one identifier is how a grouping bug becomes a deploy bug.
//
// A group holds no resources. It holds *names* — a pm2 service, a static site, a
// Garage bucket or a tunnel route — and the things they name stay exactly where
// they are, owned by pm2, nginx, Garage and cloudflared. Deleting a group
// therefore removes a label, never a deployment.
//
// Storage is the panel's own SQLite file (node:sqlite, the same handle and
// 0600 mode as accounts) rather than another JSON file beside pipelines.json.
// Membership needs what a database gives for free and a JSON file has to
// imitate: a resource can belong to at most one project (a primary key says so),
// deleting a project removes its memberships (a foreign key says so), and adding
// a batch is all-or-nothing (a transaction says so).

import type { DatabaseSync } from 'node:sqlite';
import { db } from './users';
import { assertHostname, assertName, ValidationError } from './validate';

export class ConflictError extends Error {}
export class NotFoundError extends Error {}

export const KINDS = ['service', 'static', 'bucket', 'route'] as const;
export type Kind = (typeof KINDS)[number];

export interface Group {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string | null;
}

export interface GroupSummary extends Group {
  counts: Record<Kind, number>;
}

export interface Member {
  kind: Kind;
  name: string;
  addedAt: number;
  addedBy: string | null;
}

export interface GroupDetail extends Group {
  members: Member[];
}

// Bounds, so a bug or a script cannot grow the registry without limit.
export const MAX_GROUPS = 100;
export const MAX_MEMBERS = 200;
const MAX_NAME = 60;
const MAX_DESCRIPTION = 280;

// ─── schema ──────────────────────────────────────────────────────────────────

// Created lazily per handle. `resetDb()` (tests) closes the handle and the next
// call opens a new one, so the guard is keyed on the handle rather than a flag.
const ready = new WeakSet<DatabaseSync>();

function store(): DatabaseSync {
  const d = db();
  if (ready.has(d)) return d;
  d.exec('PRAGMA foreign_keys = ON');
  d.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      created_by  TEXT
    );
    CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      kind     TEXT NOT NULL CHECK (kind IN ('service','static','bucket','route')),
      name     TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      added_by TEXT,
      -- One home per resource. Two projects claiming the same site would make
      -- "which project is this in?" unanswerable.
      PRIMARY KEY (kind, name)
    );
    CREATE INDEX IF NOT EXISTS group_members_group ON group_members(group_id);
  `);
  ready.add(d);
  return d;
}

// ─── validation ──────────────────────────────────────────────────────────────

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

export function assertGroupId(id: unknown): string {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) {
    throw new ValidationError('invalid project id');
  }
  return id;
}

function assertDisplayName(name: unknown): string {
  if (typeof name !== 'string') throw new ValidationError('a project needs a name');
  const n = name.trim().replace(/\s+/g, ' ');
  if (!n) throw new ValidationError('a project needs a name');
  if (n.length > MAX_NAME) throw new ValidationError(`name is limited to ${MAX_NAME} characters`);
  if (/[\u0000-\u001f\u007f]/.test(n)) throw new ValidationError('name cannot contain control characters');
  if (!slugify(n)) throw new ValidationError('name needs at least one letter or digit');
  return n;
}

function assertDescription(d: unknown): string {
  if (d === undefined || d === null) return '';
  if (typeof d !== 'string') throw new ValidationError('description must be text');
  const t = d.trim();
  if (t.length > MAX_DESCRIPTION) {
    throw new ValidationError(`description is limited to ${MAX_DESCRIPTION} characters`);
  }
  return t;
}

export function assertKind(kind: unknown): Kind {
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) {
    throw new ValidationError(`kind must be one of ${KINDS.join(', ')}`);
  }
  return kind as Kind;
}

/** Each kind names its resource differently, so each is checked its own way. */
export function assertMember(input: { kind: unknown; name: unknown }): { kind: Kind; name: string } {
  const kind = assertKind(input.kind);
  if (kind === 'service' || kind === 'static') {
    return { kind, name: assertName(input.name) };
  }
  if (kind === 'route') {
    const host = typeof input.name === 'string' ? assertHostname(input.name) : '';
    if (!host) throw new ValidationError('a route needs a hostname');
    return { kind, name: host };
  }
  // Garage bucket names: lowercase, digits, hyphen and dot; 3–63 characters.
  if (typeof input.name !== 'string' || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(input.name)) {
    throw new ValidationError('invalid bucket name');
  }
  return { kind, name: input.name };
}

// ─── rows ────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

const toGroup = (r: Row): Group => ({
  id: String(r.id),
  name: String(r.name),
  description: String(r.description ?? ''),
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
  createdBy: r.created_by === null || r.created_by === undefined ? null : String(r.created_by),
});

const toMember = (r: Row): Member => ({
  kind: r.kind as Kind,
  name: String(r.name),
  addedAt: Number(r.added_at),
  addedBy: r.added_by === null || r.added_by === undefined ? null : String(r.added_by),
});

function transaction<T>(d: DatabaseSync, fn: () => T): T {
  // IMMEDIATE takes the write lock up front, so two requests adding to the same
  // project queue instead of one failing halfway with SQLITE_BUSY.
  d.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    d.exec('COMMIT');
    return out;
  } catch (e) {
    try {
      d.exec('ROLLBACK');
    } catch {
      /* the failure that got us here is the one worth reporting */
    }
    throw e;
  }
}

// ─── reads ───────────────────────────────────────────────────────────────────

export function listGroups(): GroupSummary[] {
  const d = store();
  const groups = (d.prepare('SELECT * FROM groups ORDER BY name COLLATE NOCASE').all() as Row[]).map(toGroup);
  const tally = d
    .prepare('SELECT group_id, kind, COUNT(*) AS n FROM group_members GROUP BY group_id, kind')
    .all() as Row[];

  return groups.map((g) => {
    const counts = { service: 0, static: 0, bucket: 0, route: 0 } as Record<Kind, number>;
    for (const t of tally) if (t.group_id === g.id) counts[t.kind as Kind] = Number(t.n);
    return { ...g, counts };
  });
}

export function getGroup(id: string): GroupDetail {
  const d = store();
  const row = d.prepare('SELECT * FROM groups WHERE id = ?').get(assertGroupId(id)) as Row | undefined;
  if (!row) throw new NotFoundError('no such project');
  const members = (
    d
      .prepare('SELECT kind, name, added_at, added_by FROM group_members WHERE group_id = ? ORDER BY kind, name')
      .all(id) as Row[]
  ).map(toMember);
  return { ...toGroup(row), members };
}

/** "kind:name" → project id, for every resource that has a home. */
export function membership(): Record<string, string> {
  const rows = store().prepare('SELECT kind, name, group_id FROM group_members').all() as Row[];
  const out: Record<string, string> = {};
  for (const r of rows) out[`${r.kind}:${r.name}`] = String(r.group_id);
  return out;
}

// ─── writes ──────────────────────────────────────────────────────────────────

export function createGroup(input: { name: unknown; description?: unknown }, by: string | null): Group {
  const d = store();
  const name = assertDisplayName(input.name);
  const description = assertDescription(input.description);
  const id = slugify(name);

  return transaction(d, () => {
    const count = Number((d.prepare('SELECT COUNT(*) AS n FROM groups').get() as Row).n);
    if (count >= MAX_GROUPS) throw new ValidationError(`limited to ${MAX_GROUPS} projects`);
    if (d.prepare('SELECT 1 FROM groups WHERE id = ?').get(id)) {
      throw new ConflictError(`a project called "${name}" already exists`);
    }
    const now = Date.now();
    d.prepare(
      'INSERT INTO groups (id, name, description, created_at, updated_at, created_by) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, name, description, now, now, by);
    return toGroup(d.prepare('SELECT * FROM groups WHERE id = ?').get(id) as Row);
  });
}

/**
 * Rename or re-describe. The id is a slug of the *first* name and never changes:
 * it is what URLs and API calls refer to, and a rename that broke every
 * bookmark would be a poor trade for a tidier slug.
 */
export function updateGroup(id: string, input: { name?: unknown; description?: unknown }): Group {
  const d = store();
  const current = getGroup(id);
  const name = input.name === undefined ? current.name : assertDisplayName(input.name);
  const description = input.description === undefined ? current.description : assertDescription(input.description);
  d.prepare('UPDATE groups SET name = ?, description = ?, updated_at = ? WHERE id = ?').run(
    name,
    description,
    Date.now(),
    current.id,
  );
  return toGroup(d.prepare('SELECT * FROM groups WHERE id = ?').get(current.id) as Row);
}

/** Removes the project and its memberships. The resources themselves are untouched. */
export function deleteGroup(id: string): void {
  const d = store();
  const g = getGroup(id);
  d.prepare('DELETE FROM groups WHERE id = ?').run(g.id);
}

export interface AddResult {
  added: number;
  moved: number;
  unchanged: number;
}

/**
 * Put resources in a project. All-or-nothing: if any of them already belongs to
 * another project and `move` was not asked for, nothing is written and the
 * error says which. Adding something already in this project is a no-op, so
 * the call is safe to repeat.
 */
export function addMembers(
  id: string,
  members: Array<{ kind: unknown; name: unknown }>,
  by: string | null,
  opts: { move?: boolean } = {},
): AddResult {
  const d = store();
  if (!Array.isArray(members) || members.length === 0) {
    throw new ValidationError('nothing to add');
  }
  const wanted = members.map(assertMember);
  // Deduplicate within the request, so the same resource sent twice is one write.
  const unique = [...new Map(wanted.map((m) => [`${m.kind}:${m.name}`, m])).values()];

  return transaction(d, () => {
    const g = d.prepare('SELECT id, name FROM groups WHERE id = ?').get(assertGroupId(id)) as Row | undefined;
    if (!g) throw new NotFoundError('no such project');
    const gid = String(g.id);

    const have = Number(
      (d.prepare('SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?').get(gid) as Row).n,
    );
    const now = Date.now();
    const result: AddResult = { added: 0, moved: 0, unchanged: 0 };
    const taken: string[] = [];

    for (const m of unique) {
      const owner = d
        .prepare(
          'SELECT m.group_id AS id, g.name AS name FROM group_members m JOIN groups g ON g.id = m.group_id WHERE m.kind = ? AND m.name = ?',
        )
        .get(m.kind, m.name) as Row | undefined;

      if (owner && owner.id === gid) {
        result.unchanged += 1;
      } else if (owner) {
        if (!opts.move) {
          taken.push(`${m.kind} "${m.name}" is already in "${String(owner.name)}"`);
          continue;
        }
        d.prepare('UPDATE group_members SET group_id = ?, added_at = ?, added_by = ? WHERE kind = ? AND name = ?').run(
          gid,
          now,
          by,
          m.kind,
          m.name,
        );
        result.moved += 1;
      } else {
        d.prepare('INSERT INTO group_members (group_id, kind, name, added_at, added_by) VALUES (?, ?, ?, ?, ?)').run(
          gid,
          m.kind,
          m.name,
          now,
          by,
        );
        result.added += 1;
      }
    }

    // Throwing inside the transaction rolls back everything written above.
    if (taken.length) throw new ConflictError(taken.join('; '));
    if (have + result.added + result.moved > MAX_MEMBERS) {
      throw new ValidationError(`a project is limited to ${MAX_MEMBERS} resources`);
    }
    if (result.added + result.moved > 0) {
      d.prepare('UPDATE groups SET updated_at = ? WHERE id = ?').run(now, gid);
    }
    return result;
  });
}

export function removeMember(id: string, member: { kind: unknown; name: unknown }): void {
  const d = store();
  const m = assertMember(member);
  const gid = getGroup(id).id;
  const r = d.prepare('DELETE FROM group_members WHERE group_id = ? AND kind = ? AND name = ?').run(gid, m.kind, m.name);
  if (Number(r.changes) === 0) throw new NotFoundError(`${m.kind} "${m.name}" is not in this project`);
  d.prepare('UPDATE groups SET updated_at = ? WHERE id = ?').run(Date.now(), gid);
}
