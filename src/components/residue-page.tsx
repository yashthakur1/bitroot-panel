"use client";

import { useCallback, useEffect, useState } from 'react';
import { Button } from './ui/button';
import { TableSkeleton } from './skeletons';
import {
  Trash2,
  Loader2,
  RefreshCw,
  FolderX,
  GitBranch,
  Plug2,
  Archive,
  ScrollText,
  FileClock,
  Cloud,
  Database,
  X,
  Info,
} from 'lucide-react';

interface ResidueItem {
  id: string;
  category: string;
  label: string;
  detail: string;
  size: string;
  action?: { type: string; target: string; danger: string };
}

interface LedgerEntry {
  id: string;
  at: string;
  action: string;
  kind: 'files' | 'dns' | 'data' | 'config';
  what: string;
  target?: string;
  hint?: string;
}

const CATEGORY_ICON: Record<string, React.ReactNode> = {
  'Orphaned project files': <FolderX size={16} />,
  'Orphaned app files': <FolderX size={16} />,
  'Orphaned deploy repos': <GitBranch size={16} />,
  'Stale port registrations': <Plug2 size={16} />,
  'Old backups': <Archive size={16} />,
  'Logs & caches': <ScrollText size={16} />,
  'Script backups': <FileClock size={16} />,
};

const KIND_STYLE: Record<string, { icon: React.ReactNode; label: string; cls: string }> = {
  files: {
    icon: <FolderX size={12} />,
    label: 'files kept',
    cls: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  },
  dns: {
    icon: <Cloud size={12} />,
    label: 'dns record',
    cls: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800',
  },
  data: {
    icon: <Database size={12} />,
    label: 'data kept',
    cls: 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800',
  },
  config: {
    icon: <FileClock size={12} />,
    label: 'config',
    cls: 'bg-gray-50 dark:bg-gray-800/60 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700',
  },
};

// "1.2M" / "412K" / "2.0G" → bytes, for the reclaimable-space total.
function toBytes(size: string): number {
  const m = size.match(/^([\d.]+)([KMGT])?/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = (m[2] ?? '').toUpperCase();
  const mult: Record<string, number> = { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };
  return n * (mult[unit] ?? 1);
}

function humanBytes(n: number): string {
  if (n <= 0) return '0';
  const units = ['B', 'K', 'M', 'G', 'T'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)}${units[i]}`;
}

export default function ResiduePage() {
  const [items, setItems] = useState<ResidueItem[] | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [confirming, setConfirming] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/residue');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setItems(data.items);
      setLedger(data.ledger ?? []);
      setError('');
    } catch (e) {
      setError((e as Error).message);
      setItems([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function clean(item: ResidueItem) {
    if (!item.action) return;
    setBusy(item.id);
    setConfirming('');
    setNote('');
    try {
      const res = await fetch('/api/residue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.action),
      });
      const data = await res.json().catch(() => ({}));
      setNote(res.ok ? `Cleaned: ${item.label}` : (data.error ?? `HTTP ${res.status}`));
      await load();
    } finally {
      setBusy('');
    }
  }

  async function dismiss(id: string) {
    setBusy(id);
    try {
      await fetch(`/api/residue?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      await load();
    } finally {
      setBusy('');
    }
  }

  const categories = [...new Set((items ?? []).map((i) => i.category))];
  const reclaimable = (items ?? []).reduce((n, i) => n + toBytes(i.size), 0);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Residue</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2 max-w-2xl" style={{ textWrap: 'pretty' }}>
            Nothing here is broken — these are the things the panel and its CLI deliberately
            leave behind so a removal is never destructive by surprise. Review them and
            decide what to keep.
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={!!busy}>
          <RefreshCw className={`h-4 w-4 mr-2 ${!items ? 'animate-spin' : ''}`} />
          Rescan
        </Button>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {note && <p className="fade-in-up text-sm text-gray-600 dark:text-gray-400">{note}</p>}
      {!items && !error && <TableSkeleton rows={4} cols={3} />}

      {items && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4 max-w-xl">
            <div className="border rounded-lg p-4">
              <div className="text-xs uppercase text-gray-500 dark:text-gray-400 font-semibold">
                Items
              </div>
              <div className="text-2xl font-medium mt-1 tabular-nums">{items.length}</div>
            </div>
            <div className="border rounded-lg p-4">
              <div className="text-xs uppercase text-gray-500 dark:text-gray-400 font-semibold">
                Reclaimable
              </div>
              <div className="text-2xl font-medium mt-1 tabular-nums">
                {humanBytes(reclaimable)}
              </div>
            </div>
            <div className="border rounded-lg p-4">
              <div className="text-xs uppercase text-gray-500 dark:text-gray-400 font-semibold">
                Logged events
              </div>
              <div className="text-2xl font-medium mt-1 tabular-nums">{ledger.length}</div>
            </div>
          </div>

          {/* Ledger — what panel actions knowingly left behind */}
          <div>
            <h2 className="text-xl font-semibold mb-1 flex items-center gap-2">
              <Info size={18} className="text-gray-500 dark:text-gray-400" />
              What recent actions left behind
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              Recorded at the moment each action ran. Dismiss an entry once you&apos;ve
              decided about it.
            </p>
            {ledger.length === 0 ? (
              <p className="border rounded-lg p-6 text-sm text-gray-500 dark:text-gray-400">
                No leftovers recorded yet — removals and detaches will show up here.
              </p>
            ) : (
              <div className="border rounded-lg divide-y dark:divide-gray-800">
                {ledger.map((e) => {
                  const style = KIND_STYLE[e.kind] ?? KIND_STYLE.config;
                  return (
                    <div key={e.id} className="px-4 py-3.5 flex items-start gap-3">
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full border shrink-0 mt-0.5 ${style.cls}`}
                      >
                        {style.icon}
                        {style.label}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-gray-800 dark:text-gray-200">
                          {e.what}
                          {e.target && (
                            <span className="font-mono text-xs text-gray-500 dark:text-gray-400 ml-2">
                              {e.target}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {e.at} · {e.action}
                        </div>
                        {e.hint && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1" style={{ textWrap: 'pretty' }}>
                            {e.hint}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => dismiss(e.id)}
                        aria-label="Dismiss"
                        className="w-9 h-9 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0"
                      >
                        {busy === e.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <X size={14} />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Live scan findings */}
          <div>
            <h2 className="text-xl font-semibold mb-1">Found on the device</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              A live scan of the phone, independent of what the panel did.
            </p>

            {items.length === 0 ? (
              <p className="border rounded-lg p-6 text-sm text-gray-500 dark:text-gray-400">
                Nothing lingering — no orphaned files, stale ports or oversized caches.
              </p>
            ) : (
              <div className="space-y-5">
                {categories.map((cat) => (
                  <div key={cat}>
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                      {CATEGORY_ICON[cat] ?? <FolderX size={16} />}
                      {cat}
                    </h3>
                    <div className="border rounded-lg divide-y dark:divide-gray-800">
                      {items
                        .filter((i) => i.category === cat)
                        .map((item) => (
                          <div key={item.id} className="px-4 py-3.5 flex items-center gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="font-mono text-sm text-gray-800 dark:text-gray-200 truncate">
                                {item.label}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400" style={{ textWrap: 'pretty' }}>
                                {item.detail}
                              </div>
                              {confirming === item.id && item.action && (
                                <div className="fade-in-up text-xs text-red-600 dark:text-red-400 mt-1.5">
                                  {item.action.danger}
                                </div>
                              )}
                            </div>
                            <span className="text-sm text-gray-500 dark:text-gray-400 tabular-nums shrink-0">
                              {item.size}
                            </span>
                            {item.action && (
                              <div className="shrink-0">
                                {busy === item.id ? (
                                  <Loader2 size={16} className="animate-spin text-gray-400" />
                                ) : confirming === item.id ? (
                                  <div className="flex items-center gap-1">
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      onClick={() => clean(item)}
                                    >
                                      Confirm
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => setConfirming('')}
                                    >
                                      Cancel
                                    </Button>
                                  </div>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setConfirming(item.id)}
                                  >
                                    <Trash2 size={13} className="mr-1.5" /> Clean
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400 max-w-2xl" style={{ textWrap: 'pretty' }}>
            Safety rails: anything still registered in pm2 is never offered for deletion, and
            the server re-checks that immediately before removing files. PocketBase records
            and Cloudflare DNS entries are never deleted from this page — those need a
            deliberate action in their own dashboards.
          </p>
        </>
      )}
    </div>
  );
}
