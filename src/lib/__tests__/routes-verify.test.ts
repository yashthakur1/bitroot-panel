// Both of these were found on a live machine, not by the suite that existed.
// They are here so the next change cannot quietly restore either one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = readFileSync(path.join(process.cwd(), 'src/lib/routes.ts'), 'utf8');

/**
 * Comments explain the fault, so they name the very call the code must not
 * make. Assert against code alone or a test fails on its own explanation.
 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

test('unpublish never uses cloudflared to delete a DNS record', () => {
  // `cloudflared tunnel route dns` has no delete mode. --overwrite-dns *creates*
  // the record. Using it to remove one left the name resolving after
  // tunnel-remove, with the catch-all answering it — confirmed on neev-stag.
  const deleteBody = /deleteDns:\s*async[\s\S]*?\n    \},/.exec(code(SRC))?.[0] ?? '';
  assert.ok(deleteBody, 'deleteDns should exist in realEffects');
  assert.ok(
    !/cloudflared\s+tunnel\s+route\s+dns/.test(deleteBody),
    'deleteDns must not shell out to cloudflared — that command only creates',
  );
  assert.match(deleteBody, /deleteDnsFor/);
});

test('deleteDnsFor issues a real DELETE against the zone that owns the name', () => {
  const body = /export async function deleteDnsFor[\s\S]*?\n}/.exec(code(SRC))?.[0] ?? '';
  assert.ok(body, 'deleteDnsFor should exist');
  assert.match(body, /method:\s*"DELETE"/);
  // Not CF_ZONE_ID: one machine can serve names in several zones, and that
  // variable named a different zone than DOMAIN_SUFFIX on the real server.
  assert.match(body, /zoneFor\(/);
  assert.ok(!/CF_ZONE_ID/.test(body));
});

test('a 404 is checked against the ingress rules before it counts as healthy', () => {
  const body = /export async function verifyHostname[\s\S]*?\n}/.exec(code(SRC))?.[0] ?? '';
  assert.ok(body, 'verifyHostname should exist');
  // The tunnel's own catch-all is http_status:404, so a route cloudflared never
  // loaded answers exactly like a service whose root is a 404. Without this the
  // panel reported an unpublished route as live.
  assert.match(body, /code === "404"/);
  assert.match(body, /cloudflared tunnel ingress rule/);
});

test('the zone walk exists once, not once per caller', () => {
  const cli = readFileSync(path.join(process.cwd(), 'scripts/route.ts'), 'utf8');
  const setup = readFileSync(path.join(process.cwd(), 'src/lib/setup.ts'), 'utf8');
  const walks = (src: string) => (code(src).match(/zones\?name=/g) ?? []).length;

  assert.equal(walks(SRC), 1, 'lib/routes owns the lookup');
  assert.equal(walks(cli), 0, 'the CLI must not carry its own copy');
  assert.equal(walks(setup), 0, 'the setup check must not carry its own copy');
});
