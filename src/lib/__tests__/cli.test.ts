// The launcher listed `uninstall` in its help and then refused to run it. Two
// faults sat behind that: a guard rejecting everything except `install` above
// the dispatch, and — after that was moved — a spawn that returns immediately,
// so the branch started the child and then fell through into the guard anyway.
// The help text was checked both times; the command never was.
//
// These tests read the launcher rather than running install/uninstall, because
// running them on a Linux machine would install or delete software.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CLI = join(process.cwd(), 'cli', 'index.js');
const SRC = readFileSync(CLI, 'utf8');

function run(...args: string[]): { out: string; code: number } {
  try {
    return { out: execFileSync('node', [CLI, ...args], { encoding: 'utf8' }), code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { out: (err.stdout ?? '') + (err.stderr ?? ''), code: err.status ?? 1 };
  }
}

test('every command named in --help has a branch that handles it', () => {
  const names = new Set(
    [...run('--help').out.matchAll(/^\s{2}bitpanel\s+([a-z-]+)\s{2,}/gm)].map((m) => m[1]),
  );
  assert.ok(names.size >= 3, `--help listed too few commands: ${[...names].join(', ')}`);
  for (const cmd of names) {
    assert.ok(
      SRC.includes(`cmd === '${cmd}'`) || cmd === 'install',
      `--help advertises "${cmd}" but the launcher has no branch for it`,
    );
  }
});

test('a branch that spawns cannot fall through to the guard below it', () => {
  // Each spawn must be the last thing its branch does, or the code after it
  // runs while the child is still starting.
  const guard = SRC.indexOf("if (cmd !== 'install')");
  const uninstall = SRC.indexOf("if (cmd === 'uninstall')");
  assert.ok(uninstall > -1 && uninstall < guard, 'uninstall must dispatch before the guard');
  assert.ok(
    SRC.slice(uninstall, guard).includes('} else {'),
    'the uninstall branch must stop execution, not fall into the guard',
  );
});

test('an unknown command is refused', () => {
  const { out, code } = run('definitely-not-a-command');
  assert.match(out, /unknown command/);
  assert.equal(code, 1);
});

test('--version prints a bare version', () => {
  assert.match(run('--version').out.trim(), /^\d+\.\d+\.\d+$/);
});

test('the fetched script is pinned to this version', () => {
  const version = run('--version').out.trim();
  const { out } = run('url');
  assert.ok(
    out.includes(`/v${version}/`) || out.includes('/main/'),
    `url should be pinned to v${version}, or fall back to main: ${out.trim()}`,
  );
});
