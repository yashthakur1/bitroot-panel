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

// Types come from the probe module rather than a copy kept here: a local
// duplicate silently drifts every time a field is added server-side, and only
// complains at type-check time. `import type` is erased at build, so no
// server-only code follows it into the bundle.
import type { Readiness, Status, Step } from '@/lib/readiness';

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
            <StepBody step={step} onSaved={scan} />
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

// Lets the panel take the value instead of sending you to a terminal to edit
// the file it reads. Verification happens before the write, so a token that
// does not work is refused here rather than discovered later.
function CredentialForm({ step, onSaved }: { step: Step; onSaved: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((step.fields ?? []).map((f) => [f.key, f.suggestion ?? ''])),
  );
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<'idle' | 'restarting' | 'done'>('idle');
  const [error, setError] = useState('');
  const [canForce, setCanForce] = useState(false);
  const [failed, setFailed] = useState<Array<{ name: string; ok: boolean }> | null>(null);

  const filled = (step.fields ?? []).every((f) => values[f.key]?.trim());

  async function save(force: boolean) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/readiness/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values, force, restart: true }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? `HTTP ${res.status}`);
        setCanForce(Boolean(d.canForce));
        setFailed(d.verified?.permissions ?? null);
        return;
      }
      // The panel restarts itself here, so the obvious next step - re-scan
      // immediately - fires at a server that is on its way down. That request
      // failed silently and the whole thing looked like a dead button. Say what
      // happened, wait for it to answer again, then re-scan.
      setStage('restarting');
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const ping = await fetch('/api/readiness', { cache: 'no-store' });
          if (ping.ok) {
            setStage('done');
            onSaved();
            return;
          }
        } catch {
          /* still restarting */
        }
      }
      setStage('idle');
      setError('Saved, but the panel has not come back. Check: pm2 list');
    } catch (e) {
      setError((e as Error).message);
      setStage('idle');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-2.5">
      {(step.fields ?? []).map((f) => (
        <label key={f.key} className="block">
          <span className="block text-xs text-gray-600 dark:text-gray-400 mb-1">{f.label}</span>
          <input
            type={f.secret ? 'password' : 'text'}
            value={values[f.key] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            autoComplete="off"
            spellCheck={false}
            className="w-full h-9 px-2.5 rounded-lg text-sm font-mono
                       border border-gray-200 dark:border-gray-800
                       bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200
                       transition-[border-color,box-shadow] duration-200 ease-swift
                       focus:outline-none focus:border-accent-500/70 focus:ring-4 focus:ring-accent-500/10"
          />
          {f.hint && (
            <span className="block text-[11px] text-gray-500 dark:text-gray-400 mt-1 text-pretty">
              {f.hint}
            </span>
          )}
        </label>
      ))}

      {error && (
        <div className="text-xs text-red-600 dark:text-red-400 space-y-1">
          <p className="flex items-start gap-1.5">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {error}
          </p>
          {failed?.filter((p) => !p.ok).map((p) => (
            <p key={p.name} className="pl-5">
              · {p.name}
            </p>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={() => save(false)}
          disabled={busy || !filled}
          className="flex items-center gap-1.5 text-sm h-9 px-3 rounded-lg font-medium text-white
                     bg-accent-600 transition-[opacity,scale] duration-200 ease-swift
                     hover:bg-accent-500 active:scale-[0.96]
                     disabled:opacity-40 disabled:active:scale-100"
        >
          {busy && <Loader2 size={13} className="animate-spin" />}
          Save and apply
        </button>
        {stage === 'restarting' && (
          <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <Loader2 size={12} className="animate-spin" />
            Saved. Restarting the panel…
          </span>
        )}
        {stage === 'done' && (
          <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-500">
            <Check size={12} /> Applied
          </span>
        )}
        {canForce && (
          <button
            onClick={() => save(true)}
            disabled={busy}
            className="text-sm h-9 px-3 rounded-lg text-gray-600 dark:text-gray-400
                       border border-gray-200 dark:border-gray-800
                       transition-[background-color,scale] duration-200 ease-swift
                       hover:bg-gray-50 dark:hover:bg-gray-800/60 active:scale-[0.96]"
          >
            Save anyway
          </button>
        )}
      </div>
      <p className="text-[11px] text-gray-500 dark:text-gray-400">
        Written to <code className="font-mono">.env</code> on the server and the panel restarts
        itself. It stays on this machine.
      </p>
    </div>
  );
}

// Runs one of the panel's own repairs and reports what came back, rather than
// leaving the button looking inert while a shell command decides its fate.
function StepAction({
  action,
  onDone,
}: {
  action: { id: string; label: string; note?: string };
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [log, setLog] = useState('');

  async function go() {
    setBusy(true);
    setError('');
    setLog('');
    try {
      const res = await fetch('/api/readiness/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action.id }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);

      // Started, not finished. The work outlives the request and ends by
      // restarting the process that served it, so progress is polled from the
      // log rather than awaited on a connection that will be cut.
      if (d.started) {
        for (let i = 0; i < 180; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          try {
            const p = await fetch('/api/readiness/action', { cache: 'no-store' });
            const pd = await p.json();
            if (pd.log) setLog(pd.log);
            if (typeof pd.log === 'string' && pd.log.includes('== done ==')) {
              onDone();
              return;
            }
          } catch {
            // The restart cuts the connection - expected near the end.
          }
        }
        setError('still running after six minutes — check the log on the server');
        return;
      }
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        onClick={go}
        disabled={busy}
        className="flex items-center gap-1.5 text-sm h-9 px-3 rounded-lg font-medium text-white
                   bg-accent-600 transition-[opacity,scale] duration-200 ease-swift
                   hover:bg-accent-500 active:scale-[0.96]
                   disabled:opacity-40 disabled:active:scale-100"
      >
        {busy && <Loader2 size={13} className="animate-spin" />}
        {action.label}
      </button>
      {action.note && !busy && !log && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5 text-pretty">
          {action.note}
        </p>
      )}
      {log && (
        <pre className="mt-2 text-[11px] font-mono bg-gray-950 text-gray-300 rounded-lg p-2.5
                        max-h-40 overflow-auto whitespace-pre-wrap">
          {log.slice(-1500)}
        </pre>
      )}
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400 mt-1.5 flex items-start gap-1.5">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {error}
        </p>
      )}
    </div>
  );
}

function StepBody({ step, onSaved }: { step: Step; onSaved: () => void }) {
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

      {step.status !== 'ready' && step.actions && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {step.actions.map((a) => (
            <StepAction key={a.id} action={a} onDone={onSaved} />
          ))}
        </div>
      )}

      {step.status !== 'ready' && step.fields && (
        <CredentialForm step={step} onSaved={onSaved} />
      )}

      {step.status !== 'ready' && (step.fix || step.link) && (
        <div className="mt-2.5 space-y-1.5">
          {step.fix?.map((cmd) => <Command key={cmd} cmd={cmd} />)}
          {step.link && (
            <a
              href={step.link.href}
              target="_blank"
              rel="noreferrer"
              className={
                step.link.logo
                  ? `inline-flex items-center gap-2 h-9 px-3 rounded-lg text-sm
                     border border-gray-200 dark:border-gray-800
                     text-gray-700 dark:text-gray-200
                     transition-[background-color,scale] duration-200 ease-swift
                     hover:bg-gray-50 dark:hover:bg-gray-800/60 active:scale-[0.96]`
                  : `inline-flex items-center gap-1 text-xs text-accent-600 dark:text-accent-400
                     transition-colors duration-200 ease-swift hover:text-accent-500`
              }
            >
              {step.link.logo && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={step.link.logo}
                  alt=""
                  width={15}
                  height={15}
                  className="dark:invert dark:opacity-90"
                />
              )}
              {step.link.label}
              <ArrowUpRight size={step.link.logo ? 13 : 12} className="opacity-60" />
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
