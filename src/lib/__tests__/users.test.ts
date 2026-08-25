// The account store. Chosen as node:sqlite after testing it on the OnePlus
// (aarch64, Node 26) and neev-stag (Node 22), because a store the phone cannot
// open is no store at all.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let dir: string;
before(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'bp-users-'));
  process.env.BITPANEL_DB_PATH = path.join(dir, 'users.db');
});
after(() => rmSync(dir, { recursive: true, force: true }));

const users = () => import('../users');

test('the store starts empty, so .env stays in charge', async () => {
  const u = await users();
  assert.equal(u.storeInUse(), false);
});

test('a password round-trips and a wrong one does not', async () => {
  const u = await users();
  const hash = await u.hashPassword('correct horse battery');
  assert.equal(await u.passwordMatches('correct horse battery', hash), true);
  assert.equal(await u.passwordMatches('correct horse batterY', hash), false);
});

test('the stored value is a hash, never the password', async () => {
  const u = await users();
  const hash = await u.hashPassword('hunter2hunter2');
  assert.ok(!hash.includes('hunter2hunter2'));
  assert.match(hash, /^scrypt\$\d+\$/);
  // Two hashes of the same password differ: the salt is per-password, so a
  // stolen file cannot be attacked by grouping identical hashes.
  assert.notEqual(hash, await u.hashPassword('hunter2hunter2'));
});

test('creating an account puts the store in charge', async () => {
  const u = await users();
  await u.createUser({ email: 'YT@bitroot.org', password: 'superadminpass1', role: 'superadmin' });
  assert.equal(u.storeInUse(), true);
  // Normalised on the way in, so the same person cannot hold two accounts.
  assert.equal(u.getUser('yt@bitroot.org')?.email, 'yt@bitroot.org');
});

test('the database file is not readable by anyone else', async () => {
  const u = await users();
  assert.equal(statSync(u.dbPath()).mode & 0o777, 0o600);
});

test('a duplicate is named, not raised as a SQL error', async () => {
  const u = await users();
  await assert.rejects(
    () => u.createUser({ email: 'yt@bitroot.org', password: 'anotherpassword' }),
    (e: Error) => e instanceof u.UserExistsError,
  );
});

test('authenticate refuses a disabled account, then allows it again', async () => {
  const u = await users();
  await u.createUser({ email: 'tech@bitroot.org', password: 'techpassword12' });
  assert.ok(await u.authenticate('tech@bitroot.org', 'techpassword12'));

  u.setDisabled('tech@bitroot.org', true);
  assert.equal(await u.authenticate('tech@bitroot.org', 'techpassword12'), null);

  u.setDisabled('tech@bitroot.org', false);
  assert.ok(await u.authenticate('tech@bitroot.org', 'techpassword12'));
});

test('disabling and changing a password both bump the epoch', async () => {
  const u = await users();
  const before = u.getUser('tech@bitroot.org')!.epoch;
  u.setDisabled('tech@bitroot.org', true);
  const afterDisable = u.getUser('tech@bitroot.org')!.epoch;
  assert.ok(afterDisable > before, 'disable must retire existing sessions');

  await u.setPassword('tech@bitroot.org', 'a-brand-new-password');
  assert.ok(u.getUser('tech@bitroot.org')!.epoch > afterDisable,
    'a password change must retire existing sessions');
});

test('an unknown address is refused like a wrong password', async () => {
  const u = await users();
  assert.equal(await u.authenticate('nobody@bitroot.org', 'whatever12345'), null);
});

test('the last superadmin is countable, so callers can refuse to remove them', async () => {
  const u = await users();
  assert.equal(u.superadminCount(), 1);
});
