"use client";

// One place the browser learns what this machine is.
//
// Type-only import of Facts: lib/facts.ts reaches for the shell to measure
// things, and pulling that into a client bundle would drag the runner with it.
// `import type` is erased at compile time, so only the shape crosses over.
//
// Every component that needs a hostname, a suffix or a platform uses this rather
// than a NEXT_PUBLIC_ constant. Those are inlined into the bundle when the panel
// is BUILT, so editing .env and restarting — which is what the Config page tells
// you to do — changed nothing until someone rebuilt. Two components also read a
// name .env never wrote (NEXT_PUBLIC_TAILNET_IP against NEXT_PUBLIC_TAILNET_HOST)
// and silently fell back to 127.0.0.1, so the panel told operators their services
// were on localhost.

import { useEffect, useState } from "react";
import type { Facts } from "./facts";

export type { Facts };

/** Shared across components mounted together, so one page load makes one request. */
let cache: Promise<Facts> | null = null;

function load(): Promise<Facts> {
  if (!cache) {
    cache = fetch("/api/facts", { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => {
        // Let the next mount try again rather than caching a failure forever.
        cache = null;
        return {
          tailnetHost: null,
          routedHosts: [],
          domainSuffix: null,
          platform: "linux" as const,
          tunnelUp: false,
        };
      });
  }
  return cache;
}

/**
 * `null` while loading. Callers must handle that as "not known yet" and show
 * nothing, rather than a placeholder that looks like an answer.
 */
export function useFacts(): Facts | null {
  const [facts, setFacts] = useState<Facts | null>(null);
  useEffect(() => {
    let alive = true;
    load().then((f) => alive && setFacts(f));
    return () => {
      alive = false;
    };
  }, []);
  return facts;
}

/** The public URL for a name, or null when nothing routes it. */
export function publicUrl(name: string, facts: Facts | null): string | null {
  if (!facts?.domainSuffix) return null;
  const host = `${name}.${facts.domainSuffix}`;
  return facts.routedHosts.includes(host) ? `https://${host}` : null;
}

/**
 * What a name WOULD be published as. For previews in the create forms, where
 * nothing exists yet — so this deliberately does not check routedHosts. Callers
 * must word it as a future state, never as a working link.
 */
export function futureHost(name: string, facts: Facts | null): string | null {
  return facts?.domainSuffix ? `${name}.${facts.domainSuffix}` : null;
}
