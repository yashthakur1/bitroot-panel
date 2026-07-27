"use client";

import { useState } from 'react';
import {
  AlertTriangle,
  ArrowUpCircle,
  Check,
  Download,
  Loader2,
  Lock,
  Package,
  Terminal,
  X,
} from 'lucide-react';
import { Button } from './ui/button';

export interface CliApp {
  name: string;
  version: string;
}

export interface Tool {
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
export function updatable(t: Tool): boolean {
  return Boolean(t.installed && t.candidate && t.installed !== t.candidate);
}

// The data lives in the parent so the tab strip can show real counts and one
// search box can serve every section. This component renders it and owns the
// install action.
export default function SystemPanel({
  section,
  cliApps,
  tools,
  query,
  onReload,
}: {
  section: 'cli' | 'tools';
  cliApps: CliApp[] | null;
  tools: Tool[] | null;
  query: string;
  onReload: (fresh?: boolean) => void;
}) {
  const [installing, setInstalling] = useState<Tool | null>(null);
  const [log, setLog] = useState('');
  const [result, setResult] = useState<'' | 'ok' | 'fail'>('');

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
      // Versions only change once the package manager has finished, and the
      // cached ones are stale the moment it does — so bypass the cache.
      if (ok) onReload(true);
    } catch (e) {
      setLog((l) => `${l}\n(connection lost: ${(e as Error).message})`);
      setResult('fail');
    }
  }

  // ─── CLI apps ────────────────────────────────────────────────
  if (section === 'cli') {
    if (!cliApps) return <ShimmerRows />;
    const visible = cliApps.filter((a) => a.name.toLowerCase().includes(query.toLowerCase()));
    if (!visible.length) return <Empty query={query} noun="CLI apps" />;
    return (
      <div className="overflow-x-auto border border-gray-200 dark:border-gray-800 rounded-lg">
        <table className="min-w-full">
          <thead>
            <tr className="text-left text-[11px] font-mono uppercase tracking-widest text-gray-500 dark:text-gray-400">
              <th className="px-4 py-3 font-medium whitespace-nowrap">
                Package{' '}
                <span className="ml-1 border border-gray-300 dark:border-gray-700 rounded px-1 tabular-nums">
                  {visible.length}
                </span>
              </th>
              <th className="px-4 py-3 font-medium whitespace-nowrap">Version</th>
              <th className="px-4 py-3 font-medium whitespace-nowrap">Installed with</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((a) => (
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

  // ─── Tools ───────────────────────────────────────────────────
  if (!tools) return <ShimmerCards />;

  const q = query.toLowerCase();
  const matched = tools.filter(
    (t) => t.name.toLowerCase().includes(q) || t.id.includes(q) || t.description.toLowerCase().includes(q),
  );
  if (!matched.length) return <Empty query={query} noun="packages" />;

  const groups: Array<Tool['category']> = ['runtime', 'tool', 'library'];

  return (
    <div className="space-y-7">
      {groups.map((g) => {
        const items = matched.filter((t) => t.category === g);
        if (!items.length) return null;
        return (
          <section key={g} className="space-y-3">
            <h3 className="text-[11px] font-mono uppercase tracking-widest text-gray-500 dark:text-gray-400">
              {CATEGORY_LABEL[g]}{' '}
              <span className="ml-1 border border-gray-300 dark:border-gray-700 rounded px-1 tabular-nums">
                {items.length}
              </span>
            </h3>
            {/* Cards stretch to their row, so neighbours always line up. Rows
                size independently on purpose: forcing one height would push
                the tallest locked explanation onto every other row too. */}
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
    // 12px radius over 12px padding keeps the 8px icon tile concentric.
    <div className="h-full rounded-xl border border-gray-200 dark:border-gray-800 p-3 flex flex-col gap-2.5 bg-white dark:bg-gray-900/40 hover:border-gray-300 dark:hover:border-gray-700 transition-colors">
      <div className="flex items-start gap-2.5">
        <span className="w-8 h-8 shrink-0 grid place-items-center rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60">
          <Package size={15} className="text-accent-600 dark:text-accent-400" />
        </span>
        <div className="min-w-0">
          <p className="font-medium text-sm text-gray-800 dark:text-gray-200 truncate">{tool.name}</p>
          {/* Clamped so descriptions of different lengths cannot set different
              card heights across a row. */}
          <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{tool.description}</p>
        </div>
      </div>

      {tool.locked && (
        <p
          title={tool.locked}
          className="text-[11px] text-gray-500 dark:text-gray-500 line-clamp-2 border-l-2 border-gray-200 dark:border-gray-800 pl-2"
        >
          {tool.locked}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 mt-auto pt-1">
        <div className="text-xs tabular-nums text-gray-500 dark:text-gray-400 min-w-0 truncate">
          {tool.installed ? (
            <>
              v{tool.installed}
              {canUpdate && (
                <span className="text-accent-600 dark:text-accent-400"> → v{tool.candidate}</span>
              )}
            </>
          ) : tool.candidate ? (
            <>v{tool.candidate} available</>
          ) : (
            <>not in the repository</>
          )}
        </div>

        {tool.locked ? (
          <span className="shrink-0 inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700">
            <Lock size={12} /> Locked
          </span>
        ) : !tool.installed ? (
          <Button size="sm" onClick={onInstall} className="shrink-0 active:scale-[0.96] transition-transform">
            <Download size={14} className="mr-1.5" /> Install
          </Button>
        ) : canUpdate ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onInstall}
            className="shrink-0 active:scale-[0.96] transition-transform"
          >
            <ArrowUpCircle size={14} className="mr-1.5" /> Update
          </Button>
        ) : (
          <span className="shrink-0 inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border bg-green-50 dark:bg-green-950/50 text-green-700 dark:text-green-400 border-green-200 dark:border-green-900">
            <Check size={12} /> Installed
          </span>
        )}
      </div>
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

function Empty({ query, noun }: { query: string; noun: string }) {
  return (
    <p className="text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-800 rounded-lg p-8 text-center text-sm">
      {query ? `Nothing matching "${query}"` : `No ${noun} here yet.`}
    </p>
  );
}

function ShimmerRows() {
  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-lg divide-y divide-gray-100 dark:divide-gray-800">
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
          className="h-[104px] rounded-xl border border-gray-200 dark:border-gray-800 animate-pulse bg-gray-100/60 dark:bg-gray-800/40"
        />
      ))}
    </div>
  );
}
