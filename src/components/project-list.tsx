"use client";

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from './ui/button';
import { PlusCircle, Globe, RefreshCw, ExternalLink } from 'lucide-react';
import { TableSkeleton } from './skeletons';

export interface Project {
  name: string;
  status: string;
  cpu: number;
  memoryMb: number;
  uptimeMs: number;
  restarts: number;
  port: number | null;
  url: string | null;
  system: boolean;
}

export function humanUptime(ms: number): string {
  if (!ms || ms < 1000) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'online'
      ? 'bg-green-500 text-green-700'
      : status === 'errored'
        ? 'bg-red-500 text-red-700'
        : 'bg-gray-400 text-gray-600';
  const [dot, text] = color.split(' ');
  return (
    <div className="flex items-center space-x-1.5">
      <span className={`w-2 h-2 rounded-full ${dot}`}></span>
      <span className={`font-medium text-sm ${text}`}>{status}</span>
    </div>
  );
}

export default function ProjectList() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setProjects(data.projects);
      setError('');
    } catch (e) {
      setError(`could not load projects: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  const apps = projects?.filter((p) => !p.system) ?? [];
  const system = projects?.filter((p) => p.system) ?? [];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
        <div className="flex items-center space-x-3">
          <Button variant="outline" className="flex items-center gap-2" onClick={load}>
            <RefreshCw className="h-4 w-4" />
            <span>Refresh</span>
          </Button>
          <Link href="/dashboard/new-service">
            <Button className="flex items-center gap-2 bg-black text-white hover:bg-black/90">
              <PlusCircle className="h-4 w-4" />
              <span>New project</span>
            </Button>
          </Link>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!projects && !error && (
        <>
          <TableSkeleton rows={4} cols={7} />
          <div>
            <h2 className="text-xl font-semibold mb-3 text-gray-700">System services</h2>
            <TableSkeleton rows={2} cols={7} />
          </div>
        </>
      )}

      {projects && (
        <>
          <ProjectTable projects={apps} emptyText="No projects yet — create one to get started." />

          <div>
            <h2 className="text-xl font-semibold mb-3 text-gray-700">System services</h2>
            <ProjectTable projects={system} emptyText="No system services running." />
          </div>
        </>
      )}
    </div>
  );
}

function ProjectTable({ projects, emptyText }: { projects: Project[]; emptyText: string }) {
  if (projects.length === 0) {
    return <p className="text-gray-500 border rounded-lg p-6">{emptyText}</p>;
  }
  return (
    <div className="overflow-x-auto border rounded-lg">
      <table className="min-w-full">
        <thead>
          <tr className="text-left text-xs font-semibold text-gray-700 uppercase tracking-wide bg-gray-50">
            <th className="px-4 py-3 whitespace-nowrap">Name</th>
            <th className="px-4 py-3 whitespace-nowrap">Status</th>
            <th className="px-4 py-3 whitespace-nowrap">Port</th>
            <th className="px-4 py-3 whitespace-nowrap">CPU</th>
            <th className="px-4 py-3 whitespace-nowrap">Memory</th>
            <th className="px-4 py-3 whitespace-nowrap">Uptime</th>
            <th className="px-4 py-3 whitespace-nowrap">Restarts</th>
            <th className="px-4 py-3 whitespace-nowrap">URL</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.name} className="border-t hover:bg-gray-50">
              <td className="px-4 py-3 whitespace-nowrap">
                <div className="flex items-center space-x-2">
                  <Globe size={16} className="text-gray-500" />
                  <Link
                    href={`/dashboard/services/${p.name}`}
                    className="font-medium text-gray-800 hover:underline"
                  >
                    {p.name}
                  </Link>
                </div>
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                <StatusBadge status={p.status} />
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                {p.port ?? '—'}
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">{p.cpu}%</td>
              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                {p.memoryMb ? `${p.memoryMb} MB` : '—'}
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                {humanUptime(p.uptimeMs)}
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">{p.restarts}</td>
              <td className="px-4 py-3 whitespace-nowrap text-sm">
                {p.url ? (
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-purple-600 hover:underline inline-flex items-center gap-1"
                  >
                    {p.url.replace('https://', '')}
                    <ExternalLink size={12} />
                  </a>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
