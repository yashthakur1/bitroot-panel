"use client";

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpCircle,
  Check,
  Download,
  Loader2,
  Lock,
  Package,
  RefreshCw,
  Terminal,
  X,
} from 'lucide-react';
import { Button } from './ui/button';

interface CliApp {
  name: string;
  version: string;
}

interface Tool {
  id: string;
  name: string;
  description: string;
  category: 'runtime' | 'tool' | 'library';
  manager: 'pkg' | 'npm';
  pkg: string;
  locked?: string;
  installed: string | null;
  candidate: string | null;
}

const CATEGORY_LABEL: Record<Tool['category'], string> = {
  runtime: 'Runtimes',
  tool: 'Tools',
  library: 'Libraries & build dependencies',
};

// apt's Candidate is what an install would actually put on disk, so any
// difference from Installed means the button would change something.
function updatable(t: Tool): boolean {
  return Boolean(t.installed && t.candidate && t.installed !== t.candidate);
}

export default function SystemPanel({ section }: { section: 'cli' | 'tools' }) {
  const [cliApps, setCliApps] = useState<CliApp[] | null>(null);
  const [tools, setTools] = useState<Tool[] | null>(null);
  const [error, setError] = useState('');
  const [installing, setInstalling] = useState<Tool | null>(null);
  const [log, setLog] = useState('');
  const [result, setResult] = useState<'' | 'ok' | 'fail'>('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/system');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCliApps(data.cliApps);
      setTools(data.tools);
      setError('');
    } catch (e) {
      setError(`could not read system packages: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function install(t: Tool) {
    setInstalling(t);
    setLog('');
    setResult('');
    try {
      const res = await fetch('/api/system/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: t.id }),
      });
      if (!res.ok || !res.body) {
        const msg = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setLog(msg.error ?? `HTTP ${res.status}`);
        setResult('fail');
        return;
      }
      const reader = res.body.getReader();
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
      const ok = /\[\[EXIT:0\]\]/.test(full);
      setResult(ok ? 'ok' : 'fail');
      // Versions only change once the package manager has finished.
      if (ok) load();
    } catch (e) {
      setLog((l) => `${l}\n(connection lost: ${(e as Error).message})`);
      setResult('fail');
    }
  }

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;

  // ─── CLI apps ────────────────────────────────────────────────
  if (section === 'cli') {
    if (!cliApps) return <ShimmerRows />;
    return (
      <div className="overflow-x-auto border border-gray-200 dark:border-gray-800 rounded-xl">
        <table className="min-w-full">
          <thead>
            <tr className="text-left text-[11px] font-mono uppercase tracking-widest text-gray-500 dark:text-gray-400">
              <th className="px-4 py-3 font-medium whitespace-nowrap">
                Package{' '}
                <span className="ml-1 border border-gray-300 dark:border-gray-700 rounded px-1 tabular-nums">
                  {cliApps.length}
                </span>
              </th>
              <th className="px-4 py-3 font-medium whitespace-nowrap">Version</th>
              <th className="px-4 py-3 font-medium whitespace-nowrap">Installed with</th>
            </tr>
          </thead>
          <tbody>
            {cliApps.map((a) => (
              <tr
                key={a.name}
                className="border-t border-gray-100 dark:border-gray-800/80 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
              >
                <td className="px-4 py-3.5 whitespace-nowrap">
                  <div className="flex items-center gap-2.5">
                    <Terminal size={16} className="text-gray-500 dark:text-gray-400" />
                    <span className="font-medium text-gray-800 dark:text-gray-200">{a.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3.5 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300 tabular-nums">
                  {a.version || '—'}
                </td>
                <td className="px-4 py-3.5 whitespace-nowrap">
                  <span className="bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-300 text-xs font-medium px-2 py-1 rounded">
                    npm -g
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // ─── Tools marketplace ───────────────────────────────────────
  if (!tools) return <ShimmerCards />;

  const groups: Array<Tool['category']> = ['runtime', 'tool', 'library'];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400 text-pretty">
          Installed straight onto the device. Versions come from the package manager, so
          what you see here is what is actually on disk.
        </p>
        <button
          onClick={load}
          aria-label="Refresh packages"
          className="w-10 h-10 shrink-0 flex items-center justify-center rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {groups.map((g) => {
        const items = tools.filter((t) => t.category === g);
        if (!items.length) return null;
        return (
          <section key={g} className="space-y-3">
            <h3 className="text-xs uppercase font-semibold tracking-widest text-gray-500 dark:text-gray-400">
              {CATEGORY_LABEL[g]}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((t) => (
                <ToolCard key={t.id} tool={t} onInstall={() => install(t)} />
              ))}
            </div>
          </section>
        );
      })}

      {installing && (
        <InstallDialog
          tool={installing}
          log={log}
          result={result}
          onClose={() => {
            setInstalling(null);
            setLog('');
            setResult('');
          }}
        />
      )}
    </div>
  );
}

function ToolCard({ tool, onInstall }: { tool: Tool; onInstall: () => void }) {
  const canUpdate = updatable(tool);
  return (
    // Outer radius 16px against 12px of padding keeps the inner pill concentric.
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 p-3 flex flex-col gap-3 bg-white dark:bg-gray-900/40 hover:border-gray-300 dark:hover:border-gray-700 transition-colors">
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 shrink-0 grid place-items-center rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60">
          <Package size={16} className="text-accent-600 dark:text-accent-400" />
        </span>
        <div className="min-w-0">
          <p className="font-medium text-gray-800 dark:text-gray-200 truncate">{tool.name}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 text-pretty">{tool.description}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 mt-auto">
        <div className="text-xs tabular-nums text-gray-500 dark:text-gray-400 min-w-0">
          {tool.installed ? (
            <span className="truncate">
              v{tool.installed}
              {canUpdate && (
                <span className="text-accent-600 dark:text-accent-400"> → v{tool.candidate}</span>
              )}
            </span>
          ) : tool.candidate ? (
            <span>v{tool.candidate} available</span>
          ) : (
            <span>not in the repository</span>
          )}
        </div>

        {tool.locked ? (
          <span
            title={tool.locked}
            className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 cursor-help"
          >
            <Lock size={12} /> Locked
          </span>
        ) : !tool.installed ? (
          <Button size="sm" onClick={onInstall} className="active:scale-[0.96] transition-transform">
            <Download size={14} className="mr-1.5" /> Install
          </Button>
        ) : canUpdate ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onInstall}
            className="active:scale-[0.96] transition-transform"
          >
            <ArrowUpCircle size={14} className="mr-1.5" /> Update
          </Button>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border bg-green-50 dark:bg-green-950/50 text-green-700 dark:text-green-400 border-green-200 dark:border-green-900">
            <Check size={12} /> Installed
          </span>
        )}
      </div>

      {tool.locked && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 text-pretty border-t border-gray-100 dark:border-gray-800 pt-2">
          {tool.locked}
        </p>
      )}
    </div>
  );
}

function InstallDialog({
  tool,
  log,
  result,
  onClose,
}: {
  tool: Tool;
  log: string;
  result: '' | 'ok' | 'fail';
  onClose: () => void;
}) {
  const running = result === '';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={running ? undefined : onClose} />
      <div className="bounce-in relative w-full max-w-2xl rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-[0_16px_48px_rgba(0,0,0,0.24)] p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-display font-medium flex items-center gap-2">
              {running ? (
                <Loader2 size={16} className="animate-spin text-accent-500" />
              ) : result === 'ok' ? (
                <Check size={16} className="text-green-600" />
              ) : (
                <AlertTriangle size={16} className="text-red-500" />
              )}
              {running
                ? `Installing ${tool.name}…`
                : result === 'ok'
                  ? `${tool.name} installed`
                  : `${tool.name} failed`}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 font-mono">
              {tool.manager === 'pkg' ? `pkg install ${tool.pkg}` : `npm install -g ${tool.pkg}`}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={running}
            className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors disabled:opacity-40"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <pre className="bg-gray-950 text-gray-200 rounded-xl p-4 text-xs font-mono overflow-auto max-h-80 whitespace-pre-wrap">
          {log || 'starting…'}
        </pre>

        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose} disabled={running}>
            {running ? 'Running…' : 'Close'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ShimmerRows() {
  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-xl divide-y divide-gray-100 dark:divide-gray-800">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-14 animate-pulse bg-gray-100/60 dark:bg-gray-800/40" />
      ))}
    </div>
  );
}

function ShimmerCards() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-28 rounded-2xl border border-gray-200 dark:border-gray-800 animate-pulse bg-gray-100/60 dark:bg-gray-800/40"
        />
      ))}
    </div>
  );
}
