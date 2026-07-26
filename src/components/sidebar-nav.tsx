"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Box, Cloud, PlusCircle, Settings, ShieldCheck, Smartphone } from 'lucide-react';

export default function SidebarNav() {
  const pathname = usePathname();

  const navItems = [
    {
      name: 'Projects',
      href: '/dashboard',
      icon: <Box size={18} />,
      active: pathname === '/dashboard' || pathname.startsWith('/dashboard/services'),
    },
    {
      name: 'New project',
      href: '/dashboard/new-service',
      icon: <PlusCircle size={18} />,
      active: pathname.startsWith('/dashboard/new-service'),
    },
    {
      name: 'Tunnel',
      href: '/dashboard/tunnel',
      icon: <Cloud size={18} />,
      active: pathname.startsWith('/dashboard/tunnel'),
    },
    {
      name: 'IAM',
      href: '/dashboard/iam',
      icon: <ShieldCheck size={18} />,
      active: pathname.startsWith('/dashboard/iam'),
    },
    {
      name: 'Config',
      href: '/dashboard/config',
      icon: <Settings size={18} />,
      active: pathname.startsWith('/dashboard/config'),
    },
  ];

  return (
    <div className="w-full h-full bg-white dark:bg-gray-900">
      <div className="flex flex-col h-full">
        <div className="flex-1">
          <nav className="space-y-1 py-2">
            {navItems.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center px-3 py-2 text-sm ${
                  item.active
                    ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 font-medium'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <span className="mr-3 text-gray-500 dark:text-gray-400">{item.icon}</span>
                <span className="flex-1">{item.name}</span>
              </Link>
            ))}
          </nav>
        </div>

        <div className="mt-auto border-t pt-3 pb-3 px-3 space-y-2">
          <div className="text-xs text-gray-400">
            <kbd className="border rounded px-1">g</kbd>+<kbd className="border rounded px-1">l</kbd> panel logs
            {' · '}
            <kbd className="border rounded px-1">g</kbd>+<kbd className="border rounded px-1">h</kbd> home
            {' · '}
            <kbd className="border rounded px-1">g</kbd>+<kbd className="border rounded px-1">n</kbd> new
          </div>
          <div className="flex items-center text-xs text-gray-500 dark:text-gray-400">
            <Smartphone size={14} className="mr-2" />
            OnePlus 6 · Termux · pm2
          </div>
        </div>
      </div>
    </div>
  );
}
