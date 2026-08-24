// The marker parser reads a live log stream, so the awkward cases are about how
// the stream arrives rather than what it contains: markers split across chunks,
// markers glued to log text, and streams that stop without saying why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyChunk, initialState, completedCount, currentStep, stepDuration } from '../steps';

const feed = (chunks: string[], t0 = 1000) =>
  chunks.reduce((s, c, i) => applyChunk(s, c, t0 + i * 1000), initialState());

test('a normal run', () => {
  const s = feed(['[[STEPS:3]]', '[[STEP:1:Clone]]cloning...\n', '[[OK:1]]', '[[STEP:2:Install]]']);
  assert.equal(s.total, 3);
  assert.equal(completedCount(s), 1);
  assert.equal(currentStep(s)?.label, 'Install');
  assert.equal(s.logs, 'cloning...\n');
});

test('a marker glued to log text keeps both', () => {
  // runStream interleaves stdout and stderr, so this happens in practice.
  const s = feed(['npm WARN deprecated[[STEP:2:Install]] more output\n']);
  assert.equal(s.logs, 'npm WARN deprecated more output\n');
  assert.equal(s.steps[0].label, 'Install');
});

test('the failure reason is preserved exactly', () => {
  const why = 'no lockfile, and npm ci needs one';
  const s = feed(['[[STEP:2:Install]]', `[[FAIL:2:${why}]]`, '[[EXIT:1]]']);
  assert.equal(s.steps[0].state, 'failed');
  assert.equal(s.steps[0].error, why);
  assert.equal(currentStep(s)?.n, 2, 'a failure outranks a running step');
  assert.equal(s.exit, 1);
  assert.equal(s.running, false);
});

test('a label may contain colons', () => {
  const s = feed(['[[STEP:1:Fetch https://example.com/repo.git]]']);
  assert.equal(s.steps[0].label, 'Fetch https://example.com/repo.git');
});

test('a new step closes the previous one', () => {
  // Scripts that announce starts but not finishes still produce a correct rail.
  const s = feed(['[[STEP:1:A]]', '[[STEP:2:B]]', '[[EXIT:0]]']);
  assert.equal(s.steps[0].state, 'done');
  assert.equal(s.steps[1].state, 'done');
});

test('a non-zero exit with no FAIL still ends the running step', () => {
  // Otherwise the rail spins forever on a command that died.
  const s = feed(['[[STEP:1:A]]', '[[EXIT:1]]']);
  assert.equal(s.steps[0].state, 'failed');
});

test('heartbeats leave no trace', () => {
  const s = feed(['a[[HB]]b']);
  assert.equal(s.steps.length, 0);
  assert.equal(s.logs, 'ab');
});

test('durations are measured', () => {
  const s = feed(['[[STEP:1:A]]', '[[OK:1]]']);
  assert.equal(stepDuration(s.steps[0]), 1000);
});

test('applyChunk does not mutate its input', () => {
  const before = initialState();
  const snapshot = JSON.stringify(before);
  applyChunk(before, '[[STEP:1:X]]');
  assert.equal(JSON.stringify(before), snapshot);
});
