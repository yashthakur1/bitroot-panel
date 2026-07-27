"use client";

import { useCallback, useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Tabs } from './ui/tabs';
import { TableSkeleton } from './skeletons';
import {
  Github,
  Plus,
  Check,
  AlertCircle,
  Loader2,
  Star,
  Trash2,
  ExternalLink,
  KeyRound,
  Lock,
} from 'lucide-react';

interface Connection {
  id: string;
  provider: string;
  label: string;
  login: string;
  avatarUrl?: string;
  profileUrl?: string;
  createdAt: string;
  primary: boolean;
  repos: number;
  privateRepos: number;
  valid: boolean;
}

type Tab = 'connections' | 'add';

export default function GitConnectionsPage({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState<Tab>(initialTab === 'add' ? 'add' : 'connections');
  const [conns, setConns] = useState<Connection[] | null>(null);
  const [staleToken, setStaleToken] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [confirmRemove, setConfirmRemove] = useState('');

  const [token, setToken] = useState('');
  const [label, setLabel] = useState('');
  const [addError, setAddError] = useState('');
  const [added, setAdded] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/git-connections');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setConns(data.connections ?? []);
      setStaleToken(Boolean(data.staleToken));
      setError('');
    } catch (e) {
      setError((e as Error).message);
      setConns([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy('add');
    setAddError('');
    setAdded('');
    try {
      const res = await fetch('/api/git-connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, label }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setToken('');
      setLabel('');
      setAdded(`Connected as ${data.connection.login}`);
      await load();
      setTab('connections');
    } catch (err) {
      setAddError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function makePrimary(id: string) {
    setBusy(id);
    try {
      await fetch('/api/git-connections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      await load();
    } finally {
      setBusy('');
    }
  }

  async function remove(id: string) {
    setBusy(id);
    setConfirmRemove('');
    try {
      await fetch(`/api/git-connections?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      await load();
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-display font-light tracking-tight flex items-center gap-3">
          <Github size={24} className="text-gray-500 dark:text-gray-400" />
          Git connections
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2 max-w-2xl" style={{ textWrap: 'pretty' }}>
          Accounts BitPanel can read repositories from. Tokens are stored only on the phone
          and never sent to your browser.
        </p>
      </div>

      <Tabs
        tabs={[
          { key: 'connections', label: 'Connections', count: conns?.length },
          { key: 'add', label: 'Add connection' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {added && tab === 'connections' && (
        <p className="fade-in-up flex items-center gap-1.5 text-sm text-green-700 dark:text-green-400">
          <Check size={14} className="pop-in" /> {added}
        </p>
      )}

      {tab === 'connections' && (
        <>
          {!conns && <TableSkeleton rows={2} cols={4} />}

          {staleToken && (
            <div className="fade-in-up border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 rounded-xl p-4 flex items-start gap-3 text-sm text-amber-800 dark:text-amber-300">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <div style={{ textWrap: 'pretty' }}>
                <strong>A previously connected GitHub token is no longer accepted.</strong>{' '}
                GitHub rejects it with 401, which normally means the token was regenerated
                or revoked — regenerating mints a brand-new value, so the copy stored here
                stopped working. Add the current token below and deploys will work again.
              </div>
            </div>
          )}

          {conns && conns.length === 0 && !staleToken && (
            <div className="border rounded-lg p-8 text-center">
              <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
                No git accounts connected yet.
              </p>
              <Button variant="outline" size="sm" onClick={() => setTab('add')}>
                <Plus size={14} className="mr-1.5" /> Add a connection
              </Button>
            </div>
          )}

          <div className="space-y-3">
            {(conns ?? []).map((c) => (
              <div key={c.id} className="border rounded-xl p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <Github size={18} className="text-gray-700 dark:text-gray-300 shrink-0" />
                    {c.avatarUrl && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={c.avatarUrl}
                        alt=""
                        width={32}
                        height={32}
                        className="w-8 h-8 rounded-full outline outline-1 outline-black/10 dark:outline-white/10"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2 flex-wrap">
                        {c.label}
                        {c.primary && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 px-1.5 py-0.5 rounded-full">
                            <Star size={9} /> primary
                          </span>
                        )}
                        {c.valid ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase text-green-700 dark:text-green-400">
                            <Check size={10} /> valid
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase text-red-600 dark:text-red-400">
                            <AlertCircle size={10} /> token rejected
                          </span>
                        )}
                      </div>
                      <a
                        href={c.profileUrl ?? `https://github.com/${c.login}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-gray-500 dark:text-gray-400 hover:underline inline-flex items-center gap-1"
                      >
                        {c.login} <ExternalLink size={10} />
                      </a>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {busy === c.id ? (
                      <Loader2 size={16} className="animate-spin text-gray-400" />
                    ) : (
                      <>
                        {!c.primary && (
                          <Button variant="outline" size="sm" onClick={() => makePrimary(c.id)}>
                            Make primary
                          </Button>
                        )}
                        {confirmRemove === c.id ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-red-300 dark:border-red-800 text-red-600 dark:text-red-400"
                            onClick={() => remove(c.id)}
                          >
                            Really disconnect?
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-gray-500 hover:text-red-600 dark:hover:text-red-400"
                            onClick={() => setConfirmRemove(c.id)}
                          >
                            <Trash2 size={14} />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* What this connection can actually reach */}
                <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div>
                    <div className="text-[11px] uppercase text-gray-500 dark:text-gray-400 font-semibold">
                      Repositories
                    </div>
                    <div className="tabular-nums mt-0.5">{c.repos}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase text-gray-500 dark:text-gray-400 font-semibold">
                      Private
                    </div>
                    <div className="tabular-nums mt-0.5 flex items-center gap-1.5">
                      {c.privateRepos}
                      {c.valid && c.privateRepos === 0 && (
                        <span className="text-[10px] text-amber-700 dark:text-amber-300">
                          public-only token
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase text-gray-500 dark:text-gray-400 font-semibold">
                      Connected
                    </div>
                    <div className="mt-0.5 text-gray-600 dark:text-gray-400">{c.createdAt}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase text-gray-500 dark:text-gray-400 font-semibold">
                      Used for
                    </div>
                    <div className="mt-0.5 text-gray-600 dark:text-gray-400">
                      {c.primary ? 'clones & pulls' : 'browsing only'}
                    </div>
                  </div>
                </div>

                {c.valid && c.privateRepos === 0 && (
                  <p className="mt-3 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-1.5" style={{ textWrap: 'pretty' }}>
                    <Lock size={12} className="shrink-0 mt-0.5" />
                    This token sees no private repositories. If a deploy fails with
                    &quot;repository not found&quot;, set the token&apos;s Repository access to
                    <strong> All repositories</strong> and grant <strong>Contents: Read-only</strong>.
                  </p>
                )}
              </div>
            ))}
          </div>

          {conns && conns.length > 1 && (
            <p className="text-xs text-gray-500 dark:text-gray-400" style={{ textWrap: 'pretty' }}>
              Git matches stored credentials by host, so clones and pulls use the primary
              connection. Other connections still let you browse and pick repositories.
            </p>
          )}
        </>
      )}

      {tab === 'add' && (
        <form onSubmit={add} className="border rounded-xl p-5 space-y-4 max-w-xl">
          <div className="flex items-center gap-2 font-medium text-gray-900 dark:text-gray-100">
            <Github size={16} /> Connect a GitHub account
          </div>
          <ol className="text-sm text-gray-600 dark:text-gray-400 space-y-1.5 list-decimal list-inside" style={{ textWrap: 'pretty' }}>
            <li>
              Open{' '}
              <a
                href="https://github.com/settings/personal-access-tokens/new"
                target="_blank"
                rel="noreferrer"
                className="text-purple-600 dark:text-purple-400 hover:underline"
              >
                fine-grained token settings
              </a>
              .
            </li>
            <li>
              Set <strong>Repository access → All repositories</strong> (or select the repos
              you deploy).
            </li>
            <li>
              Under <strong>Repository permissions</strong>, grant{' '}
              <strong>Contents: Read-only</strong> — git needs this to clone and pull.
            </li>
            <li>Generate, copy, and paste it below.</li>
          </ol>

          <div className="flex flex-col">
            <Label htmlFor="gc-label">Label (optional)</Label>
            <Input
              id="gc-label"
              placeholder="Work account"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          <div className="flex flex-col">
            <Label htmlFor="gc-token">Personal access token</Label>
            <Input
              id="gc-token"
              type="password"
              placeholder="github_pat_… or ghp_…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="font-mono text-sm"
              required
            />
          </div>

          {addError && (
            <p className="fade-in-up flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
              <AlertCircle size={13} /> {addError}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy === 'add' || !token}>
              {busy === 'add' ? (
                <>
                  <Loader2 size={14} className="animate-spin mr-1.5" /> Verifying…
                </>
              ) : (
                <>
                  <Plus size={14} className="mr-1.5" /> Connect
                </>
              )}
            </Button>
            <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
              <KeyRound size={12} /> verified against GitHub before it is stored
            </span>
          </div>
        </form>
      )}
    </div>
  );
}
