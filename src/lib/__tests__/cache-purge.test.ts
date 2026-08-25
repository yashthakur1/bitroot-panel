// A bucket made private kept serving from Cloudflare's cache for up to a year.
// Measured on a live bucket: the origin returned 404 while the edge returned
// the file with cf-cache-status: HIT. These tests hold the fix in place.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const STORAGE = code(read('src/app/api/storage/[name]/route.ts'));
const CF = code(read('src/lib/cloudflare.ts'));

test('making a bucket private purges its cached objects', () => {
  const branch = /body\.access === 'private'[\s\S]*?\n    \}/.exec(STORAGE)?.[0] ?? '';
  assert.ok(branch, "the 'private' branch should exist");
  assert.match(branch, /purgeBucket/);
});

test('the purge happens before the origin is closed', () => {
  const branch = /body\.access === 'private'[\s\S]*?\n    \}/.exec(STORAGE)?.[0] ?? '';
  // The other order leaves a window where a request repopulates the cache from
  // a bucket that is still public.
  assert.ok(
    branch.indexOf('purgeBucket') < branch.indexOf('setWebsite'),
    'purgeBucket must be called before setWebsite(false)',
  );
});

test('deleting a bucket purges too', () => {
  assert.equal((STORAGE.match(/purgeBucket\(/g) ?? []).length, 3,
    'defined once, called from both the private path and the delete path');
});

test('purging uses files, not the Enterprise-only hosts field', () => {
  const body = /export async function purgeCachedUrls[\s\S]*?\n}/.exec(CF)?.[0] ?? '';
  assert.ok(body, 'purgeCachedUrls should exist');
  assert.match(body, /files:/);
  // `hosts` is Enterprise-only. On the Free plan it fails with a permissions
  // error that reads like a bad token.
  assert.ok(!/hosts:/.test(body));
  assert.ok(!/purge_everything/.test(body), 'never purge the whole zone as a side effect');
});

test('a purge failure is reported, never swallowed', () => {
  const body = /async function purgeBucket[\s\S]*?\n}/.exec(STORAGE)?.[0] ?? '';
  assert.match(body, /WARNING/);
});
