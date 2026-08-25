// A machine fact must never be a NEXT_PUBLIC_ constant again.
//
// NEXT_PUBLIC_ values are inlined into the browser bundle when the panel is
// BUILT. Editing .env and restarting — which the Config page tells you to do —
// does not change them. Worse, a name that .env never writes fails silently:
// two components read NEXT_PUBLIC_TAILNET_IP while setup wrote
// NEXT_PUBLIC_TAILNET_HOST, so both fell back to 127.0.0.1 and told operators
// their services were on localhost. Nothing errored.
//
// This test is the thing that stops that returning. It fails the build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Facts about the machine. Values that are genuinely build-time — a public
// analytics key, say — are not in this list and stay allowed.
const MACHINE_FACTS = [
  'NEXT_PUBLIC_DOMAIN_SUFFIX',
  'NEXT_PUBLIC_TAILNET_HOST',
  'NEXT_PUBLIC_TAILNET_IP',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

test('no component reads a machine fact from the build-time environment', () => {
  const offenders: string[] = [];
  for (const file of walk('src')) {
    // The tests and lib/facts.ts name these constants in prose, explaining why
    // they are gone. Reading them is the fault, not mentioning them.
    if (file.includes('__tests__')) continue;
    const src = readFileSync(file, 'utf8');
    for (const name of MACHINE_FACTS) {
      if (new RegExp(`process\\.env\\.${name}\\b`).test(src)) {
        offenders.push(`${file} reads ${name}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `machine facts must come from /api/facts at runtime:\n  ${offenders.join('\n  ')}`,
  );
});

test('the facts endpoint is not statically rendered', () => {
  // A cached response would be exactly the staleness this replaced.
  const src = readFileSync('src/app/api/facts/route.ts', 'utf8');
  assert.match(src, /force-dynamic/);
  assert.match(src, /no-store/);
});
