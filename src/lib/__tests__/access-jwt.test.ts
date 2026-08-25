// Believing Cloudflare Access is what removes the shared password, so the
// checks that make it safe to believe are the ones worth pinning down. A flaw
// here means anyone allowed on any application in the team reaches the panel.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { verifyAccessJwt } from '../access-jwt';

const TEAM = 'bitroot-team';
const AUD = 'a'.repeat(64);
const ISS = `https://${TEAM}.cloudflareaccess.com`;

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' }) as { n: string; e: string };

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function mint(claims: Record<string, unknown>, header: Record<string, unknown> = {}) {
  const h = b64({ alg: 'RS256', kid: 'test', ...header });
  const p = b64({ iss: ISS, aud: AUD, exp: Math.floor(Date.now() / 1000) + 600, email: 'tech@bitroot.org', ...claims });
  const signer = createSign('RSA-SHA256');
  signer.update(`${h}.${p}`);
  return `${h}.${p}.${signer.sign(privateKey).toString('base64url')}`;
}

// Stands in for the team's JWKS endpoint. Restored in `after`, not at module
// scope: doing it at module scope undid the stub before a single test ran, so
// every negative case passed because the real fetch failed rather than because
// the check worked.
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => ({
  ok: true,
  json: async () => ({ keys: [{ kid: 'test', kty: 'RSA', alg: 'RS256', ...jwk }] }),
})) as unknown as typeof fetch;
after(() => {
  globalThis.fetch = realFetch;
});

test('a well-formed token yields the identity', async () => {
  const id = await verifyAccessJwt(mint({}), TEAM, AUD);
  assert.equal(id?.email, 'tech@bitroot.org');
});

test('a token for a DIFFERENT application in the same team is refused', async () => {
  // Every app in a team is signed by the same keys. Without the audience check,
  // whoever is allowed on pocketbase.<domain> would also reach the panel.
  const id = await verifyAccessJwt(mint({ aud: 'b'.repeat(64) }), TEAM, AUD);
  assert.equal(id, null);
});

test('a token from another team is refused', async () => {
  const id = await verifyAccessJwt(mint({ iss: 'https://someone-else.cloudflareaccess.com' }), TEAM, AUD);
  assert.equal(id, null);
});

test('an expired token is refused', async () => {
  const id = await verifyAccessJwt(mint({ exp: Math.floor(Date.now() / 1000) - 5 }), TEAM, AUD);
  assert.equal(id, null);
});

test('alg none is refused before any key is consulted', async () => {
  const h = b64({ alg: 'none' });
  const p = b64({ iss: ISS, aud: AUD, exp: Math.floor(Date.now() / 1000) + 600, email: 'attacker@evil.com' });
  assert.equal(await verifyAccessJwt(`${h}.${p}.`, TEAM, AUD), null);
});

test('a tampered payload is refused', async () => {
  const token = mint({});
  const [h, , s] = token.split('.');
  const forged = `${h}.${b64({ iss: ISS, aud: AUD, exp: Math.floor(Date.now() / 1000) + 600, email: 'yt@bitroot.org' })}.${s}`;
  assert.equal(await verifyAccessJwt(forged, TEAM, AUD), null);
});

test('missing configuration means no identity, never a default one', async () => {
  assert.equal(await verifyAccessJwt(mint({}), undefined, AUD), null);
  assert.equal(await verifyAccessJwt(mint({}), TEAM, undefined), null);
  assert.equal(await verifyAccessJwt(undefined, TEAM, AUD), null);
});
