"use client";

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Box, Database, Globe, Loader2, Plus, Route, Server, X } from 'lucide-react';
import { ProjectsEmpty } from './feature-empties';

export type Kind = 'service' | 'static' | 'bucket' | 'route';

export interface GroupSummary {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string | null;
  counts: Record<Kind, number>;
}

export const KIND_LABEL: Record<Kind, { one: string; many: string }> = {
  service: { one: 'service', many: 'services' },
  static: { one: 'static site', many: 'static sites' },
  bucket: { one: 'bucket', many: 'buckets' },
  route: { one: 'route', many: 'routes' },
};

export const KIND_ICON = { service: Server, static: Globe, bucket: Database, route: Route } as const;

// Projects group things; they do not run anything. A project is a label over
// the services, static sites, buckets and routes that already exist, so the page
// says what is in each and leaves acting on them to the pages they live on.
export default function ProjectsPage() {
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/groups', { cache: 'no-store' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      setGroups(d.groups);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-display font-light tracking-tight">Projects</h1>
        {groups && groups.length > 0 && !creating && (
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 text-sm h-9 px-3 rounded-lg font-medium text-white
                       bg-accent-600 transition-[opacity,scale] duration-200 ease-swift
                       hover:bg-accent-500 active:scale-[0.96]"
          >
            <Plus size={15} /> New project
          </button>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" /> {error}
        </p>
      )}

      {creating && <NewProject onCancel={() => setCreating(false)} />}

      {groups === null && !error && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 rounded-xl border border-gray-200 dark:border-gray-800 animate-pulse" />
          ))}
        </div>
      )}

      {groups?.length === 0 && !creating && <ProjectsEmpty onCreate={() => setCreating(true)} />}

      {groups && groups.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <ProjectCard key={g.id} group={g} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectCard({ group }: { group: GroupSummary }) {
  const total = Object.values(group.counts).reduce((a, b) => a + b, 0);
  return (
    <Link
      href={`/dashboard/projects/${group.id}`}
      className="group block rounded-xl border border-gray-200 dark:border-gray-800 p-4
                 transition-[border-color,background-color] duration-200 ease-swift
                 hover:border-gray-300 dark:hover:border-gray-700 hover:bg-gray-50/60 dark:hover:bg-white/[0.02]"
    >
      <div className="flex items-center gap-2">
        <Box size={16} className="text-gray-500 dark:text-gray-400 shrink-0" />
        <h2 className="text-base font-medium text-gray-900 dark:text-gray-100 truncate">{group.name}</h2>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1.5 line-clamp-2 min-h-[2.5rem] text-pretty">
        {group.description || <span className="text-gray-400 dark:text-gray-500">No description</span>}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-xs text-gray-500 dark:text-gray-400">
        {total === 0 ? (
          <span>Nothing in it yet</span>
        ) : (
          (Object.keys(group.counts) as Kind[])
            .filter((k) => group.counts[k] > 0)
            .map((k) => {
              const Icon = KIND_ICON[k];
              const n = group.counts[k];
              return (
                <span key={k} className="flex items-center gap-1 tabular-nums">
                  <Icon size={12} /> {n} {n === 1 ? KIND_LABEL[k].one : KIND_LABEL[k].many}
                </span>
              );
            })
        )}
      </div>
    </Link>
  );
}

function NewProject({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      // Straight to the new project: an empty one has one obvious next step.
      router.push(`/dashboard/projects/${d.group.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 space-y-3 max-w-xl">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">New project</h2>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className="grid place-items-center w-8 h-8 rounded-lg text-gray-400 transition-colors duration-200 ease-swift hover:text-gray-600"
        >
          <X size={14} />
        </button>
      </div>
      <label className="block">
        <span className="text-xs text-gray-500 dark:text-gray-400">Name</span>
        <input
          autoFocus
          required
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="rapsap"
          className="mt-1 w-full h-10 px-3 rounded-lg text-sm bg-transparent border border-gray-200 dark:border-gray-800
                     focus:outline-none focus:border-accent-500"
        />
      </label>
      <label className="block">
        <span className="text-xs text-gray-500 dark:text-gray-400">Description (optional)</span>
        <input
          maxLength={280}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="The rapsap website and everything behind it"
          className="mt-1 w-full h-10 px-3 rounded-lg text-sm bg-transparent border border-gray-200 dark:border-gray-800
                     focus:outline-none focus:border-accent-500"
        />
      </label>
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" /> {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || !name.trim()}
        className="flex items-center gap-1.5 text-sm h-9 px-3 rounded-lg font-medium text-white bg-accent-600
                   transition-[opacity,scale] duration-200 ease-swift hover:bg-accent-500 active:scale-[0.96]
                   disabled:opacity-40 disabled:active:scale-100"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create project
      </button>
    </form>
  );
}
