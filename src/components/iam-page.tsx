"use client";

import { useCallback, useEffect, useState } from 'react';
import {
  ShieldCheck,
  Mail,
  Lock,
  Plus,
  Trash2,
  Loader2,
  Crown,
  AlertCircle,
  Check,
  Info,
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Tabs } from './ui/tabs';
import { StatCardsSkeleton, TableSkeleton } from './skeletons';

interface AppRef {
  id: string;
  name: string;
}

interface User {
  email: string;
  apps: AppRef[];
  superadmin: boolean;
}

interface AccessApp {
  id: string;
  name: string;
  domain: string;
  sessionDuration: string;
  policies: Array<{ name: string; decision: string; subjects: string[] }>;
}

interface IamState {
  configured: boolean;
  error?: string;
  superadmin: string;
  users: User[];
  apps: AccessApp[];
}

type Tab = 'users' | 'apps';

/** A panel login, as opposed to a Cloudflare Access grant. */
interface Account {
  email: string;
  role: 'superadmin' | 'member';
  hasPassword: boolean;
  disabledAt: number | null;
}

interface AccountsState {
  /** False while the panel is still on the single shared .env password. */
  inUse: boolean;
  store: string;
  engine: string;
  me: string | null;
  users: Account[];
  envIdentity: string | null;
  /** True once the panel can verify an Access token, so no password is asked. */
  accessIdentity: boolean;
}

export default function IamPage({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState<Tab>(initialTab === 'apps' ? 'apps' : 'users');
  const [state, setState] = useState<IamState | null>(null);
  const [canWrite, setCanWrite] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newApps, setNewApps] = useState<string[]>([]);

  const [accounts, setAccounts] = useState<AccountsState | null>(null);
  // Default on: an Access grant without a panel login gets someone to the door
  // and no further, which is rarely what "add a user" is meant to mean.
  const [newLogin, setNewLogin] = useState(true);
  const [newRole, setNewRole] = useState<'member' | 'superadmin'>('member');
  // Shown once, immediately after creation. It is never stored in the clear, so
  // if it is not copied now it has to be reset.
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/iam');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setState(data);
      setError(data.configured ? '' : (data.error ?? 'Cloudflare Access not reachable'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/accounts', { cache: 'no-store' });
      setAccounts(await res.json());
    } catch {
      // Leave it null rather than claiming a state we did not read.
      setAccounts(null);
    }
  }, []);

  useEffect(() => {
    load();
    loadAccounts();
    fetch('/api/iam/users')
      .then((r) => r.json())
      .then((d) => setCanWrite(Boolean(d.canWrite)))
      .catch(() => setCanWrite(false));
  }, [load, loadAccounts]);

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    setBusy('add');
    setNote(null);
    try {
      const done: string[] = [];
      let ok = true;

      // The Access grant is optional: a panel login alone is the right shape
      // for someone who only ever reaches this machine over Tailscale.
      if (newApps.length > 0) {
        const res = await fetch('/api/iam/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: newEmail, apps: newApps }),
        });
        const data = await res.json().catch(() => ({}));
        ok = res.ok;
        done.push(data.message ?? data.error ?? `HTTP ${res.status}`);
      }

      if (ok && newLogin) {
        const res = await fetch('/api/accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: newEmail, role: newRole }),
        });
        const data = await res.json().catch(() => ({}));
        ok = res.ok;
        done.push(data.message ?? data.error ?? `HTTP ${res.status}`);
        if (res.ok && data.password) setIssued({ email: newEmail, password: data.password });
      }

      setNote({ ok, text: done.join(' · ') || 'nothing to do — tick a login or an application' });
      if (ok) {
        setNewEmail('');
        setNewApps([]);
        setNewRole('member');
        setShowAdd(false);
        await load();
        await loadAccounts();
      }
    } finally {
      setBusy('');
    }
  }

  async function revoke(email: string, appId: string, appName: string) {
    setBusy(`${email}-${appId}`);
    setNote(null);
    try {
      const res = await fetch(
        `/api/iam/users?email=${encodeURIComponent(email)}&app=${encodeURIComponent(appId)}`,
        { method: 'DELETE' },
      );
      const data = await res.json().catch(() => ({}));
      setNote({
        ok: res.ok,
        text: res.ok ? `${email} removed from ${appName}` : (data.error ?? `HTTP ${res.status}`),
      });
      await load();
    } finally {
      setBusy('');
    }
  }

  async function promote(email: string) {
    setBusy(`promote-${email}`);
    setNote(null);
    try {
      const res = await fetch('/api/iam/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      setNote({ ok: res.ok, text: data.message ?? data.error ?? `HTTP ${res.status}` });
      await load();
    } finally {
      setBusy('');
    }
  }

  async function discoverAccess() {
    setBusy('discover');
    setNote(null);
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'discover-access' }),
      });
      const data = await res.json().catch(() => ({}));
      setNote({ ok: res.ok, text: data.message ?? data.error ?? `HTTP ${res.status}` });
      await loadAccounts();
    } finally {
      setBusy('');
    }
  }

  async function migrate() {
    setBusy('migrate');
    setNote(null);
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'migrate' }),
      });
      const data = await res.json().catch(() => ({}));
      setNote({ ok: res.ok, text: data.message ?? data.error ?? `HTTP ${res.status}` });
      await loadAccounts();
    } finally {
      setBusy('');
    }
  }

  const apps = state?.apps ?? [];
  const accountFor = (email: string) =>
    accounts?.users.find((u) => u.email === email.toLowerCase()) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-display font-light tracking-tight">IAM</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2 max-w-2xl" style={{ textWrap: 'pretty' }}>
            Who can reach this machine, and who can sign in once they do. Cloudflare Access
            guards the public hostnames with an emailed one-time code; a panel account is what
            lets someone in on the other side of it, including over Tailscale.
          </p>
        </div>
        {canWrite && tab === 'users' && (
          <Button onClick={() => setShowAdd(!showAdd)}>
            <Plus size={15} className="mr-1.5" /> Add user
          </Button>
        )}
      </div>

      <Tabs
        tabs={[
          { key: 'users', label: 'Users', count: state?.users.length },
          { key: 'apps', label: 'Protected applications', count: apps.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {canWrite === false && (
        <div className="border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 rounded-xl p-4 flex items-start gap-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <div style={{ textWrap: 'pretty' }}>
            <strong>Read-only.</strong> The Cloudflare token can view these policies but not
            change them. Add <strong>Access: Apps and Policies → Edit</strong> to the token
            (My Profile → API Tokens) and this page becomes editable — nothing else changes.
          </div>
        </div>
      )}

      {accounts && !accounts.inUse && (
        <div className="border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 rounded-xl p-4 flex items-start gap-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <div style={{ textWrap: 'pretty' }}>
            <strong>Everyone shares one password.</strong> This panel still signs in with the
            single <code>DASHBOARD_PASSWORD</code> from its <code>.env</code>, so nothing any
            person does can be told apart from anyone else, and removing one person means
            changing it for all of them.
            {accounts.envIdentity && (
              <>
                {' '}
                Migrating keeps <strong>{accounts.envIdentity}</strong> signing in with the
                password they already use, and turns it into a real account.
              </>
            )}
            <div className="mt-2.5">
              <Button onClick={migrate} disabled={busy === 'migrate'}>
                {busy === 'migrate' ? (
                  <>
                    <Loader2 size={14} className="animate-spin mr-1.5" /> Migrating…
                  </>
                ) : (
                  'Create real accounts'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {accounts?.inUse && accounts.accessIdentity === false && state?.configured && (
        <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-4 flex items-start gap-3 text-sm">
          <Info size={16} className="shrink-0 mt-0.5 text-gray-400" />
          <div className="text-gray-700 dark:text-gray-300" style={{ textWrap: 'pretty' }}>
            <strong>Access already knows who these people are.</strong> This panel is not yet
            using that, so anyone coming through a public hostname is asked for a password on
            top of the one-time code they just passed. Turning it on means they are signed in
            as themselves, with no second credential.
            <div className="mt-2.5">
              <Button onClick={discoverAccess} disabled={busy === 'discover'}>
                {busy === 'discover' ? (
                  <>
                    <Loader2 size={14} className="animate-spin mr-1.5" /> Looking…
                  </>
                ) : (
                  'Use Access identity'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {issued && (
        <div className="border border-accent-300 dark:border-accent-800 bg-accent-50 dark:bg-accent-950/40 rounded-xl p-4 text-sm">
          <p className="text-accent-900 dark:text-accent-200" style={{ textWrap: 'pretty' }}>
            <strong>Password for {issued.email}</strong> — shown once. It is stored only as a
            hash, so if it is not copied now it has to be reset.
          </p>
          <code className="mt-2 block font-mono text-sm bg-white dark:bg-gray-900 border rounded-lg px-3 py-2 select-all break-all">
            {issued.password}
          </code>
          <button
            onClick={() => setIssued(null)}
            className="mt-2 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          >
            I have saved it
          </button>
        </div>
      )}

      {note && (
        <p
          className={`fade-in-up flex items-center gap-1.5 text-sm ${
            note.ok ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'
          }`}
        >
          {note.ok ? (
            <Check size={14} className="pop-in" />
          ) : (
            <AlertCircle size={14} className="pop-in" />
          )}
          {note.text}
        </p>
      )}

      {!state && !error && (
        <>
          <TableSkeleton rows={3} cols={3} />
          <StatCardsSkeleton count={2} />
        </>
      )}

      {tab === 'users' && state?.configured && (
        <>
          {showAdd && canWrite && (
            <form
              onSubmit={addUser}
              className="fade-in-up border rounded-xl p-5 space-y-4 bg-gray-50 dark:bg-gray-800/60"
            >
              <div className="flex flex-col max-w-md">
                <Label htmlFor="iam-email">Email address</Label>
                <Input
                  id="iam-email"
                  type="email"
                  placeholder="teammate@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  required
                />
                <span className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  They receive a one-time code at this address; no other email can use it.
                </span>
              </div>
              <div>
                <Label>Applications</Label>
                <div className="flex flex-wrap gap-2 mt-1.5">
                  {apps.map((a) => {
                    const on = newApps.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() =>
                          setNewApps(on ? newApps.filter((x) => x !== a.id) : [...newApps, a.id])
                        }
                        className={`text-xs px-3 py-2 rounded-lg border transition-[background-color,border-color,scale] active:scale-[0.96] ${
                          on
                            ? 'border-accent-500 bg-accent-50 dark:bg-accent-950/40 text-accent-700 dark:text-accent-300'
                            : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300'
                        }`}
                      >
                        {on && <Check size={11} className="inline mr-1" />}
                        {a.name}
                        <span className="ml-1.5 text-gray-400 dark:text-gray-500">{a.domain}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <Label>Panel login</Label>
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  <button
                    type="button"
                    onClick={() => setNewLogin(!newLogin)}
                    className={`text-xs px-3 py-2 rounded-lg border transition-[background-color,border-color,scale] active:scale-[0.96] ${
                      newLogin
                        ? 'border-accent-500 bg-accent-50 dark:bg-accent-950/40 text-accent-700 dark:text-accent-300'
                        : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300'
                    }`}
                  >
                    {newLogin && <Check size={11} className="inline mr-1" />}
                    Give them an account on this panel
                  </button>
                  {newLogin &&
                    (['member', 'superadmin'] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setNewRole(r)}
                        className={`text-xs px-3 py-2 rounded-lg border transition-[background-color,border-color,scale] active:scale-[0.96] ${
                          newRole === r
                            ? 'border-accent-500 bg-accent-50 dark:bg-accent-950/40 text-accent-700 dark:text-accent-300'
                            : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 block" style={{ textWrap: 'pretty' }}>
                  A password is generated and shown once. Without an account they can pass
                  Cloudflare Access but cannot sign in to the panel behind it.
                </span>
              </div>
              <Button
                type="submit"
                disabled={busy === 'add' || !newEmail || (newApps.length === 0 && !newLogin)}
              >
                {busy === 'add' ? (
                  <>
                    <Loader2 size={14} className="animate-spin mr-1.5" /> Granting…
                  </>
                ) : (
                  'Grant access'
                )}
              </Button>
            </form>
          )}

          <div className="overflow-x-auto border rounded-lg">
            <table className="min-w-full">
              <thead>
                <tr className="text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide bg-gray-50 dark:bg-gray-800/60">
                  <th className="px-4 py-3 whitespace-nowrap">
                    <Mail size={13} className="inline mr-1.5 -mt-0.5" />
                    Email
                  </th>
                  <th className="px-4 py-3 whitespace-nowrap">Can access</th>
                  <th className="px-4 py-3 whitespace-nowrap">Panel login</th>
                  <th className="px-4 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {(state?.users ?? []).map((u) => (
                  <tr key={u.email} className="border-t dark:border-gray-800">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-medium text-gray-800 dark:text-gray-200">
                        {u.email}
                      </span>
                      {u.superadmin && (
                        <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold uppercase bg-accent-50 dark:bg-accent-950/40 text-accent-700 dark:text-accent-300 border border-accent-200 dark:border-accent-800 px-1.5 py-0.5 rounded-full">
                          <Crown size={9} /> superadmin
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5 flex-wrap">
                        {u.apps.map((a) => (
                          <span
                            key={a.id}
                            className="group inline-flex items-center gap-1 text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 px-2 py-0.5 rounded-full"
                          >
                            {a.name}
                            {canWrite && !u.superadmin && (
                              <button
                                onClick={() => revoke(u.email, a.id, a.name)}
                                title={`Remove from ${a.name}`}
                                className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                              >
                                {busy === `${u.email}-${a.id}` ? (
                                  <Loader2 size={10} className="animate-spin" />
                                ) : (
                                  <Trash2 size={10} />
                                )}
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                      {(() => {
                        const a = accountFor(u.email);
                        if (!accounts?.inUse) {
                          return (
                            <span className="text-gray-400 dark:text-gray-600 text-xs">
                              shared password
                            </span>
                          );
                        }
                        if (!a) {
                          return (
                            <span className="text-amber-600 dark:text-amber-400 text-xs">
                              Access only — cannot sign in
                            </span>
                          );
                        }
                        if (a.disabledAt) {
                          return (
                            <span className="text-red-600 dark:text-red-400 text-xs font-medium">
                              disabled
                            </span>
                          );
                        }
                        return (
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            <Check size={12} className="text-green-600 dark:text-green-400" />
                            <span className="text-gray-700 dark:text-gray-300">{a.role}</span>
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right">
                      {canWrite && !u.superadmin && (
                        <button
                          onClick={() => promote(u.email)}
                          className="text-xs text-gray-500 dark:text-gray-400 hover:text-accent-600 dark:hover:text-accent-400 transition-colors"
                          title="Make this the superadmin — added to every application and protected from removal"
                        >
                          {busy === `promote-${u.email}` ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            'make superadmin'
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {/* Accounts with no Access grant. They can still sign in over
                    Tailscale, so leaving them off the page would understate who
                    has a way in. */}
                {(accounts?.users ?? [])
                  .filter((a) => !(state?.users ?? []).some((u) => u.email === a.email))
                  .map((a) => (
                    <tr key={a.email} className="border-t dark:border-gray-800">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-medium text-gray-800 dark:text-gray-200">
                          {a.email}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                        Tailscale and localhost only
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        {a.disabledAt ? (
                          <span className="text-red-600 dark:text-red-400 text-xs font-medium">
                            disabled
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            <Check size={12} className="text-green-600 dark:text-green-400" />
                            <span className="text-gray-700 dark:text-gray-300">{a.role}</span>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3" />
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <p
            className="text-xs text-gray-500 dark:text-gray-400 flex items-start gap-1.5"
            style={{ textWrap: 'pretty' }}
          >
            <Info size={12} className="shrink-0 mt-0.5" />
            The superadmin is kept on every application and cannot be removed here — that
            guard exists because removing the last allowed address locks a hostname for
            everyone, permanently. Promote someone else first to move it.
          </p>
        </>
      )}

      {tab === 'apps' && state?.configured && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {apps.map((app) => (
              <div key={app.id} className="border rounded-lg p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <Lock size={14} className="text-gray-400" />
                    {app.name}
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    session {app.sessionDuration}
                  </span>
                </div>
                <div className="font-mono text-sm text-gray-600 dark:text-gray-400">
                  {app.domain}
                </div>
                {app.policies.map((p) => (
                  <div key={p.name} className="text-sm">
                    <span
                      className={`text-xs font-medium uppercase px-1.5 py-0.5 rounded mr-2 ${
                        p.decision === 'allow'
                          ? 'bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400'
                          : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300'
                      }`}
                    >
                      {p.decision}
                    </span>
                    <span className="text-gray-700 dark:text-gray-300">
                      {p.subjects.join(', ')}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <p className="text-sm text-gray-500 dark:text-gray-400" style={{ textWrap: 'pretty' }}>
            <ShieldCheck size={13} className="inline mr-1 -mt-0.5" />
            Tailscale access bypasses this gate by design — it is limited to devices in your
            tailnet instead. Public routes without an Access application rely on whatever auth
            the app itself has.
          </p>
        </>
      )}
    </div>
  );
}
