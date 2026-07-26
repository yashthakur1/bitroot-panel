"use client";

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Github, Link2, Lock, Globe, CheckCircle2 } from 'lucide-react';
import { Shimmer } from './skeletons';

interface Repo {
  fullName: string;
  private: boolean;
  defaultBranch: string;
  description?: string;
}

type Source = 'github' | 'url';

export default function NewProjectForm() {
  const [source, setSource] = useState<Source>('github');

  // GitHub connection
  const [ghLogin, setGhLogin] = useState<string | null>(null);
  const [ghChecked, setGhChecked] = useState(false);
  const [pat, setPat] = useState('');
  const [ghBusy, setGhBusy] = useState(false);
  const [ghError, setGhError] = useState('');

  // GitHub selection
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [repo, setRepo] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState('');

  // Common fields
  const [name, setName] = useState('');
  const [urlRepo, setUrlRepo] = useState('');
  const [port, setPort] = useState('');
  const [environment, setEnvironment] = useState<'public' | 'private'>('public');
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState('');
  const [done, setDone] = useState(false);

  const checkGithub = useCallback(async () => {
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
    checkGithub();
  }, [checkGithub]);

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
    if (!full) return;
    const r = repos?.find((x) => x.fullName === full);
    if (!name && r) setName(r.fullName.split('/')[1].toLowerCase().replace(/[^a-z0-9-]/g, '-'));
    const res = await fetch(`/api/github/branches?repo=${encodeURIComponent(full)}`);
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setBranches(data.branches);
      setBranch(data.defaultBranch);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setDone(false);
    setOutput('Cloning and setting up — this can take a few minutes…');
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          name,
          repo: source === 'github' ? repo : urlRepo,
          branch: source === 'github' ? branch : undefined,
          port: Number(port),
          environment,
        }),
      });
      const data = await res.json().catch(() => ({}));
      setOutput(data.output ?? data.error ?? `HTTP ${res.status}`);
      setDone(res.ok);
    } catch (err) {
      setOutput(`failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const ready =
    name && port && (source === 'github' ? repo && branch : urlRepo);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">New project</h1>
        <p className="text-gray-600 mt-2">
          Clone, install, run under pm2 — and optionally publish at{' '}
          <code>&lt;name&gt;.bitroot.in</code>.
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
            onClick={() => setSource(s)}
            className={`py-2 px-3 text-sm font-medium -mb-px inline-flex items-center gap-1.5 ${
              source === s
                ? 'text-purple-600 border-b-2 border-purple-600'
                : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {source === 'github' && !ghChecked && <Shimmer className="h-24 w-full" />}

      {source === 'github' && ghChecked && !ghLogin && (
        <form onSubmit={connectGithub} className="border rounded-lg p-5 space-y-3 bg-gray-50">
          <div className="font-medium flex items-center gap-2">
            <Github size={16} /> Connect GitHub
          </div>
          <p className="text-sm text-gray-600">
            Create a{' '}
            <a
              href="https://github.com/settings/personal-access-tokens/new"
              target="_blank"
              rel="noreferrer"
              className="text-purple-600 hover:underline"
            >
              fine-grained personal access token
            </a>{' '}
            with <strong>Contents: Read</strong> + <strong>Metadata: Read</strong> on the
            repos you want to deploy (or a classic token with <code>repo</code> scope).
            It is stored only on the phone.
          </p>
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder="github_pat_… or ghp_…"
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              className="font-mono text-sm flex-1"
            />
            <Button type="submit" disabled={ghBusy || !pat} className="bg-black text-white hover:bg-black/90">
              {ghBusy ? 'Connecting…' : 'Connect'}
            </Button>
          </div>
          {ghError && <p className="text-sm text-red-600">{ghError}</p>}
        </form>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {source === 'github' && ghLogin && (
          <>
            <div className="flex items-center justify-between text-sm border rounded-lg px-4 py-2.5 bg-gray-50">
              <span className="flex items-center gap-2 text-gray-700">
                <CheckCircle2 size={15} className="text-green-600" />
                Connected as <strong>{ghLogin}</strong>
              </span>
              <button
                type="button"
                className="text-gray-500 hover:text-red-600"
                onClick={async () => {
                  await fetch('/api/github', { method: 'DELETE' });
                  setGhLogin(null);
                  setRepos(null);
                }}
              >
                disconnect
              </button>
            </div>

            <div className="flex flex-col">
              <Label htmlFor="repo">Repository</Label>
              <select
                id="repo"
                value={repo}
                onChange={(e) => selectRepo(e.target.value)}
                className="border rounded-md px-3 py-2 text-sm bg-white"
                required
              >
                <option value="">— select a repository —</option>
                {(repos ?? []).map((r) => (
                  <option key={r.fullName} value={r.fullName}>
                    {r.fullName}
                    {r.private ? ' (private)' : ''}
                  </option>
                ))}
              </select>
            </div>

            {repo && (
              <div className="flex flex-col">
                <Label htmlFor="branch">Branch</Label>
                {branches.length === 0 ? (
                  <Shimmer className="h-9 w-48" />
                ) : (
                  <select
                    id="branch"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    className="border rounded-md px-3 py-2 text-sm bg-white w-64"
                  >
                    {branches.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                )}
                <span className="text-xs text-gray-500 mt-1">
                  future <code>project deploy</code> pulls the latest of this branch
                </span>
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
              onChange={(e) => setUrlRepo(e.target.value)}
              required={source === 'url'}
            />
          </div>
        )}

        <div className="flex gap-4">
          <div className="flex flex-col flex-1">
            <Label htmlFor="name">Project name</Label>
            <Input
              id="name"
              placeholder="my-api"
              value={name}
              onChange={(e) => setName(e.target.value)}
              pattern="[a-zA-Z0-9_-]{1,40}"
              required
            />
          </div>
          <div className="flex flex-col w-32">
            <Label htmlFor="port">Port</Label>
            <Input
              id="port"
              type="number"
              placeholder="3001"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              min={1024}
              max={65535}
              required
            />
          </div>
        </div>

        <div className="flex flex-col">
          <Label>Environment</Label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-1">
            <button
              type="button"
              onClick={() => setEnvironment('public')}
              className={`border rounded-lg p-4 text-left ${
                environment === 'public' ? 'border-purple-500 bg-purple-50' : 'hover:border-gray-300'
              }`}
            >
              <div className="font-medium flex items-center gap-2 text-sm">
                <Globe size={15} /> Public
              </div>
              <div className="text-xs text-gray-600 mt-1">
                Internet-facing at <code>{name || '<name>'}.bitroot.in</code> via Cloudflare
                Tunnel
              </div>
            </button>
            <button
              type="button"
              onClick={() => setEnvironment('private')}
              className={`border rounded-lg p-4 text-left ${
                environment === 'private' ? 'border-purple-500 bg-purple-50' : 'hover:border-gray-300'
              }`}
            >
              <div className="font-medium flex items-center gap-2 text-sm">
                <Lock size={15} /> Private
              </div>
              <div className="text-xs text-gray-600 mt-1">
                Tailscale/LAN only — no public route
              </div>
            </button>
          </div>
        </div>

        <Button
          type="submit"
          className="bg-black text-white hover:bg-black/90"
          disabled={busy || !ready}
        >
          {busy ? 'Creating…' : 'Create project'}
        </Button>
      </form>

      {output && (
        <pre className="bg-black text-gray-100 font-mono text-xs rounded-md p-4 overflow-auto max-h-96 whitespace-pre-wrap">
          {output}
        </pre>
      )}

      {done && (
        <Link href={`/dashboard/services/${name}`} className="text-purple-600 hover:underline">
          Go to {name} →
        </Link>
      )}
    </div>
  );
}
