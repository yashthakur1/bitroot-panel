"use client";

import { useCallback, useEffect, useState } from 'react';
import { useLivePoll } from '@/lib/use-poll';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Cloud,
  ExternalLink,
  RefreshCw,
  Lock,
  Globe,
  Loader2,
  Trash2,
  Shield,
} from 'lucide-react';
import { humanUptime, StatusBadge } from './project-list';
import { StatCardsSkeleton, TableSkeleton } from './skeletons';

interface TunnelRoute {
  hostname: string;
  service: string;
  port: number | null;
  attachedTo: string | null;
}

interface Service {
  name: string;
  port: number;
}

interface TunnelState {
  daemon: { status: string; uptimeMs: number; restarts: number };
  routes: TunnelRoute[];
  services: Service[];
  domain: string;
  tailscale: { host: string; ip: string };
}

export default function TunnelPage() {
  const [state, setState] = useState<TunnelState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [output, setOutput] = useState('');
  const [newName, setNewName] = useState('');
  const [newPort, setNewPort] = useState('');
  const [attachTo, setAttachTo] = useState('');
  const [confirmDelete, setConfirmDelete] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/tunnel');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState(await res.json());
      setError('');
    } catch (e) {
      setError(`could not load routing state: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useLivePoll(load, { activeMs: 10000 });

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

  // Selecting a service fills in both the port and a sensible subdomain.
  function pickService(name: string) {
    setAttachTo(name);
    const svc = state?.services.find((s) => s.name === name);
    if (svc) {
      setNewPort(String(svc.port));
      if (!newName) setNewName(svc.name.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
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
        setAttachTo('');
        load();
      }
    } finally {
      setBusy('');
    }
  }

  async function removeRoute(hostname: string) {
    const name = hostname.split('.')[0];
    setBusy(`del-${hostname}`);
    setConfirmDelete('');
    setOutput(`Detaching ${hostname}…`);
    try {
      const res = await fetch(`/api/tunnel?name=${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      setOutput(data.output ?? data.error ?? `HTTP ${res.status}`);
      load();
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-display font-light tracking-tight">Routes</h1>
        <Button variant="outline" disabled={!!busy} onClick={restartTunnel}>
          <RefreshCw className={`h-4 w-4 mr-2 ${busy === 'restart' ? 'animate-spin' : ''}`} />
          {busy === 'restart' ? 'Restarting…' : 'Restart tunnel'}
        </Button>
      </div>

      {/* Explainer */}
      <div className="border rounded-lg p-5 bg-gray-50 dark:bg-gray-800/60 text-sm text-gray-700 dark:text-gray-300 space-y-2">
        <div className="flex items-center gap-2 font-medium text-gray-900 dark:text-gray-100">
          <Cloud size={16} />
          Two ways in
        </div>
        <p style={{ textWrap: 'pretty' }}>
          <strong>Public routes</strong> go through <code>cloudflared</code>, which holds an
          outbound connection to Cloudflare — no ports opened on the phone or your router,
          automatic HTTPS. <strong>Private access</strong> needs no route at all: anything
          listening on the phone is already reachable from your Tailscale devices.
        </p>
        <p className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
          <Globe size={14} />
          Public routes are reachable by anyone — put auth in front (the app&apos;s own, or
          Cloudflare Access).
        </p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!state && !error && (
        <>
          <StatCardsSkeleton count={3} />
          <TableSkeleton rows={5} cols={3} />
        </>
      )}

      {state && (
        <>
          {/* Daemon status */}
          <div className="grid grid-cols-3 gap-4 max-w-lg">
            <div className="border rounded-lg p-4">
              <div className="text-xs uppercase text-gray-500 dark:text-gray-400 font-semibold">
                Tunnel
              </div>
              <div className="mt-1">
                <StatusBadge status={state.daemon.status} />
              </div>
            </div>
            <div className="border rounded-lg p-4">
              <div className="text-xs uppercase text-gray-500 dark:text-gray-400 font-semibold">
                Uptime
              </div>
              <div className="text-lg font-medium mt-1 tabular-nums">
                {humanUptime(state.daemon.uptimeMs)}
              </div>
            </div>
            <div className="border rounded-lg p-4">
              <div className="text-xs uppercase text-gray-500 dark:text-gray-400 font-semibold">
                Restarts
              </div>
              <div className="text-lg font-medium mt-1 tabular-nums">
                {state.daemon.restarts}
              </div>
            </div>
          </div>

          {/* Public routes */}
          <div>
            <h2 className="text-xl font-display font-medium mb-3 flex items-center gap-2">
              <Globe size={18} className="text-gray-500 dark:text-gray-400" />
              Public routes
            </h2>
            <div className="overflow-x-auto border rounded-lg">
              <table className="min-w-full">
                <thead>
                  <tr className="text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide bg-gray-50 dark:bg-gray-800/60">
                    <th className="px-4 py-3 whitespace-nowrap">Public URL</th>
                    <th className="px-4 py-3 whitespace-nowrap">Attached service</th>
                    <th className="px-4 py-3 whitespace-nowrap">Target</th>
                    <th className="px-4 py-3 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {state.routes.map((r) => (
                    <tr
                      key={r.hostname}
                      className="border-t dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        {r.service.startsWith('http://') ? (
                          <a
                            href={`https://${r.hostname}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-purple-600 dark:text-purple-400 hover:underline inline-flex items-center gap-1"
                          >
                            {r.hostname}
                            <ExternalLink size={12} />
                          </a>
                        ) : (
                          <span className="text-gray-800 dark:text-gray-200 inline-flex items-center gap-1">
                            <Lock size={12} className="text-gray-400" />
                            {r.hostname}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        {r.attachedTo ? (
                          <span className="text-xs font-medium bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 px-2 py-0.5 rounded-full">
                            {r.attachedTo}
                          </span>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-600 text-xs">
                            unattached
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap font-mono text-sm text-gray-700 dark:text-gray-300">
                        {r.service}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {busy === `del-${r.hostname}` ? (
                          <Loader2 size={14} className="animate-spin text-gray-400" />
                        ) : confirmDelete === r.hostname ? (
                          <button
                            onClick={() => removeRoute(r.hostname)}
                            className="text-xs text-red-600 dark:text-red-400 hover:underline"
                          >
                            confirm?
                          </button>
                        ) : (
                          <button
                            aria-label={`Detach ${r.hostname}`}
                            onClick={() => setConfirmDelete(r.hostname)}
                            className="w-9 h-9 flex items-center justify-center rounded-md text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              Detaching removes the ingress rule (the hostname stops serving); its DNS record
              stays in Cloudflare so re-attaching later is instant.
            </p>
          </div>

          {/* Add route */}
          <div className="max-w-2xl">
            <h2 className="text-xl font-display font-medium mb-3">Publish a service</h2>
            <form onSubmit={addRoute} className="border rounded-xl p-5 space-y-3">
              <div className="flex flex-col">
                <Label htmlFor="svc">Service</Label>
                <select
                  id="svc"
                  value={attachTo}
                  onChange={(e) => pickService(e.target.value)}
                  className="border rounded-md px-3 py-2 text-sm bg-white dark:bg-gray-900"
                >
                  <option value="">— pick a running service (or set a port manually) —</option>
                  {state.services.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name} · port {s.port}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end gap-2 flex-wrap">
                <div className="flex flex-col flex-1 min-w-48">
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
                    <span className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      .{state.domain}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col w-28">
                  <Label htmlFor="tport">Port</Label>
                  <Input
                    id="tport"
                    type="number"
                    placeholder="3001"
                    value={newPort}
                    onChange={(e) => setNewPort(e.target.value)}
                    min={1024}
                    max={65535}
                    className="tabular-nums"
                    required
                  />
                </div>
                <Button type="submit" disabled={!!busy || !newName || !newPort}>
                  {busy === 'add' ? (
                    <>
                      <Loader2 size={13} className="animate-spin mr-1.5" /> Adding…
                    </>
                  ) : (
                    'Publish'
                  )}
                </Button>
              </div>
            </form>
          </div>

          {/* Private access */}
          <div>
            <h2 className="text-xl font-display font-medium mb-3 flex items-center gap-2">
              <Shield size={18} className="text-gray-500 dark:text-gray-400" />
              Private access (Tailscale)
            </h2>
            <div className="overflow-x-auto border rounded-lg">
              <table className="min-w-full">
                <thead>
                  <tr className="text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide bg-gray-50 dark:bg-gray-800/60">
                    <th className="px-4 py-3 whitespace-nowrap">Service</th>
                    <th className="px-4 py-3 whitespace-nowrap">MagicDNS</th>
                    <th className="px-4 py-3 whitespace-nowrap">Tailnet IP</th>
                  </tr>
                </thead>
                <tbody>
                  {state.services.map((s) => (
                    <tr key={s.name} className="border-t dark:border-gray-800">
                      <td className="px-4 py-2.5 whitespace-nowrap text-sm font-medium text-gray-800 dark:text-gray-200">
                        {s.name}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap font-mono text-sm text-gray-700 dark:text-gray-300">
                        http://{state.tailscale.host}:{s.port}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap font-mono text-sm text-gray-500 dark:text-gray-400">
                        http://{state.tailscale.ip}:{s.port}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              These work from any device signed into your tailnet with no route, no DNS record
              and no public exposure — ideal for admin UIs and services you never want on the
              internet. HTTPS certificates aren&apos;t available on this side: the Tailscale
              Android app has no CLI, so <code>tailscale serve</code> can&apos;t run here.
            </p>
          </div>
        </>
      )}

      {output && (
        <pre className="fade-in-up bg-black text-gray-100 font-mono text-xs rounded-md p-4 overflow-auto max-h-72 whitespace-pre-wrap">
          {output}
        </pre>
      )}
    </div>
  );
}
