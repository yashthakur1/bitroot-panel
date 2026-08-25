// CF_ZONE_ID and the zone a machine actually serves are different things, and
// assuming otherwise has now caused three separate faults: routes published to
// the wrong zone, a domain check against the wrong apex, and IAM on neev-stag
// listing the OnePlus's applications while reporting that nothing matched a
// hostname this machine serves.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const code = (p: string) =>
  readFileSync(path.join(process.cwd(), p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Only comments that START a line. Stripping every '//' also truncated
    // every line holding an https:// URL, which silently emptied the very
    // strings these assertions look for.
    .replace(/^\s*\/\/.*$/gm, '');

const ACCESS = code('src/lib/access.ts');

test('Access requests resolve the zone instead of trusting CF_ZONE_ID', () => {
  // Every request must go through zoneId(), which works the zone out from the
  // hostnames the machine publishes.
  assert.match(ACCESS, /async function zoneId\(\)/);
  assert.match(ACCESS, /zones\/\$\{zone\}/);
});

test('no Access URL is built straight from CF_ZONE_ID', () => {
  const direct = ACCESS.match(/client\/v4\/zones\/\$\{ZONE\}/g) ?? [];
  assert.deepEqual(direct, [], 'every call must go through zoneId()');
});

test('the write probe tests the same zone as the reads', () => {
  // Probing a different zone than the one being written answers a question
  // nobody asked, and answers it confidently.
  const probe = /canWritePolicies[\s\S]*?\n}/.exec(ACCESS)?.[0] ?? '';
  assert.ok(probe, 'canWritePolicies should exist');
  assert.ok(!/\$\{ZONE\}/.test(probe), 'the probe must not use CF_ZONE_ID directly');
  assert.match(probe, /zoneId\(\)/);
});

test('the zone lookup is still owned by lib/routes', () => {
  assert.match(ACCESS, /import \{ zoneFor \} from '\.\/routes'/);
  // Not a fourth copy of the label walk.
  assert.equal((ACCESS.match(/zones\?name=/g) ?? []).length, 0);
});
