"use client";

import { useEffect, useRef } from 'react';

// Polling that respects a battery-powered server.
//
//  - pauses entirely while the tab is hidden (and refreshes the moment it
//    becomes visible again), so an unwatched dashboard costs nothing
//  - backs off toward `idleMs` the longer nothing changes, and snaps back to
//    `activeMs` on any change or user interaction
//
// `fn` should return true when it observed a change, false/undefined otherwise.
export function useLivePoll(
  fn: () => boolean | void | Promise<boolean | void>,
  { activeMs = 8000, idleMs = 45000 }: { activeMs?: number; idleMs?: number } = {},
) {
  const saved = useRef(fn);
  saved.current = fn;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = activeMs;
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === 'visible') {
        const changed = await saved.current();
        delay = changed ? activeMs : Math.min(Math.round(delay * 1.5), idleMs);
      }
      timer = setTimeout(tick, delay);
    };

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      delay = activeMs;
      clearTimeout(timer);
      tick();
    };

    tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [activeMs, idleMs]);
}
