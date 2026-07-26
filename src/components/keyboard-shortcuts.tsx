"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Chord shortcuts (GitHub-style): press "g", then within 1.2s:
//   l — panel's own logs        h — projects list        n — new project
const PANEL_APP = 'bitroot-panel';

export default function KeyboardShortcuts() {
  const router = useRouter();

  useEffect(() => {
    let pendingG = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (
        t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        t.isContentEditable
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const k = e.key.toLowerCase();
      if (pendingG) {
        pendingG = false;
        clearTimeout(timer);
        if (k === 'l') {
          e.preventDefault();
          router.push(`/dashboard/services/${PANEL_APP}?tab=logs`);
        } else if (k === 'h') {
          e.preventDefault();
          router.push('/dashboard');
        } else if (k === 'n') {
          e.preventDefault();
          router.push('/dashboard/new-service');
        }
        return;
      }
      if (k === 'g') {
        pendingG = true;
        timer = setTimeout(() => {
          pendingG = false;
        }, 1200);
      }
    }

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(timer);
    };
  }, [router]);

  return null;
}
