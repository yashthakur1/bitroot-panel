"use client";

import React from 'react';
import DashboardNav from './dashboard-nav';
import SidebarNav from './sidebar-nav';
import KeyboardShortcuts from './keyboard-shortcuts';

export default function DashboardLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col min-h-screen bg-white dark:bg-gray-900">
      <KeyboardShortcuts />
      {/* Top Navigation Bar */}
      <DashboardNav />

      {/* Main Content with Sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 border-r border-gray-200 dark:border-gray-800 min-h-screen">
          <SidebarNav />
        </div>

        {/* Main Content */}
        <main className="flex-1 overflow-auto bg-white dark:bg-gray-900">
          <div className="container max-w-7xl mx-auto px-6 py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
