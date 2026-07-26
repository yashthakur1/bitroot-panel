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
  Loader2,
  UserPlus,
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
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

const ADMIN_URL = 'https://pocketbase.bitroot.in/_/';

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

      <BackupsSection />
      <SuperuserSection />
    </div>
  );
}

function BackupsSection() {
  const [backups, setBackups] = useState<Array<{ name: string; size: string; modified: string }>>(
    [],
  );
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/pocketbase/backups');
    const data = await res.json().catch(() => ({}));
    if (res.ok) setBackups(data.backups ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function backupNow() {
    setBusy(true);
    setNote('Creating snapshot…');
    try {
      const res = await fetch('/api/pocketbase/backups', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setBackups(data.backups ?? []);
        setNote('Snapshot created.');
      } else {
        setNote(data.error ?? 'backup failed');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Archive size={18} className="text-gray-500 dark:text-gray-400" />
          Backups
        </h2>
        <Button variant="outline" size="sm" disabled={busy} onClick={backupNow}>
          {busy ? (
            <>
              <Loader2 size={13} className="animate-spin mr-1.5" /> Backing up…
            </>
          ) : (
            'Back up now'
          )}
        </Button>
      </div>
      <div className="border rounded-lg overflow-hidden">
        {backups.length === 0 ? (
          <p className="p-5 text-sm text-gray-500 dark:text-gray-400">
            No backups yet — the nightly cron runs at 3:30 AM.
          </p>
        ) : (
          <table className="min-w-full text-sm">
            <tbody>
              {backups.map((b) => (
                <tr key={b.name} className="border-t first:border-t-0 dark:border-gray-800">
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-700 dark:text-gray-300">
                    {b.name}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 tabular-nums">
                    {b.size}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 tabular-nums">
                    {b.modified}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
        {note && <span className="fade-in-up mr-2">{note}</span>}
        Nightly cron keeps a rolling 7-day window; manual snapshots are timestamped. For
        guaranteed-consistent archives use the admin UI&apos;s Settings → Backups.
      </p>
    </div>
  );
}

function SuperuserSection() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch('/api/pocketbase/superuser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      setNote(
        res.ok
          ? { ok: true, text: `Superuser "${email}" saved.` }
          : { ok: false, text: data.error ?? data.output ?? `HTTP ${res.status}` },
      );
      if (res.ok) {
        setEmail('');
        setPassword('');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-3 flex items-center gap-2">
        <UserPlus size={18} className="text-gray-500 dark:text-gray-400" />
        Superusers
      </h2>
      <form onSubmit={submit} className="border rounded-lg p-5 space-y-3 max-w-lg">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Add a new admin or reset an existing one&apos;s password (runs{' '}
          <code>pocketbase superuser upsert</code> on the phone).
        </p>
        <div className="flex gap-2 flex-wrap">
          <div className="flex flex-col flex-1 min-w-48">
            <Label htmlFor="su-email">Email</Label>
            <Input
              id="su-email"
              type="email"
              placeholder="teammate@bitroot.org"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col flex-1 min-w-48">
            <Label htmlFor="su-pass">Password</Label>
            <Input
              id="su-pass"
              type="password"
              placeholder="min 10 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={10}
              required
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy || !email || password.length < 10}>
            {busy ? (
              <>
                <Loader2 size={13} className="animate-spin mr-1.5" /> Saving…
              </>
            ) : (
              'Save superuser'
            )}
          </Button>
          {note && (
            <span
              className={`fade-in-up text-sm ${
                note.ok
                  ? 'text-green-700 dark:text-green-400'
                  : 'text-red-600 dark:text-red-400'
              }`}
            >
              {note.text}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
