'use client';

import { useCallback, useEffect, useState } from 'react';
import { Laptop, Loader2, RefreshCw, Smartphone, Server, HelpCircle } from 'lucide-react';
import { TableSkeleton } from '@/components/skeletons';

interface Device {
  id: string;
  name: string;
  hostname: string;
  os: string;
  address: string;
  online: boolean;
  lastSeen: string;
  clientVersion: string;
  updateAvailable: boolean;
  self: boolean;
  roles: string[];
  ports: number[];
}

function osIcon(os: string) {
  if (/android|ios/i.test(os)) return <Smartphone size={15} />;
  if (/linux/i.test(os)) return <Server size={15} />;
  if (/mac|windows/i.test(os)) return <Laptop size={15} />;
  return <HelpCircle size={15} />;
}

/** "3 minutes ago" beats an ISO timestamp when the question is "is it alive". */
function ago(iso: string): string {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(s) || s < 0) return '';
  if (s < 90) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [state, setState] = useState<'loaded' | 'stale' | 'absent'>('absent');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/devices', { cache: 'no-store' });
      const d = await res.json();
      setConfigured(d.configured !== false);
      if (d.state) setState(d.state);
      setDevices(d.devices ?? []);
      setErr(d.error ?? '');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const online = devices?.filter((d) => d.online).length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-display font-light tracking-tight">Devices</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2 text-pretty max-w-2xl">
            Every machine on this tailnet and what is answering on it. Read-only — this
            panel manages its own machine, and each of the others manages itself.
          </p>
        </div>
        {configured && (
          <button
            onClick={load}
            disabled={loading}
            className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 inline-flex items-center gap-1.5 py-2 transition-colors"
          >
            {loading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <RefreshCw size={13} />
            )}
            {loading ? 'probing…' : 'refresh'}
          </button>
        )}
      </div>

      {/* The key being on disk but not in this process is its own state, and the
          only one where the fix is a restart rather than a key. */}
      {!configured && state === 'stale' && (
        <div className="border border-accent-200 dark:border-accent-800 rounded-lg p-5 space-y-3 bg-accent-50/50 dark:bg-accent-950/20">
          <p className="text-sm text-gray-800 dark:text-gray-200 text-pretty">
            <strong>TS_API_KEY is in .env, but this panel was started without it.</strong>{' '}
            pm2 replays the environment it captured when the process was first created and
            never re-reads <code>.env</code>, so the key is on disk and invisible at the
            same time.
          </p>
          <pre className="bg-black text-gray-100 font-mono text-xs rounded-md p-3 overflow-x-auto">panel-restart</pre>
          <p className="text-xs text-gray-600 dark:text-gray-400 text-pretty">
            <code>panel-restart</code>, not <code>pm2 restart</code> — it reads{' '}
            <code>.env</code> and passes the values in. Plain <code>pm2 restart</code> will
            leave this page saying exactly the same thing.
          </p>
        </div>
      )}

      {!configured && state !== 'stale' && (
        <div className="border rounded-lg p-5 space-y-3 bg-gray-50 dark:bg-gray-900/40">
          <p className="text-sm text-gray-700 dark:text-gray-300 text-pretty">
            Device discovery needs a Tailscale API key. The <code>tailscale</code> CLI is
            not used, because on Android there isn&apos;t one — Tailscale is the app, so
            the phone could never enumerate the tailnet locally. The API works everywhere.
          </p>
          <ol className="text-sm text-gray-600 dark:text-gray-400 list-decimal ml-5 space-y-1.5">
            <li>
              Create a key at{' '}
              <a
                className="text-accent-600 dark:text-accent-400 hover:underline"
                href="https://login.tailscale.com/admin/settings/keys"
                target="_blank"
                rel="noreferrer"
              >
                login.tailscale.com → Settings → Keys
              </a>
            </li>
            <li>
              Add to <code>~/apps/bitroot-panel/.env</code>:
              <pre className="mt-1.5 bg-black text-gray-100 font-mono text-xs rounded-md p-3 overflow-x-auto">
{`TS_API_KEY=tskey-api-…
TS_TAILNET=-`}
              </pre>
              <span className="text-xs">
                <code>-</code> means &ldquo;the tailnet this key belongs to&rdquo;, which is
                usually what you want.
              </span>
            </li>
            <li>
              <code>panel-restart</code> — reads <code>.env</code> and passes the values
              in. Plain <code>pm2 restart</code> replays a stale environment and the key
              stays invisible.
            </li>
          </ol>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Keys expire after 90 days by default. When this page says the key was rejected,
            that is usually why.
          </p>
        </div>
      )}

      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}

      {configured && !devices && !err && <TableSkeleton rows={4} cols={4} />}

      {configured && devices && devices.length > 0 && (
        <>
          <p className="text-sm text-gray-500 dark:text-gray-400 tabular-nums">
            {online} of {devices.length} reachable
          </p>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {devices.map((d) => (
              <div
                key={d.id}
                className={`border rounded-xl p-4 space-y-3 ${
                  d.self ? 'border-accent-300 dark:border-accent-800' : ''
                } ${d.online ? '' : 'opacity-70'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-200">
                      <span className="text-gray-400 dark:text-gray-500">{osIcon(d.os)}</span>
                      <span className="truncate">{d.name}</span>
                      {d.self && (
                        <span className="shrink-0 text-[10px] font-semibold uppercase text-accent-700 dark:text-accent-300 border border-accent-200 dark:border-accent-800 rounded-full px-1.5 py-0.5">
                          this one
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {d.address}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 inline-flex items-center gap-1.5 text-xs ${
                      d.online
                        ? 'text-green-700 dark:text-green-400'
                        : 'text-gray-400 dark:text-gray-500'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        d.online ? 'bg-green-500' : 'bg-gray-400 dark:bg-gray-600'
                      }`}
                    />
                    {d.online ? 'up' : ago(d.lastSeen) || 'offline'}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {d.roles.length ? (
                    d.roles.map((r) => (
                      <span
                        key={r}
                        className="text-[11px] rounded-full px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                      >
                        {r}
                      </span>
                    ))
                  ) : (
                    <span className="text-[11px] text-gray-400 dark:text-gray-500">
                      {d.online ? 'no known service ports' : 'not reachable'}
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400 border-t dark:border-gray-800 pt-2.5">
                  <span className="truncate">
                    {d.os}
                    {d.clientVersion ? ` · ts ${d.clientVersion}` : ''}
                    {d.updateAvailable ? ' · update available' : ''}
                  </span>
                  {d.roles.includes('BitPanel') && !d.self && (
                    <a
                      href={`http://${d.address}:3210`}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-accent-600 dark:text-accent-400 hover:underline"
                    >
                      open panel
                    </a>
                  )}
                  {d.roles.includes('Dokploy') && (
                    <a
                      href={`http://${d.address}:3000`}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-accent-600 dark:text-accent-400 hover:underline"
                    >
                      open Dokploy
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400 text-pretty">
            Reachability is what answered a port probe over the tailnet just now, not what
            Tailscale reports. A machine can be on the tailnet with nothing listening —
            that reads as offline here, which is the more useful answer on a page about
            services.
          </p>
        </>
      )}

      {configured && devices && devices.length === 0 && !err && !loading && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          The key worked, but the tailnet has no devices.
        </p>
      )}
    </div>
  );
}
