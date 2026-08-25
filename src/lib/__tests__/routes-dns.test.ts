// Route verification ran `getent hosts`. Termux has no getent, so on the phone
// the command failed for every hostname and the panel reported every route as
// "does not resolve yet" — including three that were serving correctly. The
// checker was broken, not the routes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = readFileSync(path.join(process.cwd(), 'src/lib/routes.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('DNS is resolved through Node, not a shell command', () => {
  const verify = /export async function verifyHostname[\s\S]*?\n}/.exec(SRC)?.[0] ?? '';
  assert.ok(verify, 'verifyHostname should exist');
  assert.ok(!/getent/.test(verify), 'getent does not exist on Android');
  assert.match(verify, /dnsLookup\(/);
});

test('the resolver is imported from node:dns', () => {
  assert.match(SRC, /from "node:dns\/promises"/);
});

test('nothing else in the module shells out for DNS', () => {
  assert.equal((SRC.match(/getent/g) ?? []).length, 0);
});
