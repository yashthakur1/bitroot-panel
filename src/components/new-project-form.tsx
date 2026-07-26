"use client";

import { useState } from 'react';
import Link from 'next/link';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

export default function NewProjectForm() {
  const [name, setName] = useState('');
  const [repo, setRepo] = useState('');
  const [port, setPort] = useState('');
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState('');
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setDone(false);
    setOutput('Cloning and setting up — this can take a few minutes…');
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, repo, port: Number(port) }),
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

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">New project</h1>
        <p className="text-gray-600 mt-2">
          Runs <code>project clone</code> on the phone: clones the repo, installs
          dependencies, starts it under pm2, and adds a tunnel route at{' '}
          <code>&lt;name&gt;.bitroot.in</code>.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex flex-col">
          <Label htmlFor="name">Project name</Label>
          <Input
            id="name"
            placeholder="my-api"
            value={name}
            onChange={(e) => setName(e.target.value)}
            pattern="[a-zA-Z0-9_-]{1,40}"
            required
          />
          <span className="text-xs text-gray-500 mt-1">
            letters, digits, dashes — becomes the pm2 name and subdomain
          </span>
        </div>

        <div className="flex flex-col">
          <Label htmlFor="repo">Git repository URL</Label>
          <Input
            id="repo"
            placeholder="https://github.com/you/my-api.git"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            required
          />
        </div>

        <div className="flex flex-col">
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
          <span className="text-xs text-gray-500 mt-1">
            3000-3099 APIs · 3100-3199 frontends · 3200-3299 tools (see ports.conf)
          </span>
        </div>

        <Button
          type="submit"
          className="bg-black text-white hover:bg-black/90"
          disabled={busy || !name || !repo || !port}
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
