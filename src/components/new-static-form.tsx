"use client";

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Github,
  Link2,
  Lock,
  Globe,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Check,
  Sparkles,
  ArrowRight,
  PanelsTopLeft,
} from 'lucide-react';
import { Shimmer } from './skeletons';
import RepoPicker from './repo-picker';

interface Repo {
  fullName: string;
  private: boolean;
  defaultBranch: string;
  connectionId?: string;
  connectionLabel?: string;
  pushedAt?: string;
}

interface Detection {
  framework: string;
  buildCmd: string;
  outDir: string;
  static: boolean;
  server: boolean;
  notes: string[];
  incompatible: Array<{ dep: string; why: string; fix: string }>;
  packageManager: string;
}

type Source = 'github' | 'url';
type Errors = Partial<Record<'repo' | 'urlRepo' | 'name' | 'port' | 'outDir', string>>;

// Framework presets — the two fields people always have to look up.
const PRESETS: Array<{ label: string; build: string; out: string }> = [
  { label: 'Vite', build: 'npm run build', out: 'dist' },
  { label: 'Next.js (export)', build: 'npm run build', out: 'out' },
  { label: 'Astro', build: 'npm run build', out: 'dist' },
  { label: 'Create React App', build: 'npm run build', out: 'build' },
  { label: 'Plain HTML', build: '', out: '.' },
];

function computeStage(text: string): number {
  const checkpoints: RegExp[] = [
    /=== creating static site/,
    /installing dependencies|building:|published .* from/,
    /published .* from/,
    /nginx reloaded|nginx restarted|nginx started/,
    /published at https|skipping tunnel route/,
    /=== setup complete/,
  ];
  let stage = 0;
  for (const cp of checkpoints) {
    if (cp.test(text)) stage += 1;
    else break;
  }
  return stage;
}

const STEPS = ['Clone repository', 'Install & build', 'Publish to nginx', 'Route', 'Live'];

function Timeline({
  stage,
  failed,
  done,
  isPublic,
  name,
}: {
  stage: number;
  failed: boolean;
  done: boolean;
  isPublic: boolean;
  name: string;
}) {
  return (
    <div className="fade-in-up border rounded-xl p-5">
      {STEPS.map((label, i) => {
        const activeAt = i + 1;
        const doneAt = i + 2;
        let state: 'pending' | 'active' | 'done' | 'failed';
        if (done && !failed) state = 'done';
        else if (stage >= doneAt) state = 'done';
        else if (stage >= activeAt) state = failed ? 'failed' : 'active';
        else state = 'pending';
        const last = i === STEPS.length - 1;
        return (
          <div key={label} className="flex gap-3">
            <div className="flex flex-col items-center">
              {state === 'done' ? (
                <CheckCircle2 size={18} className="text-green-600 pop-in" />
              ) : state === 'failed' ? (
                <AlertCircle size={18} className="text-red-500 pop-in" />
              ) : state === 'active' ? (
                <Loader2 size={18} className="animate-spin text-accent-600 dark:text-accent-400" />
              ) : (
                <div className="w-[18px] h-[18px] rounded-full border-2 border-gray-300 dark:border-gray-700" />
              )}
              {!last && (
                <div
                  className={`w-px flex-1 my-1 transition-colors ${
                    state === 'done' ? 'bg-green-300' : 'bg-gray-200 dark:bg-gray-700'
                  }`}
                />
              )}
            </div>
            <div className={`text-sm ${last ? '' : 'pb-5'}`}>
              <span
                className={
                  state === 'done'
                    ? 'text-gray-800 dark:text-gray-200'
                    : state === 'active'
                      ? 'text-gray-900 dark:text-gray-100 font-medium'
                      : state === 'failed'
                        ? 'text-red-600 dark:text-red-400 font-medium'
                        : 'text-gray-400'
                }
              >
                {label}
                {state === 'failed' && (
                  <span className="text-xs ml-2">failed — see log below</span>
                )}
              </span>
              {label === 'Route' && state !== 'pending' && (
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {isPublic ? `${name || '<name>'}.bitroot.in` : 'private — Tailscale only'}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function NewStaticForm({ initialEnv }: { initialEnv?: string }) {
  const [source, setSource] = useState<Source>('github');
  const [ghLogin, setGhLogin] = useState<string | null>(null);
  const [ghChecked, setGhChecked] = useState(false);
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [connectionId, setConnectionId] = useState('');
  const [detection, setDetection] = useState<Detection | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [urlRepo, setUrlRepo] = useState('');

  const [name, setName] = useState('');
  const [port, setPort] = useState('');
  const [buildCmd, setBuildCmd] = useState('npm run build');
  const [outDir, setOutDir] = useState('dist');
  const [environment, setEnvironment] = useState<'public' | 'private'>(
    initialEnv === 'private' ? 'private' : 'public',
  );

  const [taken, setTaken] = useState<{ names: string[]; ports: Record<number, string> }>({
    names: [],
    ports: {},
  });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [output, setOutput] = useState('');
  const [stage, setStage] = useState(0);
  const [failed, setFailed] = useState(false);
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);

  const loadGithub = useCallback(async () => {
    const res = await fetch('/api/github');
    const data = await res.json().catch(() => ({}));
    setGhLogin(data.connected ? data.login : null);
    setGhChecked(true);
    if (data.connected) {
      const rr = await fetch('/api/github/repos');
      const rd = await rr.json().catch(() => ({}));
      if (rr.ok) setRepos(rd.repos);
    }
  }, []);

  useEffect(() => {
    loadGithub();
    fetch('/api/projects')
      .then((r) => r.json())
      .then((d) =>
        setTaken({
          names: (d.projects ?? []).map((p: { name: string }) => p.name),
          ports: d.portsInUse ?? {},
        }),
      )
      .catch(() => {});
  }, [loadGithub]);

  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  async function selectRepo(full: string) {
    setRepo(full);
    setBranches([]);
    setBranch('');
    setErrors((e) => ({ ...e, repo: undefined }));
    if (!full) return;
    if (!name) setName(full.split('/')[1].toLowerCase().replace(/[^a-z0-9-]/g, '-'));
    const conn = repos?.find((x) => x.fullName === full)?.connectionId ?? '';
    setConnectionId(conn);
    const res = await fetch(
      `/api/github/branches?repo=${encodeURIComponent(full)}` +
        (conn ? `&connection=${encodeURIComponent(conn)}` : ''),
    );
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setBranches(data.branches);
      setBranch(data.defaultBranch);
      detect(full, data.defaultBranch, conn);
    }
  }

  // Ask the repository what it is, then fill in the two fields nobody
  // remembers: build command and output folder.
  const detect = useCallback(async (full: string, br: string, conn: string) => {
    setDetecting(true);
    setDetection(null);
    try {
      const res = await fetch(
        `/api/github/detect?repo=${encodeURIComponent(full)}&branch=${encodeURIComponent(br)}` +
          (conn ? `&connection=${encodeURIComponent(conn)}` : ''),
      );
      const d = await res.json().catch(() => null);
      if (res.ok && d) {
        setDetection(d);
        setBuildCmd(d.buildCmd);
        setOutDir(d.outDir);
      }
    } finally {
      setDetecting(false);
    }
  }, []);

  const portNum = Number(port);
  const portConflict = port ? taken.ports[portNum] : undefined;
  const nameConflict = name && taken.names.includes(name);

  function nextFreePort(start = 3400): number {
    let p = start;
    while (taken.ports[p]) p += 1;
    return p;
  }

  function validate(): Errors {
    const e: Errors = {};
    if (source === 'github' ? !repo : !urlRepo) {
      if (source === 'github') e.repo = 'Pick a repository';
      else e.urlRepo = 'A git repository URL is required';
    }
    if (!name) e.name = 'Give the site a name';
    else if (!/^[a-zA-Z0-9_-]{1,40}$/.test(name)) e.name = 'Letters, digits, dashes only';
    else if (nameConflict) e.name = `"${name}" already exists`;
    if (!port) e.port = 'A port is required — nginx serves each site on its own';
    else if (!(portNum >= 1024 && portNum <= 65535)) e.port = 'Use 1024-65535';
    else if (portConflict) e.port = `Taken by ${portConflict}`;
    if (!outDir) e.outDir = 'Which folder the build writes to';
    return e;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const errs = validate();
    if (Object.values(errs).some(Boolean)) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setBusy(true);
    setStarted(true);
    setDone(false);
    setFailed(false);
    setStage(0);
    setOutput('');
    try {
      const res = await fetch('/api/static', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          repo: source === 'github' ? repo : urlRepo,
          connectionId: source === 'github' ? connectionId : undefined,
          branch: source === 'github' ? branch : undefined,
          name,
          port: portNum,
          buildCmd,
          outDir,
          environment,
        }),
      });
      if (res.headers.get('content-type')?.includes('json')) {
        const data = await res.json().catch(() => ({}));
        setOutput(data.error ?? `HTTP ${res.status}`);
        setFailed(true);
        return;
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let full = '';
      for (;;) {
        const { done: eof, value } = await reader.read();
        if (eof) break;
        full += decoder.decode(value, { stream: true });
        setOutput(
          full
            .replaceAll('[[HB]]', '')
            .replace(/\n?\[\[EXIT:\d+\]\]/, '')
            .split('\n')
            .map((l) => l.split('\r').pop() ?? '')
            .join('\n'),
        );
        setStage(computeStage(full));
      }
      const ok = /\[\[EXIT:0\]\]/.test(full);
      setDone(ok);
      setFailed(!ok);
      if (ok) setStage(6);
    } catch (err) {
      setOutput((o) => `${o}\n(connection lost: ${(err as Error).message} — the build continues on the phone)`);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-display font-light tracking-tight flex items-center gap-3">
          <PanelsTopLeft size={24} className="text-gray-500 dark:text-gray-400" />
          New static site
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2" style={{ textWrap: 'pretty' }}>
          Builds your repo once and serves the output through nginx — no Node process, so it
          costs almost nothing to keep running.
        </p>
      </div>

      <div className="border-b dark:border-gray-800">
        {(
          [
            ['github', 'GitHub', <Github key="g" size={14} />],
            ['url', 'Git URL', <Link2 key="u" size={14} />],
          ] as Array<[Source, string, React.ReactNode]>
        ).map(([s, label, icon]) => (
          <button
            key={s}
            onClick={() => !busy && setSource(s)}
            className={`py-2 px-3 text-sm font-medium -mb-px inline-flex items-center gap-1.5 transition-colors ${
              source === s
                ? 'text-accent-600 dark:text-accent-400 border-b-2 border-accent-600'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
            }`}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {source === 'github' && !ghChecked && <Shimmer className="h-16 w-full" />}
      {source === 'github' && ghChecked && !ghLogin && (
        <p className="border rounded-lg p-4 text-sm text-gray-600 dark:text-gray-400">
          GitHub isn&apos;t connected yet —{' '}
          <Link href="/dashboard/new-service" className="text-accent-600 dark:text-accent-400 hover:underline">
            connect it on the New project page
          </Link>
          , or use the Git URL tab.
        </p>
      )}

      <form onSubmit={submit} noValidate>
        <fieldset disabled={busy} className="space-y-4 disabled:opacity-70 transition-opacity">
          {source === 'github' && ghLogin && (
            <>
              <div className="flex flex-col">
                <Label htmlFor="s-repo">Repository</Label>
                <RepoPicker
                  repos={repos}
                  value={repo}
                  onSelect={selectRepo}
                  error={Boolean(errors.repo)}
                />
                {errors.repo && (
                  <p className="fade-in-up flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400 mt-1.5">
                    <AlertCircle size={13} /> {errors.repo}
                  </p>
                )}
              </div>
              {repo && (
                <div className="flex flex-col fade-in-up">
                  <Label htmlFor="s-branch">Branch</Label>
                  {branches.length === 0 ? (
                    <Shimmer className="h-9 w-64" />
                  ) : (
                    <select
                      id="s-branch"
                      value={branch}
                      onChange={(e) => {
                        setBranch(e.target.value);
                        detect(repo, e.target.value, connectionId);
                      }}
                      className="border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 w-64"
                    >
                      {branches.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </>
          )}

          {source === 'url' && (
            <div className="flex flex-col">
              <Label htmlFor="s-url">Git repository URL</Label>
              <Input
                id="s-url"
                placeholder="https://github.com/you/site.git"
                value={urlRepo}
                onChange={(e) => setUrlRepo(e.target.value)}
                className={errors.urlRepo ? 'border-red-400' : ''}
              />
              {errors.urlRepo && (
                <p className="fade-in-up flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400 mt-1.5">
                  <AlertCircle size={13} /> {errors.urlRepo}
                </p>
              )}
            </div>
          )}

          {(detecting || detection) && (
            <div className="fade-in-up border rounded-xl p-4 space-y-2">
              {detecting ? (
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <Loader2 size={14} className="animate-spin" /> Inspecting the repository…
                </div>
              ) : detection ? (
                <>
                  <div className="flex items-center gap-2 text-sm flex-wrap">
                    <Sparkles size={14} className="text-accent-600 dark:text-accent-400" />
                    <span className="text-gray-700 dark:text-gray-300">Detected</span>
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {detection.framework}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      · {detection.packageManager}
                      {detection.buildCmd ? ` · ${detection.buildCmd}` : ' · no build step'}
                      {` · output ${detection.outDir}`}
                    </span>
                  </div>
                  {detection.server && (
                    <p className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-300" style={{ textWrap: 'pretty' }}>
                      <AlertCircle size={14} className="shrink-0 mt-0.5" />
                      <span>
                        {detection.notes[0] ??
                          'This project needs a running server, so a static site will not work.'}{' '}
                        <Link href="/dashboard/new-service" className="underline">
                          Create it as a project instead
                        </Link>
                        .
                      </span>
                    </p>
                  )}
                  {detection.incompatible?.length > 0 && (
                    <div className="fade-in-up border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 rounded-lg p-3 space-y-1.5">
                      <p className="flex items-center gap-1.5 text-sm font-medium text-amber-800 dark:text-amber-300">
                        <AlertCircle size={14} /> Will not build on this device
                      </p>
                      {detection.incompatible.map((c) => (
                        <p key={c.dep} className="text-xs text-amber-800 dark:text-amber-300" style={{ textWrap: 'pretty' }}>
                          <code>{c.dep}</code> — {c.why}. Fix: {c.fix}.
                        </p>
                      ))}
                      <p className="text-xs text-amber-700 dark:text-amber-400/80" style={{ textWrap: 'pretty' }}>
                        Android uses a different C library than desktop Linux, so these
                        packages have no binary that runs here. Alternatively build it
                        elsewhere and deploy the output.
                      </p>
                    </div>
                  )}
                  {!detection.server &&
                    detection.notes.map((n) => (
                      <p key={n} className="text-xs text-gray-500 dark:text-gray-400" style={{ textWrap: 'pretty' }}>
                        {n}
                      </p>
                    ))}
                </>
              ) : null}
            </div>
          )}

          {/* Framework presets */}
          <div className="flex flex-col">
            <Label>Framework preset</Label>
            <div className="flex gap-2 flex-wrap mt-1">
              {PRESETS.map((p) => {
                const active = buildCmd === p.build && outDir === p.out;
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => {
                      setBuildCmd(p.build);
                      setOutDir(p.out);
                    }}
                    className={`text-xs px-2.5 py-1.5 rounded-full border transition-[background-color,border-color,scale] active:scale-[0.96] ${
                      active
                        ? 'border-accent-500 bg-accent-50 dark:bg-accent-950/40 text-accent-700 dark:text-accent-300'
                        : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex gap-4 flex-wrap">
            <div className="flex flex-col flex-1 min-w-52">
              <Label htmlFor="s-build">Build command</Label>
              <Input
                id="s-build"
                placeholder="npm run build (blank = no build)"
                value={buildCmd}
                onChange={(e) => setBuildCmd(e.target.value)}
                className="font-mono text-sm"
              />
            </div>
            <div className="flex flex-col w-36">
              <Label htmlFor="s-out">Output folder</Label>
              <Input
                id="s-out"
                placeholder="dist"
                value={outDir}
                onChange={(e) => setOutDir(e.target.value)}
                className={`font-mono text-sm ${errors.outDir ? 'border-red-400' : ''}`}
              />
            </div>
          </div>

          <div className="flex gap-4 items-start">
            <div className="flex flex-col flex-1">
              <Label htmlFor="s-name">Site name</Label>
              <Input
                id="s-name"
                placeholder="my-site"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={errors.name ? 'border-red-400' : ''}
              />
              {errors.name && (
                <p className="fade-in-up flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400 mt-1.5">
                  <AlertCircle size={13} /> {errors.name}
                </p>
              )}
            </div>
            <div className="flex flex-col w-40">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="s-port">Port</Label>
                <button
                  type="button"
                  className="text-xs text-accent-600 dark:text-accent-400 hover:text-accent-800 inline-flex items-center gap-0.5 py-1"
                  onClick={() => setPort(String(nextFreePort()))}
                >
                  <Sparkles size={11} /> suggest
                </button>
              </div>
              <Input
                id="s-port"
                type="number"
                placeholder="3400"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className={`tabular-nums ${errors.port || portConflict ? 'border-red-400' : ''}`}
              />
              {errors.port ? (
                <p className="fade-in-up flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400 mt-1.5">
                  <AlertCircle size={13} /> {errors.port}
                </p>
              ) : portConflict ? (
                <p className="fade-in-up text-sm text-red-600 dark:text-red-400 mt-1.5">
                  taken by {portConflict}
                </p>
              ) : port ? (
                <p className="fade-in-up flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400 mt-1.5">
                  <Check size={12} /> port is free
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col">
            <Label>Environment</Label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-1">
              <button
                type="button"
                onClick={() => setEnvironment('public')}
                className={`border rounded-xl p-4 text-left transition-[border-color,background-color,scale] active:scale-[0.98] ${
                  environment === 'public'
                    ? 'border-accent-500 bg-accent-50 dark:bg-accent-950/40'
                    : 'hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                <div className="font-medium flex items-center gap-2 text-sm">
                  <Globe size={15} /> Public
                  {environment === 'public' && (
                    <Check size={14} className="text-accent-600 ml-auto pop-in" />
                  )}
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  <code>{name || '<name>'}.bitroot.in</code> via Cloudflare Tunnel
                </div>
              </button>
              <button
                type="button"
                onClick={() => setEnvironment('private')}
                className={`border rounded-xl p-4 text-left transition-[border-color,background-color,scale] active:scale-[0.98] ${
                  environment === 'private'
                    ? 'border-accent-500 bg-accent-50 dark:bg-accent-950/40'
                    : 'hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                <div className="font-medium flex items-center gap-2 text-sm">
                  <Lock size={15} /> Private
                  {environment === 'private' && (
                    <Check size={14} className="text-accent-600 ml-auto pop-in" />
                  )}
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  Tailscale/LAN only — no public route
                </div>
              </button>
            </div>
          </div>
        </fieldset>

        <div className="mt-5 flex items-center gap-3">
          <Button type="submit" disabled={busy} className="min-w-40">
            {busy ? (
              <>
                <Loader2 size={14} className="animate-spin mr-2" />
                Building… <span className="tabular-nums ml-1">{elapsed}s</span>
              </>
            ) : done ? (
              <>
                <Check size={14} className="mr-1.5 pop-in" /> Created
              </>
            ) : (
              'Create static site'
            )}
          </Button>
          {done && (
            <Link
              href="/dashboard"
              className="fade-in-up text-accent-600 dark:text-accent-400 hover:underline inline-flex items-center gap-1 text-sm py-2"
            >
              Back to overview <ArrowRight size={14} />
            </Link>
          )}
        </div>
      </form>

      {started && (
        <Timeline
          stage={stage}
          failed={failed}
          done={done}
          isPublic={environment === 'public'}
          name={name}
        />
      )}

      {output && (
        <details className="fade-in-up" open={failed}>
          <summary className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 cursor-pointer select-none py-1">
            {failed ? 'error log' : 'view build log'}
          </summary>
          <pre className="mt-2 bg-black text-gray-100 font-mono text-xs rounded-md p-4 overflow-auto max-h-96 whitespace-pre-wrap">
            {output}
          </pre>
        </details>
      )}
    </div>
  );
}
