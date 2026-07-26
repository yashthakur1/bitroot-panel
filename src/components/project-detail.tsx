"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { humanUptime, StatusBadge, type Project } from './project-list';
import { Shimmer, StatCardsSkeleton } from './skeletons';

type Tab = 'overview' | 'logs' | 'environment';

export default function ProjectDetail({
  name,
  initialTab,
}: {
  name: string;
  initialTab?: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(
    initialTab === 'logs' || initialTab === 'environment' ? initialTab : 'overview',
  );
  const [loaded, setLoaded] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [busyAction, setBusyAction] = useState('');
  const [actionOutput, setActionOutput] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/projects');
    if (!res.ok) return;
    const data = await res.json();
    setProject(
      (data.projects as Project[]).find((p) => p.name === name) ?? null,
    );
    setLoaded(true);
  }, [name]);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  async function runAction(action: string) {
    setBusyAction(action);
    setActionOutput(`Running ${action}…`);
    try {
      const res = await fetch(`/api/projects/${name}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      setActionOutput(data.output ?? data.error ?? `HTTP ${res.status}`);
      if (action === 'remove' && res.ok) {
        router.push('/dashboard');
        return;
      }
      load();
    } catch (e) {
      setActionOutput(`failed: ${(e as Error).message}`);
    } finally {
      setBusyAction('');
      setConfirmRemove(false);
    }
  }

  // Project not in the list and no action in flight: it was removed.
  if (loaded && !project && !busyAction) {
    return (
      <div className="fade-in-up flex flex-col items-center justify-center py-24 text-center">
        <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
          <ExternalLink size={20} className="text-gray-400" />
        </div>
        <h1 className="text-xl font-semibold mb-1">&quot;{name}&quot; doesn&apos;t exist</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
          It may have been removed, or the name changed.
        </p>
        <Button className="min-w-40" onClick={() => router.push('/dashboard')}>
          Back to projects
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{name}</h1>
          <div className="flex items-center gap-4 mt-2">
            {project && <StatusBadge status={project.status} />}
            {project?.url && (
              <a
                href={project.url}
                target="_blank"
                rel="noreferrer"
                className="text-purple-600 dark:text-purple-400 hover:underline text-sm inline-flex items-center gap-1"
              >
                {project.url.replace('https://', '')}
                <ExternalLink size={12} />
              </a>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            className="bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-gray-200"
            disabled={!!busyAction}
            onClick={() => runAction('deploy')}
          >
            {busyAction === 'deploy' ? 'Deploying…' : 'Deploy'}
          </Button>
          <Button variant="outline" disabled={!!busyAction} onClick={() => runAction('restart')}>
            {busyAction === 'restart' ? 'Restarting…' : 'Restart'}
          </Button>
          {project?.status === 'online' ? (
            <Button variant="outline" disabled={!!busyAction} onClick={() => runAction('stop')}>
              {busyAction === 'stop' ? 'Stopping…' : 'Stop'}
            </Button>
          ) : (
            <Button variant="outline" disabled={!!busyAction} onClick={() => runAction('start')}>
              {busyAction === 'start' ? 'Starting…' : 'Start'}
            </Button>
          )}
          {confirmRemove ? (
            <Button
              variant="outline"
              className="border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
              disabled={!!busyAction}
              onClick={() => runAction('remove')}
            >
              {busyAction === 'remove' ? 'Removing…' : 'Really remove?'}
            </Button>
          ) : (
            <Button
              variant="outline"
              className="text-red-600 dark:text-red-400"
              disabled={!!busyAction}
              onClick={() => setConfirmRemove(true)}
            >
              Remove
            </Button>
          )}
        </div>
      </div>

      <div className="border-b">
        {(['overview', 'logs', 'environment'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`py-2 px-3 text-sm font-medium capitalize -mb-px ${
              tab === t
                ? 'text-purple-600 dark:text-purple-400 border-b-2 border-purple-600'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview project={project} actionOutput={actionOutput} />}
      {tab === 'logs' && <Logs name={name} />}
      {tab === 'environment' && <EnvEditor name={name} />}
    </div>
  );
}

function Overview({ project, actionOutput }: { project: Project | null; actionOutput: string }) {
  if (!project) return <StatCardsSkeleton count={6} />;
  const stats: Array<[string, string]> = [
    ['Status', project.status],
    ['Port', project.port ? String(project.port) : '—'],
    ['CPU', `${project.cpu}%`],
    ['Memory', project.memoryMb ? `${project.memoryMb} MB` : '—'],
    ['Uptime', humanUptime(project.uptimeMs)],
    ['Restarts', String(project.restarts)],
  ];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {stats.map(([label, value]) => (
          <div key={label} className="border rounded-lg p-4">
            <div className="text-xs uppercase text-gray-500 dark:text-gray-400 font-semibold">{label}</div>
            <div className="text-lg font-medium mt-1">{value}</div>
          </div>
        ))}
      </div>
      {actionOutput && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Last action output</h3>
          <pre className="bg-black text-gray-100 font-mono text-xs rounded-md p-4 overflow-auto max-h-80 whitespace-pre-wrap">
            {actionOutput}
          </pre>
        </div>
      )}
    </div>
  );
}

function Logs({ name }: { name: string }) {
  const [logs, setLogs] = useState('');
  const [lines, setLines] = useState(200);
  const [auto, setAuto] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLPreElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${name}/logs?lines=${lines}`);
      const data = await res.json().catch(() => ({}));
      setLogs(data.logs ?? data.error ?? `HTTP ${res.status}`);
      requestAnimationFrame(() => {
        boxRef.current?.scrollTo(0, boxRef.current.scrollHeight);
      });
    } finally {
      setLoading(false);
    }
  }, [name, lines]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [auto, load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <select
            value={lines}
            onChange={(e) => setLines(Number(e.target.value))}
            className="border rounded-md px-2 py-1.5 text-sm"
          >
            {[100, 200, 500, 1000].map((n) => (
              <option key={n} value={n}>
                last {n} lines
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            auto-refresh
          </label>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
      {!logs && loading ? (
        <div className="border rounded-md p-4 h-[500px] space-y-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <Shimmer key={i} className={`h-3 ${i % 3 === 0 ? 'w-2/3' : i % 3 === 1 ? 'w-1/2' : 'w-5/6'}`} />
          ))}
        </div>
      ) : (
        <pre
          ref={boxRef}
          className="bg-black text-gray-100 font-mono text-xs rounded-md p-4 h-[500px] overflow-auto whitespace-pre-wrap"
        >
          {logs || 'No logs.'}
        </pre>
      )}
    </div>
  );
}

function EnvEditor({ name }: { name: string }) {
  const [vars, setVars] = useState<Array<{ key: string; value: string }>>([]);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [restart, setRestart] = useState(true);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${name}/env`);
    const data = await res.json().catch(() => ({}));
    if (res.ok) setVars(data.vars ?? []);
  }, [name]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(toSave: Array<{ key: string; value: string }>) {
    setBusy(true);
    setStatus('Saving…');
    try {
      const res = await fetch(`/api/projects/${name}/env`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vars: toSave, restart }),
      });
      const data = await res.json().catch(() => ({}));
      setStatus(res.ok ? 'Saved.' : (data.error ?? 'save failed'));
      if (res.ok) {
        setNewKey('');
        setNewValue('');
        load();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Values are written to the project&apos;s <code>.env</code> file on the phone.
      </p>

      {vars.map((v, i) => (
        <div key={v.key} className="flex items-center gap-2">
          <Input value={v.key} disabled className="w-56 font-mono text-sm" />
          <Input
            value={v.value}
            onChange={(e) =>
              setVars(vars.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
            }
            className="flex-1 font-mono text-sm"
          />
        </div>
      ))}

      <div className="flex items-center gap-2">
        <Input
          placeholder="NEW_KEY"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          className="w-56 font-mono text-sm"
        />
        <Input
          placeholder="value"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          className="flex-1 font-mono text-sm"
        />
      </div>

      <div className="flex items-center gap-4">
        <Button
          className="bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-gray-200"
          disabled={busy}
          onClick={() => {
            const toSave = [...vars];
            if (newKey) toSave.push({ key: newKey, value: newValue });
            if (toSave.length) save(toSave);
          }}
        >
          {busy ? 'Saving…' : 'Save changes'}
        </Button>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={restart}
            onChange={(e) => setRestart(e.target.checked)}
          />
          restart after save
        </label>
        {status && <span className="text-sm text-gray-600 dark:text-gray-400">{status}</span>}
      </div>
    </div>
  );
}
