"use client";

// Same zone the API routes use; NEXT_PUBLIC so the browser bundle can see it.
const DOMAIN_SUFFIX = process.env.NEXT_PUBLIC_DOMAIN_SUFFIX ?? 'example.com';
const TAILNET_IP = process.env.NEXT_PUBLIC_TAILNET_IP ?? '127.0.0.1';

import ReadinessTimeline from './readiness-timeline';
import { useCallback, useEffect, useState } from 'react';
import {
  Eye,
  EyeOff,
  FileCode2,
  Server,
  Link2,
  Keyboard,
  ArrowUpCircle,
  Loader2,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { Button } from './ui/button';
import { StatCardsSkeleton, TableSkeleton } from './skeletons';
import { Tabs } from './ui/tabs';
import { humanUptime } from './project-list';

interface EnvVar {
  key: string;
  value: string;
  secret: boolean;
}

interface ConfigState {
  panel: {
    version: string;
    commit: string;
    execMode: string;
    node: string;
    port: string;
    uptimeSec: number;
  };
  env: EnvVar[];
  device: string;
  versions?: Record<string, string>;
}

const UPGRADE_TARGETS: Array<{
  target: string;
  label: string;
  versionKey?: string;
  desc: string;
}> = [
  {
    target: 'pocketbase',
    label: 'PocketBase',
    versionKey: 'pocketbase',
    desc: 'rebuilds the latest release with Termux Go, health-checks, auto-rolls back on failure',
  },
  {
    target: 'pm2',
    label: 'pm2',
    versionKey: 'pm2',
    desc: 'npm install -g pm2@latest + in-place daemon update (apps keep running)',
  },
  {
    target: 'termux',
    label: 'Termux packages',
    desc: 'pkg update + upgrade — refreshes node, go, git, openssh and friends',
  },
];

interface CheckEntry {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

function Upgrades({
  versions,
  onDone,
}: {
  versions: Record<string, string>;
  onDone: () => void;
}) {
  const [running, setRunning] = useState('');
  // Which row the log belongs to. Kept separate from `running` so the output
  // stays attached to its own row after the upgrade finishes.
  const [logFor, setLogFor] = useState('');
  const [log, setLog] = useState('');
  const [result, setResult] = useState<'ok' | 'fail' | ''>('');
  const [checks, setChecks] = useState<Record<string, CheckEntry> | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/upgrades/check');
      if (res.ok) setChecks(await res.json());
    } catch {
      // offline; chips stay hidden
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  async function upgrade(target: string) {
    setRunning(target);
    setLogFor(target);
    setResult('');
    setLog(`Starting ${target} upgrade…\n`);
    try {
      const res = await fetch('/api/upgrades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      });
      if (res.headers.get('content-type')?.includes('json')) {
        const data = await res.json().catch(() => ({}));
        setLog(data.error ?? `HTTP ${res.status}`);
        setResult('fail');
        return;
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let full = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setLog(
          full
            .replaceAll('[[HB]]', '')
            .replace(/\n?\[\[EXIT:\d+\]\]/, '')
            .split('\n')
            .map((l) => l.split('\r').pop() ?? '')
            .join('\n'),
        );
      }
      setResult(/\[\[EXIT:0\]\]/.test(full) ? 'ok' : 'fail');
      onDone();
      check();
    } catch (e) {
      setLog((l) => `${l}\n(connection lost: ${(e as Error).message} — the upgrade continues on the server)`);
      setResult('fail');
    } finally {
      setRunning('');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-display font-medium flex items-center gap-2">
          <ArrowUpCircle size={18} className="text-gray-500 dark:text-gray-400" />
          Software &amp; upgrades
        </h2>
        <button
          onClick={check}
          disabled={checking}
          className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 inline-flex items-center gap-1.5 py-2 transition-colors"
        >
          {checking ? <Loader2 size={12} className="animate-spin" /> : null}
          {checking ? 'checking…' : 'check for updates'}
        </button>
      </div>
      <div className="border rounded-lg divide-y dark:divide-gray-800">
        {UPGRADE_TARGETS.map((t) => {
          const c = checks?.[t.target];
          return (
            <div key={t.target}>
            <div className="px-4 py-3 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-2 flex-wrap">
                  {t.label}
                  {t.versionKey && versions[t.versionKey] && (
                    <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
                      {versions[t.versionKey]}
                    </span>
                  )}
                  {c?.updateAvailable ? (
                    <span className="pop-in inline-flex items-center gap-1 text-[10px] font-semibold uppercase bg-accent-50 dark:bg-accent-950/40 text-accent-700 dark:text-accent-300 border border-accent-200 dark:border-accent-800 px-1.5 py-0.5 rounded-full">
                      <ArrowUpCircle size={10} />
                      {c.latest ? `update → ${c.latest}` : c.current}
                    </span>
                  ) : c ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase text-green-700 dark:text-green-400">
                      <Check size={10} /> up to date
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{t.desc}</div>
              </div>
              <Button
                variant={c?.updateAvailable ? 'default' : 'outline'}
                size="sm"
                disabled={!!running}
                onClick={() => upgrade(t.target)}
              >
                {running === t.target ? (
                  <>
                    <Loader2 size={13} className="animate-spin mr-1.5" /> Upgrading…
                  </>
                ) : (
                  'Upgrade'
                )}
              </Button>
            </div>

            {logFor === t.target && log && (
              <div className="px-4 pb-4 space-y-2">
                {result && (
                  <p
                    className={`fade-in-up flex items-center gap-1.5 text-sm ${
                      result === 'ok'
                        ? 'text-green-700 dark:text-green-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {result === 'ok' ? (
                      <Check size={14} className="pop-in" />
                    ) : (
                      <AlertTriangle size={14} className="pop-in" />
                    )}
                    {result === 'ok' ? 'Upgrade completed.' : 'Upgrade failed — see log.'}
                  </p>
                )}
                <pre className="bg-black text-gray-100 font-mono text-xs rounded-md p-3 overflow-auto max-h-72 whitespace-pre-wrap">
                  {log}
                </pre>
              </div>
            )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type Tab = 'setup' | 'runtime' | 'software' | 'device';

export default function ConfigPage({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState<Tab>(
    initialTab === 'software' || initialTab === 'device' || initialTab === 'runtime'
      ? initialTab
      : 'setup',
  );
  const [state, setState] = useState<ConfigState | null>(null);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/config');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState(await res.json());
      setError('');
    } catch (e) {
      setError(`could not load config: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-display font-light tracking-tight">Config</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          The panel&apos;s own runtime configuration on the server. Read-only — to change
          values, edit <code>~/apps/bitroot-panel/.env</code> and run{' '}
          <code>pm2 restart bitroot-panel</code>.
        </p>
      </div>

      <Tabs
        tabs={[
          { key: 'setup', label: 'Setup' },
          { key: 'runtime', label: 'Runtime' },
          { key: 'software', label: 'Software' },
          { key: 'device', label: 'Device' },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className={tab === 'setup' ? '' : 'hidden'}>
        <ReadinessTimeline />
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!state && !error && (
        <>
          <StatCardsSkeleton count={6} />
          <TableSkeleton rows={5} cols={2} />
        </>
      )}

      {state && (
        <>
          {/* Runtime */}
          <div
            className={`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 ${
              tab === 'runtime' ? '' : 'hidden'
            }`}
          >
            {(
              [
                ['Version', `v${state.panel.version}`],
                ['Exec mode', state.panel.execMode],
                ['Node', state.panel.node],
                ['Port', state.panel.port],
                ['Uptime', humanUptime(state.panel.uptimeSec * 1000)],
                ['Deployed', state.panel.commit.split(' ')[0]],
              ] as Array<[string, string]>
            ).map(([label, value]) => (
              <div key={label} className="border rounded-lg p-4">
                <div className="text-xs uppercase text-gray-500 dark:text-gray-400 font-semibold">{label}</div>
                <div className="text-lg font-medium mt-1 truncate" title={value}>
                  {value}
                </div>
              </div>
            ))}
          </div>
          <p className={`text-sm text-gray-500 dark:text-gray-400 -mt-4 ${tab === 'runtime' ? '' : 'hidden'}`}>
            Last deploy: <span className="font-mono">{state.panel.commit}</span>
          </p>

          {/* .env */}
          <div className={tab === 'runtime' ? '' : 'hidden'}>
            <h2 className="text-xl font-display font-medium mb-3 flex items-center gap-2">
              <FileCode2 size={18} className="text-gray-500 dark:text-gray-400" />
              Environment (.env)
            </h2>
            <div className="overflow-x-auto border rounded-lg">
              <table className="min-w-full">
                <thead>
                  <tr className="text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide bg-gray-50 dark:bg-gray-800/60">
                    <th className="px-4 py-3 whitespace-nowrap">Key</th>
                    <th className="px-4 py-3 whitespace-nowrap">Value</th>
                    <th className="px-4 py-3 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {state.env.map((v) => {
                    const shown = !v.secret || revealed[v.key];
                    return (
                      <tr key={v.key} className="border-t hover:bg-gray-50 dark:hover:bg-gray-800/60">
                        <td className="px-4 py-3 whitespace-nowrap font-mono text-sm font-medium text-gray-800 dark:text-gray-200">
                          {v.key}
                        </td>
                        <td className="px-4 py-3 font-mono text-sm text-gray-700 dark:text-gray-300 break-all">
                          {shown ? v.value : '••••••••••••'}
                        </td>
                        <td className="px-4 py-3">
                          {v.secret && (
                            <button
                              className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                              title={shown ? 'hide' : 'reveal'}
                              onClick={() =>
                                setRevealed({ ...revealed, [v.key]: !revealed[v.key] })
                              }
                            >
                              {shown ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Endpoints */}
          <div className={tab === 'runtime' ? '' : 'hidden'}>
            <h2 className="text-xl font-display font-medium mb-3 flex items-center gap-2">
              <Link2 size={18} className="text-gray-500 dark:text-gray-400" />
              Ways to reach this panel
            </h2>
            <div className="border rounded-lg divide-y text-sm">
              <div className="px-4 py-3 flex justify-between flex-wrap gap-2">
                <span className="text-gray-700 dark:text-gray-300">Public (Cloudflare Access + password)</span>
                <a href={`https://panel.${DOMAIN_SUFFIX}`} className="font-mono text-accent-600 dark:text-accent-400 hover:underline">
                  {`panel.${DOMAIN_SUFFIX}`}
                </a>
              </div>
              <div className="px-4 py-3 flex justify-between flex-wrap gap-2">
                <span className="text-gray-700 dark:text-gray-300">Tailscale (private, password only)</span>
                <span className="font-mono text-gray-800 dark:text-gray-200">{TAILNET_IP}:{state.panel.port}</span>
              </div>
            </div>
          </div>

          {/* Software & upgrades */}
          <div className={tab === 'software' ? '' : 'hidden'}>
          <div className="mb-4 rounded-lg border border-amber-300/60 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/[0.06] p-3">
            <p className="text-sm text-amber-800 dark:text-amber-400 text-pretty">
              <strong>Upgrading pm2 restarts every service on this machine</strong>, including this
              panel — the page will drop while it happens. The process list is saved first and
              restored if the daemon comes back empty, but do it when a few minutes of downtime is
              acceptable.
            </p>
          </div>
            <Upgrades versions={state.versions ?? {}} onDone={load} />
          </div>

          {/* Shortcuts */}
          <div className={tab === 'device' ? '' : 'hidden'}>
            <h2 className="text-xl font-display font-medium mb-3 flex items-center gap-2">
              <Keyboard size={18} className="text-gray-500 dark:text-gray-400" />
              Keyboard shortcuts
            </h2>
            <div className="border rounded-lg divide-y dark:divide-gray-800 text-sm max-w-md">
              {(
                [
                  ['l', 'Open panel logs'],
                  ['h', 'Projects list'],
                  ['n', 'New project'],
                ] as Array<[string, string]>
              ).map(([key, action]) => (
                <div key={key} className="px-4 py-2.5 flex items-center justify-between">
                  <span className="text-gray-700 dark:text-gray-300">{action}</span>
                  <span className="text-gray-500 dark:text-gray-400">
                    <kbd className="border rounded px-1.5 py-0.5 text-xs font-mono bg-gray-50 dark:bg-gray-800/60">
                      g
                    </kbd>
                    <span className="mx-1">then</span>
                    <kbd className="border rounded px-1.5 py-0.5 text-xs font-mono bg-gray-50 dark:bg-gray-800/60">
                      {key}
                    </kbd>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Device */}
          <div className={tab === 'device' ? '' : 'hidden'}>
            <h2 className="text-xl font-display font-medium mb-3 flex items-center gap-2">
              <Server size={18} className="text-gray-500 dark:text-gray-400" />
              Device
            </h2>
            <pre className="bg-black text-gray-100 font-mono text-xs rounded-md p-4 overflow-auto max-h-96 whitespace-pre-wrap">
              {state.device || 'no device info'}
            </pre>
          </div>
        </>
      )}
    </div>
  );
}
