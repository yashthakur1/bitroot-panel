"use client";

import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Mail, Lock } from 'lucide-react';
import { StatCardsSkeleton, TableSkeleton } from './skeletons';

interface AccessPolicy {
  name: string;
  decision: string;
  subjects: string[];
}

interface AccessApp {
  name: string;
  domain: string;
  sessionDuration: string;
  policies: AccessPolicy[];
}

interface IamState {
  configured: boolean;
  error?: string;
  apps: AccessApp[];
  users: Array<{ email: string; apps: string[] }>;
}

export default function IamPage() {
  const [state, setState] = useState<IamState | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/iam');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setState(data);
      setError('');
    } catch (e) {
      setError(`could not load IAM data: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-display font-light tracking-tight">IAM</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Who can pass the Cloudflare Access gate on your public <code>bitroot.in</code>{' '}
          hostnames. Managed in Cloudflare Zero Trust; this page is a live read-only view.
        </p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!state && !error && (
        <>
          <TableSkeleton rows={3} cols={3} />
          <StatCardsSkeleton count={2} />
        </>
      )}

      {state && !state.configured && (
        <div className="border rounded-lg p-5 bg-amber-50 dark:bg-amber-950/40 text-sm text-amber-800 dark:text-amber-300">
          Not configured: set <code>CF_API_TOKEN</code> and <code>CF_ZONE_ID</code> in the
          panel&apos;s <code>.env</code> on the phone (a token with read access to
          &quot;Access: Apps and Policies&quot; is enough), then restart the panel.
        </div>
      )}

      {state?.configured && (
        <>
          {/* Users */}
          <div>
            <h2 className="text-xl font-display font-medium mb-3 flex items-center gap-2">
              <Mail size={18} className="text-gray-500 dark:text-gray-400" />
              Users
            </h2>
            <div className="overflow-x-auto border rounded-lg">
              <table className="min-w-full">
                <thead>
                  <tr className="text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide bg-gray-50 dark:bg-gray-800/60">
                    <th className="px-4 py-3 whitespace-nowrap">Email</th>
                    <th className="px-4 py-3 whitespace-nowrap">Can access</th>
                  </tr>
                </thead>
                <tbody>
                  {state.users.map((u) => (
                    <tr key={u.email} className="border-t hover:bg-gray-50 dark:hover:bg-gray-800/60">
                      <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-800 dark:text-gray-200">
                        {u.email}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex gap-1.5 flex-wrap">
                          {u.apps.map((a) => (
                            <span
                              key={a}
                              className="text-xs font-medium bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 px-2 py-0.5 rounded-full"
                            >
                              {a}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Applications */}
          <div>
            <h2 className="text-xl font-display font-medium mb-3 flex items-center gap-2">
              <ShieldCheck size={18} className="text-gray-500 dark:text-gray-400" />
              Protected applications
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {state.apps.map((app) => (
                <div key={app.domain} className="border rounded-lg p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
                      <Lock size={14} className="text-gray-400" />
                      {app.name}
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      session {app.sessionDuration}
                    </span>
                  </div>
                  <div className="font-mono text-sm text-gray-600 dark:text-gray-400">{app.domain}</div>
                  {app.policies.map((p) => (
                    <div key={p.name} className="text-sm">
                      <span
                        className={`text-xs font-medium uppercase px-1.5 py-0.5 rounded mr-2 ${
                          p.decision === 'allow'
                            ? 'bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400'
                            : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300'
                        }`}
                      >
                        {p.decision}
                      </span>
                      <span className="text-gray-700 dark:text-gray-300">{p.subjects.join(', ')}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <p className="text-sm text-gray-500 dark:text-gray-400">
            Note: Tailscale access (private IPs / MagicDNS) bypasses this gate by design —
            it is limited to devices in your tailnet instead. Other public tunnel routes
            without an Access app rely on their own auth.
          </p>
        </>
      )}
    </div>
  );
}
