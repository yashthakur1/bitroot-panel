"use client";

import { useState } from 'react';
import { Button } from './ui/button';
import { AlertTriangle, Check, Loader2, X } from 'lucide-react';

export interface RemoveOptions {
  deleteDns: boolean;
  deleteFiles: boolean;
  deleteRepo: boolean;
}

// Removal is the one action people cannot undo, so it states plainly what is
// always removed and what is optional — rather than quietly leaving residue
// and mentioning it afterwards.
export default function RemoveDialog({
  name,
  kind,
  hosts,
  filesPath,
  repoPath,
  busy,
  onCancel,
  onConfirm,
}: {
  name: string;
  kind: 'project' | 'static site';
  hosts: string[];
  filesPath: string;
  repoPath?: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (opts: RemoveOptions) => void;
}) {
  const [deleteDns, setDeleteDns] = useState(true);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [deleteRepo, setDeleteRepo] = useState(false);

  const always =
    kind === 'project'
      ? ['Stop the process and unregister it from pm2', 'Remove the tunnel route', 'Free its port']
      : ['Stop serving it through nginx', 'Remove the tunnel route', 'Free its port'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={busy ? undefined : onCancel} />
      <div className="bounce-in relative w-full max-w-lg rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-[0_16px_48px_rgba(0,0,0,0.24)] p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-display font-medium flex items-center gap-2">
              <AlertTriangle size={18} className="text-red-500" />
              Remove {name}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Choose what to delete. Anything you keep is listed on the Residue page.
            </p>
          </div>
          <button
            onClick={onCancel}
            disabled={busy}
            className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            aria-label="Cancel"
          >
            <X size={18} />
          </button>
        </div>

        <div>
          <p className="text-xs uppercase font-semibold text-gray-500 dark:text-gray-400 mb-2">
            Always removed
          </p>
          <ul className="space-y-1.5">
            {always.map((line) => (
              <li key={line} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                <Check size={14} className="text-green-600 shrink-0 mt-0.5" />
                {line}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-xs uppercase font-semibold text-gray-500 dark:text-gray-400 mb-2">
            Also delete
          </p>
          <div className="space-y-2">
            <label
              className={`flex items-start gap-2.5 text-sm rounded-lg border p-3 cursor-pointer transition-colors ${
                hosts.length === 0
                  ? 'opacity-50 cursor-not-allowed border-gray-200 dark:border-gray-800'
                  : deleteDns
                    ? 'border-accent-500 bg-accent-50 dark:bg-accent-950/40'
                    : 'border-gray-200 dark:border-gray-700'
              }`}
            >
              <input
                type="checkbox"
                className="accent-accent-600 mt-0.5"
                checked={deleteDns && hosts.length > 0}
                disabled={hosts.length === 0}
                onChange={(e) => setDeleteDns(e.target.checked)}
              />
              <span>
                <span className="text-gray-800 dark:text-gray-200">Cloudflare DNS record</span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">
                  {hosts.length > 0
                    ? hosts.join(', ')
                    : 'no public hostname — nothing to delete'}
                </span>
              </span>
            </label>

            <label
              className={`flex items-start gap-2.5 text-sm rounded-lg border p-3 cursor-pointer transition-colors ${
                deleteFiles
                  ? 'border-red-400 dark:border-red-800 bg-red-50 dark:bg-red-950/30'
                  : 'border-gray-200 dark:border-gray-700'
              }`}
            >
              <input
                type="checkbox"
                className="accent-red-600 mt-0.5"
                checked={deleteFiles}
                onChange={(e) => setDeleteFiles(e.target.checked)}
              />
              <span>
                <span className="text-gray-800 dark:text-gray-200">Files on the phone</span>
                <span className="block text-xs text-gray-500 dark:text-gray-400 font-mono">
                  {filesPath}
                </span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">
                  Includes its .env — anything not pushed to git is gone for good.
                </span>
              </span>
            </label>

            {repoPath && (
              <label
                className={`flex items-start gap-2.5 text-sm rounded-lg border p-3 cursor-pointer transition-colors ${
                  deleteRepo
                    ? 'border-red-400 dark:border-red-800 bg-red-50 dark:bg-red-950/30'
                    : 'border-gray-200 dark:border-gray-700'
                }`}
              >
                <input
                  type="checkbox"
                  className="accent-red-600 mt-0.5"
                  checked={deleteRepo}
                  onChange={(e) => setDeleteRepo(e.target.checked)}
                />
                <span>
                  <span className="text-gray-800 dark:text-gray-200">Deploy repo</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400 font-mono">
                    {repoPath}
                  </span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">
                    &quot;git push phone main&quot; for this app stops working.
                  </span>
                </span>
              </label>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => onConfirm({ deleteDns: deleteDns && hosts.length > 0, deleteFiles, deleteRepo })}
          >
            {busy ? (
              <>
                <Loader2 size={14} className="animate-spin mr-1.5" /> Removing…
              </>
            ) : (
              `Remove ${name}`
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
