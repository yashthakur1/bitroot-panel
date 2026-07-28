"use client";

import { Box } from 'lucide-react';

// Placeholder. Deliberately says what this page is for and what already exists
// elsewhere, so it reads as unfinished rather than broken - and so it does not
// get mistaken for the Services page it was split out of.
export default function ProjectsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-display font-light tracking-tight flex items-center gap-3">
          <Box size={24} className="text-gray-500 dark:text-gray-400" />
          Projects
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2" style={{ textWrap: 'pretty' }}>
          A place to group the things that make up one piece of work — its services, static sites,
          buckets and routes — rather than listing them by what happens to run them.
        </p>
      </div>

      <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-8 text-center space-y-2">
        <p className="text-gray-700 dark:text-gray-300 text-sm">Nothing here yet.</p>
        <p className="text-gray-500 dark:text-gray-400 text-sm text-pretty max-w-md mx-auto">
          Everything currently deployed is on{' '}
          <a
            href="/dashboard"
            className="text-accent-600 dark:text-accent-400 hover:underline"
          >
            Services
          </a>
          , which lists processes and sites individually. This page is where they will be grouped.
        </p>
      </div>
    </div>
  );
}
