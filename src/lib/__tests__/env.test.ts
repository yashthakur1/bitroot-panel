// The .env format is subtle enough that four separate hand-rolled parsers in
// this project were each wrong in a different way. These cases are the ones that
// actually broke something, so they are worth keeping rather than re-deriving.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEnvEdits, parseEnv, looksSecret, EnvFormatError } from '../env';

const val = (text: string, k: string) => parseEnv(text).find((v) => v.key === k)?.value;
const round = (v: string) => val(applyEnvEdits('', [{ key: 'K', value: v }]), 'K');

test('a quoted value loses its quotes', () => {
  assert.equal(val('Q="hello world"', 'Q'), 'hello world');
});

test('a URL survives — this is what sed corrupted', () => {
  // `sed -i "s/^KEY=.*/KEY=$val/"` broke on the / and & in a value like this.
  const v = 'mysql://a:b@c/d?x=1&y=2';
  assert.equal(round(v), v);
});

test('a password with a hash is not truncated', () => {
  // The setup wizard wrote this raw; dotenv then stopped at the # and the
  // operator was locked out of the panel they had just configured.
  const pw = 'p@ss#word with spaces';
  assert.equal(round(pw), pw);
  assert.equal(val(`P=${pw}`, 'P'), 'p@ss', 'unquoted really does truncate');
});

test('values that need no quoting round-trip', () => {
  for (const v of ['3210', 'example.com', 'a/b+c==', 'tskey-abc123']) {
    assert.equal(round(v), v);
  }
});

test('hostile characters round-trip', () => {
  for (const v of ['say "hi"', 'C:\\path\\to', 'a$b `c`', 'colour #fff', "it's fine", 'a\\nb', '']) {
    assert.equal(round(v), v, `failed for ${JSON.stringify(v)}`);
  }
});

test('multi-line values work, and neighbours survive', () => {
  const pem = '-----BEGIN KEY-----\nl2\nl3\n-----END KEY-----';
  const out = applyEnvEdits('A=1\nB=2\n', [{ key: 'PEM', value: pem }]);
  assert.equal(val(out, 'PEM'), pem);
  assert.equal(val(out, 'A'), '1');
  assert.equal(val(out, 'B'), '2');
  assert.equal(parseEnv(out).find((v) => v.key === 'PEM')?.multiline, true);
});

test('replacing a multi-line value removes the whole old span', () => {
  const first = applyEnvEdits('', [{ key: 'K', value: 'a\nb\nc' }]);
  const second = applyEnvEdits(first, [{ key: 'K', value: 'short' }]);
  assert.equal(val(second, 'K'), 'short');
  assert.ok(!second.includes('\nb\n'), 'orphaned lines left behind');
});

test('comments and ordering survive an edit', () => {
  const src = '# top\nA=1\n\n# middle\nB=2\n';
  const out = applyEnvEdits(src, [{ key: 'B', value: '3' }]);
  assert.ok(out.includes('# top'));
  assert.ok(out.includes('# middle'));
  assert.ok(out.indexOf('A=1') < out.indexOf('B='));
});

test('a null value deletes the key', () => {
  const out = applyEnvEdits('A=1\nB=2\n', [{ key: 'A', value: null }]);
  assert.equal(val(out, 'A'), undefined);
  assert.equal(val(out, 'B'), '2');
});

test('an unrepresentable value is refused, not mangled', () => {
  // Neither quote style can carry both ' and ", and writing it anyway would
  // leave stray backslashes in the value.
  assert.throws(() => round(`he said "it's fine"`), EnvFormatError);
});

test('secret detection is broad', () => {
  for (const k of ['TS_API_KEY', 'DASHBOARD_PASSWORD', 'SESSION_SECRET', 'DATABASE_URL']) {
    assert.equal(looksSecret(k), true, k);
  }
  assert.equal(looksSecret('PORT'), false);
});
