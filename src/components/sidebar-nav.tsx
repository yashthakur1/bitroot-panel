"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Box,
  Cloud,
  Database,
  PlusCircle,
  Recycle,
  Settings,
  ShieldCheck,
} from 'lucide-react';

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
      name: 'PocketBase',
      href: '/dashboard/pocketbase',
      icon: <Database size={18} />,
      active: pathname.startsWith('/dashboard/pocketbase'),
    },
    {
      name: 'Routes',
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
      name: 'Residue',
      href: '/dashboard/residue',
      icon: <Recycle size={18} />,
      active: pathname.startsWith('/dashboard/residue'),
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

      </div>
    </div>
  );
}
