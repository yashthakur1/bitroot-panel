// Changing the domain is the operation that broke the most things at once:
// .env said one domain, the tunnel served another, Garage stripped a third.
// These tests hold the migration honest about what it will and will not move.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, parseIngress, planMigrate, type RouteEffects } from '../routes';

const CONFIG = `tunnel: abc
ingress:
  - hostname: blog.old.com
    service: http://localhost:3001
  - hostname: shop.old.com
    service: http://localhost:3002
  - hostname: keep.other.com
    service: http://localhost:3003
  - service: http_status:404
`;

test('planMigrate moves only the hostnames under the old suffix', () => {
  const steps = planMigrate(parseIngress(CONFIG), 'old.com', 'new.com', 'new.com');
  assert.deepEqual(
    steps.map((s) => [s.from, s.to]),
    [
      ['blog.old.com', 'blog.new.com'],
      ['shop.old.com', 'shop.new.com'],
    ],
  );
  assert.ok(steps.every((s) => s.covered));
});

test('planMigrate keeps the catch-all and unrelated zones out of it', () => {
  const steps = planMigrate(parseIngress(CONFIG), 'old.com', 'new.com', 'new.com');
  assert.ok(!steps.some((s) => s.from === 'keep.other.com'));
  assert.ok(!steps.some((s) => s.from === undefined));
});

test('planMigrate is empty when the domain did not change', () => {
  assert.deepEqual(planMigrate(parseIngress(CONFIG), 'old.com', 'old.com', 'old.com'), []);
  assert.deepEqual(planMigrate(parseIngress(CONFIG), '', 'new.com', 'new.com'), []);
});

test('planMigrate marks a target the certificate cannot cover', () => {
  // deep.new.com is a zone; blog.deep.new.com is one level below it, which the
  // wildcard covers. Two levels below is what fails.
  const steps = planMigrate(parseIngress(CONFIG), 'old.com', 'sub.new.com', 'new.com');
  assert.equal(steps.length, 2);
  assert.ok(steps.every((s) => !s.covered));
  assert.match(steps[0].reason ?? '', /new\.com/);
});

const OK = { dns: 'ok', ingress: 'ok', tunnel: 'ok', tls: 'ok', origin: 'ok' } as const;
const BAD = { ...OK, tls: 'failed' } as const;

function fakeEffects(state: { config: string; dns: string[]; verified: Set<string> }): RouteEffects {
  return {
    readConfig: async () => state.config,
    writeConfig: async (text: string) => {
      state.config = text;
    },
    reloadTunnel: async () => {},
    createDns: async (hostname: string) => {
      state.dns.push(hostname);
    },
    deleteDns: async (hostname: string) => {
      state.dns = state.dns.filter((h) => h !== hostname);
    },
    verify: async (hostname: string) =>
      state.verified.has(hostname)
        ? { ok: true, checks: { ...OK } }
        : { ok: false, checks: { ...BAD }, reason: 'TLS handshake failed' },
  };
}

test('migrate publishes the new hostname before removing the old one', async () => {
  const state = {
    config: CONFIG,
    dns: ['blog.old.com', 'shop.old.com'],
    verified: new Set(['blog.new.com', 'shop.new.com']),
  };
  const result = await migrate(fakeEffects(state), {
    from: 'old.com',
    to: 'new.com',
    zone: 'new.com',
  });

  assert.equal(result.moved.length, 2);
  assert.equal(result.skipped.length, 0);
  assert.deepEqual(state.dns.sort(), ['blog.new.com', 'shop.new.com']);

  const hosts = parseIngress(state.config)
    .map((e) => e.hostname)
    .filter(Boolean);
  assert.deepEqual(hosts.sort(), ['blog.new.com', 'keep.other.com', 'shop.new.com']);
});

test('migrate leaves the old route in place when the new one fails to verify', async () => {
  const state = {
    config: CONFIG,
    dns: ['blog.old.com', 'shop.old.com'],
    verified: new Set(['shop.new.com']), // blog never comes up
  };
  const result = await migrate(fakeEffects(state), {
    from: 'old.com',
    to: 'new.com',
    zone: 'new.com',
  });

  assert.deepEqual(result.moved.map((s) => s.from), ['shop.old.com']);
  assert.deepEqual(result.skipped.map((s) => s.from), ['blog.old.com']);

  const hosts = parseIngress(state.config)
    .map((e) => e.hostname)
    .filter(Boolean);
  // The service the operator had is still reachable. A rollback that leaves a
  // hostname with no route is worse than not migrating it.
  assert.ok(hosts.includes('blog.old.com'));
  assert.ok(state.dns.includes('blog.old.com'));
});
