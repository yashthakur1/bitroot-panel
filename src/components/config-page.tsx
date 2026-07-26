"use client";

import { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, FileCode2, Smartphone, Link2 } from 'lucide-react';
import { StatCardsSkeleton, TableSkeleton } from './skeletons';
import { humanUptime } from './project-list';

interface EnvVar {
  key: string;
  value: string;
  secret: boolean;
}

interface ConfigState {
  panel: {
    version: string;
    commit: string;
    execMode: string;
    node: string;
    port: string;
    uptimeSec: number;
  };
  env: EnvVar[];
  device: string;
}

export default function ConfigPage() {
  const [state, setState] = useState<ConfigState | null>(null);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/config');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState(await res.json());
      setError('');
    } catch (e) {
      setError(`could not load config: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Config</h1>
        <p className="text-gray-600 mt-2">
          The panel&apos;s own runtime configuration on the phone. Read-only — to change
          values, edit <code>~/apps/bitroot-panel/.env</code> and run{' '}
          <code>pm2 restart bitroot-panel</code>.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {!state && !error && (
        <>
          <StatCardsSkeleton count={6} />
          <TableSkeleton rows={5} cols={2} />
        </>
      )}

      {state && (
        <>
          {/* Runtime */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {(
              [
                ['Version', `v${state.panel.version}`],
                ['Exec mode', state.panel.execMode],
                ['Node', state.panel.node],
                ['Port', state.panel.port],
                ['Uptime', humanUptime(state.panel.uptimeSec * 1000)],
                ['Deployed', state.panel.commit.split(' ')[0]],
              ] as Array<[string, string]>
            ).map(([label, value]) => (
              <div key={label} className="border rounded-lg p-4">
                <div className="text-xs uppercase text-gray-500 font-semibold">{label}</div>
                <div className="text-lg font-medium mt-1 truncate" title={value}>
                  {value}
                </div>
              </div>
            ))}
          </div>
          <p className="text-sm text-gray-500 -mt-4">
            Last deploy: <span className="font-mono">{state.panel.commit}</span>
          </p>

          {/* .env */}
          <div>
            <h2 className="text-xl font-semibold mb-3 flex items-center gap-2">
              <FileCode2 size={18} className="text-gray-500" />
              Environment (.env)
            </h2>
            <div className="overflow-x-auto border rounded-lg">
              <table className="min-w-full">
                <thead>
                  <tr className="text-left text-xs font-semibold text-gray-700 uppercase tracking-wide bg-gray-50">
                    <th className="px-4 py-3 whitespace-nowrap">Key</th>
                    <th className="px-4 py-3 whitespace-nowrap">Value</th>
                    <th className="px-4 py-3 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {state.env.map((v) => {
                    const shown = !v.secret || revealed[v.key];
                    return (
                      <tr key={v.key} className="border-t hover:bg-gray-50">
                        <td className="px-4 py-3 whitespace-nowrap font-mono text-sm font-medium text-gray-800">
                          {v.key}
                        </td>
                        <td className="px-4 py-3 font-mono text-sm text-gray-700 break-all">
                          {shown ? v.value : '••••••••••••'}
                        </td>
                        <td className="px-4 py-3">
                          {v.secret && (
                            <button
                              className="text-gray-400 hover:text-gray-700"
                              title={shown ? 'hide' : 'reveal'}
                              onClick={() =>
                                setRevealed({ ...revealed, [v.key]: !revealed[v.key] })
                              }
                            >
                              {shown ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Endpoints */}
          <div>
            <h2 className="text-xl font-semibold mb-3 flex items-center gap-2">
              <Link2 size={18} className="text-gray-500" />
              Ways to reach this panel
            </h2>
            <div className="border rounded-lg divide-y text-sm">
              <div className="px-4 py-3 flex justify-between flex-wrap gap-2">
                <span className="text-gray-700">Public (Cloudflare Access + password)</span>
                <a href="https://panel.bitroot.in" className="font-mono text-purple-600 hover:underline">
                  panel.bitroot.in
                </a>
              </div>
              <div className="px-4 py-3 flex justify-between flex-wrap gap-2">
                <span className="text-gray-700">Tailscale (private, password only)</span>
                <span className="font-mono text-gray-800">100.127.137.83:{state.panel.port}</span>
              </div>
            </div>
          </div>

          {/* Device */}
          <div>
            <h2 className="text-xl font-semibold mb-3 flex items-center gap-2">
              <Smartphone size={18} className="text-gray-500" />
              Device
            </h2>
            <pre className="bg-black text-gray-100 font-mono text-xs rounded-md p-4 overflow-auto max-h-96 whitespace-pre-wrap">
              {state.device || 'no device info'}
            </pre>
          </div>
        </>
      )}
    </div>
  );
}
