// The service API's gate and the client-editable static-site settings. Each
// test is one guarantee: the gate opens only for the exact token over
// loopback, and nothing a client types reaches the host's shell unchecked.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { serviceRequestAllowed } from '../service-auth';
import {
  assertBranch,
  assertBuildScript,
  assertOutDir,
  parseStaticrc,
  renderStaticrc,
  toConfig,
} from '../static-config';

const TOKEN = 'x'.repeat(40);
const h = (init: Record<string, string>) => new Headers(init);

describe('service gate', () => {
  it('accepts the exact token over loopback', () => {
    assert.equal(serviceRequestAllowed(h({ authorization: `Bearer ${TOKEN}` }), TOKEN), true);
  });
  it('refuses a wrong, missing or differently-sized token', () => {
    assert.equal(serviceRequestAllowed(h({ authorization: `Bearer ${'y'.repeat(40)}` }), TOKEN), false);
    assert.equal(serviceRequestAllowed(h({ authorization: `Bearer ${TOKEN}x` }), TOKEN), false);
    assert.equal(serviceRequestAllowed(h({}), TOKEN), false);
  });
  it('refuses anything that came through the tunnel, even with the token', () => {
    assert.equal(serviceRequestAllowed(h({ authorization: `Bearer ${TOKEN}`, 'cf-connecting-ip': '1.2.3.4' }), TOKEN), false);
  });
  it('is closed when no token is configured', () => {
    assert.equal(serviceRequestAllowed(h({ authorization: 'Bearer ' }), null), false);
  });
});

describe('static-site settings', () => {
  it('accepts ordinary branches and refuses ones that could be options or paths', () => {
    assert.equal(assertBranch('main'), 'main');
    assert.equal(assertBranch('release/2026-10'), 'release/2026-10');
    for (const bad of ['-x', '--upload-pack=sh', 'a..b', '/abs', 'a b', 'a;rm', '$(id)', 'x.lock', '']) {
      assert.throws(() => assertBranch(bad), Error, bad);
    }
  });
  it('builds only with a named npm script', () => {
    assert.equal(assertBuildScript('build'), 'build');
    assert.equal(assertBuildScript('build:prod'), 'build:prod');
    assert.equal(assertBuildScript(''), '');
    for (const bad of ['build && curl x', 'rm -rf /', '$(id)', 'a;b', '-x']) {
      assert.throws(() => assertBuildScript(bad), Error, bad);
    }
  });
  it('keeps the output folder inside the repo', () => {
    assert.equal(assertOutDir('./dist/'), 'dist');
    assert.equal(assertOutDir('build/site'), 'build/site');
    for (const bad of ['../etc', '/etc', 'a/../../b', '', 'a b']) {
      assert.throws(() => assertOutDir(bad), Error, bad);
    }
  });
  it('reads what `static-site create` writes and round-trips what it writes back', () => {
    const rc = parseStaticrc('BUILD_CMD=npm\\ run\\ build\nOUT_DIR=dist\nPORT=3100\nBRANCH=main\n');
    assert.deepEqual(
      { ...toConfig(rc), repo: undefined },
      { repo: undefined, buildScript: 'build', outDir: 'dist', port: 3100, branch: 'main' },
    );
    assert.deepEqual(parseStaticrc(renderStaticrc(rc)), rc);
  });
});
