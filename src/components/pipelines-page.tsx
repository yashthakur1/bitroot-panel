"use client";

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Check,
  GitBranch,
  Loader2,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import DashboardLayout from './dashboard-layout';

interface Pipeline {
  id: string;
  repo: string;
  branch: string;
  project: string;
  connectionId: string | null;
  hookId: number | null;
  createdAt: string;
}

interface Run {
  id: string;
  pipelineId: string;
  at: string;
  ok: boolean;
  sha?: string;
  message?: string;
  pusher?: string;
  output?: string;
}

interface Data {
  pipelines: Pipeline[];
  runs: Run[];
  connections: Array<{ id: string; label: string }>;
  deliveryBase: string | null;
  device: string;
}

export default function PipelinesPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/pipelines', { cache: 'no-store' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      setData(d);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <DashboardLayout>
      <div className="p-6 max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-display font-light flex items-center gap-2">
            <GitBranch size={20} className="text-gray-500 dark:text-gray-400" />
            Pipelines
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2 text-pretty">
            A push to a branch deploys a service on{' '}
            <span className="font-mono text-sm">{data?.device ?? 'this machine'}</span>. The panel
            registers the webhook with GitHub for you; deliveries are signed and land on the deploy
            service, never on the panel itself.
          </p>
        </div>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" /> {error}
          </p>
        )}

        {data && !data.deliveryBase && (
          <div className="rounded-xl border border-amber-300/60 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/[0.06] p-4">
            <p className="text-sm text-amber-800 dark:text-amber-400 text-pretty">
              No domain is set, so there is no public address for GitHub to deliver to. Set one in{' '}
              <Link href="/dashboard/config" className="underline">
                Config → Setup
              </Link>{' '}
              first.
            </p>
          </div>
        )}

        {data && data.connections.length === 0 && (
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
            <p className="text-sm text-gray-600 dark:text-gray-400 text-pretty">
              No GitHub connection yet. Add one under{' '}
              <Link href="/dashboard/git" className="text-accent-600 dark:text-accent-400 underline">
                Git connections
              </Link>{' '}
              — creating a webhook needs admin rights on the repository.
            </p>
          </div>
        )}

        {data?.pipelines.length === 0 && !adding && (
          <p className="text-sm text-gray-500 dark:text-gray-400">Nothing wired up yet.</p>
        )}

        <div className="space-y-3">
          {data?.pipelines.map((p) => (
            <PipelineRow
              key={p.id}
              pipeline={p}
              runs={data.runs.filter((r) => r.pipelineId === p.id)}
              onChange={load}
            />
          ))}
        </div>

        {adding ? (
          <NewPipeline
            connections={data?.connections ?? []}
            onDone={() => {
              setAdding(false);
              load();
            }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            disabled={!data?.deliveryBase || (data?.connections.length ?? 0) === 0}
            className="flex items-center gap-1.5 text-sm h-9 px-3 rounded-lg font-medium text-white
                       bg-accent-600 transition-[opacity,scale] duration-200 ease-swift
                       hover:bg-accent-500 active:scale-[0.96]
                       disabled:opacity-40 disabled:active:scale-100"
          >
            <Plus size={15} /> New pipeline
          </button>
        )}
      </div>
    </DashboardLayout>
  );
}

function PipelineRow({
  pipeline,
  runs,
  onChange,
}: {
  pipeline: Pipeline;
  runs: Run[];
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const last = runs[0];

  async function remove() {
    setBusy(true);
    try {
      await fetch(`/api/pipelines?id=${pipeline.id}`, { method: 'DELETE' });
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 break-all">
            {pipeline.repo}
            <span className="text-gray-400 dark:text-gray-500"> @ </span>
            <span className="font-mono">{pipeline.branch}</span>
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            deploys <span className="font-mono text-gray-700 dark:text-gray-300">{pipeline.project}</span>
            {pipeline.hookId === null && (
              <span className="text-amber-600 dark:text-amber-500">
                {' '}
                · no webhook was registered — pushes will not trigger anything
              </span>
            )}
          </p>
        </div>
        {confirming ? (
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={remove}
              disabled={busy}
              className="text-xs h-8 px-2.5 rounded-lg text-white bg-red-600
                         transition-[opacity,scale] duration-200 ease-swift
                         hover:bg-red-500 active:scale-[0.96] disabled:opacity-50"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : 'Remove'}
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="grid place-items-center w-8 h-8 rounded-lg text-gray-400
                         transition-colors duration-200 ease-swift hover:text-gray-600"
            >
              <X size={13} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            aria-label="Remove pipeline"
            className="shrink-0 grid place-items-center w-9 h-9 rounded-lg text-gray-400
                       transition-colors duration-200 ease-swift hover:text-red-500"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {last && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800/70 flex items-start gap-2">
          {last.ok ? (
            <Check size={13} className="text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle size={13} className="text-red-500 shrink-0 mt-0.5" />
          )}
          <div className="text-xs min-w-0">
            <p className="text-gray-600 dark:text-gray-400">
              {last.ok ? 'Deployed' : 'Failed'} {new Date(last.at).toLocaleString()}
              {last.sha && <span className="font-mono"> · {last.sha}</span>}
              {last.pusher && <span> · {last.pusher}</span>}
            </p>
            {last.message && (
              <p className="text-gray-500 dark:text-gray-500 truncate">{last.message}</p>
            )}
            {!last.ok && last.output && (
              <pre className="mt-1.5 text-[11px] font-mono bg-gray-50 dark:bg-gray-800/60 rounded-md p-2 overflow-x-auto max-h-32">
                {last.output.slice(-800)}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NewPipeline({
  connections,
  onDone,
  onCancel,
}: {
  connections: Array<{ id: string; label: string }>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('');
  const [project, setProject] = useState('');
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? '');
  const [branches, setBranches] = useState<string[] | null>(null);
  const [projects, setProjects] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/projects')
      .then((r) => r.json())
      .then((d) =>
        setProjects(
          (d.projects ?? [])
            .filter((p: { system?: boolean }) => !p.system)
            .map((p: { name: string }) => p.name),
        ),
      )
      .catch(() => setProjects([]));
  }, []);

  // Branches are fetched on demand rather than as you type: each keystroke
  // would be a GitHub API call against a rate limit shared with everything else
  // the panel does.
  async function loadBranches() {
    setBranches(null);
    setError('');
    try {
      const res = await fetch(
        `/api/github/branches?repo=${encodeURIComponent(repo)}&connection=${encodeURIComponent(connectionId)}`,
      );
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      const names: string[] = d.branches ?? d ?? [];
      setBranches(names);
      if (names.includes('main')) setBranch('main');
      else if (names.length) setBranch(names[0]);
    } catch (e) {
      setError((e as Error).message);
      setBranches([]);
    }
  }

  async function create() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/pipelines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo, branch, project, connectionId: connectionId || null }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input =
    'w-full h-9 px-2.5 rounded-lg text-sm border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 transition-[border-color,box-shadow] duration-200 ease-swift focus:outline-none focus:border-accent-500/70 focus:ring-4 focus:ring-accent-500/10';

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 space-y-3">
      {connections.length > 1 && (
        <label className="block">
          <span className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Connection</span>
          <select value={connectionId} onChange={(e) => setConnectionId(e.target.value)} className={input}>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="block">
        <span className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Repository</span>
        <div className="flex gap-2">
          <input
            value={repo}
            onChange={(e) => setRepo(e.target.value.trim())}
            placeholder="owner/name"
            spellCheck={false}
            className={`${input} font-mono`}
          />
          <button
            onClick={loadBranches}
            disabled={!/^[^/\s]+\/[^/\s]+$/.test(repo)}
            className="shrink-0 text-sm h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-800
                       text-gray-700 dark:text-gray-300
                       transition-[background-color,scale] duration-200 ease-swift
                       hover:bg-gray-50 dark:hover:bg-gray-800/60 active:scale-[0.96]
                       disabled:opacity-40 disabled:active:scale-100"
          >
            Find branches
          </button>
        </div>
      </label>

      {branches !== null && (
        <label className="block">
          <span className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Branch</span>
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className={input}>
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="block">
        <span className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Deploys</span>
        <select value={project} onChange={(e) => setProject(e.target.value)} className={input}>
          <option value="">Pick a service…</option>
          {projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <span className="block text-[11px] text-gray-500 dark:text-gray-400 mt-1">
          Runs <code className="font-mono">project deploy</code> — pull, install, build, restart,
          health check.
        </span>
      </label>

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1.5">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={create}
          disabled={busy || !repo || !branch || !project}
          className="flex items-center gap-1.5 text-sm h-9 px-3 rounded-lg font-medium text-white
                     bg-accent-600 transition-[opacity,scale] duration-200 ease-swift
                     hover:bg-accent-500 active:scale-[0.96]
                     disabled:opacity-40 disabled:active:scale-100"
        >
          {busy && <Loader2 size={13} className="animate-spin" />}
          Create pipeline
        </button>
        <button
          onClick={onCancel}
          className="text-sm h-9 px-3 rounded-lg text-gray-600 dark:text-gray-400
                     border border-gray-200 dark:border-gray-800
                     transition-[background-color,scale] duration-200 ease-swift
                     hover:bg-gray-50 dark:hover:bg-gray-800/60 active:scale-[0.96]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
