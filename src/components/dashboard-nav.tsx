"use client";

import React from 'react';
import Link from 'next/link';
import { Plus, Settings, ShieldCheck, LogOut } from 'lucide-react';
import ThemeToggle from './theme-toggle';
import Logo from './logo';

// Fetched once per page session rather than per mount: the nav renders on every
// route and the answer cannot change without the process restarting.
let serverPromise: Promise<{ name: string; platform: string }> | null = null;
function serverInfo() {
  if (!serverPromise) {
    serverPromise = fetch('/api/server-name')
      .then((r) => r.json())
      .catch(() => ({ name: '', platform: '' }));
  }
  return serverPromise;
}

// Replaces a hardcoded "Dev Server" badge whose tooltip named one specific
// phone. Now it names the machine you are actually looking at, which is the
// thing worth knowing when the same panel runs on more than one.
function ServerBadge() {
  const [info, setInfo] = React.useState<{ name: string; platform: string } | null>(null);
  React.useEffect(() => {
    let live = true;
    serverInfo().then((d) => live && setInfo(d));
    return () => {
      live = false;
    };
  }, []);

  // Render nothing until it is known: a badge that briefly reads "loading" is
  // worse than one that simply appears.
  if (!info?.name) return null;

  return (
    <span
      title={info.platform}
      className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-1 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400"
    >
      {info.name}
    </span>
  );
}

export default function DashboardNav() {
  return (
    <header className="border-b border-gray-200 dark:border-gray-800">
      <div className="flex items-center justify-between h-14 px-4">
        <div className="flex items-center gap-2.5">
          <Link
            href="/dashboard"
            aria-label="BitPanel home"
            className="flex items-center gap-2 text-gray-900 dark:text-gray-100 transition-opacity hover:opacity-70"
          >
            <Logo size={22} />
            <span className="font-display font-medium">BitPanel</span>
          </Link>
          <ServerBadge />
        </div>

        <div className="flex items-center space-x-2">
          <Link href="/dashboard/new-service">
            <button className="flex items-center bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/60 rounded-md px-2 py-1.5 border border-gray-200 dark:border-gray-800 transition-colors">
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
      <button aria-label="Profile" className="w-10 h-10 flex items-center justify-center">
        <div className="w-8 h-8 bg-accent-600 rounded-full flex items-center justify-center transition-transform group-hover:scale-105">
          <span className="text-white font-medium text-sm">Y</span>
        </div>
      </button>

      {/* pt-2 keeps the hover area contiguous between avatar and card */}
      <div className="hidden group-hover:block absolute right-0 top-full pt-2 z-50">
        <div className="bounce-in w-64 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-[0_8px_24px_rgba(0,0,0,0.10),0_2px_6px_rgba(0,0,0,0.06)] p-2">
          <div className="flex items-center gap-3 p-3">
            <div className="w-10 h-10 bg-accent-600 rounded-full flex items-center justify-center shrink-0">
              <span className="text-white font-medium">Y</span>
            </div>
            <div className="min-w-0">
              <div className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                {process.env.NEXT_PUBLIC_ADMIN_NAME ?? 'Administrator'}
                <span className="ml-2 text-[10px] font-semibold uppercase bg-accent-50 dark:bg-accent-950/40 text-accent-600 dark:text-accent-400 border border-accent-200 dark:border-accent-800 px-1.5 py-0.5 rounded-full align-middle">
                  admin
                </span>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {process.env.NEXT_PUBLIC_SUPERADMIN_EMAIL ?? 'admin@example.com'}
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
