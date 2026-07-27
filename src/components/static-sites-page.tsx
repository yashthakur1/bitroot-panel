"use client";

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from './ui/button';
import { Tabs } from './ui/tabs';
import { TableSkeleton, StatCardsSkeleton } from './skeletons';
import { useLivePoll } from '@/lib/use-poll';
import { humanUptime, StatusBadge } from './project-list';
import {
  PanelsTopLeft,
  Plus,
  ExternalLink,
  RefreshCw,
  Server,
  Check,
  Pause,
} from 'lucide-react';

interface Site {
  name: string;
  port: number;
  size: string;
  served: boolean;
  branch: string;
  url: string | null;
  urls?: string[];
}

interface NginxState {
  status: string;
  uptimeMs: number;
  memoryMb: number;
  restarts: number;
}

type Tab = 'sites' | 'serving';

export default function StaticSitesPage({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState<Tab>(initialTab === 'serving' ? 'serving' : 'sites');
  const [sites, setSites] = useState<Site[] | null>(null);
  const [nginx, setNginx] = useState<NginxState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    const [s, p] = await Promise.all([
      fetch('/api/static').then((r) => r.json()).catch(() => ({})),
      fetch('/api/projects').then((r) => r.json()).catch(() => ({})),
    ]);
    setSites(s.sites ?? []);
    const n = (p.projects ?? []).find((x: { name: string }) => x.name === 'nginx');
    setNginx(
      n
        ? { status: n.status, uptimeMs: n.uptimeMs, memoryMb: n.memoryMb, restarts: n.restarts }
        : null,
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useLivePoll(load, { activeMs: 10000 });

  async function restartNginx() {
    setBusy(true);
    setNote('Restarting nginx…');
    try {
      const res = await fetch('/api/projects/nginx/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restart' }),
      });
      setNote(res.ok ? 'nginx restarted.' : 'restart failed');
      load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-display font-light tracking-tight flex items-center gap-3">
            <PanelsTopLeft size={24} className="text-gray-500 dark:text-gray-400" />
            Static sites
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2" style={{ textWrap: 'pretty' }}>
            Built once and served by a single nginx — no Node process per site, so they cost
            almost nothing to keep online.
          </p>
        </div>
        <Link href="/dashboard/new-static">
          <Button className="flex items-center gap-2">
            <Plus size={15} /> New static site
          </Button>
        </Link>
      </div>

      <Tabs
        tabs={[
          { key: 'sites', label: 'Sites', count: sites?.length },
          { key: 'serving', label: 'Serving' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'sites' && (
        <>
          {!sites && <TableSkeleton rows={3} cols={5} />}
          {sites && sites.length === 0 && (
            <div className="border rounded-lg p-8 text-center">
              <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
                No static sites yet.
              </p>
              <Link href="/dashboard/new-static">
                <Button variant="outline" size="sm">
                  Create your first one
                </Button>
              </Link>
            </div>
          )}
          {sites && sites.length > 0 && (
            <div className="overflow-x-auto border rounded-lg">
              <table className="min-w-full">
                <thead>
                  <tr className="text-left text-[11px] font-mono uppercase tracking-widest text-gray-500 dark:text-gray-400">
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Port</th>
                    <th className="px-4 py-3 font-medium">Build size</th>
                    <th className="px-4 py-3 font-medium">Branch</th>
                    <th className="px-4 py-3 font-medium">URL</th>
                  </tr>
                </thead>
                <tbody>
                  {sites.map((s) => (
                    <tr
                      key={s.name}
                      className="border-t border-gray-100 dark:border-gray-800/80 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
                    >
                      <td className="px-4 py-3.5">
                        <Link
                          href={`/dashboard/static/${s.name}`}
                          className="font-medium text-gray-800 dark:text-gray-200 underline-offset-4 hover:underline"
                        >
                          {s.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3.5">
                        {s.served ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border bg-green-50 dark:bg-green-950/50 text-green-700 dark:text-green-400 border-green-200 dark:border-green-900">
                            <Check size={12} /> Served
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border bg-gray-50 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700">
                            <Pause size={12} /> Not served
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-sm tabular-nums text-gray-700 dark:text-gray-300">
                        {s.port}
                      </td>
                      <td className="px-4 py-3.5 text-sm tabular-nums text-gray-700 dark:text-gray-300">
                        {s.size}
                      </td>
                      <td className="px-4 py-3.5 text-sm text-gray-700 dark:text-gray-300">
                        {s.branch || 'default'}
                      </td>
                      <td className="px-4 py-3.5 text-sm">
                        {s.url ? (
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent-600 dark:text-accent-400 hover:underline inline-flex items-center gap-1"
                          >
                            {s.url.replace('https://', '')}
                            <ExternalLink size={11} />
                          </a>
                        ) : (
                          <Link
                            href="/dashboard/tunnel?tab=publish"
                            className="text-gray-400 dark:text-gray-600 hover:text-accent-600 dark:hover:text-accent-400 transition-colors"
                            title="Private — click to publish a public hostname"
                          >
                            private
                          </Link>
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

      {tab === 'serving' && (
        <div className="space-y-6">
          {!nginx && <StatCardsSkeleton count={4} />}
          {nginx && (
            <>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-xl font-display font-medium flex items-center gap-2">
                  <Server size={18} className="text-gray-500 dark:text-gray-400" />
                  nginx
                </h2>
                <Button variant="outline" size="sm" disabled={busy} onClick={restartNginx}>
                  <RefreshCw size={13} className={`mr-1.5 ${busy ? 'animate-spin' : ''}`} />
                  Restart
                </Button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="border rounded-lg p-4">
                  <div className="text-xs uppercase text-gray-500 dark:text-gray-400 font-semibold">
                    Status
                  </div>
                  <div className="mt-1">
                    <StatusBadge status={nginx.status} />
                  </div>
                </div>
                {(
                  [
                    ['Uptime', humanUptime(nginx.uptimeMs)],
                    ['Memory', nginx.memoryMb ? `${nginx.memoryMb} MB` : '—'],
                    ['Restarts', String(nginx.restarts)],
                  ] as Array<[string, string]>
                ).map(([label, value]) => (
                  <div key={label} className="border rounded-lg p-4">
                    <div className="text-xs uppercase text-gray-500 dark:text-gray-400 font-semibold">
                      {label}
                    </div>
                    <div className="text-lg font-medium mt-1 tabular-nums">{value}</div>
                  </div>
                ))}
              </div>
              {note && <p className="text-sm text-gray-500 dark:text-gray-400">{note}</p>}
              <div className="border rounded-lg divide-y dark:divide-gray-800 text-sm">
                <div className="px-4 py-3 flex justify-between flex-wrap gap-2">
                  <span className="text-gray-700 dark:text-gray-300">Site configs</span>
                  <span className="font-mono text-gray-800 dark:text-gray-200">
                    ~/etc/nginx/sites/
                  </span>
                </div>
                <div className="px-4 py-3 flex justify-between flex-wrap gap-2">
                  <span className="text-gray-700 dark:text-gray-300">Published files</span>
                  <span className="font-mono text-gray-800 dark:text-gray-200">
                    ~/apps/static/&lt;name&gt;/public
                  </span>
                </div>
                <div className="px-4 py-3 flex justify-between flex-wrap gap-2">
                  <span className="text-gray-700 dark:text-gray-300">Access logs</span>
                  <span className="font-mono text-gray-800 dark:text-gray-200">
                    ~/var/log/nginx/
                  </span>
                </div>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400" style={{ textWrap: 'pretty' }}>
                Each site listens on its own port so it works over Tailscale as well as
                through a public route. Restarting nginx affects every static site at once —
                individual sites reload automatically when you rebuild them.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
