"use client";

import { useCallback, useEffect, useState } from 'react';
import {
  Database,
  ExternalLink,
  RotateCw,
  Check,
  AlertTriangle,
  Archive,
  Plug,
} from 'lucide-react';
import { Button } from './ui/button';
import { StatCardsSkeleton } from './skeletons';
import { humanUptime } from './project-list';

interface PbState {
  healthy: boolean;
  version: string;
  port: number;
  status: string;
  uptimeMs: number;
  memoryMb: number;
  restarts: number;
}

const ADMIN_URL = 'http://100.127.137.83:8090/_/';

export default function PocketBasePage() {
  const [state, setState] = useState<PbState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/pocketbase');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState(await res.json());
      setError('');
    } catch (e) {
      setError(`could not load PocketBase state: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  async function restart() {
    setBusy(true);
    setNote('Restarting…');
    try {
      const res = await fetch('/api/projects/pocketbase/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restart' }),
      });
      setNote(res.ok ? 'Restarted.' : 'restart failed');
      load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Database size={26} className="text-gray-500 dark:text-gray-400" />
            PocketBase
            {state && (
              <span
                className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border align-middle ${
                  state.healthy
                    ? 'bg-green-50 dark:bg-green-950/50 text-green-700 dark:text-green-400 border-green-200 dark:border-green-900'
                    : 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-400 border-red-200 dark:border-red-900'
                }`}
              >
                {state.healthy ? <Check size={12} /> : <AlertTriangle size={12} />}
                {state.healthy ? 'healthy' : 'unhealthy'}
              </span>
            )}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">
            The shared SQLite database for all your small projects — REST + realtime API,
            auth, and file storage in one process.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href={ADMIN_URL} target="_blank" rel="noreferrer">
            <Button className="flex items-center gap-2">
              Open admin <ExternalLink size={13} />
            </Button>
          </a>
          <Button variant="outline" onClick={restart} disabled={busy}>
            <RotateCw size={14} className={`mr-1.5 ${busy ? 'animate-spin' : ''}`} />
            Restart
          </Button>
        </div>
      </div>

      {note && <p className="text-sm text-gray-500 dark:text-gray-400">{note}</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!state && !error && <StatCardsSkeleton count={5} />}

      {state && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {(
            [
              ['Version', state.version],
              ['Status', state.status],
              ['Port', String(state.port)],
              ['Memory', state.memoryMb ? `${state.memoryMb} MB` : '—'],
              ['Uptime', humanUptime(state.uptimeMs)],
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
      )}

      <div>
        <h2 className="text-xl font-semibold mb-3 flex items-center gap-2">
          <Plug size={18} className="text-gray-500 dark:text-gray-400" />
          Connect from your apps
        </h2>
        <div className="border rounded-lg p-5 space-y-3 text-sm">
          <p className="text-gray-600 dark:text-gray-400">
            Apps running on the phone reach it locally — no tunnel, no auth hop:
          </p>
          <pre className="bg-black text-gray-100 font-mono text-xs rounded-md p-4 overflow-auto">
{`import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');
const posts = await pb.collection('my_app_posts').getList(1, 20);`}
          </pre>
          <p className="text-gray-500 dark:text-gray-400 text-xs">
            Tip: prefix collections per app (<code>blog_posts</code>, <code>todo_items</code>)
            to keep one instance tidy across projects. The admin dashboard is reachable over
            Tailscale only.
          </p>
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-3 flex items-center gap-2">
          <Archive size={18} className="text-gray-500 dark:text-gray-400" />
          Backups
        </h2>
        <div className="border rounded-lg p-5 text-sm text-gray-600 dark:text-gray-400">
          Nightly at 3:30 AM a cron job archives <code>pb_data</code> to{' '}
          <code>~/backups/pocketbase-&lt;weekday&gt;.tar.gz</code> — a rolling 7-day window on
          the phone. Restore = stop, untar, start.
        </div>
      </div>
    </div>
  );
}
