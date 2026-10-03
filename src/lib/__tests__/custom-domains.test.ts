// Custom domains — the registry and validation (not DNS/nginx/certbot, which
// need a real network and a real box; those are exercised by hand against
// neev-stag). Each test is one guarantee the registry has to hold.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let dir: string;
before(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'bp-domains-'));
  process.env.BITPANEL_DB_PATH = path.join(dir, 'users.db');
});
after(() => rmSync(dir, { recursive: true, force: true }));

const lib = () => import('../custom-domains');

beforeEach(async () => {
  const d = await lib();
  for (const site of ['rapsap-website', 'other']) {
    for (const row of d.listDomains(site)) {
      // Removing an apex also cascades its www sibling (or vice versa), so a
      // row from this same snapshot may already be gone by the time we reach it.
      try {
        d.removeDomain(site, row.domain);
      } catch (e) {
        if (!(e instanceof d.NotFoundError)) throw e;
      }
    }
  }
});

test('adding a plain hostname attaches it with no redirect', async () => {
  const d = await lib();
  const rows = d.addDomain('rapsap-website', { domain: 'shop.rapsap.com' }, 'a@b.co');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].domain, 'shop.rapsap.com');
  assert.equal(rows[0].redirectTo, null);
  assert.equal(rows[0].addedBy, 'a@b.co');
});

test('an apex with the checkbox on also attaches www, and the apex redirects to it', async () => {
  const d = await lib();
  const rows = d.addDomain('rapsap-website', { domain: 'rapsap.com', redirectApexToWww: true }, null);
  assert.equal(rows.length, 2);
  const apex = rows.find((r) => r.domain === 'rapsap.com')!;
  const www = rows.find((r) => r.domain === 'www.rapsap.com')!;
  assert.equal(apex.redirectTo, 'www.rapsap.com');
  assert.equal(www.redirectTo, null);
});

test('a subdomain ignores the apex checkbox — there is no apex to redirect', async () => {
  const d = await lib();
  const rows = d.addDomain('rapsap-website', { domain: 'shop.rapsap.com', redirectApexToWww: true }, null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].redirectTo, null);
});

test('a domain already attached anywhere cannot be attached again', async () => {
  const d = await lib();
  d.addDomain('rapsap-website', { domain: 'rapsap.com' }, null);
  await assert.rejects(
    async () => d.addDomain('rapsap-website', { domain: 'rapsap.com' }, null),
    (e: Error) => e instanceof d.ConflictError && /already attached here/.test(e.message),
  );
  await assert.rejects(
    async () => d.addDomain('other', { domain: 'rapsap.com' }, null),
    (e: Error) => e instanceof d.ConflictError && /already belongs to "rapsap-website"/.test(e.message),
  );
});

test('the apex+www pair is all-or-nothing: a taken www blocks adding the apex too', async () => {
  const d = await lib();
  d.addDomain('other', { domain: 'www.rapsap.com' }, null);
  await assert.rejects(async () => d.addDomain('rapsap-website', { domain: 'rapsap.com', redirectApexToWww: true }, null));
  assert.equal(d.listDomains('rapsap-website').length, 0, 'the apex must not have been left attached alone');
});

test('not a hostname is refused', async () => {
  const d = await lib();
  assert.throws(() => d.addDomain('rapsap-website', { domain: 'http://rapsap.com' }, null));
  assert.throws(() => d.addDomain('rapsap-website', { domain: '' }, null));
  assert.throws(() => d.addDomain('rapsap-website', { domain: 'not a domain' }, null));
});

test('a site is bounded in how many domains it can hold', async () => {
  const d = await lib();
  for (let i = 0; i < d.MAX_DOMAINS_PER_SITE; i++) {
    d.addDomain('rapsap-website', { domain: `s${i}.rapsap.com` }, null);
  }
  assert.throws(() => d.addDomain('rapsap-website', { domain: 'one-more.rapsap.com' }, null), /limited to/);
});

test('removing a domain drops it, and any redirect that pointed at it', async () => {
  const d = await lib();
  d.addDomain('rapsap-website', { domain: 'rapsap.com', redirectApexToWww: true }, null);
  const left = d.removeDomain('rapsap-website', 'www.rapsap.com');
  // the apex redirected to www, which is now gone — it is dropped too rather
  // than left 308-ing into a dead end
  assert.equal(left.length, 0);
});

test('removing an unattached domain is reported, not silently accepted', async () => {
  const d = await lib();
  assert.throws(() => d.removeDomain('rapsap-website', 'never-added.com'), d.NotFoundError);
});

test('requiredRecord names the apex "@" and a subdomain by its label', async () => {
  const d = await lib();
  assert.deepEqual(d.requiredRecord('rapsap.com', '1.2.3.4'), { type: 'A', name: '@', value: '1.2.3.4' });
  assert.deepEqual(d.requiredRecord('www.rapsap.com', '1.2.3.4'), { type: 'A', name: 'www', value: '1.2.3.4' });
  assert.deepEqual(d.requiredRecord('shop.rapsap.com', '1.2.3.4'), { type: 'A', name: 'shop', value: '1.2.3.4' });
});

test('checkDns is "unknown" rather than "invalid" when there is no public IP to compare against', async () => {
  const d = await lib();
  assert.equal(await d.checkDns('rapsap.com', null), 'unknown');
});

test('checkDns says "invalid" for a domain with no A record at all', async () => {
  const d = await lib();
  // a name guaranteed not to exist
  assert.equal(await d.checkDns('this-domain-does-not-exist-bitpanel-test.invalid', '1.2.3.4'), 'invalid');
});

test('domains persist across the handle being reopened, as they would across a restart', async () => {
  const d = await lib();
  const users = await import('../users');
  d.addDomain('rapsap-website', { domain: 'rapsap.com' }, null);
  users.resetDb();
  assert.equal(d.listDomains('rapsap-website')[0]?.domain, 'rapsap.com');
});
