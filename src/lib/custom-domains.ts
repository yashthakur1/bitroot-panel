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
// Cert acquisition and nginx config are deliberately two separate steps, run in
// that order, because certbot's `--nginx` *installer* edits a vhost file by
// pattern-matching its existing server blocks — fine for a plain proxy_pass,
// but an apex's `return 308 https://www...` is exactly the kind of content an
// automatic editor could silently double up on or clobber on a second run.
// So certbot here only ever runs with `certonly` (authenticator-only: it proves
// control and writes cert files, nothing else), and every byte of the vhost
// — including the redirect logic — is written by this module, once, from
// scratch, each time. One owner per file.

export interface DomainStatus extends DomainRow {
  dns: DnsStatus;
  record: { type: 'A'; name: string; value: string } | null;
}

const LIVE_DIR = (site: string) => `/etc/letsencrypt/live/custom-${site}`;

/**
 * The hostnames the current certificate actually lists, not just whether one
 * exists. A site's cert is requested once for whatever domains are live at
 * the time, and a domain added later — www, say, added after the apex already
 * had a certificate — needs that cert *expanded*, not skipped because a file
 * happens to be sitting there. Checking existence alone was exactly this bug:
 * the apex got HTTPS, www went live later, and syncSite kept reusing the
 * apex-only certificate for both because "a cert exists" was the only
 * question it asked — which is a valid cert for the wrong set of names, i.e.
 * precisely the browser error ("certificate common name invalid") this
 * function exists to prevent.
 */
async function certCovers(site: string): Promise<string[]> {
  const r = await run(
    `openssl x509 -in "${LIVE_DIR(site)}/fullchain.pem" -noout -ext subjectAltName 2>/dev/null || true`,
    10_000,
  );
  return [...r.output.matchAll(/DNS:([^\s,]+)/g)].map((m) => m[1]);
}

const proxyLocation = (port: number) => `location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }`;

/**
 * One domain's :80 block, plus its :443 block once a certificate exists.
 * A redirect entry (the apex) always 308s to its www sibling, on either
 * scheme; a serving entry proxies on :443 and, once that exists, the :80
 * copy becomes a plain scheme upgrade instead of a second proxy.
 */
function vhostBlocks(site: string, domain: string, redirectTo: string | null, port: number, https: boolean): string {
  const httpBody = redirectTo
    ? `return 308 https://${redirectTo}$request_uri;`
    : https
      ? `return 301 https://$host$request_uri;`
      : proxyLocation(port);

  const httpBlock = `server {
    listen 80;
    listen [::]:80;
    server_name ${domain};
    ${httpBody}
}`;

  if (!https) return httpBlock;

  const httpsBody = redirectTo ? `return 308 https://${redirectTo}$request_uri;` : proxyLocation(port);
  const httpsBlock = `server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ${domain};
    ssl_certificate     ${LIVE_DIR(site)}/fullchain.pem;
    ssl_certificate_key ${LIVE_DIR(site)}/privkey.pem;
    ${httpsBody}
}`;

  return `${httpBlock}\n\n${httpsBlock}`;
}

/**
 * https is decided per domain, not once for the whole file: a domain the
 * certificate already covers must keep its :443 block on every rewrite, even
 * while a sibling domain added moments ago is still plain :80 waiting for its
 * own certificate. Writing one blanket "https or not" for the file is what
 * briefly took working HTTPS domains back down to plain HTTP on every sync.
 */
function buildConfig(site: string, domains: Array<DomainRow & { certified: boolean }>, port: number): string {
  const header = `# custom-${site} — managed by BitPanel (do not hand-edit; see domain-write)\n`;
  const blocks = domains.map((d) => vhostBlocks(site, d.domain, d.redirectTo, port, d.certified));
  return header + blocks.join('\n\n') + '\n';
}

export interface SyncResult {
  domains: DomainStatus[];
  certified: boolean;
}

/**
 * The one entrypoint the "Refresh" button (and adding/removing a domain) calls.
 * Checks DNS for every domain on the site, serves only the ones that actually
 * resolve here, and — the first time a site has any — gets a certificate and
 * turns HTTPS on. Safe to call repeatedly; each step is a no-op when nothing
 * changed.
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
    await run(`static-site domain-unwrite ${shq(name)}`, 30_000);
    return { domains: statuses, certified: false };
  }

  const covered = await certCovers(name);
  const missing = live.filter((s) => !covered.includes(s.domain));

  // Base write: domains the cert already covers keep full HTTPS; a domain
  // that just went live gets a plain :80 proxy — enough to actually serve it,
  // and the one thing certbot's authenticator needs to reach in a moment.
  // Nothing that already worked is ever regressed by this call.
  await runWithInput(
    `static-site domain-write ${shq(name)} ${port}`,
    buildConfig(name, live.map((s) => ({ ...s, certified: covered.includes(s.domain) })), port),
    30_000,
  );

  if (missing.length === 0) {
    return { domains: statuses, certified: live.length > 0 };
  }

  // certbot re-validates every requested name, not just the new ones, so the
  // full live set goes in — --expand (in the static-site script) grows the
  // existing certificate's SAN list rather than starting a fresh lineage.
  const r = await run(`static-site domain-cert ${shq(name)} ${live.map((s) => shq(s.domain)).join(' ')}`, 120_000);
  if (!r.ok) {
    // DNS was right but the issuer still refused (rate limit, CAA record,
    // propagation not actually complete at Let's Encrypt's own resolvers) —
    // whatever was already covered keeps serving over HTTPS; only the new
    // domain stays on plain HTTP until the next sync tries again.
    return { domains: statuses, certified: covered.length > 0 };
  }

  const nowCovered = await certCovers(name);
  const stillMissing = live.some((s) => !nowCovered.includes(s.domain));
  if (!stillMissing) {
    await runWithInput(
      `static-site domain-write ${shq(name)} ${port}`,
      buildConfig(name, live.map((s) => ({ ...s, certified: true })), port),
      30_000,
    );
  }

  return { domains: statuses, certified: !stillMissing };
}
