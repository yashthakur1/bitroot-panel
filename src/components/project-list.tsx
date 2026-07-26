"use client";

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import NewMenu from './new-menu';
import { TableSkeleton } from './skeletons';
import {
  Globe,
  RefreshCw,
  ExternalLink,
  Search,
  MoreHorizontal,
  Check,
  Database,
  Loader2,
  Pause,
  AlertTriangle,
  ScrollText,
  RotateCw,
  Play,
  Square,
} from 'lucide-react';

export interface Project {
  name: string;
  status: string;
  cpu: number;
  memoryMb: number;
  uptimeMs: number;
  restarts: number;
  port: number | null;
  url: string | null;
  system: boolean;
}

export function humanUptime(ms: number): string {
  if (!ms || ms < 1000) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

// Dot-style badge used on detail pages.
export function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'online'
      ? 'bg-green-500 text-green-700 dark:text-green-400'
      : status === 'errored'
        ? 'bg-red-500 text-red-700 dark:text-red-400'
        : 'bg-gray-400 text-gray-600 dark:text-gray-400';
  const [dot, ...text] = color.split(' ');
  return (
    <div className="flex items-center space-x-1.5">
      <span className={`w-2 h-2 rounded-full ${dot}`}></span>
      <span className={`font-medium text-sm ${text.join(' ')}`}>{status}</span>
    </div>
  );
}

// Render-style pill badge for the services table.
function DeployBadge({ status }: { status: string }) {
  if (status === 'online') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border bg-green-50 dark:bg-green-950/50 text-green-700 dark:text-green-400 border-green-200 dark:border-green-900">
        <Check size={12} /> Deployed
      </span>
    );
  }
  if (status === 'errored') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-400 border-red-200 dark:border-red-900">
        <AlertTriangle size={12} /> Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border bg-gray-50 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700">
      <Pause size={12} /> Suspended
    </span>
  );
}

function runtimeOf(p: Project): string {
  if (p.name === 'pocketbase' || p.name === 'cloudflared') return 'Go';
  return 'Node';
}

type Tab = 'active' | 'suspended' | 'all' | 'system';

export default function ProjectList() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('active');
  const [query, setQuery] = useState('');
  const [menuFor, setMenuFor] = useState('');
  const [busyRow, setBusyRow] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setProjects(data.projects);
      setError('');
    } catch (e) {
      setError(`could not load services: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  async function rowAction(name: string, action: string) {
    setBusyRow(name);
    setMenuFor('');
    try {
      await fetch(`/api/projects/${name}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      await load();
    } finally {
      setBusyRow('');
    }
  }

  const apps = projects?.filter((p) => !p.system) ?? [];
  const system = projects?.filter((p) => p.system) ?? [];
  const active = apps.filter((p) => p.status === 'online');
  const suspended = apps.filter((p) => p.status !== 'online');

  const tabs: Array<[Tab, string, number]> = [
    ['active', 'Active', active.length],
    ['suspended', 'Suspended', suspended.length],
    ['all', 'All', apps.length],
    ['system', 'System', system.length],
  ];

  const pool =
    tab === 'active' ? active : tab === 'suspended' ? suspended : tab === 'all' ? apps : system;
  const visible = pool.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
        <div className="flex items-center space-x-3">
          <button
            onClick={load}
            aria-label="Refresh"
            className="w-10 h-10 flex items-center justify-center rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <NewMenu />
        </div>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!projects && !error && <TableSkeleton rows={5} cols={7} />}

      {projects && (
        <>
          {/* Tabs */}
          <div className="inline-flex border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden divide-x divide-gray-200 dark:divide-gray-800">
            {tabs.map(([key, label, count]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-3.5 py-2 text-sm font-medium transition-colors ${
                  tab === key
                    ? 'bg-purple-600 text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60'
                }`}
              >
                {label} <span className="tabular-nums">({count})</span>
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search services"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10 pr-4 py-2.5 border border-gray-200 dark:border-gray-800 bg-transparent rounded-lg w-full text-sm focus:outline-none focus:ring-1 focus:ring-purple-500 transition-shadow"
            />
          </div>

          {/* Table */}
          {visible.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-800 rounded-lg p-8 text-center text-sm">
              {query ? `Nothing matching "${query}"` : 'No services here yet.'}
            </p>
          ) : (
            <div className="overflow-x-auto border border-gray-200 dark:border-gray-800 rounded-lg">
              <table className="min-w-full">
                <thead>
                  <tr className="text-left text-[11px] font-mono uppercase tracking-widest text-gray-500 dark:text-gray-400">
                    <th className="px-4 py-3 whitespace-nowrap font-medium">
                      Service name{' '}
                      <span className="ml-1 border border-gray-300 dark:border-gray-700 rounded px-1 tabular-nums">
                        {visible.length}
                      </span>
                    </th>
                    <th className="px-4 py-3 whitespace-nowrap font-medium">Status</th>
                    <th className="px-4 py-3 whitespace-nowrap font-medium">Runtime</th>
                    <th className="px-4 py-3 whitespace-nowrap font-medium">Port</th>
                    <th className="px-4 py-3 whitespace-nowrap font-medium">Uptime</th>
                    <th className="px-4 py-3 whitespace-nowrap font-medium">URL</th>
                    <th className="px-4 py-3 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => (
                    <tr
                      key={p.name}
                      className="border-t border-gray-100 dark:border-gray-800/80 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
                    >
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <div className="flex items-center space-x-2.5">
                          {p.name === 'pocketbase' ? (
                            <Database size={16} className="text-gray-500 dark:text-gray-400" />
                          ) : (
                            <Globe size={16} className="text-gray-500 dark:text-gray-400" />
                          )}
                          <Link
                            href={
                              p.name === 'pocketbase'
                                ? '/dashboard/pocketbase'
                                : `/dashboard/services/${p.name}`
                            }
                            className="font-medium text-gray-800 dark:text-gray-200 underline-offset-4 hover:underline"
                          >
                            {p.name}
                          </Link>
                          {busyRow === p.name && (
                            <Loader2 size={13} className="animate-spin text-purple-500" />
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <DeployBadge status={p.status} />
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className="bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-300 text-xs font-medium px-2 py-1 rounded">
                          {runtimeOf(p)}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300 tabular-nums">
                        {p.port ?? '—'}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300 tabular-nums">
                        {humanUptime(p.uptimeMs)}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-sm">
                        {p.url ? (
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-purple-600 dark:text-purple-400 hover:underline inline-flex items-center gap-1"
                          >
                            {p.url.replace('https://', '')}
                            <ExternalLink size={11} />
                          </a>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-600">private</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap relative">
                        <button
                          aria-label={`Actions for ${p.name}`}
                          onClick={() => setMenuFor(menuFor === p.name ? '' : p.name)}
                          className="w-9 h-9 flex items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        >
                          <MoreHorizontal size={16} />
                        </button>
                        {menuFor === p.name && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setMenuFor('')} />
                            <div className="bounce-in absolute right-4 top-11 z-50 w-44 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-[0_8px_24px_rgba(0,0,0,0.12)] p-1.5 text-sm">
                              {p.url && (
                                <a
                                  href={p.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                                >
                                  <ExternalLink size={14} /> Open URL
                                </a>
                              )}
                              <Link
                                href={`/dashboard/services/${p.name}?tab=logs`}
                                className="flex items-center gap-2 px-3 py-2 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                              >
                                <ScrollText size={14} /> Logs
                              </Link>
                              <button
                                onClick={() => rowAction(p.name, 'restart')}
                                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                              >
                                <RotateCw size={14} /> Restart
                              </button>
                              {p.status === 'online' ? (
                                <button
                                  onClick={() => rowAction(p.name, 'stop')}
                                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                                >
                                  <Square size={14} /> Stop
                                </button>
                              ) : (
                                <button
                                  onClick={() => rowAction(p.name, 'start')}
                                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                                >
                                  <Play size={14} /> Start
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
