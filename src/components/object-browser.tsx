"use client";

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Download,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  File as FileIcon,
  Loader2,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from './ui/button';
import { TableSkeleton } from './skeletons';

export interface S3Object {
  key: string;
  size: number;
  lastModified: string;
  etag: string;
}

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

const EXT = (k: string) => (k.includes('.') ? k.split('.').pop()!.toLowerCase() : '');

const IMAGE = /^(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/;
const VIDEO = /^(mp4|webm|mov|mkv|m4v)$/;
const AUDIO = /^(mp3|wav|ogg|opus|flac|m4a)$/;
const TEXT = /^(txt|md|json|ya?ml|csv|log|js|ts|tsx|jsx|css|html|xml|sh|toml|ini|env)$/;
// Formats that can carry an alpha channel. A JPEG never has transparent
// pixels, so striping behind one would only imply something untrue.
const ALPHA = /^(png|svg|webp|avif|gif|ico)$/;

function kindOf(key: string): 'image' | 'video' | 'audio' | 'text' | 'other' {
  const e = EXT(key);
  if (IMAGE.test(e)) return 'image';
  if (VIDEO.test(e)) return 'video';
  if (AUDIO.test(e)) return 'audio';
  if (TEXT.test(e)) return 'text';
  return 'other';
}

function KindIcon({ kind }: { kind: ReturnType<typeof kindOf> }) {
  const cls = 'text-gray-500 dark:text-gray-400 shrink-0';
  if (kind === 'image') return <ImageIcon size={15} className={cls} />;
  if (kind === 'video') return <Film size={15} className={cls} />;
  if (kind === 'audio') return <Music size={15} className={cls} />;
  if (kind === 'text') return <FileText size={15} className={cls} />;
  return <FileIcon size={15} className={cls} />;
}

export default function ObjectBrowser({
  bucket,
  onBack,
  onChanged,
}: {
  bucket: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [objects, setObjects] = useState<S3Object[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<S3Object | null>(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/storage/${bucket}/objects`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      setObjects(d.objects);
      setError('');
    } catch (e) {
      setError(`could not list objects: ${(e as Error).message}`);
      setObjects([]);
    }
  }, [bucket]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(key: string) {
    setBusy(key);
    try {
      const res = await fetch(
        `/api/storage/${bucket}/objects?key=${encodeURIComponent(key)}`,
        { method: 'DELETE' },
      );
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setError(d.error ?? `HTTP ${res.status}`);
      if (selected?.key === key) setSelected(null);
      await load();
      onChanged();
    } finally {
      setBusy('');
    }
  }

  const visible = (objects ?? []).filter((o) =>
    o.key.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
        >
          <ArrowLeft size={15} /> Buckets
        </button>
        <span className="text-gray-300 dark:text-gray-700">/</span>
        <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{bucket}</span>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search files"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-10 pr-4 py-2.5 border border-gray-200 dark:border-gray-800 bg-transparent rounded-lg w-full text-sm focus:outline-none focus:ring-1 focus:ring-accent-500 transition-shadow"
        />
      </div>

      <div>
        <div className="min-w-0">
          {!objects && <TableSkeleton rows={4} cols={3} />}
          {objects && visible.length === 0 && (
            <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-8 text-center">
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                {query ? `Nothing matching "${query}"` : 'This bucket is empty.'}
              </p>
            </div>
          )}
          {objects && visible.length > 0 && (
            <div className="overflow-x-auto border border-gray-200 dark:border-gray-800 rounded-lg">
              <table className="min-w-full">
                <thead>
                  <tr className="text-left text-[11px] font-mono uppercase tracking-widest text-gray-500 dark:text-gray-400">
                    <th className="px-4 py-3 font-medium whitespace-nowrap">
                      File{' '}
                      <span className="ml-1 border border-gray-300 dark:border-gray-700 rounded px-1 tabular-nums">
                        {visible.length}
                      </span>
                    </th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">Size</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">Modified</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((o) => (
                    <tr
                      key={o.key}
                      onClick={() => setSelected(o)}
                      className={`border-t border-gray-100 dark:border-gray-800/80 cursor-pointer transition-colors ${
                        selected?.key === o.key
                          ? 'bg-accent-50 dark:bg-accent-950/40'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800/40'
                      }`}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <KindIcon kind={kindOf(o.key)} />
                          <span className="text-sm text-gray-800 dark:text-gray-200 truncate">
                            {o.key}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400 tabular-nums">
                        {human(o.size)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400 tabular-nums">
                        {o.lastModified ? new Date(o.lastModified).toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>

      {selected && (
        <Details
          bucket={bucket}
          object={selected}
          busy={busy === selected.key}
          onClose={() => setSelected(null)}
          onDelete={() => remove(selected.key)}
        />
      )}
    </div>
  );
}

function Details({
  bucket,
  object,
  busy,
  onClose,
  onDelete,
}: {
  bucket: string;
  object: S3Object;
  busy: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  const kind = kindOf(object.key);
  const src = `/api/storage/${bucket}/objects/raw?key=${encodeURIComponent(object.key)}`;
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    setText(null);
    // Only small text files are inlined; a large log would otherwise be pulled
    // through the panel in full just to fill a preview pane.
    if (kind !== 'text' || object.size > 256 * 1024) return;
    let cancelled = false;
    fetch(src)
      .then((r) => r.text())
      .then((t) => !cancelled && setText(t.slice(0, 20000)))
      .catch(() => !cancelled && setText(null));
    return () => {
      cancelled = true;
    };
  }, [src, kind, object.size]);

  return (
    <>
      {/* Dimmed rather than blurred: a backdrop-filter repaints the whole area
          behind it every frame, which is the expensive option on a phone. */}
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className="slide-in-right fixed right-0 top-0 z-50 h-full w-full max-w-sm overflow-y-auto border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-[0_0_40px_rgba(0,0,0,0.3)] p-5 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <KindIcon kind={kind} />
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200 break-all">
            {object.key.split('/').pop()}
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close details"
          className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors shrink-0"
        >
          <X size={16} />
        </button>
      </div>

      <div
        className={`rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden ${
          kind === 'image'
            ? ALPHA.test(EXT(object.key))
              ? 'alpha-canvas'
              : 'opaque-canvas'
            : 'bg-gray-50 dark:bg-gray-900/60'
        }`}
      >
        {kind === 'image' && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={object.key} className="w-full max-h-64 object-contain" />
        )}
        {kind === 'video' && <video src={src} controls className="w-full max-h-56" />}
        {kind === 'audio' && <audio src={src} controls className="w-full p-3" />}
        {kind === 'text' &&
          (text === null ? (
            <p className="p-3 text-xs text-gray-500 dark:text-gray-400">
              {object.size > 256 * 1024 ? 'Too large to preview inline.' : 'Loading…'}
            </p>
          ) : (
            <pre className="p-3 text-[11px] font-mono max-h-56 overflow-auto whitespace-pre-wrap text-gray-700 dark:text-gray-300">
              {text}
            </pre>
          ))}
        {kind === 'other' && (
          <p className="p-6 text-xs text-center text-gray-500 dark:text-gray-400">
            No preview for this file type.
          </p>
        )}
      </div>

      <dl className="space-y-2 text-xs">
        <Row label="Key" value={object.key} mono />
        <Row label="Size" value={`${human(object.size)} (${object.size.toLocaleString()} bytes)`} />
        <Row
          label="Modified"
          value={object.lastModified ? new Date(object.lastModified).toLocaleString() : '—'}
        />
        <Row label="Type" value={EXT(object.key) || 'unknown'} />
        <Row label="ETag" value={object.etag || '—'} mono />
        <Row label="Bucket" value={bucket} mono />
      </dl>

      <div className="flex gap-2">
        <a href={`${src}&download=1`} className="flex-1">
          <Button variant="secondary" size="sm" fullWidth className="flex items-center gap-1.5">
            <Download size={14} /> Download
          </Button>
        </a>
        <Button
          variant="destructive"
          size="sm"
          disabled={busy}
          onClick={() => {
            if (confirm(`Delete "${object.key}"? This cannot be undone.`)) onDelete();
          }}
          className="flex items-center gap-1.5"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
        </Button>
      </div>
      </aside>
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="uppercase font-semibold tracking-widest text-[10px] text-gray-500 dark:text-gray-400">
        {label}
      </dt>
      <dd
        className={`text-gray-700 dark:text-gray-300 break-all ${mono ? 'font-mono text-[11px]' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}
