// Two faults found while building the feature placeholders, both invisible in
// review and both easy to bring back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (p: string) =>
  readFileSync(path.join(process.cwd(), p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const SRC = read('src/components/feature-empty.tsx');
const PRESETS = read('src/components/feature-empties.tsx');

test('the hidden state cannot mismatch server rendering', () => {
  // A lazy useState read localStorage on the first client render while the
  // server, which has no storage, drew the preview — React error #418 on
  // Projects, which renders on the server.
  assert.match(SRC, /useSyncExternalStore\(/);
  assert.ok(!/useState\(\s*\(\)\s*=>\s*readHidden/.test(SRC));
});

test('aria-hidden sits on the sketch, never on the panel holding the close button', () => {
  // aria-hidden cannot be undone by a descendant, so on the panel it also hid
  // the "Hide preview" button from assistive technology.
  const panel = /bp-empty-grid[\s\S]*?Hide preview/.exec(SRC)?.[0] ?? '';
  assert.ok(panel, 'the preview panel should contain the close button');
  assert.equal((panel.match(/aria-hidden="true"/g) ?? []).length, 1);
  assert.ok(!/bp-empty-grid[^>]*aria-hidden/.test(SRC), 'not on the panel itself');
});

test('Projects offers no create action, because projects cannot be created yet', () => {
  const projects = /export function ProjectsEmpty[\s\S]*?\n}/.exec(PRESETS)?.[0] ?? '';
  assert.ok(projects, 'ProjectsEmpty should exist');
  assert.ok(!/Create your first project/.test(projects));
  assert.match(projects, /go: true/);
});
