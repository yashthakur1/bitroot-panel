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

test('Projects offers a create action, and it leads somewhere real', () => {
  // The placeholder used to withhold this button, because "Create your first
  // project" leading nowhere would have been a lie. Projects exist now, so the
  // button must exist too — and stay wired: a create action bound to nothing is
  // the same lie again, only harder to spot.
  const projects = /export function ProjectsEmpty[\s\S]*?\n}/.exec(PRESETS)?.[0] ?? '';
  assert.ok(projects, 'ProjectsEmpty should exist');
  assert.match(projects, /Create your first project/);
  assert.match(projects, /onClick: onCreate/);
  assert.ok(!/Coming soon/i.test(projects), 'a feature that exists is not "coming soon"');

  const page = read('src/components/projects-page.tsx');
  assert.match(page, /<ProjectsEmpty onCreate=/, 'the page must supply the handler');
  assert.match(page, /fetch\('\/api\/groups', \{\s*method: 'POST'/, 'and the form must really create a project');
});
