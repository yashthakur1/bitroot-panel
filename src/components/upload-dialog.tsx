"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, FileUp, Loader2, Sparkles, X } from 'lucide-react';
import { Button } from './ui/button';

// Formats that are already compressed. Running gzip over these costs CPU and
// time on a phone-bound upload and returns roughly nothing - occasionally
// slightly more than the original.
const ALREADY_COMPRESSED =
  /\.(jpe?g|png|gif|webp|avif|heic|mp[34]|m4[av]|mov|webm|mkv|ogg|opus|flac|zip|gz|bz2|xz|zst|7z|rar|pdf|woff2?|br)$/i;

// Below this, the round trip through gzip is not worth the metadata or the
// risk of a client that mishandles Content-Encoding.
const MIN_SAVING = 0.05;
const MIN_SIZE = 1024;

export interface Analysed {
  file: File;
  compressible: boolean;
  original: number;
  compressed: number | null;
  blob: Blob | null;
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

async function gzip(file: File): Promise<Blob | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = file.stream().pipeThrough(new CompressionStream('gzip'));
    return await new Response(stream).blob();
  } catch {
    return null;
  }
}

// Measured, not guessed: every candidate is actually gzipped so the dialog can
// state a real saving rather than a hopeful one.
async function analyse(file: File): Promise<Analysed> {
  const base: Analysed = {
    file,
    compressible: false,
    original: file.size,
    compressed: null,
    blob: null,
  };
  if (file.size < MIN_SIZE || ALREADY_COMPRESSED.test(file.name)) return base;

  const blob = await gzip(file);
  if (!blob) return base;

  const saving = 1 - blob.size / file.size;
  if (saving < MIN_SAVING) return base;
  return { ...base, compressible: true, compressed: blob.size, blob };
}

export default function UploadDialog({
  bucket,
  isPublic,
  onClose,
  onDone,
}: {
  bucket: string;
  isPublic: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [files, setFiles] = useState<Analysed[] | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [compress, setCompress] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<Array<{ name: string; ok: boolean; note: string }>>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = useCallback(async (list: FileList | null) => {
    if (!list?.length) return;
    setAnalysing(true);
    setResults([]);
    try {
      setFiles(await Promise.all(Array.from(list).map(analyse)));
    } finally {
      setAnalysing(false);
    }
  }, []);

  useEffect(() => {
    inputRef.current?.click();
  }, []);

  const candidates = files?.filter((f) => f.compressible) ?? [];
  const totalOriginal = files?.reduce((n, f) => n + f.original, 0) ?? 0;
  const totalToSend =
    files?.reduce((n, f) => n + (compress && f.compressible ? f.compressed! : f.original), 0) ?? 0;
  const saving = totalOriginal ? 1 - totalToSend / totalOriginal : 0;

  async function upload() {
    if (!files) return;
    setUploading(true);
    setProgress({ done: 0, total: files.length });
    const out: Array<{ name: string; ok: boolean; note: string }> = [];
    for (const f of files) {
      const useGz = compress && f.compressible;
      const body = new FormData();
      body.append('file', useGz ? new File([f.blob!], f.file.name) : f.file);
      body.append('key', f.file.name);
      body.append('contentType', f.file.type || 'application/octet-stream');
      if (useGz) body.append('contentEncoding', 'gzip');
      try {
        const res = await fetch(`/api/storage/${bucket}/objects`, { method: 'POST', body });
        const d = await res.json().catch(() => ({}));
        out.push({
          name: f.file.name,
          ok: res.ok,
          note: res.ok
            ? useGz
              ? `${human(f.original)} → ${human(f.compressed!)} gzipped`
              : human(f.original)
            : (d.error ?? `HTTP ${res.status}`),
        });
      } catch (e) {
        out.push({ name: f.file.name, ok: false, note: (e as Error).message });
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
      setResults([...out]);
    }
    setUploading(false);
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={uploading ? undefined : onClose} />
      <div className="bounce-in relative w-full max-w-lg rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-[0_16px_48px_rgba(0,0,0,0.24)] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-display font-medium">Upload to {bucket}</h2>
          <button
            onClick={onClose}
            disabled={uploading}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => pick(e.target.files)}
        />

        {analysing && (
          <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Checking what compresses…
          </p>
        )}

        {!analysing && !files && (
          <Button variant="outline" fullWidth onClick={() => inputRef.current?.click()}>
            <FileUp size={15} className="mr-1.5" /> Choose files
          </Button>
        )}

        {files && !uploading && results.length === 0 && (
          <>
            <div className="max-h-52 overflow-auto rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
              {files.map((f) => (
                <div key={f.file.name} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="truncate text-gray-800 dark:text-gray-200">{f.file.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-gray-500 dark:text-gray-400">
                    {f.compressible && compress ? (
                      <>
                        {human(f.original)} <span className="text-green-600 dark:text-green-500">→ {human(f.compressed!)}</span>
                      </>
                    ) : (
                      human(f.original)
                    )}
                  </span>
                </div>
              ))}
            </div>

            {candidates.length > 0 ? (
              <label className="flex items-start gap-2.5 text-sm rounded-lg border border-accent-200 dark:border-accent-900 bg-accent-50 dark:bg-accent-950/40 p-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-accent-600 mt-0.5"
                  checked={compress}
                  onChange={(e) => setCompress(e.target.checked)}
                />
                <span>
                  <span className="text-gray-800 dark:text-gray-200 font-medium flex items-center gap-1.5">
                    <Sparkles size={13} className="text-accent-600 dark:text-accent-400" />
                    Compress {candidates.length} file{candidates.length === 1 ? '' : 's'} losslessly
                  </span>
                  <span className="block text-xs text-gray-600 dark:text-gray-400 mt-0.5 text-pretty">
                    Sends {human(totalToSend)} instead of {human(totalOriginal)} —{' '}
                    <strong>{(saving * 100).toFixed(0)}% less</strong> over a{' '}
                    {isPublic ? '1.8 MB/s uplink' : 'Tailscale link'}. Stored gzipped with{' '}
                    <code className="font-mono">Content-Encoding</code>, so readers get the original
                    bytes back byte for byte.
                  </span>
                </span>
              </label>
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400 rounded-lg border border-gray-200 dark:border-gray-800 p-3 text-pretty">
                Nothing here compresses usefully — these formats are already compressed, so they
                upload as-is.
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setFiles(null)}>
                Back
              </Button>
              <Button onClick={upload} className="active:scale-[0.96] transition-transform">
                Upload {files.length} file{files.length === 1 ? '' : 's'}
              </Button>
            </div>
          </>
        )}

        {(uploading || results.length > 0) && (
          <>
            <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-accent-500 transition-[width] duration-300"
                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
              />
            </div>
            <div className="max-h-52 overflow-auto space-y-1">
              {results.map((r) => (
                <div key={r.name} className="flex items-start gap-2 text-xs">
                  {r.ok ? (
                    <Check size={13} className="text-green-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle size={13} className="text-red-500 shrink-0 mt-0.5" />
                  )}
                  <span className="text-gray-700 dark:text-gray-300 truncate">{r.name}</span>
                  <span className={`ml-auto shrink-0 ${r.ok ? 'text-gray-500 dark:text-gray-400' : 'text-red-500'}`}>
                    {r.note}
                  </span>
                </div>
              ))}
            </div>
            {!uploading && (
              <div className="flex justify-end">
                <Button onClick={onClose}>Done</Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
