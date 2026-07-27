"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Box, Cloud, Database, Github, HardDrive, PanelsTopLeft, Plus, Recycle, Settings, ShieldCheck } from 'lucide-react';

interface Item {
  name: string;
  href: string;
  icon: React.ReactNode;
  match: (p: string) => boolean;
}

// Create actions sit above the navigation: they are things you *do*, not
// places you go.
const CREATE: Item[] = [
  {
    name: 'New project',
    href: '/dashboard/new-service',
    icon: <Plus size={16} />,
    match: (p) => p.startsWith('/dashboard/new-service'),
  },
  {
    name: 'New static site',
    href: '/dashboard/new-static',
    icon: <Plus size={16} />,
    match: (p) => p.startsWith('/dashboard/new-static'),
  },
];

const GROUPS: Array<{ title: string; items: Item[] }> = [
  {
    title: 'Deploy',
    items: [
      {
        name: 'Projects',
        href: '/dashboard',
        icon: <Box size={18} />,
        match: (p) => p === '/dashboard' || p.startsWith('/dashboard/services'),
      },
      {
        name: 'Static sites',
        href: '/dashboard/static',
        icon: <PanelsTopLeft size={18} />,
        match: (p) => p.startsWith('/dashboard/static'),
      },
    ],
  },
  {
    title: 'Infrastructure',
    items: [
      {
        name: 'Git connections',
        href: '/dashboard/git',
        icon: <Github size={18} />,
        match: (p) => p.startsWith('/dashboard/git'),
      },
      {
        name: 'PocketBase',
        href: '/dashboard/pocketbase',
        icon: <Database size={18} />,
        match: (p) => p.startsWith('/dashboard/pocketbase'),
      },
      {
        name: 'Storage',
        href: '/dashboard/storage',
        icon: <HardDrive size={18} />,
        match: (p) => p.startsWith('/dashboard/storage'),
      },
      {
        name: 'Routes',
        href: '/dashboard/tunnel',
        icon: <Cloud size={18} />,
        match: (p) => p.startsWith('/dashboard/tunnel'),
      },
      {
        name: 'IAM',
        href: '/dashboard/iam',
        icon: <ShieldCheck size={18} />,
        match: (p) => p.startsWith('/dashboard/iam'),
      },
    ],
  },
  {
    title: 'System',
    items: [
      {
        name: 'Residue',
        href: '/dashboard/residue',
        icon: <Recycle size={18} />,
        match: (p) => p.startsWith('/dashboard/residue'),
      },
      {
        name: 'Config',
        href: '/dashboard/config',
        icon: <Settings size={18} />,
        match: (p) => p.startsWith('/dashboard/config'),
      },
    ],
  },
];

export default function SidebarNav() {
  const pathname = usePathname();

  return (
    <div className="w-full h-full bg-white dark:bg-gray-900">
      <div className="flex flex-col h-full py-3">
        {/* Create */}
        <nav className="px-2 space-y-1">
          {CREATE.map((item) => (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                item.match(pathname)
                  ? 'bg-accent-50 dark:bg-accent-950/40 text-accent-700 dark:text-accent-300 font-medium'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              <span className="text-gray-400 dark:text-gray-500">{item.icon}</span>
              {item.name}
            </Link>
          ))}
        </nav>

        <div className="h-px bg-gray-100 dark:bg-gray-800 mx-4 my-3" />

        {/* Navigation */}
        <div className="flex-1 space-y-5">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="px-5 mb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                {group.title}
              </h3>
              <nav className="px-2 space-y-0.5">
                {group.items.map((item) => (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                      item.match(pathname)
                        ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-medium'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/60'
                    }`}
                  >
                    <span
                      className={
                        item.match(pathname)
                          ? 'text-accent-600 dark:text-accent-400'
                          : 'text-gray-400 dark:text-gray-500'
                      }
                    >
                      {item.icon}
                    </span>
                    {item.name}
                  </Link>
                ))}
              </nav>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
