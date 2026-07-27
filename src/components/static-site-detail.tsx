"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from './ui/button';
import { StatCardsSkeleton } from './skeletons';
import {
  PanelsTopLeft,
  ExternalLink,
  Loader2,
  Check,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

interface Site {
  name: string;
  port: number;
  size: string;
  served: boolean;
  branch: string;
  url: string | null;
}

export default function StaticSiteDetail({ name }: { name: string }) {
  const router = useRouter();
  const [site, setSite] = useState<Site | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState('');
  const [output, setOutput] = useState('');
  const [result, setResult] = useState<'ok' | 'fail' | ''>('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/static');
    const data = await res.json().catch(() => ({}));
    setSite((data.sites ?? []).find((s: Site) => s.name === name) ?? null);
    setLoaded(true);
  }, [name]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [output]);

  async function deploy() {
    setBusy('deploy');
    setResult('');
    setOutput('Pulling and rebuilding…\n');
    try {
      const res = await fetch(`/api/static/${name}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deploy' }),
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let full = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setOutput(
          full
            .replaceAll('[[HB]]', '')
            .replace(/\n?\[\[EXIT:\d+\]\]/, '')
            .split('\n')
            .map((l) => l.split('\r').pop() ?? '')
            .join('\n'),
        );
      }
      setResult(/\[\[EXIT:0\]\]/.test(full) ? 'ok' : 'fail');
      load();
    } catch (e) {
      setOutput((o) => `${o}\n(connection lost: ${(e as Error).message})`);
      setResult('fail');
    } finally {
      setBusy('');
    }
  }

  async function remove() {
    setBusy('remove');
    setConfirmRemove(false);
    try {
      const res = await fetch(`/api/static/${name}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove' }),
      });
      if (res.ok) {
        router.push('/dashboard');
        return;
      }
      const data = await res.json().catch(() => ({}));
      setOutput(data.error ?? data.output ?? `HTTP ${res.status}`);
      setResult('fail');
    } finally {
      setBusy('');
    }
  }

  if (loaded && !site) {
    return (
      <div className="fade-in-up flex flex-col items-center justify-center py-24 text-center">
        <h1 className="text-xl font-display font-medium mb-1">
          &quot;{name}&quot; is not a static site
        </h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
          It may have been removed.
        </p>
        <Button onClick={() => router.push('/dashboard')}>Back to overview</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-display font-light tracking-tight flex items-center gap-3">
            <PanelsTopLeft size={24} className="text-gray-500 dark:text-gray-400" />
            {name}
            <span className="text-xs font-medium px-2 py-1 rounded border bg-gray-50 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 align-middle">
              static
            </span>
          </h1>
          {site?.url && (
            <a
              href={site.url}
              target="_blank"
              rel="noreferrer"
              className="text-purple-600 dark:text-purple-400 hover:underline text-sm inline-flex items-center gap-1 mt-2"
            >
              {site.url.replace('https://', '')}
              <ExternalLink size={12} />
            </a>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button disabled={!!busy} onClick={deploy}>
            {busy === 'deploy' ? (
              <>
                <Loader2 size={14} className="animate-spin mr-1.5" /> Rebuilding…
              </>
            ) : (
              <>
                <RefreshCw size={14} className="mr-1.5" /> Rebuild
              </>
            )}
          </Button>
          {confirmRemove ? (
            <div className="flex flex-col items-end gap-1.5">
              <Button
                variant="outline"
                className="border-red-300 dark:border-red-800 text-red-600 dark:text-red-400"
                disabled={!!busy}
                onClick={remove}
              >
                {busy === 'remove' ? 'Removing…' : 'Really remove?'}
              </Button>
              <p className="fade-in-up text-xs text-gray-500 dark:text-gray-400 max-w-xs text-right">
                Drops the nginx vhost, tunnel route and port. Source and built files are
                kept and listed on{' '}
                <Link href="/dashboard/residue" className="underline">
                  Residue
                </Link>
                .
              </p>
            </div>
          ) : (
            <Button
              variant="outline"
              className="text-red-600 dark:text-red-400"
              disabled={!!busy}
              onClick={() => setConfirmRemove(true)}
            >
              Remove
            </Button>
          )}
        </div>
      </div>

      {!site && !loaded && <StatCardsSkeleton count={4} />}

      {site && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {(
            [
              ['Status', site.served ? 'served' : 'not served'],
              ['Port', String(site.port)],
              ['Build size', site.size],
              ['Branch', site.branch || 'default'],
            ] as Array<[string, string]>
          ).map(([label, value]) => (
            <div key={label} className="border rounded-lg p-4">
              <div className="text-xs uppercase text-gray-500 dark:text-gray-400 font-semibold">
                {label}
              </div>
              <div className="text-lg font-medium mt-1 tabular-nums">{value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="border rounded-lg divide-y dark:divide-gray-800 text-sm">
        <div className="px-4 py-3 flex justify-between flex-wrap gap-2">
          <span className="text-gray-700 dark:text-gray-300">Private (Tailscale)</span>
          <span className="font-mono text-gray-800 dark:text-gray-200">
            http://oneplus-6:{site?.port ?? '—'}
          </span>
        </div>
        <div className="px-4 py-3 flex justify-between flex-wrap gap-2">
          <span className="text-gray-700 dark:text-gray-300">Served from</span>
          <span className="font-mono text-gray-800 dark:text-gray-200">
            ~/apps/static/{name}/public
          </span>
        </div>
      </div>

      {result && (
        <p
          className={`fade-in-up flex items-center gap-1.5 text-sm ${
            result === 'ok'
              ? 'text-green-700 dark:text-green-400'
              : 'text-red-600 dark:text-red-400'
          }`}
        >
          {result === 'ok' ? (
            <Check size={14} className="pop-in" />
          ) : (
            <AlertCircle size={14} className="pop-in" />
          )}
          {result === 'ok' ? 'Rebuilt and reloaded.' : 'Rebuild failed — see log.'}
        </p>
      )}

      {output && (
        <pre
          ref={logRef}
          className="fade-in-up bg-black text-gray-100 font-mono text-xs rounded-md p-4 overflow-auto max-h-96 whitespace-pre-wrap"
        >
          {output}
        </pre>
      )}
    </div>
  );
}
