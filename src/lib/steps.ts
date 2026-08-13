// Parsing step markers out of a log stream.
//
// The panel's long operations already stream through runStream, which speaks
// `[[HB]]` and `[[EXIT:<code>]]`. This adds three markers so the same stream can
// also say which phase it is in and why a phase failed, without a second channel
// and without the UI guessing at meaning by pattern-matching log text.
//
//   [[STEPS:6]]                    total phases, declared once
//   [[STEP:2:Install dependencies]]  phase 2 started
//   [[OK:2]]                       phase 2 finished
//   [[FAIL:2:no lockfile found]]   phase 2 failed, with the reason
//
// Anything else is log text and passes through untouched.
//
// See docs/streaming-progress.md.

export type StepState = 'pending' | 'running' | 'done' | 'failed';

export interface Step {
  n: number;
  label: string;
  state: StepState;
  /** Reason text from [[FAIL:…]] — written by the script, never inferred here. */
  error?: string;
  startedAt?: number;
  endedAt?: number;
}

export interface StreamState {
  steps: Step[];
  /** From [[STEPS:n]]. Null when the script never declared a total. */
  total: number | null;
  logs: string;
  /** Exit code once [[EXIT:n]] arrives. */
  exit: number | null;
  /** True between the first byte and [[EXIT:…]]. */
  running: boolean;
}

export function initialState(): StreamState {
  return { steps: [], total: null, logs: '', exit: null, running: true };
}

// One marker per match. Split rather than replace so a marker that arrives
// mid-line — runStream interleaves stdout and stderr, so this happens — does not
// swallow the log text around it.
const MARKER = /\[\[(STEPS|STEP|OK|FAIL|EXIT|HB):?([^\]]*)\]\]/g;

/**
 * Fold a chunk of stream into the state. Pure: returns a new object and never
 * mutates the input, so it is safe to drive a reducer with.
 *
 * `now` is injectable so durations can be tested without a clock.
 */
export function applyChunk(
  prev: StreamState,
  chunk: string,
  now: number = Date.now(),
): StreamState {
  const steps = prev.steps.map((s) => ({ ...s }));
  let { total, exit, running } = prev;
  let logs = prev.logs;

  const closePrevious = (state: StepState, error?: string) => {
    const open = [...steps].reverse().find((s) => s.state === 'running');
    if (!open) return;
    open.state = state;
    open.endedAt = now;
    if (error) open.error = error;
  };

  let last = 0;
  for (const m of chunk.matchAll(MARKER)) {
    logs += chunk.slice(last, m.index);
    last = m.index + m[0].length;

    const [, kind, rest] = m;
    switch (kind) {
      case 'HB':
        break; // keep-alive only; nothing to record
      case 'STEPS':
        total = Number(rest) || null;
        break;
      case 'STEP': {
        // `2:Install dependencies` — the label may itself contain colons.
        const colon = rest.indexOf(':');
        const n = Number(colon === -1 ? rest : rest.slice(0, colon));
        const label = colon === -1 ? `Step ${n}` : rest.slice(colon + 1);
        // A new step implicitly closes the previous one, so a script that only
        // announces starts still produces a correct rail.
        closePrevious('done');
        const existing = steps.find((s) => s.n === n);
        if (existing) {
          existing.label = label;
          existing.state = 'running';
          existing.startedAt = now;
          existing.endedAt = undefined;
          existing.error = undefined;
        } else {
          steps.push({ n, label, state: 'running', startedAt: now });
        }
        break;
      }
      case 'OK': {
        const n = Number(rest);
        const s = steps.find((x) => x.n === n);
        if (s) {
          s.state = 'done';
          s.endedAt = now;
        } else {
          closePrevious('done');
        }
        break;
      }
      case 'FAIL': {
        const colon = rest.indexOf(':');
        const n = Number(colon === -1 ? rest : rest.slice(0, colon));
        const why = colon === -1 ? '' : rest.slice(colon + 1);
        const s = steps.find((x) => x.n === n);
        if (s) {
          s.state = 'failed';
          s.endedAt = now;
          s.error = why;
        } else {
          closePrevious('failed', why);
        }
        break;
      }
      case 'EXIT':
        exit = Number(rest);
        running = false;
        // A non-zero exit with no [[FAIL:…]] still has to mark the open step, or
        // the rail would show it spinning forever.
        if (exit !== 0) closePrevious('failed');
        else closePrevious('done');
        break;
    }
  }
  logs += chunk.slice(last);

  return { steps: steps.sort((a, b) => a.n - b.n), total, logs, exit, running };
}

/** The step to report on: the failure if there is one, else the running one. */
export function currentStep(s: StreamState): Step | undefined {
  return s.steps.find((x) => x.state === 'failed') ?? s.steps.find((x) => x.state === 'running');
}

/** Completed-step count, for "2 / 6". */
export function completedCount(s: StreamState): number {
  return s.steps.filter((x) => x.state === 'done').length;
}

export function stepDuration(s: Step): number | null {
  return s.startedAt && s.endedAt ? s.endedAt - s.startedAt : null;
}
