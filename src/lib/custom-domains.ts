// Custom domains for a static site — the Vercel-style flow: add a hostname,
// get back the one DNS record that makes it work, and a status that tells you
// whether the record is there yet.
//
// A static site already has a tunnel hostname under DOMAIN_SUFFIX. A custom
// domain is different: it is not in the Cloudflare zone the tunnel lives in, so
// it cannot be routed through the tunnel. Instead the box's own public IP
// serves it directly over nginx on :80/:443, with Let's Encrypt (certbot)
// issuing the certificate once DNS actually points here — exactly the two
// things Vercel's own "Add Domains" dialog is asking the operator to arrange,
// just pointed at this server instead of theirs.
//
// Storage is the same SQLite handle as accounts and projects, for the same
// reason groups.ts gives: one domain has one home, and that is a primary key's
// job, not a JSON file's.

import { resolve4 } from 'node:dns/promises';
import type { DatabaseSync } from 'node:sqlite';
import { db } from './users';
import { run, runCached, runWithInput } from './runner';
import { assertHostname, assertName, shq, ValidationError } from './validate';

/**
 * This box's own address on the public internet.
 *
 * Deliberately not part of lib/facts.ts: that aggregator is fetched on nearly
 * every dashboard page, and a dependency on an external IP-echo service has no
 * business sitting on that hot path. Only the domains UI needs this, so only
 * it pays for the external call — cached for ten minutes, since a server's
 * public IP does not change minute to minute.
 */
export async function getPublicIp(): Promise<string | null> {
  const r = await runCached('curl -s -4 --max-time 5 https://ifconfig.me 2>/dev/null', 600_000);
  const ip = r.output.trim();
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : null;
}

export class ConflictError extends Error {}
export class NotFoundError extends Error {}

export const MAX_DOMAINS_PER_SITE = 10;

export interface DomainRow {
  site: string;
  domain: string;
  /** Hostname this one 308-redirects to, or null when it is served directly. */
  redirectTo: string | null;
  active: boolean;
  createdAt: number;
  addedBy: string | null;
}

// ─── schema ──────────────────────────────────────────────────────────────────

const ready = new WeakSet<DatabaseSync>();

function store(): DatabaseSync {
  const d = db();
  if (ready.has(d)) return d;
  d.exec(`
    CREATE TABLE IF NOT EXISTS site_domains (
      site        TEXT NOT NULL,
      domain      TEXT PRIMARY KEY,
      redirect_to TEXT,
      active      INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL,
      added_by    TEXT
    );
    CREATE INDEX IF NOT EXISTS site_domains_site ON site_domains(site);
  `);
  ready.add(d);
  return d;
}

type Row = Record<string, unknown>;

const toDomain = (r: Row): DomainRow => ({
  site: String(r.site),
  domain: String(r.domain),
  redirectTo: r.redirect_to === null || r.redirect_to === undefined ? null : String(r.redirect_to),
  active: Number(r.active) === 1,
  createdAt: Number(r.created_at),
  addedBy: r.added_by === null || r.added_by === undefined ? null : String(r.added_by),
});

// ─── reads ───────────────────────────────────────────────────────────────────

export function listDomains(site: string): DomainRow[] {
  const d = store();
  return (
    d.prepare('SELECT * FROM site_domains WHERE site = ? ORDER BY created_at').all(assertName(site)) as Row[]
  ).map(toDomain);
}

/** Every domain that currently resolves to something, across all sites — for cert renewal. */
export function allActiveDomains(): DomainRow[] {
  return (store().prepare('SELECT * FROM site_domains WHERE active = 1').all() as Row[]).map(toDomain);
}

/** Every site that has at least one custom domain attached — what the background watcher polls. */
export function sitesWithDomains(): string[] {
  const rows = store().prepare('SELECT DISTINCT site FROM site_domains').all() as Row[];
  return rows.map((r) => String(r.site));
}

// ─── writes ──────────────────────────────────────────────────────────────────

/**
 * Registers a domain (and, if asked, its apex→www sibling) against a site.
 * Mirrors Vercel's "Redirect apex domains to www" checkbox: given an apex, the
 * www host is what actually serves, and the apex becomes a 308 to it — because
 * an apex cannot be a CNAME onto anything, ours included, while www can.
 */
export function addDomain(
  site: string,
  input: { domain: unknown; redirectApexToWww?: boolean },
  by: string | null,
): DomainRow[] {
  const d = store();
  const name = assertName(site);
  if (typeof input.domain !== 'string') throw new ValidationError('a domain needs a hostname');
  const host = assertHostname(input.domain);
  if (!host) throw new ValidationError('a domain needs a hostname');

  const isApex = host.split('.').length === 2; // good enough for .com/.in — no public-suffix table here
  const wantsRedirect = Boolean(input.redirectApexToWww) && isApex;
  const www = `www.${host}`;

  const toInsert = wantsRedirect ? [www, host] : [host];

  const count = Number((d.prepare('SELECT COUNT(*) AS n FROM site_domains WHERE site = ?').get(name) as Row).n);
  if (count + toInsert.length > MAX_DOMAINS_PER_SITE) {
    throw new ValidationError(`a site is limited to ${MAX_DOMAINS_PER_SITE} domains`);
  }

  d.exec('BEGIN IMMEDIATE');
  try {
    for (const h of toInsert) {
      const existing = d.prepare('SELECT site FROM site_domains WHERE domain = ?').get(h) as Row | undefined;
      if (existing) {
        throw new ConflictError(
          existing.site === name ? `"${h}" is already attached here` : `"${h}" already belongs to "${existing.site}"`,
        );
      }
    }
    const now = Date.now();
    for (const h of toInsert) {
      const redirectTo = wantsRedirect && h === host ? www : null;
      d.prepare(
        'INSERT INTO site_domains (site, domain, redirect_to, active, created_at, added_by) VALUES (?, ?, ?, 0, ?, ?)',
      ).run(name, h, redirectTo, now, by);
    }
    d.exec('COMMIT');
  } catch (e) {
    try {
      d.exec('ROLLBACK');
    } catch {
      /* the failure above is the one worth reporting */
    }
    throw e;
  }

  return listDomains(name);
}

export function removeDomain(site: string, domain: unknown): DomainRow[] {
  const d = store();
  const name = assertName(site);
  if (typeof domain !== 'string') throw new ValidationError('a domain needs a hostname');
  const host = assertHostname(domain);
  const row = d.prepare('SELECT 1 FROM site_domains WHERE site = ? AND domain = ?').get(name, host);
  if (!row) throw new NotFoundError(`"${host}" is not attached to "${name}"`);
  d.prepare('DELETE FROM site_domains WHERE site = ? AND domain = ?').run(name, host);
  // A redirect whose target just left has nowhere to send visitors; dropping it
  // too avoids serving a 308 into a dead end.
  d.prepare('DELETE FROM site_domains WHERE site = ? AND redirect_to = ?').run(name, host);
  return listDomains(name);
}

export function markActive(site: string, domain: string, active: boolean): void {
  store()
    .prepare('UPDATE site_domains SET active = ? WHERE site = ? AND domain = ?')
    .run(active ? 1 : 0, assertName(site), domain);
}

// ─── DNS check ───────────────────────────────────────────────────────────────

export type DnsStatus = 'valid' | 'invalid' | 'unknown';

/** What a domain's A record would need to be, in the shape the UI shows it. */
export function requiredRecord(domain: string, publicIp: string): { type: 'A'; name: string; value: string } {
  const parts = domain.split('.');
  const name = parts.length > 2 ? parts.slice(0, -2).join('.') : '@';
  return { type: 'A', name, value: publicIp };
}

/**
 * Resolves a domain's A records and says whether they match this server.
 * 'unknown' (not 'invalid') on a lookup failure that is not "no such record" —
 * a DNS timeout is not evidence the operator misconfigured anything.
 */
export async function checkDns(domain: string, publicIp: string | null): Promise<DnsStatus> {
  if (!publicIp) return 'unknown';
  try {
    const ips = await resolve4(domain);
    return ips.includes(publicIp) ? 'valid' : 'invalid';
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === 'ENOTFOUND' || code === 'ENODATA' ? 'invalid' : 'unknown';
  }
}

// ─── provisioning ────────────────────────────────────────────────────────────
//
// Routing and TLS both go through Traefik now (see the Phase A migration:
// the box used to run a hand-rolled nginx vhost per site plus certbot in
// `certonly` mode for each certificate; both are replaced by one Traefik
// instance that owns :80/:443 for the whole box). This is a real
// simplification, not just a swap: Traefik's `certResolver` on a router
// fetches and renews that router's certificate itself, lazily, on first use
// — so there is no separate cert-acquisition step to sequence here, no
// "does a file exist yet" bookkeeping, and no sudo (the dynamic-config
// directory is owned by the same user the panel runs as, unlike
// `/etc/nginx` and `/etc/letsencrypt`). One YAML file per site, rewritten
// from scratch each sync, is the entire mechanism.

export interface DomainStatus extends DomainRow {
  dns: DnsStatus;
  record: { type: 'A'; name: string; value: string } | null;
}

const TRAEFIK_DYNAMIC_DIR = '$HOME/traefik/dynamic';

/**
 * One domain's routers: a plain :80 (either a scheme upgrade or, for a
 * redirect entry like the apex, straight to the target) and a :443 that
 * either proxies or redirects, each requesting its own certificate from
 * Traefik's `le` resolver. yq/js-yaml are both overkill for a document this
 * regular — it's templated directly, the same way the nginx version was.
 */
function domainBlock(domain: string, redirectTo: string | null): string {
  const safeName = domain.replace(/[^a-z0-9]+/g, '-');
  if (redirectTo) {
    return `
    ${safeName}-http:
      rule: "Host(\`${domain}\`)"
      entryPoints: [web]
      service: ${safeName}
      middlewares: [${safeName}-redirect]
    ${safeName}-https:
      rule: "Host(\`${domain}\`)"
      entryPoints: [websecure]
      service: ${safeName}
      tls:
        certResolver: le
      middlewares: [${safeName}-redirect]`;
  }
  return `
    ${safeName}-http:
      rule: "Host(\`${domain}\`)"
      entryPoints: [web]
      service: ${safeName}
      middlewares: [redirect-to-https]
    ${safeName}-https:
      rule: "Host(\`${domain}\`)"
      entryPoints: [websecure]
      service: ${safeName}
      tls:
        certResolver: le`;
}

function domainMiddleware(domain: string, redirectTo: string | null): string {
  if (!redirectTo) return '';
  const safeName = domain.replace(/[^a-z0-9]+/g, '-');
  return `
    ${safeName}-redirect:
      redirectRegex:
        regex: '^https?://${domain.replace(/\./g, '\\.')}/(.*)'
        replacement: 'https://${redirectTo}/\${1}'
        permanent: true`;
}

function domainService(domain: string, port: number): string {
  const safeName = domain.replace(/[^a-z0-9]+/g, '-');
  return `
    ${safeName}:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:${port}"`;
}

function buildTraefikConfig(domains: DomainRow[], port: number): string {
  const header = `# ${domains[0]?.site ?? ''} — managed by BitPanel (do not hand-edit; see custom-domains.ts)\n`;
  const hasRedirectMiddleware = domains.some((d) => !d.redirectTo);
  return (
    header +
    'http:\n' +
    '  routers:' +
    domains.map((d) => domainBlock(d.domain, d.redirectTo)).join('') +
    '\n\n  middlewares:' +
    (hasRedirectMiddleware
      ? `
    redirect-to-https:
      redirectScheme:
        scheme: https
        permanent: true`
      : '') +
    domains.map((d) => domainMiddleware(d.domain, d.redirectTo)).join('') +
    '\n\n  services:' +
    domains.map((d) => domainService(d.domain, port)).join('') +
    '\n'
  );
}

/**
 * Touches a domain over HTTPS (triggering Traefik's lazy ACME fetch if it
 * hasn't happened yet) and reports whether a real certificate came back,
 * rather than Traefik's own self-signed fallback — the same question
 * `certCovers` used to answer by reading certbot's files, now asked of
 * Traefik directly since it owns the certificate lifecycle itself.
 */
async function isCertified(domain: string): Promise<boolean> {
  await run(
    `curl -sk -o /dev/null --max-time 15 --resolve ${shq(domain)}:443:127.0.0.1 https://${shq(domain)}/ 2>&1 || true`,
    20_000,
  );
  const r = await run(
    `echo | openssl s_client -connect 127.0.0.1:443 -servername ${shq(domain)} 2>/dev/null | ` +
      'openssl x509 -noout -issuer 2>/dev/null || true',
    10_000,
  );
  const issuer = r.output.trim();
  return issuer.length > 0 && !issuer.includes('TRAEFIK DEFAULT CERT');
}

export interface SyncResult {
  domains: DomainStatus[];
  certified: boolean;
}

/**
 * The one entrypoint the "Refresh" button (and adding/removing a domain) calls.
 * Checks DNS for every domain on the site, serves only the ones that actually
 * resolve here, and writes the complete Traefik route for them in one step —
 * Traefik handles certificate issuance itself from there. Safe to call
 * repeatedly; each step is a no-op when nothing changed.
 */
export async function syncSite(site: string, port: number): Promise<SyncResult> {
  const name = assertName(site);
  const rows = listDomains(name);
  const publicIp = await getPublicIp();

  const statuses = await Promise.all(
    rows.map(async (r): Promise<DomainStatus> => ({
      ...r,
      dns: await checkDns(r.domain, publicIp),
      record: publicIp ? requiredRecord(r.domain, publicIp) : null,
    })),
  );

  for (const s of statuses) markActive(name, s.domain, s.dns === 'valid');
  const live = statuses.filter((s) => s.dns === 'valid').map((s) => ({ ...s }));

  if (live.length === 0) {
    await run(`rm -f "${TRAEFIK_DYNAMIC_DIR}/${name}.yml"`, 10_000);
    return { domains: statuses, certified: false };
  }

  await runWithInput(`cat > "${TRAEFIK_DYNAMIC_DIR}/${name}.yml"`, buildTraefikConfig(live, port), 15_000);

  // Traefik's file provider watches this directory and reloads on its own —
  // no reload step, unlike nginx. Confirm each serving (non-redirect) domain
  // actually has a real certificate now; a redirect-only entry (the apex)
  // still needs one too, since TLS terminates before the HTTP-level redirect
  // runs, so it's checked the same way.
  const certResults = await Promise.all(live.map((s) => isCertified(s.domain)));
  const certified = certResults.every(Boolean);

  return { domains: statuses, certified };
}
