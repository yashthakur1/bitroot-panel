// The one implementation of "publish this service at this hostname".
//
// A route is not one thing on disk. It is a DNS record at Cloudflare, an ingress
// entry in the tunnel's config, and — for object storage — a root_domain in
// garage.toml. Nothing owned all three, so they drifted: changing DOMAIN_SUFFIX
// left a bucket with a live DNS record, a stale ingress entry and a garage
// config pointing at the previous domain. Each piece was individually correct.
//
// Everything here is plain Node so the CLI in scripts/ can import it without a
// server running. The panel imports the same module. One implementation, two
// callers — the alternative is shell and TypeScript versions that disagree.

// ─── types ───────────────────────────────────────────────────────────────────

export interface IngressEntry {
  /** Absent on the catch-all, which must stay last. */
  hostname?: string;
  service: string;
}

export type CheckState = "ok" | "missing" | "failed" | "skipped" | "unknown";

export interface RouteStatus {
  dns: CheckState;
  ingress: CheckState;
  tunnel: CheckState;
  tls: CheckState;
  origin: CheckState;
}

export interface Route {
  hostname: string;
  service: string;
  /** Parsed out of the service URL, when it is a local port. */
  port: number | null;
  status: RouteStatus;
}

export class RouteError extends Error {}

// ─── ingress: parse and render ───────────────────────────────────────────────

/**
 * Read the ingress list out of a cloudflared config.
 *
 * Deliberately line-based rather than a YAML parser: this file is edited by
 * shell scripts and by hand, and a strict parser would reject a file cloudflared
 * itself accepts. Anything not recognised is left alone by render().
 */
export function parseIngress(yaml: string): IngressEntry[] {
  const out: IngressEntry[] = [];
  let pending: string | undefined;

  for (const raw of yaml.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#")) continue;

    const h = line.match(/^-?\s*hostname:\s*(\S+)/);
    if (h) {
      pending = h[1];
      continue;
    }
    const s = line.match(/^-?\s*service:\s*(\S+)/);
    if (s) {
      out.push(
        pending ? { hostname: pending, service: s[1] } : { service: s[1] },
      );
      pending = undefined;
    }
  }
  return out;
}

/**
 * Render an ingress list back to YAML.
 *
 * The catch-all is forced last no matter where it sits in the input. cloudflared
 * matches top to bottom, so a catch-all above a hostname silently swallows it —
 * the route exists, the config looks right, and every request returns 404.
 */
export function renderIngress(entries: IngressEntry[]): string {
  const named = entries.filter((e) => e.hostname);
  const catchAll = entries.find((e) => !e.hostname) ?? {
    service: "http_status:404",
  };

  const lines = ["ingress:"];
  for (const e of named) {
    lines.push(`  - hostname: ${e.hostname}`);
    lines.push(`    service: ${e.service}`);
  }
  lines.push(`  - service: ${catchAll.service}`);
  return lines.join("\n") + "\n";
}

/** Replace the ingress block in a full config, leaving every other line intact. */
export function replaceIngressBlock(
  yaml: string,
  entries: IngressEntry[],
): string {
  const lines = yaml.split("\n");
  const start = lines.findIndex((l) => /^\s*ingress:\s*$/.test(l));
  if (start === -1) return yaml.replace(/\s*$/, "\n") + renderIngress(entries);

  // The block ends at the first line that is neither a list item nor indented.
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === "") continue;
    if (!/^\s/.test(l)) {
      end = i;
      break;
    }
  }
  return [
    ...lines.slice(0, start),
    renderIngress(entries).trimEnd(),
    ...lines.slice(end),
  ].join("\n");
}

// ─── validation ──────────────────────────────────────────────────────────────

/**
 * Can Cloudflare's certificate cover this hostname?
 *
 * Universal SSL covers the zone apex and ONE level of wildcard: `example.com`
 * and `*.example.com`. It does not cover `a.b.example.com`. Publishing there
 * produces a TLS handshake failure rather than an error page, which reads as a
 * broken server rather than an unsupported name — we lost an afternoon to
 * exactly that. Advanced Certificate Manager lifts the limit, so this reports
 * why rather than pretending the name is invalid.
 */
export function certificateCoverage(
  hostname: string,
  zone: string,
): { covered: boolean; reason?: string } {
  if (hostname === zone) return { covered: true };
  if (!hostname.endsWith(`.${zone}`)) {
    return {
      covered: false,
      reason: `${hostname} is not inside the zone ${zone}`,
    };
  }
  const labels = hostname.slice(0, -(zone.length + 1)).split(".");
  if (labels.length === 1) return { covered: true };
  return {
    covered: false,
    reason:
      `${hostname} is ${labels.length} levels below ${zone}, and Cloudflare's ` +
      `certificate covers only *.${zone}. TLS would fail with a handshake error. ` +
      `Use a name like ${labels[labels.length - 1]}.${zone}, or add Advanced ` +
      `Certificate Manager to cover deeper names.`,
  };
}

/** A hostname the tunnel and DNS will both accept. */
export function validateHostname(hostname: string): void {
  if (!hostname || hostname.length > 253)
    throw new RouteError("hostname is empty or too long");
  if (
    !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(
      hostname,
    )
  ) {
    throw new RouteError(
      `"${hostname}" is not a valid hostname — lowercase letters, digits and hyphens only`,
    );
  }
}

/** The local port a service URL points at, when it points at one. */
export function portOf(service: string): number | null {
  const m = service.match(/:(\d+)(?:\/|$)/);
  return m ? Number(m[1]) : null;
}

// ─── planning ────────────────────────────────────────────────────────────────

export interface PublishPlan {
  hostname: string;
  service: string;
  /** False when the hostname is already routed to the same place. */
  changesIngress: boolean;
  /** What the ingress becomes. */
  ingress: IngressEntry[];
  /** Set when an existing entry is being repointed, so a rollback can restore it. */
  replaces?: IngressEntry;
}

/**
 * Work out the new ingress without touching anything.
 *
 * Separated from the doing so the caller can show the plan, and so the whole of
 * this decision is testable without a tunnel, a network or Cloudflare.
 */
export function planPublish(
  current: IngressEntry[],
  hostname: string,
  service: string,
): PublishPlan {
  validateHostname(hostname);
  const existing = current.find((e) => e.hostname === hostname);

  if (existing && existing.service === service) {
    return { hostname, service, changesIngress: false, ingress: current };
  }

  const ingress = existing
    ? current.map((e) => (e.hostname === hostname ? { hostname, service } : e))
    : [
        ...current.filter((e) => e.hostname),
        { hostname, service },
        ...current.filter((e) => !e.hostname),
      ];

  return {
    hostname,
    service,
    changesIngress: true,
    ingress,
    replaces: existing,
  };
}

export function planUnpublish(current: IngressEntry[], hostname: string) {
  const existing = current.find((e) => e.hostname === hostname);
  return {
    hostname,
    changesIngress: Boolean(existing),
    ingress: current.filter((e) => e.hostname !== hostname),
    removed: existing,
  };
}

// ─── the existing callers ────────────────────────────────────────────────────
// These two kept the panel's removal paths working before this module existed.
// Same signatures, so api/projects, api/static and api/storage are untouched —
// but hostsForPort now goes through the parser above instead of carrying its own
// copy of the ingress format, which is the duplication this module exists to end.

import { run } from "./runner";

/**
 * Hostnames whose ingress rule points at a given local port.
 *
 * Removal needs this because a route's hostname is not required to match the
 * service name — the panel on this machine answers at "neevpanel", not "panel".
 */
export async function hostsForPort(port: number): Promise<string[]> {
  const cfg = await run(
    'cat "$HOME/.cloudflared/config.yml" 2>/dev/null || true',
  );
  return parseIngress(cfg.output)
    .filter((e) => e.hostname && portOf(e.service) === port)
    .map((e) => e.hostname as string);
}

export async function portForService(name: string): Promise<number | null> {
  const r = await run(
    `grep "^${name}=" "$HOME/bin/ports.conf" 2>/dev/null | cut -d= -f2 || true`,
  );
  const port = Number(r.output.trim());
  return Number.isInteger(port) && port > 0 ? port : null;
}
