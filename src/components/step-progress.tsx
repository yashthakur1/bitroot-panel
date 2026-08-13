'use client';

// Shared view for long, multi-phase operations: a step rail on the right, the log
// stream on the left.
//
// Five components each hand-rolled the same reader loop and the same
// `.replaceAll('[[HB]]','')` marker stripping, and none of them could say which
// phase was running or why one failed. `useStepStream` replaces that loop, and
// `StepProgress` renders whatever the script chose to announce.
//
// Protocol and rationale: docs/streaming-progress.md.

import { useCallback, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, Circle, Loader2, RotateCcw, XCircle } from 'lucide-react';
import {
  applyChunk,
  completedCount,
  initialState,
  stepDuration,
  type StreamState,
  type Step,
} from '@/lib/steps';

/**
 * Read a streaming response, folding it into step state as it arrives.
 *
 * The command keeps running server-side if this unmounts — runStream is
 * deliberately built that way, so a closed tab cannot abort a deploy.
 */
export function useStepStream() {
  const [state, setState] = useState<StreamState | null>(null);
  const abort = useRef<AbortController | null>(null);

  const start = useCallback(async (input: RequestInfo, init?: RequestInit) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;

    let acc = initialState();
    setState(acc);

    const res = await fetch(input, { ...init, signal: controller.signal });
    if (!res.body) {
      setState({ ...acc, running: false, exit: 1, logs: 'no response body' });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      acc = applyChunk(acc, decoder.decode(value, { stream: true }));
      setState(acc);
    }
    // A stream that ends without [[EXIT:…]] means the connection dropped rather
    // than the command finishing; say so instead of leaving a spinner.
    if (acc.running) setState({ ...acc, running: false, exit: acc.exit ?? 1 });
  }, []);

  const reset = useCallback(() => {
    abort.current?.abort();
    setState(null);
  }, []);

  return { state, start, reset };
}

/** Carriage returns drive in-place progress bars; keep only the final frame. */
function displayLogs(raw: string): string {
  return raw
    .split('\n')
    .map((l) => l.split('\r').pop() ?? '')
    .join('\n')
    .trimEnd();
}

function fmt(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function StepRow({ step }: { step: Step }) {
  const dur = stepDuration(step);
  const icon = {
    pending: <Circle size={16} className="text-gray-400 dark:text-gray-600 shrink-0" />,
    running: <Loader2 size={16} className="text-accent-500 animate-spin shrink-0" />,
    done: <CheckCircle2 size={16} className="text-green-600 dark:text-green-500 shrink-0" />,
    failed: <XCircle size={16} className="text-red-600 dark:text-red-500 shrink-0" />,
  }[step.state];

  return (
    <li
      className={`flex gap-2.5 px-3 py-2.5 rounded-lg ${
        step.state === 'failed'
          ? 'bg-red-50 dark:bg-red-950/40'
          : step.state === 'running'
            ? 'bg-gray-100 dark:bg-gray-800/60'
            : ''
      }`}
    >
      <span className="mt-0.5">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="tabular-nums text-xs text-gray-400 dark:text-gray-500">{step.n}</span>
          <span
            className={`text-sm ${
              step.state === 'pending'
                ? 'text-gray-400 dark:text-gray-500'
                : 'text-gray-800 dark:text-gray-200'
            }`}
          >
            {step.label}
          </span>
          {dur !== null && (
            <span className="ml-auto tabular-nums text-xs text-gray-400 dark:text-gray-500 shrink-0">
              {fmt(dur)}
            </span>
          )}
        </span>
        {/* Never truncated: this sentence is the most useful thing on the page,
            and the design this borrows from elided it behind an ellipsis. */}
        {step.error && (
          <span className="block mt-1 text-xs text-red-700 dark:text-red-300 break-words [text-wrap:pretty]">
            {step.error}
          </span>
        )}
      </span>
    </li>
  );
}

export function StepProgress({
  state,
  title,
  details,
  onRetry,
  retryLabel,
}: {
  state: StreamState;
  title?: string;
  /** Invariants worth keeping visible while logs scroll — repo, branch, port. */
  details?: Array<{ label: string; value: string }>;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const failed = state.steps.find((s) => s.state === 'failed');
  // Logs are noise until something breaks, then they are the whole story.
  const [open, setOpen] = useState(false);
  const showLogs = open || Boolean(failed);
  const logs = displayLogs(state.logs);
  const lastLine = logs.split('\n').filter(Boolean).pop() ?? '';

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_18rem]">
      {/* ── logs ─────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl bg-gray-50 dark:bg-gray-900 p-1.5 ring-1 ring-gray-200 dark:ring-gray-800">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center gap-2 px-3 min-h-10 text-left rounded-xl transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-[0.99]"
          style={{ transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)' }}
          aria-expanded={showLogs}
        >
          <ChevronDown
            size={14}
            className={`shrink-0 text-gray-400 transition-transform duration-150 ${showLogs ? '' : '-rotate-90'}`}
          />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {title ?? 'Output'}
          </span>
          <span className="tabular-nums text-xs text-gray-400 dark:text-gray-500">
            {logs ? `${logs.split('\n').length} lines` : ''}
          </span>
          {!showLogs && lastLine && (
            <span className="ml-2 truncate font-mono text-xs text-gray-400 dark:text-gray-500">
              {lastLine}
            </span>
          )}
        </button>

        {showLogs && (
          <pre className="mt-1.5 max-h-[28rem] overflow-auto rounded-xl bg-black p-4 font-mono text-xs text-gray-100 whitespace-pre-wrap">
            {logs || '…'}
          </pre>
        )}
      </section>

      {/* ── step rail ────────────────────────────────────────────────────── */}
      <aside className="space-y-4">
        <div className="rounded-2xl bg-gray-50 dark:bg-gray-900 p-1.5 ring-1 ring-gray-200 dark:ring-gray-800">
          <div className="flex items-baseline justify-between px-3 min-h-10">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Steps</span>
            <span className="tabular-nums text-xs text-gray-400 dark:text-gray-500">
              {completedCount(state)}
              {state.total ? ` / ${state.total}` : ''}
            </span>
          </div>

          {state.steps.length === 0 ? (
            <p className="px-3 pb-3 text-xs text-gray-400 dark:text-gray-500 [text-wrap:pretty]">
              {state.running ? 'Starting…' : 'This operation reported no steps.'}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {state.steps.map((s) => (
                <StepRow key={s.n} step={s} />
              ))}
            </ul>
          )}
        </div>

        {failed && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="w-full inline-flex items-center justify-center gap-2 min-h-10 px-4 rounded-xl bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium transition-transform duration-150 active:scale-[0.96]"
            style={{ transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)' }}
          >
            <RotateCcw size={14} />
            {retryLabel ?? `Retry from step ${failed.n}`}
          </button>
        )}

        {details && details.length > 0 && (
          <dl className="rounded-2xl bg-gray-50 dark:bg-gray-900 px-4 py-3 ring-1 ring-gray-200 dark:ring-gray-800 space-y-1.5">
            {details.map((d) => (
              <div key={d.label} className="flex items-baseline justify-between gap-3">
                <dt className="text-xs text-gray-500 dark:text-gray-400 shrink-0">{d.label}</dt>
                <dd className="text-xs text-gray-800 dark:text-gray-200 text-right break-all">
                  {d.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {!state.running && !failed && state.exit === 0 && (
          <p className="px-1 text-xs text-green-700 dark:text-green-400">Finished without errors.</p>
        )}
      </aside>
    </div>
  );
}
