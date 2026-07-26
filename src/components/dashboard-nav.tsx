"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plus, Globe } from 'lucide-react';

export default function DashboardNav() {
  const pathname = usePathname();

  const serviceMatch = pathname.match(/^\/dashboard\/services\/([^/]+)/);
  const isNewService = pathname.includes('/new-service');

  return (
    <header className="border-b border-gray-200">
      <div className="flex items-center justify-between h-14 px-4">
        <div className="flex items-center space-x-4">
          <Link href="/dashboard" className="flex items-center">
            <div className="w-8 h-8 bg-black rounded flex items-center justify-center mr-1">
              <span className="text-white font-bold text-xs">B</span>
            </div>
          </Link>
          <div className="flex items-center rounded-md bg-gray-100 px-2 py-1">
            <span className="font-medium text-gray-700">Bitroot Panel</span>
          </div>
          <div className="flex items-center text-sm text-gray-600">
            <Link href="/dashboard" className="hover:text-gray-900">
              Projects
            </Link>
            {serviceMatch && (
              <>
                <span className="mx-2 text-gray-400">/</span>
                <span className="font-medium text-gray-800 flex items-center">
                  <Globe size={14} className="mr-1" />
                  {serviceMatch[1]}
                </span>
              </>
            )}
            {isNewService && (
              <>
                <span className="mx-2 text-gray-400">/</span>
                <span className="font-medium text-gray-800">New project</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <Link href="/dashboard/new-service">
            <button className="flex items-center bg-white hover:bg-gray-50 rounded-md px-2 py-1.5 border">
              <Plus className="h-4 w-4 mr-1" />
              <span className="text-sm font-medium">New</span>
            </button>
          </Link>
          <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center">
            <span className="text-white font-medium text-sm">Y</span>
          </div>
        </div>
      </div>
    </header>
  );
}
