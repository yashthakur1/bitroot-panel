"use client";

import { useCallback, useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Boxes,
  Loader2,
  Plus,
  Copy,
  Check,
  Link2,
  ChevronDown,
  Table2,
  ExternalLink,
} from 'lucide-react';
import { TableSkeleton } from './skeletons';

interface Collection {
  name: string;
  type: string;
  records: number;
}

interface Db {
  name: string;
  created: string;
  withAuth: boolean;
  collections: Collection[];
  records: number;
  internalUrl: string;
  publicUrl: string;
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
      className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors py-1"
    >
      {copied ? (
        <>
          <Check size={12} className="text-green-600 pop-in" /> copied
        </>
      ) : (
        <>
          <Copy size={12} /> {label ?? 'copy'}
        </>
      )}
    </button>
  );
}

export default function PocketBaseDatabases() {
  const [dbs, setDbs] = useState<Db[] | null>(null);
  const [unassigned, setUnassigned] = useState<Collection[]>([]);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [withAuth, setWithAuth] = useState(true);
  const [note, setNote] = useState('');
  const [expanded, setExpanded] = useState('');
  const [projects, setProjects] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/pocketbase/databases');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data.error ||
            `Could not reach the PocketBase admin API (HTTP ${res.status}). Check that the pocketbase service is running.`,
        );
      }
      setDbs(data.databases);
      setUnassigned(data.unassigned ?? []);
      setError('');
    } catch (e) {
      setError((e as Error).message);
      setDbs([]);
    }
  }, []);

  useEffect(() => {
    load();
    fetch('/api/projects')
      .then((r) => r.json())
      .then((d) =>
        setProjects(
          (d.projects ?? [])
            .filter((p: { system: boolean; name: string }) => !p.system && p.name !== 'pocketbase')
            .map((p: { name: string }) => p.name),
        ),
      )
      .catch(() => {});
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setNote('');
    try {
      const res = await fetch('/api/pocketbase/databases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, withAuth }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setNote(`Created ${data.collections.join(', ')}`);
        setName('');
        setShowForm(false);
        setExpanded(data.name);
        load();
      } else {
        setNote(data.error ?? `HTTP ${res.status}`);
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-display font-medium flex items-center gap-2">
          <Boxes size={18} className="text-gray-500 dark:text-gray-400" />
          Project databases
        </h2>
        <Button size="sm" onClick={() => setShowForm(!showForm)}>
          <Plus size={14} className="mr-1.5" /> New database
        </Button>
      </div>

      <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
        Each database is a namespace of collections inside the shared PocketBase instance —
        instant to create, with connection details you can drop straight into a project.
      </p>

      {showForm && (
        <form
          onSubmit={create}
          className="fade-in-up border rounded-xl p-5 mb-4 space-y-3 bg-gray-50 dark:bg-gray-800/60"
        >
          <div className="flex gap-3 flex-wrap items-end">
            <div className="flex flex-col flex-1 min-w-52">
              <Label htmlFor="db-name">Database name</Label>
              <Input
                id="db-name"
                placeholder="myapp"
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                required
              />
              <span className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                creates <code>{name || 'myapp'}_items</code>
                {withAuth && (
                  <>
                    {' '}
                    and <code>{name || 'myapp'}_users</code>
                  </>
                )}
              </span>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 pb-2">
              <input
                type="checkbox"
                className="accent-purple-600"
                checked={withAuth}
                onChange={(e) => setWithAuth(e.target.checked)}
              />
              include auth collection
            </label>
            <Button type="submit" disabled={creating || name.length < 2} className="mb-0.5">
              {creating ? (
                <>
                  <Loader2 size={13} className="animate-spin mr-1.5" /> Creating…
                </>
              ) : (
                'Create'
              )}
            </Button>
          </div>
        </form>
      )}

      {note && <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 fade-in-up">{note}</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}
      {!dbs && !error && <TableSkeleton rows={2} cols={4} />}

      {dbs && dbs.length === 0 && !error && (
        <p className="border rounded-lg p-6 text-sm text-gray-500 dark:text-gray-400">
          No project databases yet. Create one to get collections plus ready-to-paste
          connection details.
        </p>
      )}

      <div className="space-y-3">
        {(dbs ?? []).map((db) => (
          <DbCard
            key={db.name}
            db={db}
            projects={projects}
            open={expanded === db.name}
            onToggle={() => setExpanded(expanded === db.name ? '' : db.name)}
            onChanged={load}
          />
        ))}
      </div>

      {unassigned.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">
            Other collections
          </h3>
          <div className="border rounded-lg divide-y dark:divide-gray-800 text-sm">
            {unassigned.map((c) => (
              <div key={c.name} className="px-4 py-2.5 flex items-center justify-between">
                <span className="font-mono text-gray-700 dark:text-gray-300">{c.name}</span>
                <span className="text-gray-500 dark:text-gray-400 tabular-nums">
                  {c.records} records · {c.type}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DbCard({
  db,
  projects,
  open,
  onToggle,
  onChanged,
}: {
  db: Db;
  projects: string[];
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const [linkTo, setLinkTo] = useState('');
  const [linking, setLinking] = useState(false);
  const [linkNote, setLinkNote] = useState('');

  const envBlock = `POCKETBASE_URL=${db.internalUrl}\nPOCKETBASE_PUBLIC_URL=${db.publicUrl}\nPOCKETBASE_PREFIX=${db.name}_`;
  const snippet = `import PocketBase from 'pocketbase';

const pb = new PocketBase(process.env.POCKETBASE_URL);
const items = await pb.collection('${db.name}_items').getList(1, 20);`;

  async function link() {
    if (!linkTo) return;
    setLinking(true);
    setLinkNote('');
    try {
      const res = await fetch(`/api/projects/${linkTo}/env`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vars: [
            { key: 'POCKETBASE_URL', value: db.internalUrl },
            { key: 'POCKETBASE_PUBLIC_URL', value: db.publicUrl },
            { key: 'POCKETBASE_PREFIX', value: `${db.name}_` },
          ],
          restart: true,
        }),
      });
      setLinkNote(res.ok ? `Written to ${linkTo}/.env and restarted.` : 'could not write env');
      onChanged();
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className="border rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <Table2 size={16} className="text-gray-500 dark:text-gray-400 shrink-0" />
          <span className="font-medium text-gray-900 dark:text-gray-100">{db.name}</span>
          <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
            {db.collections.length} collections · {db.records} records
          </span>
        </div>
        <ChevronDown
          size={16}
          className={`text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="fade-in-up border-t dark:border-gray-800 p-5 space-y-4">
          {/* Collections */}
          <div className="flex flex-wrap gap-2">
            {db.collections.map((c) => (
              <span
                key={c.name}
                className="text-xs font-mono bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-2 py-1 rounded"
              >
                {c.name}
                <span className="text-gray-500 dark:text-gray-500 ml-1.5 tabular-nums">
                  {c.records}
                </span>
              </span>
            ))}
            <a
              href={`${db.publicUrl}/_/#/collections`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-purple-600 dark:text-purple-400 hover:underline inline-flex items-center gap-1 px-1 py-1"
            >
              manage in admin <ExternalLink size={10} />
            </a>
          </div>

          {/* Connection details */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs uppercase font-semibold text-gray-500 dark:text-gray-400">
                  Environment
                </span>
                <CopyButton text={envBlock} label="copy .env" />
              </div>
              <pre className="bg-black text-gray-100 font-mono text-[11px] rounded-md p-3 overflow-auto">
                {envBlock}
              </pre>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs uppercase font-semibold text-gray-500 dark:text-gray-400">
                  Usage
                </span>
                <CopyButton text={snippet} label="copy snippet" />
              </div>
              <pre className="bg-black text-gray-100 font-mono text-[11px] rounded-md p-3 overflow-auto">
                {snippet}
              </pre>
            </div>
          </div>

          {/* Link to a project */}
          <div className="flex items-center gap-2 flex-wrap">
            <Link2 size={15} className="text-gray-500 dark:text-gray-400" />
            <span className="text-sm text-gray-700 dark:text-gray-300">Link to project:</span>
            <select
              value={linkTo}
              onChange={(e) => setLinkTo(e.target.value)}
              className="border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1.5 text-sm bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
            >
              <option value="">— select —</option>
              {projects.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <Button size="sm" variant="outline" disabled={!linkTo || linking} onClick={link}>
              {linking ? (
                <>
                  <Loader2 size={12} className="animate-spin mr-1.5" /> Writing…
                </>
              ) : (
                'Write env + restart'
              )}
            </Button>
            {linkNote && (
              <span className="fade-in-up text-sm text-green-700 dark:text-green-400">
                {linkNote}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
