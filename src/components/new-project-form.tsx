"use client";

// Zone comes from the environment so a checkout is not tied to one person's
// infrastructure. NEXT_PUBLIC_ because this renders in the browser.
const DOMAIN_SUFFIX = process.env.NEXT_PUBLIC_DOMAIN_SUFFIX ?? 'example.com';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  description?: string;
}

interface Detection {
  framework: string;
  buildCmd: string;
  outDir: string;
  hasStart: boolean;
  static: boolean;
  server: boolean;
  notes: string[];
  incompatible: Array<{ dep: string; why: string; fix: string }>;
  packageManager: string;
}

type Source = 'github' | 'url';
type Errors = Partial<Record<'repo' | 'branch' | 'urlRepo' | 'name' | 'port', string>>;

// Progress checkpoints matched against the server's live `project clone` output.
// The number of matched checkpoints drives the step timeline.
function computeStage(text: string, isPublic: boolean): number {
  const checkpoints: RegExp[] = [
    /=== cloning/,
    /cloned to |already exists — skipping clone/,
    /registered in ecosystem|already in ecosystem/,
    /PM2: started/,
    isPublic
      ? /cloudflared reloaded|tunnel route .* already exists/
      : /skipping tunnel route/,
    /=== setup complete/,
  ];
  let stage = 0;
  for (const cp of checkpoints) {
    if (cp.test(text)) stage += 1;
    else break;
  }
  return stage;
}

type StepState = 'pending' | 'active' | 'done' | 'failed' | 'skipped';

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') return <CheckCircle2 size={18} className="text-green-600 pop-in" />;
  if (state === 'failed') return <AlertCircle size={18} className="text-red-500 pop-in" />;
  if (state === 'active')
    return <Loader2 size={18} className="animate-spin text-accent-600 dark:text-accent-400" />;
  if (state === 'skipped')
    return <div className="w-[18px] h-[18px] rounded-full border-2 border-gray-200 dark:border-gray-800 border-dashed" />;
  return <div className="w-[18px] h-[18px] rounded-full border-2 border-gray-300 dark:border-gray-700" />;
}

function Timeline({
  stage,
  isPublic,
  failed,
  finished,
  name,
}: {
  stage: number;
  isPublic: boolean;
  failed: boolean;
  finished: boolean;
  name: string;
}) {
  const steps: Array<{ label: string; a: number; d: number; detail?: React.ReactNode; skip?: boolean }> = [
    { label: 'Clone repository', a: 1, d: 2 },
    { label: 'Install dependencies', a: 2, d: 3 },
    { label: 'Start under pm2', a: 3, d: 4 },
    isPublic
      ? {
          label: 'Publish tunnel route',
          a: 4,
          d: 5,
          detail: (
            <code className="text-xs text-gray-500 dark:text-gray-400">{name || '<name>'}.{DOMAIN_SUFFIX}</code>
          ),
        }
      : { label: 'Tunnel route', a: 4, d: 5, skip: true },
    { label: 'Live', a: 5, d: 6 },
  ];

  return (
    <div className="fade-in-up border rounded-xl p-5">
      {steps.map((s, i) => {
        let state: StepState;
        if (s.skip) state = 'skipped';
        else if (finished && !failed) state = 'done';
        else if (stage >= s.d) state = 'done';
        else if (stage >= s.a) state = failed ? 'failed' : 'active';
        else state = 'pending';
        const last = i === steps.length - 1;
        return (
          <div key={s.label} className="flex gap-3">
            <div className="flex flex-col items-center">
              <StepIcon state={state} />
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
                {s.label}
                {state === 'skipped' && (
                  <span className="text-xs text-gray-400 ml-2">skipped — private</span>
                )}
                {state === 'failed' && (
                  <span className="text-xs ml-2">failed — see log below</span>
                )}
              </span>
              {s.detail && state !== 'pending' && <div>{s.detail}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return (
    <p className="fade-in-up flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400 mt-1.5">
      <AlertCircle size={13} className="shrink-0" />
      {msg}
    </p>
  );
}

function FieldOk({ msg }: { msg: string }) {
  return (
    <p className="fade-in-up flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400 mt-1.5">
      <Check size={12} className="shrink-0" />
      {msg}
    </p>
  );
}

export default function NewProjectForm({ initialEnv }: { initialEnv?: string }) {
  const [source, setSource] = useState<Source>('github');

  // GitHub connection
  const [ghLogin, setGhLogin] = useState<string | null>(null);
  const [ghAvatar, setGhAvatar] = useState<string | null>(null);
  const [ghProfile, setGhProfile] = useState<string>('');
  const [ghChecked, setGhChecked] = useState(false);
  const [pat, setPat] = useState('');
  const [ghBusy, setGhBusy] = useState(false);
  const [ghError, setGhError] = useState('');

  // GitHub selection
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [repo, setRepo] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [connectionId, setConnectionId] = useState('');
  const [detection, setDetection] = useState<Detection | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [branch, setBranch] = useState('');

  // Common fields
  const [name, setName] = useState('');
  const [urlRepo, setUrlRepo] = useState('');
  const [port, setPort] = useState('');
  const [environment, setEnvironment] = useState<'public' | 'private'>(
    initialEnv === 'private' ? 'private' : 'public',
  );

  // Existing projects, for live conflict checks
  const [taken, setTaken] = useState<{ names: string[]; ports: Record<number, string> }>({
    names: [],
    ports: {},
  });

  // Submit lifecycle
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [output, setOutput] = useState('');
  const [done, setDone] = useState(false);
  const [stage, setStage] = useState(0);
  const [failed, setFailed] = useState(false);
  const [started, setStarted] = useState(false);
  const [lostConnection, setLostConnection] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);

  const checkGithub = useCallback(async () => {
    const res = await fetch('/api/github');
    const data = await res.json().catch(() => ({}));
    setGhLogin(data.connected ? data.login : null);
    setGhAvatar(data.connected ? (data.avatarUrl ?? null) : null);
    setGhProfile(data.profileUrl ?? '');
    setGhChecked(true);
    if (data.connected) {
      const rr = await fetch('/api/github/repos');
      const rd = await rr.json().catch(() => ({}));
      if (rr.ok) setRepos(rd.repos);
    }
  }, []);

  useEffect(() => {
    checkGithub();
    // load existing names + every occupied port (registry, tunnel routes,
    // pm2 apps, listening sockets) for live validation
    fetch('/api/projects')
      .then((r) => r.json())
      .then((d) => {
        const names: string[] = (d.projects ?? []).map((p: { name: string }) => p.name);
        const ports: Record<number, string> = d.portsInUse ?? {};
        setTaken({ names, ports });
      })
      .catch(() => {});
  }, [checkGithub]);

  // elapsed timer while creating
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  useEffect(() => {
    outputRef.current?.scrollTo(0, outputRef.current.scrollHeight);
  }, [output]);

  function clearError(field: keyof Errors) {
    setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));
  }

  const portNum = Number(port);
  const portConflict = port && taken.ports[portNum];
  const portValid = port && portNum >= 1024 && portNum <= 65535 && !portConflict;
  const nameConflict = name && taken.names.includes(name);
  const nameValid = name && /^[a-zA-Z0-9_-]{1,40}$/.test(name) && !nameConflict;

  function nextFreePort(start = 3000): number {
    let p = start;
    while (taken.ports[p]) p += 1;
    return p;
  }

  function validate(): Errors {
    const errs: Errors = {};
    if (source === 'github') {
      if (!repo) errs.repo = 'Pick a repository to deploy';
      else if (!branch) errs.branch = 'Pick a branch';
    } else if (!urlRepo) {
      errs.urlRepo = 'A git repository URL is required';
    }
    if (!name) errs.name = 'Give the project a name';
    else if (!/^[a-zA-Z0-9_-]{1,40}$/.test(name))
      errs.name = 'Only letters, digits, dashes and underscores';
    else if (nameConflict) errs.name = `"${name}" already exists on the server`;
    if (!port) errs.port = 'A port is required — every app gets its own';
    else if (!(portNum >= 1024 && portNum <= 65535)) errs.port = 'Use a port between 1024 and 65535';
    else if (portConflict) errs.port = `Port ${port} is taken by ${portConflict}`;
    return errs;
  }

  async function connectGithub(e: React.FormEvent) {
    e.preventDefault();
    setGhBusy(true);
    setGhError('');
    try {
      const res = await fetch('/api/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: pat }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPat('');
      checkGithub();
    } catch (err) {
      setGhError((err as Error).message);
    } finally {
      setGhBusy(false);
    }
  }

  async function selectRepo(full: string) {
    setRepo(full);
    setBranches([]);
    setBranch('');
    clearError('repo');
    if (!full) return;
    const r = repos?.find((x) => x.fullName === full);
    if (!name && r) {
      setName(r.fullName.split('/')[1].toLowerCase().replace(/[^a-z0-9-]/g, '-'));
      clearError('name');
    }
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
      clearError('branch');
      detect(full, data.defaultBranch, conn);
    }
  }

  // Inspect the repository so the form can say what it found — and warn when a
  // repo has no way to start a process.
  const detect = useCallback(async (full: string, br: string, conn: string) => {
    setDetecting(true);
    setDetection(null);
    try {
      const res = await fetch(
        `/api/github/detect?repo=${encodeURIComponent(full)}&branch=${encodeURIComponent(br)}` +
          (conn ? `&connection=${encodeURIComponent(conn)}` : ''),
      );
      const d = await res.json().catch(() => null);
      if (res.ok && d) setDetection(d);
    } finally {
      setDetecting(false);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.values(errs).some(Boolean)) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setBusy(true);
    setDone(false);
    setFailed(false);
    setStage(0);
    setStarted(true);
    setOutput('');
    const isPublic = environment === 'public';
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          name,
          repo: source === 'github' ? repo : urlRepo,
          connectionId: source === 'github' ? connectionId : undefined,
          branch: source === 'github' ? branch : undefined,
          port: portNum,
          environment,
        }),
      });

      // Validation errors come back as JSON; success streams plain text.
      if (res.headers.get('content-type')?.includes('json')) {
        const data = await res.json().catch(() => ({}));
        setOutput(data.error ?? `HTTP ${res.status}`);
        setFailed(true);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let full = '';
      const display = (raw: string) =>
        raw
          .replaceAll('[[HB]]', '') // server heartbeats, not real output
          .replace(/\n?\[\[EXIT:\d+\]\]/, '')
          .split('\n')
          .map((l) => l.split('\r').pop() ?? '') // keep last progress frame per line
          .join('\n');
      for (;;) {
        const { done: eof, value } = await reader.read();
        if (eof) break;
        full += decoder.decode(value, { stream: true });
        setOutput(display(full));
        setStage(computeStage(full, isPublic));
      }
      const ok = /\[\[EXIT:0\]\]/.test(full);
      setDone(ok);
      setFailed(!ok);
      if (ok) setStage(6);
    } catch (err) {
      // Stream broke mid-flight. The server keeps running the deploy —
      // say so honestly instead of pretending it failed.
      setLostConnection(true);
      setOutput((o) => `${o}\n(connection lost: ${(err as Error).message})`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-display font-light tracking-tight" style={{ textWrap: 'balance' }}>
          New project
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Clone, install, run under pm2 — and optionally publish at{' '}
          <code>&lt;name&gt;.{DOMAIN_SUFFIX}</code>.
        </p>
      </div>

      {/* Source tabs */}
      <div className="border-b">
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

      {source === 'github' && !ghChecked && <Shimmer className="h-24 w-full" />}

      {source === 'github' && ghChecked && !ghLogin && (
        <form onSubmit={connectGithub} className="fade-in-up border rounded-xl p-5 space-y-3 bg-gray-50 dark:bg-gray-800/60">
          <div className="font-medium flex items-center gap-2">
            <Github size={16} /> Connect GitHub
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400" style={{ textWrap: 'pretty' }}>
            Manage accounts on the{' '}
            <Link href="/dashboard/git" className="text-accent-600 dark:text-accent-400 hover:underline">
              Git connections
            </Link>{' '}
            page, or paste one here. Create a{' '}
            <a
              href="https://github.com/settings/personal-access-tokens/new"
              target="_blank"
              rel="noreferrer"
              className="text-accent-600 dark:text-accent-400 hover:underline"
            >
              fine-grained personal access token
            </a>{' '}
            with <strong>Contents: Read</strong> + <strong>Metadata: Read</strong> on the
            repos you want to deploy (or a classic token with <code>repo</code> scope).
            It is stored only on the server.
          </p>
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder="github_pat_… or ghp_…"
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              className="font-mono text-sm flex-1"
            />
            <Button type="submit" disabled={ghBusy || !pat}>
              {ghBusy ? (
                <>
                  <Loader2 size={14} className="animate-spin mr-1.5" /> Connecting…
                </>
              ) : (
                'Connect'
              )}
            </Button>
          </div>
          {ghError && <FieldError msg={ghError} />}
        </form>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <fieldset disabled={busy} className="space-y-4 disabled:opacity-70 transition-opacity">
          {source === 'github' && ghLogin && (
            <>
              <div className="fade-in-up flex items-center justify-between text-sm border rounded-lg px-4 py-2.5 bg-gray-50 dark:bg-gray-800/60">
                <span className="flex items-center gap-2.5 text-gray-700 dark:text-gray-300">
                  <Github size={16} className="text-gray-800 dark:text-gray-200 shrink-0" />
                  {ghAvatar && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={ghAvatar}
                      alt=""
                      width={20}
                      height={20}
                      className="w-5 h-5 rounded-full outline outline-1 outline-black/10 dark:outline-white/10 pop-in"
                    />
                  )}
                  <span>
                    Connected as{' '}
                    <a
                      href={ghProfile || `https://github.com/${ghLogin}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-gray-900 dark:text-gray-100 hover:underline underline-offset-2"
                    >
                      {ghLogin}
                    </a>
                  </span>
                  <CheckCircle2 size={14} className="text-green-600 dark:text-green-500 shrink-0" />
                </span>
                <button
                  type="button"
                  className="text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors py-2 px-2 -mr-2"
                  onClick={async () => {
                    await fetch('/api/github', { method: 'DELETE' });
                    setGhLogin(null);
                    setGhAvatar(null);
                    setRepos(null);
                  }}
                >
                  disconnect
                </button>
              </div>

              <div className="flex flex-col">
                <Label htmlFor="repo">Repository</Label>
                <RepoPicker
                  repos={repos}
                  value={repo}
                  onSelect={selectRepo}
                  error={Boolean(errors.repo)}
                />
                <FieldError msg={errors.repo} />
              </div>

              {repo && (
                <div className="flex flex-col fade-in-up">
                  <Label htmlFor="branch">Branch</Label>
                  {branches.length === 0 ? (
                    <Shimmer className="h-9 w-64" />
                  ) : (
                    <select
                      id="branch"
                      value={branch}
                      onChange={(e) => {
                        setBranch(e.target.value);
                        clearError('branch');
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
                  <span className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    future <code>project deploy</code> pulls the latest of this branch
                  </span>
                  {(detecting || detection) && (
                    <div className="fade-in-up mt-3 border rounded-xl p-4 space-y-2">
                      {detecting ? (
                        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                          <Loader2 size={14} className="animate-spin" /> Inspecting the
                          repository…
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
                              {detection.buildCmd
                                ? ` · builds with ${detection.buildCmd}`
                                : ' · no build step'}
                            </span>
                          </div>
                          {!detection.hasStart && (
                            <p className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-300" style={{ textWrap: 'pretty' }}>
                              <AlertCircle size={14} className="shrink-0 mt-0.5" />
                              <span>
                                No <code>start</code> script, so pm2 has nothing to run.
                                {detection.static && (
                                  <>
                                    {' '}
                                    This looks like a static site —{' '}
                                    <Link href="/dashboard/new-static" className="underline">
                                      create it as a static site
                                    </Link>{' '}
                                    to serve it through nginx with no Node process.
                                  </>
                                )}
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
                          {detection.hasStart &&
                            detection.notes.map((n) => (
                              <p key={n} className="text-xs text-gray-500 dark:text-gray-400" style={{ textWrap: 'pretty' }}>
                                {n}
                              </p>
                            ))}
                        </>
                      ) : null}
                    </div>
                  )}
                  <FieldError msg={errors.branch} />
                </div>
              )}
            </>
          )}

          {source === 'url' && (
            <div className="flex flex-col">
              <Label htmlFor="urlrepo">Git repository URL</Label>
              <Input
                id="urlrepo"
                placeholder="https://github.com/you/my-api.git"
                value={urlRepo}
                onChange={(e) => {
                  setUrlRepo(e.target.value);
                  clearError('urlRepo');
                }}
                className={errors.urlRepo ? 'border-red-400 dark:border-red-700' : ''}
              />
              <FieldError msg={errors.urlRepo} />
            </div>
          )}

          <div className="flex gap-4 items-start">
            <div className="flex flex-col flex-1">
              <Label htmlFor="name">Project name</Label>
              <Input
                id="name"
                placeholder="my-api"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  clearError('name');
                }}
                className={errors.name ? 'border-red-400 dark:border-red-700' : ''}
              />
              {errors.name ? (
                <FieldError msg={errors.name} />
              ) : nameConflict ? (
                <FieldError msg={`"${name}" already exists on the server`} />
              ) : nameValid ? (
                <FieldOk msg={environment === 'public' ? `${name}.${DOMAIN_SUFFIX}` : 'name is free'} />
              ) : null}
            </div>
            <div className="flex flex-col w-40">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="port">Port</Label>
                <button
                  type="button"
                  className="text-xs text-accent-600 dark:text-accent-400 hover:text-accent-800 dark:hover:text-accent-300 transition-colors inline-flex items-center gap-0.5 py-1"
                  onClick={() => {
                    setPort(String(nextFreePort()));
                    clearError('port');
                  }}
                >
                  <Sparkles size={11} /> suggest
                </button>
              </div>
              <Input
                id="port"
                type="number"
                placeholder="3001"
                value={port}
                onChange={(e) => {
                  setPort(e.target.value);
                  clearError('port');
                }}
                min={1024}
                max={65535}
                className={`tabular-nums ${errors.port || portConflict ? 'border-red-400 dark:border-red-700' : ''}`}
              />
              {errors.port ? (
                <FieldError msg={errors.port} />
              ) : portConflict ? (
                <FieldError msg={`taken by ${portConflict}`} />
              ) : portValid ? (
                <FieldOk msg="port is free" />
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
                    <Check size={14} className="text-accent-600 dark:text-accent-400 ml-auto pop-in" />
                  )}
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  Internet-facing at <code>{name || '<name>'}.{DOMAIN_SUFFIX}</code> via Cloudflare
                  Tunnel
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
                    <Check size={14} className="text-accent-600 dark:text-accent-400 ml-auto pop-in" />
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
                Creating… <span className="tabular-nums ml-1">{elapsed}s</span>
              </>
            ) : done ? (
              <>
                <Check size={14} className="mr-1.5 pop-in" /> Created
              </>
            ) : (
              'Create project'
            )}
          </Button>
          {done && (
            <Link
              href={`/dashboard/services/${name}`}
              className="fade-in-up text-accent-600 dark:text-accent-400 hover:underline inline-flex items-center gap-1 text-sm py-2"
            >
              Go to {name} <ArrowRight size={14} />
            </Link>
          )}
        </div>
      </form>

      {started && (
        <Timeline
          stage={stage}
          isPublic={environment === 'public'}
          failed={failed}
          finished={done}
          name={name}
        />
      )}

      {lostConnection && (
        <div className="fade-in-up border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 rounded-xl p-4 flex items-start gap-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <div style={{ textWrap: 'pretty' }}>
            <strong>Connection to the panel dropped — the deployment is still running on
            the server.</strong>{' '}
            Give it a few minutes, then check the{' '}
            <Link href="/dashboard" className="underline">
              projects list
            </Link>
            : if <code>{name}</code> appears there as online, it succeeded.
          </div>
        </div>
      )}

      {output && (
        <details className="fade-in-up" open={failed}>
          <summary className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 cursor-pointer select-none transition-colors py-1">
            {failed ? 'error log' : 'view live log'}
          </summary>
          <pre
            ref={outputRef}
            className="mt-2 bg-black text-gray-100 font-mono text-xs rounded-md p-4 overflow-auto max-h-96 whitespace-pre-wrap"
          >
            {output}
          </pre>
        </details>
      )}
    </div>
  );
}
