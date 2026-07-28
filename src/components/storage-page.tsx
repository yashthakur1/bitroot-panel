"use client";

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Globe,
  FolderOpen,
  HardDrive,
  Key,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Button } from './ui/button';
import { Tabs } from './ui/tabs';
import { TableSkeleton } from './skeletons';
import UploadDialog from './upload-dialog';
import ObjectBrowser from './object-browser';

interface BucketKey {
  accessKeyId: string;
  name: string;
  permissions: { read: boolean; write: boolean; owner: boolean };
}

interface Bucket {
  id: string;
  name: string;
  bytes: number;
  objects: number;
  quotaBytes: number | null;
  websiteAccess: boolean;
  access: 'private' | 'public';
  publicUrl: string | null;
  keys: BucketKey[];
}

interface Data {
  configured: boolean;
  tiers: number[];
  maxTierGb: number;
  buckets: Bucket[];
  freeBytes: number | null;
  committedBytes: number;
  s3Endpoint: string;
  error?: string;
}

const GIB = 1024 ** 3;

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export default function StoragePage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTier, setNewTier] = useState<number | null>(5);
  const [tierFor, setTierFor] = useState<Bucket | null>(null);
  const [keyFor, setKeyFor] = useState<Bucket | null>(null);
  const [uploadTo, setUploadTo] = useState<Bucket | null>(null);
  const [tab, setTab] = useState<'buckets' | 'endpoint'>('buckets');
  const [browsing, setBrowsing] = useState<Bucket | null>(null);
  const [newKey, setNewKey] = useState<{ accessKeyId: string; secretAccessKey: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/storage');
      const d = await res.json();
      setData(d);
      setError(d.error ?? '');
    } catch (e) {
      setError(`could not read storage: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function call(url: string, init: RequestInit, tag: string) {
    setBusy(tag);
    try {
      const res = await fetch(url, init);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setError(d.error ?? `HTTP ${res.status}`);
      else setError('');
      await load();
      return d;
    } finally {
      setBusy('');
    }
  }

  if (!data && !error) return <TableSkeleton rows={4} cols={5} />;

  if (data && !data.configured) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-display font-light tracking-tight">Storage</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-800 rounded-lg p-8 text-center">
          Garage is not configured. Set <code className="font-mono">GARAGE_ADMIN_TOKEN</code> in the
          panel environment and restart it.
        </p>
      </div>
    );
  }

  const buckets = data?.buckets ?? [];
  const committedGb = (data?.committedBytes ?? 0) / GIB;
  const freeGb = data?.freeBytes ? data.freeBytes / GIB : null;
  const publicCount = buckets.filter((b) => b.access === 'public').length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-light tracking-tight flex items-center gap-3">
            <HardDrive size={24} className="text-gray-500 dark:text-gray-400" />
            Storage
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2" style={{ textWrap: 'pretty' }}>
            S3-compatible object storage on the device. Buckets are capped at a fixed tier that
            Garage enforces itself, and stay private unless you publish them.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={load}
            aria-label="Refresh"
            className="w-10 h-10 flex items-center justify-center rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <Button onClick={() => setCreating(true)} className="flex items-center gap-2">
            <Plus size={15} /> New bucket
          </Button>
        </div>
      </div>

      <Tabs
        tabs={[
          { key: 'buckets' as const, label: 'Buckets', count: buckets.length },
          { key: 'endpoint' as const, label: 'Endpoint' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {tab === 'endpoint' && (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4 space-y-1">
          <p className="text-xs uppercase font-semibold tracking-widest text-gray-500 dark:text-gray-400">
            S3 endpoint
          </p>
          <div className="flex items-center gap-2">
            <code className="font-mono text-sm text-gray-800 dark:text-gray-200 truncate">
              {data?.s3Endpoint}
            </code>
            <CopyButton value={data?.s3Endpoint ?? ''} />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 text-pretty">
            The S3 API, over Tailscale only. Region <code className="font-mono">garage</code>,
            path-style addressing, and every request must be signed with a bucket key — opening it
            in a browser returns <code className="font-mono">AccessDenied</code>.
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 text-pretty">
            {publicCount > 0
              ? `${publicCount} of ${buckets.length} bucket${buckets.length === 1 ? '' : 's'} ${
                  publicCount === 1 ? 'is' : 'are'
                } published, and their objects are also readable over plain HTTPS with no key — that is the address to hand out.`
              : 'No bucket is published, so this endpoint is the only way in. Publishing one adds an HTTPS address that needs no key.'}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4 space-y-1">
          <p className="text-xs uppercase font-semibold tracking-widest text-gray-500 dark:text-gray-400">
            Committed
          </p>
          <p className="text-sm text-gray-800 dark:text-gray-200 tabular-nums">
            {committedGb.toFixed(0)} GB promised across {buckets.length} bucket
            {buckets.length === 1 ? '' : 's'}
            {freeGb !== null && ` · ${freeGb.toFixed(0)} GB free on device`}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 text-pretty">
            Tiers are what a bucket may grow to, not what it uses. A new bucket is refused if it
            would promise more than the device has.
          </p>
        </div>
      </div>
      )}

      {tab === 'buckets' && browsing && (
        <ObjectBrowser
          bucket={browsing.name}
          publicUrl={browsing.publicUrl}
          s3Endpoint={data?.s3Endpoint ?? ''}
          onBack={() => setBrowsing(null)}
          onChanged={load}
        />
      )}

      {tab === 'buckets' && !browsing && (buckets.length === 0 ? (
        <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-8 text-center">
          <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">No buckets yet.</p>
          <Button variant="secondary" onClick={() => setCreating(true)}>
            Create your first one
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {buckets.map((b) => {
            const quota = b.quotaBytes ?? 0;
            const pct = quota ? Math.min(100, (b.bytes / quota) * 100) : 0;
            return (
              <div
                key={b.id}
                className="rounded-lg border border-gray-200 dark:border-gray-800 p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <HardDrive size={16} className="text-gray-500 dark:text-gray-400" />
                      <span className="font-medium text-gray-800 dark:text-gray-200">{b.name}</span>
                      {b.access === 'public' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded border bg-accent-50 dark:bg-accent-950/40 text-accent-700 dark:text-accent-400 border-accent-200 dark:border-accent-900">
                          <Globe size={11} /> Public
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded border bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700">
                          <Lock size={11} /> Private
                        </span>
                      )}
                    </div>
                    {b.publicUrl && (
                      <a
                        href={b.publicUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-accent-600 dark:text-accent-400 hover:underline"
                      >
                        {b.publicUrl.replace('https://', '')}
                      </a>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === b.name}
                      onClick={() => setTierFor(b)}
                      className="active:scale-[0.96] transition-transform tabular-nums"
                    >
                      {b.quotaBytes ? `${Math.round(b.quotaBytes / GIB)} GB` : 'No cap'}
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === b.name}
                      onClick={() =>
                        call(
                          `/api/storage/${b.name}`,
                          {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              access: b.access === 'public' ? 'private' : 'public',
                            }),
                          },
                          b.name,
                        )
                      }
                      className="active:scale-[0.96] transition-transform"
                    >
                      {b.access === 'public' ? (
                        <>
                          <Lock size={14} className="mr-1.5" /> Make private
                        </>
                      ) : (
                        <>
                          <Globe size={14} className="mr-1.5" /> Publish
                        </>
                      )}
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setBrowsing(b)}
                      className="active:scale-[0.96] transition-transform"
                    >
                      <FolderOpen size={14} className="mr-1.5" /> Files
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setUploadTo(b)}
                      className="active:scale-[0.96] transition-transform"
                    >
                      <Upload size={14} className="mr-1.5" /> Upload
                    </Button>

                    <Button size="sm" variant="outline" onClick={() => setKeyFor(b)}>
                      <Key size={14} className="mr-1.5" /> Key
                    </Button>

                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy === b.name}
                      onClick={() => {
                        if (!confirm(`Delete bucket "${b.name}"?`)) return;
                        call(`/api/storage/${b.name}`, { method: 'DELETE' }, b.name);
                      }}
                      className="active:scale-[0.96] transition-transform"
                    >
                      {busy === b.name ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-[width] duration-500 ${
                        pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-accent-500'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                    <span>
                      {human(b.bytes)} {quota ? `of ${human(quota)}` : 'used · no cap'} · {b.objects} object
                      {b.objects === 1 ? '' : 's'}
                    </span>
                    <span>{quota ? `${pct.toFixed(0)}%` : ''}</span>
                  </div>
                </div>

                {b.keys.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {b.keys.map((k) => (
                      <span
                        key={k.accessKeyId}
                        className="inline-flex items-center gap-1.5 text-[11px] font-mono px-2 py-1 rounded border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400"
                      >
                        <Key size={10} />
                        {k.name || k.accessKeyId}
                        <span className="opacity-60">{k.permissions.write ? 'rw' : 'ro'}</span>
                        <button
                          aria-label={`Delete key ${k.name || k.accessKeyId}`}
                          onClick={() => {
                            if (!confirm(`Delete access key "${k.name || k.accessKeyId}"?`)) return;
                            call(
                              `/api/storage/keys?id=${encodeURIComponent(k.accessKeyId)}`,
                              { method: 'DELETE' },
                              b.name,
                            );
                          }}
                          className="hover:text-red-500 transition-colors"
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {creating && (
        <Dialog title="New bucket" onClose={() => setCreating(false)}>
          <label className="block text-sm space-y-1">
            <span className="text-gray-700 dark:text-gray-300">Name</span>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value.toLowerCase())}
              placeholder="backups"
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 bg-transparent rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-accent-500"
            />
            <span className="block text-xs text-gray-500 dark:text-gray-400 text-pretty">
              Lowercase letters, digits and hyphens. A public bucket is served at
              this name as a hostname, so it has to be a valid DNS label — and Garage cannot rename
              a bucket later.
            </span>
          </label>

          <SizePicker
            presets={data?.tiers ?? []}
            max={data?.maxTierGb ?? 80}
            value={newTier}
            onChange={setNewTier}
          />

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy === 'create' || !newName}
              onClick={async () => {
                const d = await call(
                  '/api/storage',
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: newName, tierGb: newTier }),
                  },
                  'create',
                );
                if (d?.ok) {
                  setCreating(false);
                  setNewName('');
                }
              }}
            >
              {busy === 'create' ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null}
              Create
            </Button>
          </div>
        </Dialog>
      )}

      {tierFor && (
        <Dialog title={`Size of ${tierFor.name}`} onClose={() => setTierFor(null)}>
          <SizePicker
            presets={data?.tiers ?? []}
            max={data?.maxTierGb ?? 80}
            value={tierFor.quotaBytes ? Math.round(tierFor.quotaBytes / GIB) : null}
            onChange={async (v) => {
              const b = tierFor;
              setTierFor(null);
              await call(
                `/api/storage/${b.name}`,
                {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ tierGb: v }),
                },
                b.name,
              );
            }}
          />
        </Dialog>
      )}

      {uploadTo && (
        <UploadDialog
          bucket={uploadTo.name}
          isPublic={uploadTo.access === 'public'}
          onClose={() => setUploadTo(null)}
          onDone={load}
        />
      )}

      {keyFor && (
        <KeyDialog
          bucket={keyFor}
          created={newKey}
          busy={busy === 'key'}
          onCreate={async (name, readOnly) => {
            const d = await call(
              '/api/storage/keys',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bucket: keyFor.name, name, readOnly }),
              },
              'key',
            );
            if (d?.ok) setNewKey(d.key);
          }}
          onClose={() => {
            setKeyFor(null);
            setNewKey(null);
          }}
        />
      )}
    </div>
  );
}

// Presets for the common cases, a free field for anything else up to the
// ceiling, and no cap at all - which is the honest default for a device whose
// spare space changes as other things are added and removed.
function SizePicker({
  presets,
  max,
  value,
  onChange,
}: {
  presets: number[];
  max: number;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const isPreset = value !== null && presets.includes(value);
  const [custom, setCustom] = useState(!isPreset && value !== null);
  const [draft, setDraft] = useState(String(value ?? ''));

  return (
    <div className="space-y-2">
      <span className="text-sm text-gray-700 dark:text-gray-300">Size limit</span>
      <div className="flex flex-wrap gap-2">
        {presets.map((t) => (
          <button
            key={t}
            onClick={() => {
              setCustom(false);
              onChange(t);
            }}
            className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors active:scale-[0.96] tabular-nums ${
              !custom && value === t
                ? 'border-accent-500 bg-accent-50 dark:bg-accent-950/40 text-accent-700 dark:text-accent-400'
                : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60'
            }`}
          >
            {t} GB
          </button>
        ))}
        <button
          onClick={() => setCustom(true)}
          className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors active:scale-[0.96] ${
            custom
              ? 'border-accent-500 bg-accent-50 dark:bg-accent-950/40 text-accent-700 dark:text-accent-400'
              : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60'
          }`}
        >
          Custom
        </button>
        <button
          onClick={() => {
            setCustom(false);
            onChange(null);
          }}
          className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors active:scale-[0.96] ${
            !custom && value === null
              ? 'border-accent-500 bg-accent-50 dark:bg-accent-950/40 text-accent-700 dark:text-accent-400'
              : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60'
          }`}
        >
          No cap
        </button>
      </div>

      {custom && (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={max}
            autoFocus
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= 1 && n <= max) onChange(n);
            }}
            className="w-24 px-3 py-2 border border-gray-200 dark:border-gray-800 bg-transparent rounded-lg text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-accent-500"
          />
          <span className="text-sm text-gray-500 dark:text-gray-400">GB (max {max})</span>
        </div>
      )}

      <p className="text-xs text-gray-500 dark:text-gray-400 text-pretty">
        {value === null
          ? 'No cap: the bucket grows with what you put in it, limited only by free space on the device. Usage is still reported per bucket.'
          : `Garage refuses writes past ${value} GB, so the bucket cannot quietly outgrow it.`}
      </p>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      aria-label="Copy"
      onClick={() => {
        navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="shrink-0 w-8 h-8 grid place-items-center rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
    >
      {done ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
    </button>
  );
}

function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="bounce-in relative w-full max-w-md rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-[0_16px_48px_rgba(0,0,0,0.24)] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-display font-medium">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function KeyDialog({
  bucket,
  created,
  busy,
  onCreate,
  onClose,
}: {
  bucket: Bucket;
  created: { accessKeyId: string; secretAccessKey: string } | null;
  busy: boolean;
  onCreate: (name: string, readOnly: boolean) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(`${bucket.name}-key`);
  const [readOnly, setReadOnly] = useState(false);

  return (
    <Dialog title={`Access key for ${bucket.name}`} onClose={onClose}>
      {created ? (
        <>
          <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-800 dark:text-amber-500 text-pretty">
            <AlertTriangle size={13} className="inline mr-1 -mt-0.5" />
            Copy the secret now. Garage does not store it in retrievable form, so this is the only
            time it can be shown.
          </div>
          <Field label="Access key ID" value={created.accessKeyId} />
          <Field label="Secret access key" value={created.secretAccessKey} />
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </>
      ) : (
        <>
          <label className="block text-sm space-y-1">
            <span className="text-gray-700 dark:text-gray-300">Key name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-800 bg-transparent rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-accent-500"
            />
          </label>
          <label className="flex items-start gap-2.5 text-sm rounded-lg border border-gray-200 dark:border-gray-800 p-3 cursor-pointer">
            <input
              type="checkbox"
              className="accent-accent-600 mt-0.5"
              checked={readOnly}
              onChange={(e) => setReadOnly(e.target.checked)}
            />
            <span>
              <span className="text-gray-800 dark:text-gray-200">Read only</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                The key can list and download, but not upload or delete.
              </span>
            </span>
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={busy || !name} onClick={() => onCreate(name, readOnly)}>
              {busy ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null}
              Create key
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase font-semibold tracking-widest text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 font-mono text-xs bg-gray-100 dark:bg-gray-800 rounded-lg px-2.5 py-2 break-all">
          {value}
        </code>
        <CopyButton value={value} />
      </div>
    </div>
  );
}
