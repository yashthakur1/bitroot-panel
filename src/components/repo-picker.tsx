"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, Lock, Globe, Check, Github } from 'lucide-react';
import { Shimmer } from './skeletons';

export interface PickerRepo {
  fullName: string;
  private: boolean;
  defaultBranch: string;
  pushedAt?: string;
  description?: string;
  connectionId?: string;
  connectionLabel?: string;
}

function relativeTime(iso?: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const day = 86_400_000;
  if (diff < day) return 'today';
  if (diff < 30 * day) return `${Math.round(diff / day)}d ago`;
  if (diff < 365 * day) return `${Math.round(diff / (30 * day))}mo ago`;
  return `${Math.round(diff / (365 * day))}y ago`;
}

// Searchable repository picker: a native select is unusable once an account
// has a hundred repos, and it cannot show ownership or visibility either.
export default function RepoPicker({
  repos,
  value,
  onSelect,
  error,
}: {
  repos: PickerRepo[] | null;
  value: string;
  onSelect: (fullName: string) => void;
  error?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Group by owner so personal and organisation repositories are distinct.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = (repos ?? []).filter(
      (r) =>
        !q ||
        r.fullName.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q),
    );
    const byOwner = new Map<string, PickerRepo[]>();
    for (const r of matched) {
      const owner = r.fullName.split('/')[0];
      if (!byOwner.has(owner)) byOwner.set(owner, []);
      byOwner.get(owner)!.push(r);
    }
    return [...byOwner.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [repos, query]);

  const flat = useMemo(() => groups.flatMap(([, list]) => list), [groups]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 20);
    else setQuery('');
  }, [open]);

  // keep the highlighted row in view while arrowing through a long list
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${highlight}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  function choose(repo: PickerRepo) {
    onSelect(repo.fullName);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flat[highlight]) choose(flat[highlight]);
    }
  }

  const selected = (repos ?? []).find((r) => r.fullName === value);
  const multipleAccounts = new Set((repos ?? []).map((r) => r.connectionId)).size > 1;

  if (!repos) return <Shimmer className="h-10 w-full" />;

  let running = -1;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between gap-2 border rounded-md px-3 h-10 text-sm bg-white dark:bg-gray-900 transition-colors ${
          error
            ? 'border-red-400 dark:border-red-700'
            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
        }`}
      >
        <span className="flex items-center gap-2 min-w-0">
          {selected ? (
            <>
              {selected.private ? (
                <Lock size={13} className="text-gray-400 shrink-0" />
              ) : (
                <Globe size={13} className="text-gray-400 shrink-0" />
              )}
              <span className="truncate text-gray-800 dark:text-gray-200">
                {selected.fullName}
              </span>
            </>
          ) : (
            <span className="text-gray-400 dark:text-gray-500">Select a repository</span>
          )}
        </span>
        <ChevronDown
          size={15}
          className={`text-gray-400 shrink-0 transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="bounce-in absolute left-0 right-0 top-full mt-2 z-50 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-[0_8px_24px_rgba(0,0,0,0.12),0_2px_6px_rgba(0,0,0,0.06)] overflow-hidden"
            onKeyDown={onKeyDown}
          >
            <div className="flex items-center gap-2 px-3 border-b border-gray-100 dark:border-gray-800">
              <Search size={15} className="text-gray-400 shrink-0" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search repositories…"
                className="flex-1 h-11 bg-transparent text-sm outline-none text-gray-800 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-500"
              />
              <span className="text-xs tabular-nums text-gray-400 shrink-0">
                {flat.length}
              </span>
            </div>

            <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
              {flat.length === 0 && (
                <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400 text-center">
                  Nothing matching &quot;{query}&quot;
                </p>
              )}

              {groups.map(([owner, list]) => (
                <div key={owner}>
                  <div className="sticky top-0 flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 dark:bg-gray-800/80 backdrop-blur text-[10px] font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                    <Github size={11} />
                    {owner}
                    <span className="ml-auto tabular-nums font-normal normal-case tracking-normal">
                      {list.length}
                    </span>
                  </div>
                  {list.map((r) => {
                    running += 1;
                    const idx = running;
                    const isSelected = r.fullName === value;
                    return (
                      <button
                        key={r.fullName}
                        type="button"
                        data-idx={idx}
                        onMouseEnter={() => setHighlight(idx)}
                        onClick={() => choose(r)}
                        className={`w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors ${
                          highlight === idx ? 'bg-gray-100 dark:bg-gray-800' : ''
                        }`}
                      >
                        {r.private ? (
                          <Lock size={13} className="text-gray-400 shrink-0" />
                        ) : (
                          <Globe size={13} className="text-gray-400 shrink-0" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-gray-800 dark:text-gray-200 truncate">
                            {r.fullName.split('/')[1]}
                          </span>
                          {r.description && (
                            <span className="block text-xs text-gray-500 dark:text-gray-400 truncate">
                              {r.description}
                            </span>
                          )}
                        </span>
                        {multipleAccounts && r.connectionLabel && (
                          <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0">
                            {r.connectionLabel.replace('GitHub · ', '')}
                          </span>
                        )}
                        <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0 tabular-nums">
                          {relativeTime(r.pushedAt)}
                        </span>
                        {isSelected && (
                          <Check size={14} className="text-purple-600 dark:text-purple-400 shrink-0 pop-in" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="border-t border-gray-100 dark:border-gray-800 px-3 py-2 text-[11px] text-gray-400 dark:text-gray-500 flex items-center gap-3">
              <span>↑↓ navigate</span>
              <span>↵ select</span>
              <span>esc close</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
