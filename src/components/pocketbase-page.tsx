"use client";

// Facts come from /api/facts at runtime, not from NEXT_PUBLIC_* baked into this
// bundle at build time. The old constants read NEXT_PUBLIC_TAILNET_IP while .env
// wrote NEXT_PUBLIC_TAILNET_HOST — the names never matched, so this page fell
// back to 127.0.0.1 and told the operator their database was on localhost.
// A value the server can measure should not be a build-time guess.
import type { Facts } from '@/lib/facts';

import { useCallback, useEffect, useState } from 'react';
import { useLivePoll } from '@/lib/use-poll';
import {
  Database,
  ExternalLink,
  RotateCw,
  Check,
  AlertTriangle,
  Archive,
  Plug,
  KeyRound,
  Loader2,
  UserPlus,
  Download,
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { StatCardsSkeleton } from './skeletons';
import { humanUptime } from './project-list';
import PocketBaseDatabases from './pocketbase-databases';

interface PbState {
  healthy: boolean;
  version: string;
  port: number;
  status: string;
  uptimeMs: number;
  memoryMb: number;
  restarts: number;
  cpu: number;
  dbSize: string;
  collections: number;
  records: number;
  requests24h: number | null;
  errors24h: number | null;
  internalUrl: string;
  publicUrl: string;
}

// Where "Open admin" should point, given what this machine actually has.
// Public first, then the tailnet, then loopback — which only helps somebody
// already on the box, so it is last and honest about that.
//
// This was two constants: an ADMIN_URL built from a suffix that might not be
// routed, and `TS_FQDN = 'localhost'` hardcoded under a comment explaining why
// a full MagicDNS name matters. The comment was right; the value was not.
function adminUrl(facts: Facts | null): string {
  const host = facts?.domainSuffix && `pocketbase.${facts.domainSuffix}`;
  if (host && facts?.routedHosts.includes(host)) return `https://${host}/_/`;
  if (facts?.tailnetHost) return `http://${facts.tailnetHost}:8090/_/`;
  return 'http://127.0.0.1:8090/_/';
}

type Tab = 'overview' | 'databases' | 'backups' | 'access';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'databases', label: 'Databases' },
  { key: 'backups', label: 'Backups' },
  { key: 'access', label: 'Access' },
];

export default function PocketBasePage({ initialTab }: { initialTab?: string }) {
  const [facts, setFacts] = useState<Facts | null>(null);
  useEffect(() => {
    fetch('/api/facts', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setFacts)
      .catch(() => setFacts(null));
  }, []);

  const [tab, setTab] = useState<Tab>(
    TABS.some((t) => t.key === initialTab) ? (initialTab as Tab) : 'overview',
  );
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
  }, [load]);
  useLivePoll(load, { activeMs: 10000 });

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
          <h1 className="text-3xl font-display font-light tracking-tight flex items-center gap-3">
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
          <a href={adminUrl(facts)} target="_blank" rel="noreferrer">
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

      {/* Tabs */}
      <div className="border-b dark:border-gray-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`py-2 px-3 text-sm font-medium -mb-px transition-colors ${
              tab === t.key
                ? 'text-accent-600 dark:text-accent-400 border-b-2 border-accent-600 dark:border-accent-400'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
        {!state && !error && <StatCardsSkeleton count={8} />}

        {state && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            {(
              [
                ['Version', state.version],
                ['Uptime', humanUptime(state.uptimeMs)],
                ['Memory', state.memoryMb ? `${state.memoryMb} MB` : '—'],
                ['CPU', `${state.cpu}%`],
                ['DB size', state.dbSize],
                ['Collections', String(state.collections)],
                ['Records', state.records.toLocaleString()],
                [
                  'Requests 24h',
                  state.requests24h === null
                    ? '—'
                    : `${state.requests24h.toLocaleString()}${
                        state.errors24h ? ` · ${state.errors24h} err` : ''
                      }`,
                ],
              ] as Array<[string, string]>
            ).map(([label, value]) => (
              <div key={label} className="border rounded-lg p-3.5">
                <div className="text-[11px] uppercase text-gray-500 dark:text-gray-400 font-semibold">
                  {label}
                </div>
                <div className="text-base font-medium mt-1 tabular-nums truncate" title={value}>
                  {value}
                </div>
              </div>
            ))}
          </div>
        )}

        <div>
          <h2 className="text-xl font-display font-medium mb-3 flex items-center gap-2">
            <Plug size={18} className="text-gray-500 dark:text-gray-400" />
            Endpoints
          </h2>
          <div className="border rounded-lg divide-y dark:divide-gray-800 text-sm">
            <div className="px-4 py-3 flex justify-between items-start flex-wrap gap-2">
              <div>
                <div className="text-gray-700 dark:text-gray-300">Internal</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  For apps running on the server — not reachable from your browser
                </div>
              </div>
              <span className="font-mono text-gray-800 dark:text-gray-200">
                {state?.internalUrl ?? 'http://127.0.0.1:8090'}
              </span>
            </div>
            <div className="px-4 py-3 flex justify-between items-start flex-wrap gap-2">
              <div>
                <div className="text-gray-700 dark:text-gray-300">Public</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  HTTPS through the Cloudflare tunnel, reachable anywhere
                </div>
              </div>
              {(() => {
                // Only if a route exists for it. This used to print
                // pocketbase.<suffix> unconditionally, so the link was dead
                // until somebody happened to publish that exact hostname.
                const host =
                  facts?.domainSuffix && `pocketbase.${facts.domainSuffix}`;
                const routed = host && facts?.routedHosts.includes(host);
                if (!routed) {
                  return (
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      Not published — publish it from Routes
                    </span>
                  );
                }
                return (
                  <a
                    href={`https://${host}/_/`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-accent-600 dark:text-accent-400 hover:underline"
                  >
                    {host}
                  </a>
                );
              })()}
            </div>
            <div className="px-4 py-3 flex justify-between items-start flex-wrap gap-2">
              <div>
                <div className="text-gray-700 dark:text-gray-300">Private (Tailscale)</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Any device on your tailnet — HTTP, but carried inside WireGuard
                </div>
              </div>
              {facts?.tailnetHost ? (
                <a
                  href={`http://${facts.tailnetHost}:8090/_/`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-accent-600 dark:text-accent-400 hover:underline"
                >
                  {facts.tailnetHost}:8090
                </a>
              ) : (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Tailscale is not on this machine
                </span>
              )}
            </div>
          </div>
        </div>
        </>
      )}

      {tab === 'databases' && <PocketBaseDatabases />}
      {tab === 'backups' && <BackupsSection />}
      {tab === 'access' && <AccessSection />}
    </div>
  );
}

function AccessSection() {
  return (
    <div className="space-y-8">
      <SuperuserSection />

      <div>
        <h2 className="text-xl font-display font-medium mb-3 flex items-center gap-2">
          <KeyRound size={18} className="text-gray-500 dark:text-gray-400" />
          How the panel authenticates
        </h2>
        <div className="border rounded-lg p-5 text-sm text-gray-600 dark:text-gray-400 space-y-2">
          <p style={{ textWrap: 'pretty' }}>
            BitPanel uses its own superuser, <code>panel@bitpanel.local</code>, kept separate
            from the accounts you sign in with. Change your own password whenever you like —
            the panel is unaffected.
          </p>
          <p style={{ textWrap: 'pretty' }}>
            Its credential lives on the server at{' '}
            <code>~/apps/pocketbase/.superuser</code> (mode 600) and never reaches the
            browser. If it ever stops working — say the data directory is restored from a
            backup — the panel resets that one account through the local CLI and carries on.
          </p>
        </div>
      </div>
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
        <h2 className="text-xl font-display font-medium flex items-center gap-2">
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
                  <td className="px-4 py-2.5 text-right">
                    <a
                      href={`/api/pocketbase/backups/download?name=${encodeURIComponent(b.name)}`}
                      download
                      className="inline-flex items-center gap-1.5 text-xs text-accent-600 dark:text-accent-400 hover:underline"
                    >
                      <Download size={13} /> Download
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
        {note && <span className="fade-in-up mr-2">{note}</span>}
        Nightly cron keeps a rolling 7-day window; manual snapshots are timestamped.
        Downloading gives you a point-in-time copy — untar it and open{' '}
        <code>pb_data/data.db</code> in any SQLite client. Edits to that copy stay local;
        they are never written back to the server.
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
      <h2 className="text-xl font-display font-medium mb-3 flex items-center gap-2">
        <UserPlus size={18} className="text-gray-500 dark:text-gray-400" />
        Superusers
      </h2>
      <form onSubmit={submit} className="border rounded-lg p-5 space-y-3 max-w-lg">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Add a new admin or reset an existing one&apos;s password (runs{' '}
          <code>pocketbase superuser upsert</code> on the server).
        </p>
        <div className="flex gap-2 flex-wrap">
          <div className="flex flex-col flex-1 min-w-48">
            <Label htmlFor="su-email">Email</Label>
            <Input
              id="su-email"
              type="email"
              placeholder="teammate@example.com"
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
