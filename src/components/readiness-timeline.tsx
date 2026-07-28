"use client";

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Copy,
  Loader2,
  RefreshCw,
  Circle,
} from 'lucide-react';

type Status = 'ready' | 'partial' | 'missing';

interface Step {
  id: string;
  title: string;
  status: Status;
  detail: string;
  unlocks: string[];
  fix?: string[];
  link?: { href: string; label: string };
  checks?: Array<{ name: string; ok: boolean }>;
  guide?: string[];
  grants?: Array<{ scope: string; permission: string; why: string; missed?: boolean }>;
  required?: boolean;
}

interface Readiness {
  steps: Step[];
  ready: number;
  total: number;
  scannedAt: string;
}

export default function ReadinessTimeline() {
  const [data, setData] = useState<Readiness | null>(null);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);

  const scan = useCallback(async () => {
    setScanning(true);
    setError('');
    try {
      const res = await fetch('/api/readiness', { cache: 'no-store' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      setData(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    scan();
  }, [scan]);

  if (!data && !error) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2 py-6">
        <Loader2 size={14} className="animate-spin" /> Checking what this server can do…
      </p>
    );
  }

  const done = data?.ready ?? 0;
  const total = data?.total ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const remaining = data?.steps.filter((s) => s.status !== 'ready') ?? [];

  return (
    <div className="space-y-6">
      {/* Progress ------------------------------------------------- */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              <span className="tabular-nums">{done}</span> of{' '}
              <span className="tabular-nums">{total}</span> ready
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 text-pretty">
              {remaining.length === 0
                ? 'Everything the panel can use is configured.'
                : `${remaining.length} thing${remaining.length === 1 ? '' : 's'} left. Each one only affects its own features — the rest of the panel works regardless.`}
            </p>
          </div>
          <button
            onClick={scan}
            disabled={scanning}
            className="shrink-0 flex items-center gap-1.5 text-sm px-2.5 h-9 rounded-lg
                       border border-gray-200 dark:border-gray-800
                       text-gray-700 dark:text-gray-300
                       transition-[background-color,scale] duration-200 ease-swift
                       hover:bg-gray-50 dark:hover:bg-gray-800/60
                       active:scale-[0.96] disabled:opacity-50 disabled:active:scale-100"
          >
            <RefreshCw size={14} className={scanning ? 'animate-spin' : ''} />
            Re-scan
          </button>
        </div>
        <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-accent-500 transition-[width] duration-500 ease-swift"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" /> {error}
        </p>
      )}

      {/* Timeline ------------------------------------------------- */}
      <ol className="relative">
        {data?.steps.map((step, i) => (
          <li key={step.id} className="relative pl-9 pb-6 last:pb-0">
            {/* The rail stops at the last node instead of trailing into space. */}
            {i < data.steps.length - 1 && (
              <span
                aria-hidden
                className="absolute left-[11px] top-6 bottom-0 w-px bg-gray-200 dark:bg-gray-800"
              />
            )}
            <StatusDot status={step.status} />
            <StepBody step={step} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function StatusDot({ status }: { status: Status }) {
  const base =
    'absolute left-0 top-0.5 grid place-items-center w-[23px] h-[23px] rounded-full border-2';
  if (status === 'ready') {
    return (
      <span className={`${base} bg-emerald-500 border-emerald-500`}>
        <Check size={13} strokeWidth={3} className="text-white" />
      </span>
    );
  }
  if (status === 'partial') {
    return (
      <span className={`${base} bg-amber-500 border-amber-500`}>
        <AlertTriangle size={12} strokeWidth={2.5} className="text-white" />
      </span>
    );
  }
  return (
    <span
      className={`${base} border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900`}
    >
      <Circle size={7} className="text-gray-300 dark:text-gray-700 fill-current" />
    </span>
  );
}

function StepBody({ step }: { step: Step }) {
  const tone =
    step.status === 'ready'
      ? 'text-gray-900 dark:text-gray-100'
      : step.status === 'partial'
        ? 'text-amber-700 dark:text-amber-500'
        : 'text-gray-700 dark:text-gray-300';

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className={`text-sm font-medium ${tone}`}>{step.title}</h3>
        {step.status === 'ready' && (
          <span className="text-[10px] uppercase tracking-wider text-emerald-600 dark:text-emerald-500">
            Ready
          </span>
        )}
        {step.status === 'partial' && (
          <span className="text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-500">
            Needs attention
          </span>
        )}
        {step.status === 'missing' && !step.required && (
          <span className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
            Optional
          </span>
        )}
      </div>

      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 text-pretty">{step.detail}</p>

      {step.checks && step.status !== 'ready' && (
        <ul className="mt-2 space-y-1">
          {step.checks.map((c) => (
            <li key={c.name} className="flex items-center gap-1.5 text-xs">
              {c.ok ? (
                <Check size={12} className="text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle size={12} className="text-red-500 shrink-0" />
              )}
              <span className={c.ok ? 'text-gray-500 dark:text-gray-400' : 'text-red-600 dark:text-red-400'}>
                {c.name}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Saying what it costs beats saying what it is. */}
      {step.status !== 'ready' && step.unlocks.length > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
          Until this is done:{' '}
          <span className="text-gray-600 dark:text-gray-300">
            {step.unlocks.join(' · ')}
          </span>{' '}
          {step.unlocks.length === 1 ? 'does not work' : 'do not work'}.
        </p>
      )}

      {step.status !== 'ready' && step.guide && (
        <ol className="mt-3 space-y-1.5">
          {step.guide.map((line, i) => (
            <li key={line} className="flex gap-2.5 text-xs text-gray-600 dark:text-gray-300">
              <span className="shrink-0 grid place-items-center w-4 h-4 mt-px rounded-full
                               bg-gray-100 dark:bg-gray-800 text-[10px] font-medium
                               text-gray-500 dark:text-gray-400 tabular-nums">
                {i + 1}
              </span>
              <span className="text-pretty">{line}</span>
            </li>
          ))}
        </ol>
      )}

      {step.status !== 'ready' && step.grants && (
        <div className="mt-2.5 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
          {step.grants.map((g) => (
            <div
              key={`${g.scope}-${g.permission}`}
              className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-2 text-xs
                          border-b border-gray-100 dark:border-gray-800/70 last:border-b-0
                          ${g.missed ? 'bg-amber-50/60 dark:bg-amber-500/[0.06]' : ''}`}
            >
              <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400 w-14 shrink-0">
                {g.scope}
              </span>
              <span className="font-medium text-gray-800 dark:text-gray-200">{g.permission}</span>
              {g.missed && (
                <span className="text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-500">
                  easy to miss
                </span>
              )}
              <span className="basis-full pl-[3.5rem] text-gray-500 dark:text-gray-400 text-pretty">
                {g.why}
              </span>
            </div>
          ))}
        </div>
      )}

      {step.status !== 'ready' && (step.fix || step.link) && (
        <div className="mt-2.5 space-y-1.5">
          {step.fix?.map((cmd) => <Command key={cmd} cmd={cmd} />)}
          {step.link && (
            <a
              href={step.link.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-accent-600 dark:text-accent-400
                         transition-colors duration-200 ease-swift hover:text-accent-500"
            >
              {step.link.label}
              <ArrowUpRight size={12} />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// Some of these are commands and some are instructions; only the commands are
// worth a copy button, and a sentence with a copy icon next to it reads like a
// bug.
function Command({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  const runnable = /^[a-z~./]/.test(cmd) && !cmd.includes(' the ');

  if (!runnable) {
    return <p className="text-xs text-gray-500 dark:text-gray-400 text-pretty">{cmd}</p>;
  }

  return (
    <div className="flex items-start gap-2 group">
      <code className="flex-1 text-[12px] font-mono bg-gray-50 dark:bg-gray-800/60 text-gray-700 dark:text-gray-300 rounded-md px-2 py-1.5 break-all">
        {cmd}
      </code>
      <button
        onClick={() => {
          navigator.clipboard.writeText(cmd);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        aria-label="Copy command"
        className="shrink-0 grid place-items-center w-9 h-9 -m-1 rounded-md text-gray-400
                   transition-colors duration-200 ease-swift
                   hover:text-gray-600 dark:hover:text-gray-300"
      >
        <span className="relative block w-[13px] h-[13px]">
          <Check size={13} className={`absolute inset-0 icon-swap ${copied ? '' : 'is-off'} text-emerald-600`} />
          <Copy size={13} className={`absolute inset-0 icon-swap ${copied ? 'is-off' : ''}`} />
        </span>
      </button>
    </div>
  );
}
