// The domain field used to accept anything shaped like a domain. It accepted
// neevpanel.bitroot.club, which cannot get a certificate, and the panel then
// reported every service as published while none of them answered.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { checkDomainUsable } from '../setup';

const realFetch = globalThis.fetch;

/** Answers as Cloudflare does: the zone the account owns, and nothing else. */
function cloudflareWith(zones: string[]) {
  return async (url: string | URL | Request) => {
    const name = new URL(String(url)).searchParams.get('name') ?? '';
    const found = zones.includes(name);
    return {
      json: async () => ({ success: true, result: found ? [{ name }] : [] }),
    } as Response;
  };
}

beforeEach(() => {
  globalThis.fetch = cloudflareWith(['bitroot.club']) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('the zone itself is usable', async () => {
  const r = await checkDomainUsable('bitroot.club', 'token');
  assert.equal(r.ok, true);
  assert.equal(r.zone, 'bitroot.club');
});

test('a name one level below the zone is refused', async () => {
  // Services publish at <name>.<domain>, so this domain puts them two levels
  // below the zone — past what Cloudflare's wildcard covers.
  const r = await checkDomainUsable('neevpanel.bitroot.club', 'token');
  assert.equal(r.ok, false);
  assert.equal(r.zone, 'bitroot.club');
  assert.match(r.reason ?? '', /bitroot\.club/);
  assert.match(r.reason ?? '', /certificate/i);
});

test('a domain in no Cloudflare zone is refused, and says so', async () => {
  const r = await checkDomainUsable('somewhere.else.net', 'token');
  assert.equal(r.ok, false);
  assert.equal(r.zone, undefined);
  assert.match(r.reason ?? '', /No Cloudflare zone/);
});

test('without a token it does not guess', async () => {
  // Guessing is what allowed the bad suffix in the first place. Accept it, but
  // say the check did not run rather than implying it passed.
  const r = await checkDomainUsable('anything.example', undefined);
  assert.equal(r.ok, true);
  assert.match(r.reason ?? '', /skipped/);
});

test('a Cloudflare outage does not silently pass the domain', async () => {
  globalThis.fetch = (async () => {
    throw new Error('network down');
  }) as typeof fetch;
  const r = await checkDomainUsable('bitroot.club', 'token');
  assert.equal(r.ok, false);
});
