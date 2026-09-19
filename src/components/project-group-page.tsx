"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Box,
  Check,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { KIND_ICON, KIND_LABEL, type Kind } from './projects-page';

interface Member {
  kind: Kind;
  name: string;
  addedAt: number;
  addedBy: string | null;
}

interface Detail {
  id: string;
  name: string;
  description: string;
  members: Member[];
}

/** One thing that exists on this machine and could be put in a project. */
interface Resource {
  kind: Kind;
  name: string;
  status?: string;
  url?: string | null;
}

const KINDS: Kind[] = ['service', 'static', 'bucket', 'route'];
const key = (kind: Kind, name: string) => `${kind}:${name}`;

/** Where each kind of resource is managed. A project links there; it does not duplicate it. */
function hrefFor(kind: Kind, name: string): string {
  if (kind === 'service') return `/dashboard/services/${name}`;
  if (kind === 'static') return `/dashboard/static/${name}`;
  if (kind === 'bucket') return '/dashboard/storage';
  return '/dashboard/tunnel';
}

export default function ProjectGroupPage({ id }: { id: string }) {
  const router = useRouter();
  const [group, setGroup] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [owners, setOwners] = useState<Record<string, string>>({}); // "kind:name" → project id
  const [names, setNames] = useState<Record<string, string>>({}); //   project id → display name
  const [live, setLive] = useState<Record<string, Resource>>({});
  const [routesLoaded, setRoutesLoaded] = useState(false);
  // 'ready' only once services and buckets were actually read. Until then a row
  // cannot be called missing: slow or failed is not the same as gone.
  const [resources, setResources] = useState<'loading' | 'ready' | 'failed'>('loading');
  const routesStarted = useRef(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  // Resources are read after the project is on screen. /api/projects probes ports
  // and can take seconds; the project itself is one database read, and making
  // the second wait for the first would blank the page for no reason.
  const loadResources = useCallback(async () => {
    try {
      const [svc, sto] = await Promise.all([
        fetch('/api/projects', { cache: 'no-store' }).catch(() => null),
        fetch('/api/storage', { cache: 'no-store' }).catch(() => null),
      ]);
      const next: Record<string, Resource> = {};
      if (svc?.ok) {
        const sd = await svc.json();
        for (const p of sd.projects ?? []) {
          if (p.system) continue;
          const kind: Kind = p.type === 'static' ? 'static' : 'service';
          next[key(kind, p.name)] = { kind, name: p.name, status: p.status, url: p.url };
        }
      }
      if (sto?.ok) {
        const bd = await sto.json();
        for (const b of bd.buckets ?? []) {
          next[key('bucket', b.name)] = { kind: 'bucket', name: b.name, url: b.publicUrl ?? null };
        }
      }
      setLive((prev) => {
        // Keep routes already fetched: they are slower to get and load separately.
        const routes = Object.fromEntries(Object.entries(prev).filter(([k]) => k.startsWith('route:')));
        return { ...next, ...routes };
      });
      // Services are what a project mostly holds; without them nothing can be
      // judged, so their absence is a failure rather than "empty".
      setResources(svc?.ok ? 'ready' : 'failed');
    } catch {
      setResources('failed');
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const [g, all] = await Promise.all([
        fetch(`/api/groups/${id}`, { cache: 'no-store' }),
        fetch('/api/groups', { cache: 'no-store' }),
      ]);
      if (g.status === 404) {
        setMissing(true);
        return;
      }
      const gd = await g.json();
      if (!g.ok) throw new Error(gd.error ?? `HTTP ${g.status}`);
      setGroup(gd.group);

      const ad = await all.json();
      setOwners(ad.membership ?? {});
      setNames(Object.fromEntries((ad.groups ?? []).map((x: { id: string; name: string }) => [x.id, x.name])));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    load();
    loadResources();
  }, [load, loadResources]);

  // Routes are verified over HTTPS one by one, which is slow, so they are only
  // fetched when a project holds one or the picker's Routes tab is opened.
  const loadRoutes = useCallback(async () => {
    if (routesStarted.current) return;
    routesStarted.current = true;
    try {
      const res = await fetch('/api/routes', { cache: 'no-store' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      setLive((prev) => {
        const next = { ...prev };
        for (const r of d.routes ?? []) {
          next[key('route', r.hostname)] = {
            kind: 'route',
            name: r.hostname,
            status: r.ok ? 'online' : 'stopped',
            url: `https://${r.hostname}`,
          };
        }
        return next;
      });
    } catch {
      /* rows stay "unknown" */
    } finally {
      setRoutesLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (group?.members.some((m) => m.kind === 'route')) loadRoutes();
  }, [group, loadRoutes]);

  async function remove(m: Member) {
    setBusy(true);
    try {
      const res = await fetch(`/api/groups/${id}/members?kind=${m.kind}&name=${encodeURIComponent(m.name)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function destroy() {
    setBusy(true);
    try {
      const res = await fetch(`/api/groups/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      router.push('/dashboard/projects');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const summary = useMemo(() => {
    const members = group?.members ?? [];
    const withStatus = members.filter((m) => live[key(m.kind, m.name)]?.status !== undefined);
    const up = withStatus.filter((m) => live[key(m.kind, m.name)]?.status === 'online').length;
    const gone =
      resources === 'ready'
        ? members.filter((m) => m.kind !== 'route' && !live[key(m.kind, m.name)]).length
        : 0;
    return { total: members.length, tracked: withStatus.length, up, gone };
  }, [group, live, resources]);

  if (missing) {
    return (
      <div className="p-6 max-w-3xl space-y-3">
        <Back />
        <h1 className="text-2xl font-display font-light">No such project</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          It may have been deleted. Everything it grouped is still on{' '}
          <Link href="/dashboard" className="underline">
            Services
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <Back />

      {!group && !error && <div className="h-24 rounded-xl border border-gray-200 dark:border-gray-800 animate-pulse" />}

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" /> {error}
        </p>
      )}

      {group && (
        <>
          <Header
            group={group}
            summary={summary}
            editing={editing}
            onEdit={() => setEditing(true)}
            onDone={() => {
              setEditing(false);
              load();
            }}
          />

          <Members
            members={group.members}
            live={live}
            resources={resources}
            routesLoaded={routesLoaded}
            busy={busy}
            onRemove={remove}
          />

          <AddResources
            groupId={group.id}
            members={group.members}
            live={live}
            resources={resources}
            owners={owners}
            names={names}
            onNeedRoutes={loadRoutes}
            routesLoaded={routesLoaded}
            onAdded={load}
          />

          <div className="pt-4 border-t border-gray-200 dark:border-gray-800">
            {confirmDelete ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-gray-600 dark:text-gray-400 text-pretty">
                  Delete <strong>{group.name}</strong>?{' '}
                  {group.members.length > 0
                    ? `The ${group.members.length} resource${group.members.length === 1 ? '' : 's'} in it stay exactly as they are.`
                    : 'It is empty.'}
                </p>
                <button
                  onClick={destroy}
                  disabled={busy}
                  className="text-xs h-8 px-2.5 rounded-lg text-white bg-red-600 transition-[opacity,scale] duration-200 ease-swift
                             hover:bg-red-500 active:scale-[0.96] disabled:opacity-50"
                >
                  {busy ? <Loader2 size={12} className="animate-spin" /> : 'Delete project'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs h-8 px-2.5 rounded-lg text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 transition-colors duration-200 ease-swift hover:text-red-600"
              >
                <Trash2 size={13} /> Delete project
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Back() {
  return (
    <Link
      href="/dashboard/projects"
      className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 transition-colors duration-200 ease-swift
                 hover:text-gray-900 dark:hover:text-gray-100"
    >
      <ArrowLeft size={14} /> Projects
    </Link>
  );
}

function Header({
  group,
  summary,
  editing,
  onEdit,
  onDone,
}: {
  group: Detail;
  summary: { total: number; tracked: number; up: number; gone: number };
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/groups/${group.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <form onSubmit={save} className="space-y-2 max-w-xl">
        <input
          autoFocus
          required
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Project name"
          className="w-full h-11 px-3 rounded-lg text-2xl font-display font-light bg-transparent border border-gray-200 dark:border-gray-800 focus:outline-none focus:border-accent-500"
        />
        <input
          maxLength={280}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-label="Description"
          placeholder="Description"
          className="w-full h-10 px-3 rounded-lg text-sm bg-transparent border border-gray-200 dark:border-gray-800 focus:outline-none focus:border-accent-500"
        />
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="flex items-center gap-1.5 text-sm h-9 px-3 rounded-lg font-medium text-white bg-accent-600 hover:bg-accent-500 disabled:opacity-40"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
          </button>
          <button type="button" onClick={onDone} className="text-sm h-9 px-3 rounded-lg text-gray-600 dark:text-gray-400">
            Cancel
          </button>
        </div>
      </form>
    );
  }

  const state =
    summary.total === 0
      ? null
      : summary.tracked === 0
        ? null
        : summary.up === summary.tracked
          ? { text: 'All up', tone: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' }
          : { text: `${summary.tracked - summary.up} of ${summary.tracked} down`, tone: 'text-red-600 dark:text-red-400', dot: 'bg-red-500' };

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-3xl font-display font-light tracking-tight flex items-center gap-2.5 min-w-0">
          <Box size={22} className="text-gray-500 dark:text-gray-400 shrink-0" />
          <span className="truncate">{group.name}</span>
        </h1>
        <button
          onClick={onEdit}
          aria-label="Edit name and description"
          className="grid place-items-center w-9 h-9 rounded-lg text-gray-400 transition-colors duration-200 ease-swift hover:text-gray-700 dark:hover:text-gray-200"
        >
          <Pencil size={14} />
        </button>
      </div>
      {group.description && (
        <p className="text-gray-600 dark:text-gray-400 mt-2 text-pretty max-w-2xl">{group.description}</p>
      )}
      {state && (
        <p className={`mt-3 text-sm flex items-center gap-2 ${state.tone}`}>
          <span className={`inline-block w-2 h-2 rounded-full ${state.dot}`} /> {state.text}
        </p>
      )}
      {summary.gone > 0 && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-500 flex items-center gap-1.5">
          <AlertTriangle size={12} /> {summary.gone} resource{summary.gone === 1 ? '' : 's'} in this project no longer exist on this machine.
        </p>
      )}
    </div>
  );
}

function Members({
  members,
  live,
  resources,
  routesLoaded,
  busy,
  onRemove,
}: {
  members: Member[];
  live: Record<string, Resource>;
  resources: 'loading' | 'ready' | 'failed';
  routesLoaded: boolean;
  busy: boolean;
  onRemove: (m: Member) => void;
}) {
  if (members.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center">
        <p className="text-sm text-gray-700 dark:text-gray-300">Nothing in this project yet.</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-pretty">
          Add a service, static site, bucket or route below. It stays where it is — the project only groups it.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {KINDS.filter((k) => members.some((m) => m.kind === k)).map((k) => {
        const Icon = KIND_ICON[k];
        const rows = members.filter((m) => m.kind === k);
        return (
          <section key={k}>
            <h2 className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 flex items-center gap-1.5 mb-2">
              <Icon size={12} /> {KIND_LABEL[k].many}
            </h2>
            <ul className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-200 dark:divide-gray-800">
              {rows.map((m) => {
                const r = live[key(m.kind, m.name)];
                const known = resources === 'ready' && (m.kind !== 'route' || routesLoaded);
                const gone = known && !r;
                const dot = gone
                  ? 'bg-amber-500'
                  : r?.status === undefined
                    ? 'bg-gray-300 dark:bg-gray-600'
                    : r.status === 'online'
                      ? 'bg-emerald-500'
                      : 'bg-red-500';
                return (
                  <li key={m.name} className="flex items-center gap-3 px-4 py-3">
                    <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${dot}`} />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={hrefFor(m.kind, m.name)}
                        className="text-sm font-medium text-gray-900 dark:text-gray-100 hover:underline break-all"
                      >
                        {m.name}
                      </Link>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {gone ? (
                          <span className="text-amber-600 dark:text-amber-500">no longer on this machine</span>
                        ) : r?.status ? (
                          r.status
                        ) : resources === 'loading' ? (
                          'checking…'
                        ) : (
                          'status unknown'
                        )}
                      </p>
                    </div>
                    {r?.url && (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open ${m.name}`}
                        className="grid place-items-center w-8 h-8 rounded-lg text-gray-400 transition-colors duration-200 ease-swift hover:text-gray-700 dark:hover:text-gray-200"
                      >
                        <ExternalLink size={14} />
                      </a>
                    )}
                    <button
                      onClick={() => onRemove(m)}
                      disabled={busy}
                      aria-label={`Remove ${m.name} from this project`}
                      title="Remove from project (the resource itself is untouched)"
                      className="grid place-items-center w-8 h-8 rounded-lg text-gray-400 transition-colors duration-200 ease-swift hover:text-red-600 disabled:opacity-40"
                    >
                      <X size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function AddResources({
  groupId,
  members,
  live,
  resources,
  owners,
  names,
  onNeedRoutes,
  routesLoaded,
  onAdded,
}: {
  groupId: string;
  members: Member[];
  live: Record<string, Resource>;
  resources: 'loading' | 'ready' | 'failed';
  owners: Record<string, string>;
  names: Record<string, string>;
  onNeedRoutes: () => void;
  routesLoaded: boolean;
  onAdded: () => void;
}) {
  const [tab, setTab] = useState<Kind>('static');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const inThis = useMemo(() => new Set(members.map((m) => key(m.kind, m.name))), [members]);
  const items = Object.values(live)
    .filter((r) => r.kind === tab && !inThis.has(key(r.kind, r.name)))
    .sort((a, b) => a.name.localeCompare(b.name));

  function choose(k: Kind) {
    setTab(k);
    if (k === 'route') onNeedRoutes();
  }

  function toggle(r: Resource) {
    setPicked((prev) => {
      const next = new Set(prev);
      const k = key(r.kind, r.name);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  // Taking something from another project is a decision, not a side effect: it
  // is only sent as a move when a selected resource actually belongs elsewhere.
  const takingFromOthers = [...picked].filter((k) => owners[k] && owners[k] !== groupId);

  async function add() {
    setBusy(true);
    setError('');
    try {
      const members = [...picked].map((k) => {
        const i = k.indexOf(':');
        return { kind: k.slice(0, i), name: k.slice(i + 1) };
      });
      const res = await fetch(`/api/groups/${groupId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ members, move: takingFromOthers.length > 0 }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      setPicked(new Set());
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 space-y-3">
      <h2 className="text-sm font-medium flex items-center gap-1.5">
        <Plus size={14} /> Add to this project
      </h2>

      <div role="tablist" className="flex flex-wrap gap-1.5">
        {KINDS.map((k) => {
          const Icon = KIND_ICON[k];
          const on = tab === k;
          return (
            <button
              key={k}
              role="tab"
              aria-selected={on}
              onClick={() => choose(k)}
              className={`flex items-center gap-1.5 text-xs h-8 px-2.5 rounded-lg border transition-colors duration-200 ease-swift ${
                on
                  ? 'border-accent-500 text-accent-700 dark:text-accent-400 bg-accent-50/60 dark:bg-accent-500/10'
                  : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-700'
              }`}
            >
              <Icon size={12} /> {KIND_LABEL[k].many}
            </button>
          );
        })}
      </div>

      {tab === 'route' && !routesLoaded ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Checking routes…
        </p>
      ) : resources === 'loading' && tab !== 'route' ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Reading what is deployed on this machine…
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 text-pretty">
          {resources === 'failed' && tab !== 'route'
            ? 'Could not read what is deployed on this machine. Reload to try again.'
            : `Every ${KIND_LABEL[tab].one} on this machine is already in this project, or there are none.`}
        </p>
      ) : (
        <ul className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-200 dark:divide-gray-800">
          {items.map((r) => {
            const k = key(r.kind, r.name);
            const owner = owners[k];
            return (
              <li key={k}>
                <label className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50/60 dark:hover:bg-white/[0.02]">
                  <input
                    type="checkbox"
                    checked={picked.has(k)}
                    onChange={() => toggle(r)}
                    className="accent-[var(--accent-600,#4f46e5)]"
                  />
                  <span className="text-sm text-gray-900 dark:text-gray-100 break-all flex-1">{r.name}</span>
                  {owner && owner !== groupId && (
                    <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                      in {names[owner] ?? owner}
                    </span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {takingFromOthers.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-500 text-pretty">
          {takingFromOthers.length === 1 ? 'One selected resource is' : `${takingFromOthers.length} selected resources are`}{' '}
          in another project. Adding {takingFromOthers.length === 1 ? 'it' : 'them'} moves {takingFromOthers.length === 1 ? 'it' : 'them'} here.
        </p>
      )}

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" /> {error}
        </p>
      )}

      <button
        onClick={add}
        disabled={busy || picked.size === 0}
        className="flex items-center gap-1.5 text-sm h-9 px-3 rounded-lg font-medium text-white bg-accent-600
                   transition-[opacity,scale] duration-200 ease-swift hover:bg-accent-500 active:scale-[0.96]
                   disabled:opacity-40 disabled:active:scale-100"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        {picked.size > 0 ? `Add ${picked.size} to project` : 'Add to project'}
      </button>
    </section>
  );
}
