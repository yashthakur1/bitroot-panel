// The old token was an HMAC of a fixed string, so every browser held the same
// cookie value: it named nobody, never expired, and could not be revoked for
// one person. These tests pin down the properties that replaced it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueSession, verifySession } from '../session';

const SECRET = 'a-test-secret-value';

test('a token names the person it was issued to', async () => {
  const t = await issueSession(SECRET, 'Tech@Bitroot.org');
  const claims = await verifySession(SECRET, t);
  // Normalised, so a capitalised address cannot become a second identity.
  assert.equal(claims?.sub, 'tech@bitroot.org');
});

test('two people get different tokens', async () => {
  const a = await issueSession(SECRET, 'yt@bitroot.org');
  const b = await issueSession(SECRET, 'tech@bitroot.org');
  assert.notEqual(a, b);
});

test('a token signed with another secret is refused', async () => {
  const t = await issueSession(SECRET, 'yt@bitroot.org');
  assert.equal(await verifySession('a-different-secret', t), null);
});

test('editing the payload invalidates the signature', async () => {
  const t = await issueSession(SECRET, 'tech@bitroot.org');
  const [payload, sig] = t.split('.');
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
  decoded.sub = 'yt@bitroot.org';
  const forged = `${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${sig}`;
  assert.equal(await verifySession(SECRET, forged), null);
});

test('an expired token is refused', async () => {
  const t = await issueSession(SECRET, 'yt@bitroot.org', { ttlSeconds: -1 });
  assert.equal(await verifySession(SECRET, t), null);
});

test('the epoch travels with the token so a password change can retire it', async () => {
  const t = await issueSession(SECRET, 'yt@bitroot.org', { epoch: 7 });
  assert.equal((await verifySession(SECRET, t))?.epoch, 7);
});

test('junk is refused rather than throwing', async () => {
  for (const bad of ['', 'no-dot', '.', 'a.b', 'x'.repeat(500)]) {
    assert.equal(await verifySession(SECRET, bad), null, `should reject: ${bad}`);
  }
  assert.equal(await verifySession(SECRET, undefined), null);
});
