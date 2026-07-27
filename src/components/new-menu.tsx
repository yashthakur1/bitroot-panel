"use client";

import { useState } from 'react';
import Link from 'next/link';
import {
  Plus,
  ChevronDown,
  PanelsTopLeft,
  Globe,
  Lock,
  Workflow,
  ListEnd,
  Clock,
  Database,
  Layers,
  Boxes,
  FileText,
} from 'lucide-react';

interface Item {
  icon: React.ReactNode;
  label: string;
  href?: string;
  soon?: boolean;
  beta?: boolean;
}

const GROUPS: Item[][] = [
  [
    { icon: <PanelsTopLeft size={16} />, label: 'Static Site', href: '/dashboard/new-static' },
    { icon: <Globe size={16} />, label: 'Web Service', href: '/dashboard/new-service?env=public' },
    { icon: <Lock size={16} />, label: 'Private Service', href: '/dashboard/new-service?env=private' },
    { icon: <Workflow size={16} />, label: 'Workflow', soon: true, beta: true },
    { icon: <ListEnd size={16} />, label: 'Background Worker', soon: true },
    { icon: <Clock size={16} />, label: 'Cron Job', soon: true },
  ],
  [
    { icon: <Database size={16} />, label: 'PocketBase SQLite', href: '/dashboard/pocketbase' },
    { icon: <Layers size={16} />, label: 'Key Value', soon: true },
  ],
  [
    { icon: <Boxes size={16} />, label: 'Project', soon: true },
    { icon: <FileText size={16} />, label: 'Blueprint', soon: true },
  ],
];

export default function NewMenu() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-500 active:bg-purple-700 text-white font-medium text-sm rounded-md px-4 h-10 transition-[background-color,scale] active:scale-[0.96]"
      >
        <Plus size={15} />
        New
        <ChevronDown
          size={14}
          className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="bounce-in absolute right-0 top-full mt-2 w-64 z-50 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-[0_8px_24px_rgba(0,0,0,0.12),0_2px_6px_rgba(0,0,0,0.06)] p-1.5">
            {GROUPS.map((group, gi) => (
              <div key={gi}>
                {gi > 0 && <div className="h-px bg-gray-100 dark:bg-gray-800 mx-2 my-1.5" />}
                {group.map((item) =>
                  item.soon ? (
                    <div
                      key={item.label}
                      className="group/item relative flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-gray-400 dark:text-gray-600 cursor-not-allowed select-none"
                    >
                      <span className="opacity-60">{item.icon}</span>
                      <span className="flex-1">{item.label}</span>
                      {item.beta && (
                        <span className="text-[10px] font-semibold uppercase bg-purple-600/80 text-white px-1.5 py-0.5 rounded">
                          beta
                        </span>
                      )}
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-medium bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 px-1.5 py-0.5 rounded opacity-0 group-hover/item:opacity-100 transition-opacity duration-150">
                        coming soon
                      </span>
                    </div>
                  ) : (
                    <Link
                      key={item.label}
                      href={item.href!}
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    >
                      <span className="text-gray-500 dark:text-gray-400">{item.icon}</span>
                      {item.label}
                    </Link>
                  ),
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
