// Projects — the registry that groups services, static sites, buckets and routes.
// What matters here is the guarantees the schema is meant to give, so each test
// is one guarantee.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let dir: string;
before(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'bp-groups-'));
  process.env.BITPANEL_DB_PATH = path.join(dir, 'users.db');
});
after(() => rmSync(dir, { recursive: true, force: true }));

const lib = () => import('../groups');
const users = () => import('../users');

// A clean slate per test, without paying for a new file each time.
beforeEach(async () => {
  const g = await lib();
  for (const p of g.listGroups()) g.deleteGroup(p.id);
});

test('a project is created with a stable slug id', async () => {
  const g = await lib();
  const p = g.createGroup({ name: '  Rapsap  ', description: 'the website' }, 'a@b.co');
  assert.equal(p.id, 'rapsap');
  assert.equal(p.name, 'Rapsap');
  assert.equal(p.description, 'the website');
  assert.equal(p.createdBy, 'a@b.co');
});

test('names become url-safe ids, and a name with no letters is refused', async () => {
  const g = await lib();
  assert.equal(g.createGroup({ name: 'Bit Root — Club!' }, null).id, 'bit-root-club');
  assert.equal(g.createGroup({ name: 'Café Ünï' }, null).id, 'cafe-uni');
  assert.throws(() => g.createGroup({ name: '!!!' }, null), /letter or digit/);
  assert.throws(() => g.createGroup({ name: '   ' }, null), /needs a name/);
  assert.throws(() => g.createGroup({ name: 'x'.repeat(61) }, null), /limited to 60/);
});

test('two projects cannot share a name, however it is capitalised', async () => {
  const g = await lib();
  g.createGroup({ name: 'Rapsap' }, null);
  await assert.rejects(async () => g.createGroup({ name: 'rapsap' }, null), g.ConflictError);
});

test('renaming keeps the id, so links to the project keep working', async () => {
  const g = await lib();
  g.createGroup({ name: 'Rapsap' }, null);
  const r = g.updateGroup('rapsap', { name: 'Rapsap Retail', description: 'stores and site' });
  assert.equal(r.id, 'rapsap');
  assert.equal(r.name, 'Rapsap Retail');
  assert.equal(g.getGroup('rapsap').description, 'stores and site');
});

test('adding a static site puts it in the project and is safe to repeat', async () => {
  const g = await lib();
  g.createGroup({ name: 'Rapsap' }, null);
  const first = g.addMembers('rapsap', [{ kind: 'static', name: 'rapsap-website' }], 'a@b.co');
  assert.deepEqual(first, { added: 1, moved: 0, unchanged: 0 });
  const again = g.addMembers('rapsap', [{ kind: 'static', name: 'rapsap-website' }], 'a@b.co');
  assert.deepEqual(again, { added: 0, moved: 0, unchanged: 1 });
  const detail = g.getGroup('rapsap');
  assert.equal(detail.members.length, 1);
  assert.equal(detail.members[0].addedBy, 'a@b.co');
  assert.equal(g.listGroups()[0].counts.static, 1);
});

test('a resource has one home: a second project cannot claim it without move', async () => {
  const g = await lib();
  g.createGroup({ name: 'Rapsap' }, null);
  g.createGroup({ name: 'Other' }, null);
  g.addMembers('rapsap', [{ kind: 'static', name: 'site' }], null);

  await assert.rejects(
    async () => g.addMembers('other', [{ kind: 'static', name: 'site' }], null),
    (e: Error) => e instanceof g.ConflictError && /already in "Rapsap"/.test(e.message),
  );
  assert.equal(g.getGroup('other').members.length, 0);

  const moved = g.addMembers('other', [{ kind: 'static', name: 'site' }], null, { move: true });
  assert.deepEqual(moved, { added: 0, moved: 1, unchanged: 0 });
  assert.equal(g.getGroup('rapsap').members.length, 0);
  assert.equal(g.getGroup('other').members.length, 1);
});

test('a name can be reused across kinds: a service and a static site are different things', async () => {
  const g = await lib();
  g.createGroup({ name: 'Rapsap' }, null);
  g.addMembers('rapsap', [{ kind: 'service', name: 'web' }, { kind: 'static', name: 'web' }], null);
  assert.equal(g.getGroup('rapsap').members.length, 2);
});

test('a batch is all-or-nothing: one invalid or taken member writes none of them', async () => {
  const g = await lib();
  g.createGroup({ name: 'A' }, null);
  g.createGroup({ name: 'B' }, null);
  g.addMembers('b', [{ kind: 'static', name: 'taken' }], null);

  await assert.rejects(async () =>
    g.addMembers('a', [{ kind: 'static', name: 'fresh' }, { kind: 'static', name: 'taken' }], null),
  );
  assert.equal(g.getGroup('a').members.length, 0, 'the fresh one must not have been kept');

  assert.throws(() => g.addMembers('a', [{ kind: 'static', name: 'fine' }, { kind: 'static', name: 'bad name!' }], null));
  assert.equal(g.getGroup('a').members.length, 0);
});

test('members are validated per kind', async () => {
  const g = await lib();
  g.createGroup({ name: 'A' }, null);
  assert.throws(() => g.addMembers('a', [{ kind: 'nonsense', name: 'x' }], null), /kind must be/);
  assert.throws(() => g.addMembers('a', [{ kind: 'service', name: 'has space' }], null), /invalid project name/);
  assert.throws(() => g.addMembers('a', [{ kind: 'route', name: 'https://x.com/path' }], null), /not a hostname/);
  assert.throws(() => g.addMembers('a', [{ kind: 'route', name: '' }], null), /needs a hostname/);
  assert.throws(() => g.addMembers('a', [{ kind: 'bucket', name: 'UPPER' }], null), /invalid bucket name/);
  assert.throws(() => g.addMembers('a', [], null), /nothing to add/);
  const ok = g.addMembers(
    'a',
    [
      { kind: 'route', name: 'Rapsap-Website.Bitroot.Club' },
      { kind: 'bucket', name: 'rapsap-assets' },
    ],
    null,
  );
  assert.equal(ok.added, 2);
  assert.ok(g.getGroup('a').members.some((m) => m.kind === 'route' && m.name === 'rapsap-website.bitroot.club'));
});

test('removing a member takes it out and leaves the project', async () => {
  const g = await lib();
  g.createGroup({ name: 'A' }, null);
  g.addMembers('a', [{ kind: 'static', name: 's' }], null);
  g.removeMember('a', { kind: 'static', name: 's' });
  assert.equal(g.getGroup('a').members.length, 0);
  assert.throws(() => g.removeMember('a', { kind: 'static', name: 's' }), g.NotFoundError);
});

test('deleting a project removes its memberships, so its resources become free again', async () => {
  const g = await lib();
  g.createGroup({ name: 'A' }, null);
  g.createGroup({ name: 'B' }, null);
  g.addMembers('a', [{ kind: 'static', name: 's' }], null);
  g.deleteGroup('a');
  assert.deepEqual(g.membership(), {});
  // Free to be claimed elsewhere, which proves no orphan row was left behind.
  assert.equal(g.addMembers('b', [{ kind: 'static', name: 's' }], null).added, 1);
  assert.throws(() => g.getGroup('a'), g.NotFoundError);
});

test('membership() answers "which project is this in" for every resource at once', async () => {
  const g = await lib();
  g.createGroup({ name: 'Rapsap' }, null);
  g.addMembers('rapsap', [{ kind: 'static', name: 'rapsap-website' }, { kind: 'service', name: 'api' }], null);
  assert.deepEqual(g.membership(), { 'static:rapsap-website': 'rapsap', 'service:api': 'rapsap' });
});

test('the registry is bounded', async () => {
  const g = await lib();
  g.createGroup({ name: 'A' }, null);
  const many = Array.from({ length: g.MAX_MEMBERS + 1 }, (_, i) => ({ kind: 'static', name: `s${i}` }));
  assert.throws(() => g.addMembers('a', many, null), /limited to 200/);
  assert.equal(g.getGroup('a').members.length, 0, 'an over-limit batch writes nothing');
});

test('projects survive the handle being reopened, as they would across a restart', async () => {
  const g = await lib();
  const u = await users();
  g.createGroup({ name: 'Rapsap' }, null);
  g.addMembers('rapsap', [{ kind: 'static', name: 'rapsap-website' }], null);
  u.resetDb();
  assert.equal(g.getGroup('rapsap').members[0].name, 'rapsap-website');
});

test('the accounts table still works alongside, and stays private', async () => {
  const u = await users();
  const g = await lib();
  g.createGroup({ name: 'Rapsap' }, null);
  assert.equal(u.storeInUse(), false, 'projects must not make the panel think accounts exist');
});
