"use client";

import { Sun, Moon } from 'lucide-react';

// Theme state lives as a `dark` class on <html> (set pre-paint by the script
// in layout.tsx). Both icons stay in the DOM and cross-fade via CSS, so there
// is nothing to hydrate and no flash.
export default function ThemeToggle() {
  function toggle() {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('bp-theme', next ? 'dark' : 'light');
    } catch {
      // private browsing etc.
    }
  }

  const iconBase =
    'absolute transition-[opacity,transform,filter] duration-300 ease-[cubic-bezier(0.2,0,0,1)]';

  return (
    <button
      onClick={toggle}
      aria-label="Toggle dark mode"
      className="relative w-10 h-10 flex items-center justify-center rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
    >
      <Sun
        size={17}
        className={`${iconBase} opacity-100 scale-100 blur-0 dark:opacity-0 dark:scale-[0.25] dark:blur-[4px]`}
      />
      <Moon
        size={17}
        className={`${iconBase} opacity-0 scale-[0.25] blur-[4px] dark:opacity-100 dark:scale-100 dark:blur-0`}
      />
    </button>
  );
}
