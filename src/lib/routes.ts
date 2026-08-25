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

import { run, runWithInput } from "./runner";
import { shq } from "./validate";

// ─── types ───────────────────────────────────────────────────────────────────

export interface IngressEntry {
  /** Absent on the catch-all, which must stay last. */
  hostname?: string;
  service: string;
  /**
   * The comment written above this entry, without its "# ".
   *
   * tunnel-add annotates each route with its service name and port. A renderer
   * that drops them hands back a file that still works and is markedly less
   * readable than the one it replaced — which is a regression even though
   * nothing fails.
   */
  comment?: string;
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
  let comment: string | undefined;

  for (const raw of yaml.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#")) {
      // Kept so render can put it back. Only the last comment before an entry
      // belongs to it; a header paragraph is handled separately.
      comment = line.replace(/^#\s?/, "");
      continue;
    }
    if (line === "") {
      // A blank line ends a comment's association with what follows.
      comment = undefined;
      continue;
    }

    const h = line.match(/^-?\s*hostname:\s*(\S+)/);
    if (h) {
      pending = h[1];
      continue;
    }
    const s = line.match(/^-?\s*service:\s*(\S+)/);
    if (s) {
      const entry: IngressEntry = pending
        ? { hostname: pending, service: s[1] }
        : { service: s[1] };
      if (comment) entry.comment = comment;
      out.push(entry);
      pending = undefined;
      comment = undefined;
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
  lines.push(
    "  # Routes are inserted above the catch-all, which must stay last.",
  );
  for (const e of named) {
    lines.push("");
    if (e.comment) lines.push(`  # ${e.comment}`);
    lines.push(`  - hostname: ${e.hostname}`);
    lines.push(`    service: ${e.service}`);
  }
  lines.push("");
  // Only if the file already had one. Inventing a comment breaks idempotence:
  // the next parse reads it back as real, so rendering twice is not the same as
  // rendering once, and every rewrite would show a spurious change.
  if (catchAll.comment) lines.push(`  # ${catchAll.comment}`);
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
  const merged = [
    ...lines.slice(0, start),
    renderIngress(entries).trimEnd(),
    ...lines.slice(end),
  ].join("\n");
  return merged.endsWith("\n") ? merged : merged + "\n";
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

/**
 * What changing the domain suffix does to the routes that already exist.
 *
 * Changing DOMAIN_SUFFIX used to change one string in .env. Every route
 * published before the change kept the old hostname, so the panel showed one
 * domain and served another, and the only way to find out was to open each URL.
 * This makes the consequence visible before it is accepted.
 */
export interface MigrationStep {
  from: string;
  to: string;
  service: string;
  /** False when the new hostname would sit outside the certificate. */
  covered: boolean;
  reason?: string;
}

export function planMigrate(
  current: IngressEntry[],
  from: string,
  to: string,
  zone: string,
): MigrationStep[] {
  if (!from || !to || from === to) return [];
  const steps: MigrationStep[] = [];
  for (const e of current) {
    if (!e.hostname) continue;
    if (!e.hostname.endsWith(`.${from}`)) continue;
    const name = e.hostname.slice(0, -(from.length + 1));
    const next = `${name}.${to}`;
    const cover = certificateCoverage(next, zone);
    steps.push({
      from: e.hostname,
      to: next,
      service: e.service,
      covered: cover.covered,
      reason: cover.reason,
    });
  }
  return steps;
}

/**
 * Move every route from one suffix to the next.
 *
 * Publish first, then unpublish. The old hostname keeps working until the new
 * one is verified, so a failure part-way leaves a reachable service rather than
 * an unreachable one. A step whose new hostname has no certificate is reported
 * and skipped, never published half-way.
 */
export async function migrate(
  fx: RouteEffects,
  opts: { from: string; to: string; zone: string },
): Promise<{ moved: MigrationStep[]; skipped: MigrationStep[] }> {
  const before = await fx.readConfig();
  const steps = planMigrate(parseIngress(before), opts.from, opts.to, opts.zone);
  const moved: MigrationStep[] = [];
  const skipped: MigrationStep[] = [];

  for (const step of steps) {
    if (!step.covered) {
      skipped.push(step);
      continue;
    }
    const res = await publish(fx, {
      hostname: step.to,
      service: step.service,
      zone: opts.zone,
    });
    if (!res.ok) {
      skipped.push({ ...step, covered: false, reason: res.reason });
      continue;
    }
    await unpublish(fx, step.from);
    moved.push(step);
  }
  return { moved, skipped };
}

// ─── the existing callers ────────────────────────────────────────────────────
// These two kept the panel's removal paths working before this module existed.
// Same signatures, so api/projects, api/static and api/storage are untouched —
// but hostsForPort now goes through the parser above instead of carrying its own
// copy of the ingress format, which is the duplication this module exists to end.

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

// ─── doing it ────────────────────────────────────────────────────────────────
//
// The effects are injected rather than called directly. Publishing writes DNS at
// Cloudflare and rewrites the config of a running tunnel, so the failure paths —
// especially rollback — have to be provable without a live tunnel to break.

export interface VerifyResult {
  ok: boolean;
  checks: RouteStatus;
  /** Why it failed, in words the operator can act on. */
  reason?: string;
}

export interface RouteEffects {
  readConfig(): Promise<string>;
  writeConfig(text: string): Promise<void>;
  reloadTunnel(): Promise<void>;
  createDns(hostname: string): Promise<void>;
  deleteDns(hostname: string): Promise<void>;
  verify(hostname: string): Promise<VerifyResult>;
}

export interface PublishResult {
  ok: boolean;
  hostname: string;
  /** True when the route was already exactly as asked for. */
  unchanged: boolean;
  verify?: VerifyResult;
  reason?: string;
  /** Set when something failed and the previous state was put back. */
  rolledBack?: boolean;
}

/**
 * Publish a hostname, and undo it if it does not work.
 *
 * The order matters. DNS goes first because it is the slow half and the one
 * that can fail for reasons outside this machine; the config is only rewritten
 * once DNS exists. If verification then fails, both halves are undone — the
 * config from the exact text read at the start rather than a re-render, so a
 * rollback cannot introduce a formatting change of its own.
 *
 * Half-created routes are what left a bucket with a live DNS record pointing at
 * an ingress rule that no longer matched.
 */
export async function publish(
  fx: RouteEffects,
  opts: { hostname: string; service: string; zone: string },
): Promise<PublishResult> {
  const { hostname, service, zone } = opts;
  validateHostname(hostname);

  const cover = certificateCoverage(hostname, zone);
  if (!cover.covered) {
    return { ok: false, hostname, unchanged: true, reason: cover.reason };
  }

  const before = await fx.readConfig();
  const plan = planPublish(parseIngress(before), hostname, service);

  if (!plan.changesIngress) {
    // Already routed here. Still verify: the entry existing is not evidence it
    // works, and reporting "already published" for a broken route is how a
    // problem stays hidden.
    const verify = await fx.verify(hostname);
    return {
      ok: verify.ok,
      hostname,
      unchanged: true,
      verify,
      reason: verify.reason,
    };
  }

  let dnsCreated = false;
  try {
    await fx.createDns(hostname);
    dnsCreated = true;

    await fx.writeConfig(replaceIngressBlock(before, plan.ingress));
    await fx.reloadTunnel();

    const verify = await fx.verify(hostname);
    if (verify.ok) return { ok: true, hostname, unchanged: false, verify };

    await rollback(fx, before, hostname, dnsCreated, Boolean(plan.replaces));
    return {
      ok: false,
      hostname,
      unchanged: false,
      verify,
      rolledBack: true,
      reason: verify.reason ?? "the route did not answer after publishing",
    };
  } catch (e) {
    await rollback(fx, before, hostname, dnsCreated, Boolean(plan.replaces));
    return {
      ok: false,
      hostname,
      unchanged: false,
      rolledBack: true,
      reason: (e as Error).message,
    };
  }
}

/**
 * Put back what was there.
 *
 * `replacedExisting` decides whether the DNS record is removed: when the
 * hostname was already routed somewhere, its record predates this attempt and
 * deleting it would break the route that was working before.
 */
async function rollback(
  fx: RouteEffects,
  previousConfig: string,
  hostname: string,
  dnsCreated: boolean,
  replacedExisting: boolean,
): Promise<void> {
  // Each step is attempted even if an earlier one throws. A rollback that stops
  // halfway leaves exactly the split state it exists to prevent.
  try {
    await fx.writeConfig(previousConfig);
    await fx.reloadTunnel();
  } catch {
    /* reported by the caller's reason; nothing better to do here */
  }
  if (dnsCreated && !replacedExisting) {
    try {
      await fx.deleteDns(hostname);
    } catch {
      /* the record is harmless without an ingress rule pointing at it */
    }
  }
}

export async function unpublish(
  fx: RouteEffects,
  hostname: string,
): Promise<{
  ok: boolean;
  hostname: string;
  unchanged: boolean;
  reason?: string;
}> {
  const before = await fx.readConfig();
  const plan = planUnpublish(parseIngress(before), hostname);

  if (!plan.changesIngress) {
    // Removing something absent is success, not an error: it is the state asked
    // for, and a retry after a partial failure must not report a problem.
    return { ok: true, hostname, unchanged: true };
  }

  try {
    await fx.writeConfig(replaceIngressBlock(before, plan.ingress));
    await fx.reloadTunnel();
    await fx.deleteDns(hostname);
    return { ok: true, hostname, unchanged: false };
  } catch (e) {
    return {
      ok: false,
      hostname,
      unchanged: false,
      reason: (e as Error).message,
    };
  }
}

// ─── the real effects ────────────────────────────────────────────────────────

/**
 * Verify a hostname by using it.
 *
 * The tunnel reporting a route, and the route working, are different claims.
 * Every check here is an observation: does the name resolve, does TLS complete,
 * does something answer. A 404 counts as answering — plenty of services return
 * one at `/` — so this asks whether the request completed, not what it said.
 */
export async function verifyHostname(hostname: string): Promise<VerifyResult> {
  const checks: RouteStatus = {
    dns: "unknown",
    ingress: "ok",
    tunnel: "unknown",
    tls: "unknown",
    origin: "unknown",
  };

  const dns = await run(
    `getent hosts ${hostname} 2>/dev/null | head -1 || true`,
    15_000,
  );
  checks.dns = dns.output.trim() ? "ok" : "missing";
  if (checks.dns === "missing") {
    return { ok: false, checks, reason: `${hostname} does not resolve yet` };
  }

  // -o /dev/null with a written-out code: curl exits non-zero on an HTTP error
  // status, and treating that as failure would reject a service whose root is a
  // 404. What matters is that the request completed.
  const http = await run(
    `curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://${hostname}/ 2>/dev/null || true`,
    30_000,
  );
  const code = http.output.trim();
  if (code === "" || code === "000") {
    checks.tls = "failed";
    return {
      ok: false,
      checks,
      reason:
        `${hostname} resolves but the request did not complete. Usually TLS: ` +
        `Cloudflare's certificate covers only one level below the zone.`,
    };
  }

  checks.tls = "ok";
  checks.tunnel = "ok";
  // 502 and 504 are the tunnel reaching Cloudflare but not the local service.
  checks.origin = code === "502" || code === "504" ? "failed" : "ok";
  if (checks.origin === "failed") {
    return {
      ok: false,
      checks,
      reason: `the tunnel answered ${code} — the local service is not responding`,
    };
  }

  // A 404 is ambiguous and was being read as healthy. The tunnel's own
  // catch-all is `http_status:404`, so a route cloudflared never loaded answers
  // exactly like a service whose root is a 404. Ask cloudflared which rule it
  // matches — that is local, exact, and settles it. Anything other than 404
  // proves a rule matched, so the question does not arise.
  if (code === "404") {
    const rule = await run(
      `cloudflared tunnel ingress rule ${shq(`https://${hostname}`)} 2>&1 || true`,
      20_000,
    );
    // The catch-all has no hostname of its own, so its match prints no
    // "hostname:" line. A real rule always names one.
    const matchedHost = /^\s*hostname:\s*(\S+)/m.exec(rule.output)?.[1];
    if (!matchedHost) {
      checks.ingress = "failed";
      return {
        ok: false,
        checks,
        reason:
          `${hostname} reaches the tunnel but matches no ingress rule — the ` +
          "catch-all answered. The route is not actually published.",
      };
    }
  }

  return { ok: true, checks };
}

const CONFIG = "$HOME/.cloudflared/config.yml";

/** The effects, against this machine. */
const CF_API = "https://api.cloudflare.com/client/v4";

/**
 * The zone that actually contains this hostname, asked of Cloudflare.
 *
 * Not CF_ZONE_ID and not DOMAIN_SUFFIX. On the machine this was written
 * against, CF_ZONE_ID named bitroot.in while DOMAIN_SUFFIX was bitroot.club —
 * two different zones — so a check against either was wrong for every hostname.
 * One machine can serve names in several zones.
 *
 * Walks the labels: a.b.example.com asks for a.b.example.com, then
 * b.example.com, then example.com, and takes the first the account owns.
 */
export async function zoneFor(
  hostname: string,
  token = process.env.CF_API_TOKEN,
): Promise<{ id: string; name: string } | null> {
  if (!token) return null;
  const labels = hostname.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join(".");
    try {
      const res = await fetch(
        `${CF_API}/zones?name=${encodeURIComponent(candidate)}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const d = (await res.json()) as {
        success?: boolean;
        result?: Array<{ id?: string; name?: string }>;
      };
      const hit = d.success ? d.result?.[0] : undefined;
      if (hit?.id && hit.name) return { id: hit.id, name: hit.name };
    } catch {
      break; // network trouble: the caller decides, rather than guessing here
    }
  }
  return null;
}

/**
 * Actually delete the DNS record.
 *
 * This used to run `cloudflared tunnel route dns --overwrite-dns`, which
 * *creates* a record — it has no delete mode. So every unpublish left a live
 * record pointing at the tunnel. With the ingress rule gone the catch-all
 * answered it, which is a 404 on a hostname nobody could account for. Proven on
 * a real machine: after tunnel-remove, the name still resolved.
 */
export async function deleteDnsFor(hostname: string): Promise<number> {
  const token = process.env.CF_API_TOKEN;
  if (!token) return 0;
  const zone = await zoneFor(hostname, token);
  if (!zone) return 0;

  const head = { Authorization: `Bearer ${token}` };
  const list = await fetch(
    `${CF_API}/zones/${zone.id}/dns_records?name=${encodeURIComponent(hostname)}`,
    { headers: head, cache: "no-store" },
  );
  const d = (await list.json()) as {
    success?: boolean;
    result?: Array<{ id: string }>;
  };
  if (!d.success || !d.result?.length) return 0;

  let removed = 0;
  for (const rec of d.result) {
    const res = await fetch(`${CF_API}/zones/${zone.id}/dns_records/${rec.id}`, {
      method: "DELETE",
      headers: head,
    });
    if (res.ok) removed++;
  }
  return removed;
}

export function realEffects(tunnelId: string): RouteEffects {
  return {
    readConfig: async () =>
      (await run(`cat "${CONFIG}" 2>/dev/null || true`)).output,

    // Written through a temp file and renamed. A partial write to the config of
    // a running tunnel is worse than no write at all.
    writeConfig: async (text) => {
      const r = await runWithInput(
        `umask 077; cat > "${CONFIG}.tmp" && mv "${CONFIG}.tmp" "${CONFIG}"`,
        text,
        30_000,
      );
      if (!r.ok)
        throw new RouteError(`could not write the tunnel config: ${r.output}`);
    },

    reloadTunnel: async () => {
      const r = await run(
        "pm2 restart cloudflared 2>&1 || cloudflared service restart 2>&1",
        60_000,
      );
      if (!r.ok)
        throw new RouteError(`could not reload the tunnel: ${r.output}`);
      // cloudflared registers its edge connections a moment after starting.
      await new Promise((res) => setTimeout(res, 6000));
    },

    createDns: async (hostname) => {
      const r = await run(
        `cloudflared tunnel route dns ${shq(tunnelId)} ${shq(hostname)} 2>&1`,
        60_000,
      );
      // Already pointing here is the state we want, not a failure.
      if (!r.ok && !/already (exists|configured)/i.test(r.output)) {
        throw new RouteError(`could not create the DNS record: ${r.output}`);
      }
    },

    deleteDns: async (hostname) => {
      // Deliberately not `cloudflared tunnel route dns`: that command only
      // creates. Deletion is an API call or it does not happen.
      await deleteDnsFor(hostname);
    },

    verify: verifyHostname,
  };
}
