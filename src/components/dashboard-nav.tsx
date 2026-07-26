"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plus, Globe, Settings, ShieldCheck, LogOut } from 'lucide-react';
import ThemeToggle from './theme-toggle';

export default function DashboardNav() {
  const pathname = usePathname();

  const serviceMatch = pathname.match(/^\/dashboard\/services\/([^/]+)/);
  const isNewService = pathname.includes('/new-service');

  return (
    <header className="border-b border-gray-200 dark:border-gray-800">
      <div className="flex items-center justify-between h-14 px-4">
        <div className="flex items-center space-x-4">
          <Link href="/dashboard" className="flex items-center">
            <div className="w-8 h-8 bg-black rounded flex items-center justify-center mr-1">
              <span className="text-white font-bold text-xs">B</span>
            </div>
          </Link>
          <div className="flex items-center rounded-md bg-gray-100 dark:bg-gray-800 px-2 py-1">
            <span className="font-medium text-gray-700 dark:text-gray-300">Bitroot Panel</span>
          </div>
          <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
            <Link href="/dashboard" className="hover:text-gray-900 dark:hover:text-gray-100">
              Projects
            </Link>
            {serviceMatch && (
              <>
                <span className="mx-2 text-gray-400">/</span>
                <span className="font-medium text-gray-800 dark:text-gray-200 flex items-center">
                  <Globe size={14} className="mr-1" />
                  {serviceMatch[1]}
                </span>
              </>
            )}
            {isNewService && (
              <>
                <span className="mx-2 text-gray-400">/</span>
                <span className="font-medium text-gray-800 dark:text-gray-200">New project</span>
              </>
            )}
            {pathname.startsWith('/dashboard/tunnel') && (
              <>
                <span className="mx-2 text-gray-400">/</span>
                <span className="font-medium text-gray-800 dark:text-gray-200">Tunnel</span>
              </>
            )}
            {pathname.startsWith('/dashboard/iam') && (
              <>
                <span className="mx-2 text-gray-400">/</span>
                <span className="font-medium text-gray-800 dark:text-gray-200">IAM</span>
              </>
            )}
            {pathname.startsWith('/dashboard/pocketbase') && (
              <>
                <span className="mx-2 text-gray-400">/</span>
                <span className="font-medium text-gray-800 dark:text-gray-200">PocketBase</span>
              </>
            )}
            {pathname.startsWith('/dashboard/config') && (
              <>
                <span className="mx-2 text-gray-400">/</span>
                <span className="font-medium text-gray-800 dark:text-gray-200">Config</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <Link href="/dashboard/new-service">
            <button className="flex items-center bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/60 rounded-md px-2 py-1.5 border">
              <Plus className="h-4 w-4 mr-1" />
              <span className="text-sm font-medium">New</span>
            </button>
          </Link>
          <ThemeToggle />
          <ProfileMenu />
        </div>
      </div>
    </header>
  );
}

function ProfileMenu() {
  async function signOut() {
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    window.location.href = '/';
  }

  return (
    <div className="relative group">
      <button
        aria-label="Profile"
        className="w-10 h-10 flex items-center justify-center"
      >
        <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center transition-transform group-hover:scale-105">
          <span className="text-white font-medium text-sm">Y</span>
        </div>
      </button>

      {/* pt-2 keeps the hover area contiguous between avatar and card */}
      <div className="hidden group-hover:block absolute right-0 top-full pt-2 z-50">
        <div className="bounce-in w-64 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-[0_8px_24px_rgba(0,0,0,0.10),0_2px_6px_rgba(0,0,0,0.06)] p-2">
          <div className="flex items-center gap-3 p-3">
            <div className="w-10 h-10 bg-purple-600 rounded-full flex items-center justify-center shrink-0">
              <span className="text-white font-medium">Y</span>
            </div>
            <div className="min-w-0">
              <div className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                Yash Thakur
                <span className="ml-2 text-[10px] font-semibold uppercase bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-800 px-1.5 py-0.5 rounded-full align-middle">
                  admin
                </span>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                yt@bitroot.org
              </div>
            </div>
          </div>
          <div className="h-px bg-gray-100 dark:bg-gray-800 mx-2 my-1" />
          <nav className="text-sm">
            <Link
              href="/dashboard/config"
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <Settings size={15} className="text-gray-500 dark:text-gray-400" /> Config
            </Link>
            <Link
              href="/dashboard/iam"
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <ShieldCheck size={15} className="text-gray-500 dark:text-gray-400" /> IAM
            </Link>
          </nav>
          <div className="h-px bg-gray-100 dark:bg-gray-800 mx-2 my-1" />
          <button
            onClick={signOut}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
