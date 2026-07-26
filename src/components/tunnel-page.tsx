"use client";

import { useCallback, useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Cloud, ExternalLink, RefreshCw, Lock, Globe } from 'lucide-react';
import { humanUptime, StatusBadge } from './project-list';
import { StatCardsSkeleton, TableSkeleton } from './skeletons';

interface TunnelRoute {
  hostname: string;
  service: string;
}

interface TunnelState {
  daemon: { status: string; uptimeMs: number; restarts: number };
  routes: TunnelRoute[];
  domain: string;
}

export default function TunnelPage() {
  const [state, setState] = useState<TunnelState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [output, setOutput] = useState('');
  const [newName, setNewName] = useState('');
  const [newPort, setNewPort] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/tunnel');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState(await res.json());
      setError('');
    } catch (e) {
      setError(`could not load tunnel state: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  async function restartTunnel() {
    setBusy('restart');
    setOutput('Restarting cloudflared…');
    try {
      const res = await fetch('/api/tunnel/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restart' }),
      });
      const data = await res.json().catch(() => ({}));
      setOutput(data.output ?? data.error ?? `HTTP ${res.status}`);
      load();
    } finally {
      setBusy('');
    }
  }

  async function addRoute(e: React.FormEvent) {
    e.preventDefault();
    setBusy('add');
    setOutput('Creating DNS record and route…');
    try {
      const res = await fetch('/api/tunnel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, port: Number(newPort) }),
      });
      const data = await res.json().catch(() => ({}));
      setOutput(data.output ?? data.error ?? `HTTP ${res.status}`);
      if (res.ok) {
        setNewName('');
        setNewPort('');
        load();
      }
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Cloudflare Tunnel</h1>
        <Button variant="outline" disabled={!!busy} onClick={restartTunnel}>
          <RefreshCw className={`h-4 w-4 mr-2 ${busy === 'restart' ? 'animate-spin' : ''}`} />
          {busy === 'restart' ? 'Restarting…' : 'Restart tunnel'}
        </Button>
      </div>

      {/* Explainer */}
      <div className="border rounded-lg p-5 bg-gray-50 text-sm text-gray-700 space-y-2">
        <div className="flex items-center gap-2 font-medium text-gray-900">
          <Cloud size={16} />
          How this works
        </div>
        <p>
          <code>cloudflared</code> runs on the phone and keeps an <em>outbound</em> connection
          to Cloudflare — no ports are opened on the phone or your router. Each route below
          publishes one local port to the internet as{' '}
          <code>&lt;name&gt;.{state?.domain ?? 'bitroot.in'}</code> with automatic HTTPS.
        </p>
        <p className="flex items-center gap-1.5 text-amber-700">
          <Globe size={14} />
          Routes are <strong>publicly reachable</strong> — anything you expose here should have
          its own authentication (like this panel&apos;s password).
        </p>
        <p className="text-gray-500">
          A cron watchdog checks the tunnel every 3 minutes and restarts it if it goes dead.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {!state && !error && (
        <>
          <StatCardsSkeleton count={3} />
          <TableSkeleton rows={5} cols={2} />
        </>
      )}

      {/* Daemon status */}
      {state && (
        <div className="grid grid-cols-3 gap-4 max-w-lg">
          <div className="border rounded-lg p-4">
            <div className="text-xs uppercase text-gray-500 font-semibold">Daemon</div>
            <div className="mt-1">
              <StatusBadge status={state.daemon.status} />
            </div>
          </div>
          <div className="border rounded-lg p-4">
            <div className="text-xs uppercase text-gray-500 font-semibold">Uptime</div>
            <div className="text-lg font-medium mt-1">{humanUptime(state.daemon.uptimeMs)}</div>
          </div>
          <div className="border rounded-lg p-4">
            <div className="text-xs uppercase text-gray-500 font-semibold">Restarts</div>
            <div className="text-lg font-medium mt-1">{state.daemon.restarts}</div>
          </div>
        </div>
      )}

      {/* Routes */}
      {state && (
        <div>
          <h2 className="text-xl font-semibold mb-3">Public routes</h2>
          <div className="overflow-x-auto border rounded-lg">
            <table className="min-w-full">
              <thead>
                <tr className="text-left text-xs font-semibold text-gray-700 uppercase tracking-wide bg-gray-50">
                  <th className="px-4 py-3 whitespace-nowrap">Public URL</th>
                  <th className="px-4 py-3 whitespace-nowrap">Forwards to</th>
                </tr>
              </thead>
              <tbody>
                {state.routes.map((r) => (
                  <tr key={r.hostname} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap">
                      {r.service.startsWith('http://') ? (
                        <a
                          href={`https://${r.hostname}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-purple-600 hover:underline inline-flex items-center gap-1"
                        >
                          {r.hostname}
                          <ExternalLink size={12} />
                        </a>
                      ) : (
                        <span className="text-gray-800 inline-flex items-center gap-1">
                          <Lock size={12} className="text-gray-400" />
                          {r.hostname}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-sm text-gray-700">
                      {r.service}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add route */}
      <div className="max-w-md space-y-4">
        <h2 className="text-xl font-semibold">Add a route</h2>
        <form onSubmit={addRoute} className="space-y-3">
          <div className="flex items-end gap-2">
            <div className="flex flex-col flex-1">
              <Label htmlFor="tname">Subdomain</Label>
              <div className="flex items-center gap-1">
                <Input
                  id="tname"
                  placeholder="myapp"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value.toLowerCase())}
                  pattern="[a-z0-9-]{1,40}"
                  required
                />
                <span className="text-sm text-gray-500 whitespace-nowrap">
                  .{state?.domain ?? 'bitroot.in'}
                </span>
              </div>
            </div>
            <div className="flex flex-col w-28">
              <Label htmlFor="tport">Local port</Label>
              <Input
                id="tport"
                type="number"
                placeholder="3001"
                value={newPort}
                onChange={(e) => setNewPort(e.target.value)}
                min={1024}
                max={65535}
                required
              />
            </div>
          </div>
          <Button
            type="submit"
            className="bg-black text-white hover:bg-black/90"
            disabled={!!busy || !newName || !newPort}
          >
            {busy === 'add' ? 'Adding…' : 'Add route'}
          </Button>
        </form>
      </div>

      {output && (
        <pre className="bg-black text-gray-100 font-mono text-xs rounded-md p-4 overflow-auto max-h-72 whitespace-pre-wrap">
          {output}
        </pre>
      )}
    </div>
  );
}
