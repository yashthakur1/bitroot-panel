// Garage's website endpoint maps a Host header to a bucket by stripping its
// configured root_domain. If that does not match the domain the panel hands out
// URLs under, every published object 404s - from Garage itself, which looks
// exactly like a missing file and is nothing of the sort.
//
// The installer writes this line before a domain has been chosen, so it starts
// as ".example.com" and nothing reconciled it afterwards. A fresh install got a
// storage endpoint that refused everything while the panel advertised it.

import { run } from './runner';
import { shq } from './validate';

// $PREFIX is Termux; /etc is everywhere else. GARAGE_CONFIG wins if set.
const CANDIDATES = [
  '${GARAGE_CONFIG:-}',
  '$PREFIX/etc/garage.toml',
  '/etc/garage.toml',
  '$HOME/garage.toml',
];

export async function garageConfigPath(): Promise<string | null> {
  const r = await run(
    `for f in ${CANDIDATES.join(' ')}; do [ -n "$f" ] && [ -f "$f" ] && echo "$f" && break; done; true`,
    10_000,
  );
  const p = r.output.trim().split('\n').pop()?.trim() ?? '';
  return p.startsWith('/') || p.includes('/') ? p : null;
}

/** The domain Garage's website endpoint currently strips, without the dot. */
export async function webRootDomain(): Promise<string | null> {
  const path = await garageConfigPath();
  if (!path) return null;
  // Only the one inside [s3_web]: there is a second root_domain under [s3_api]
  // that governs S3 addressing and must not be touched by this.
  const r = await run(
    `awk '/^\\[/ { s=$0 } s=="[s3_web]" && /^[[:space:]]*root_domain[[:space:]]*=/ { print; exit }' ${shq(path)} 2>/dev/null; true`,
    10_000,
  );
  const m = /root_domain\s*=\s*"\.?([^"]*)"/.exec(r.output);
  return m ? m[1] : null;
}

export interface SyncResult {
  ok: boolean;
  message: string;
}

export async function syncWebRootDomain(domain: string): Promise<SyncResult> {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)+$/i.test(domain)) {
    return { ok: false, message: 'that does not look like a domain' };
  }
  const path = await garageConfigPath();
  if (!path) return { ok: false, message: 'could not find garage.toml on this machine' };

  const current = await webRootDomain();
  if (current === domain) return { ok: true, message: `already set to .${domain}` };

  // Rewritten through a temp file and moved into place, so a failed write never
  // leaves Garage with a half-written config it will refuse to start on.
  const script = [
    `src=${shq(path)}`,
    'tmp=$(mktemp)',
    `awk -v d=${shq(domain)} '`,
    '  /^\\[/ { s=$0 }',
    '  s=="[s3_web]" && /^[[:space:]]*root_domain[[:space:]]*=/ { print "root_domain = \\"." d "\\""; next }',
    '  { print }',
    `' "$src" > "$tmp"`,
    // Refuse to install an empty or truncated result.
    '[ -s "$tmp" ] || { echo "rewrite produced nothing"; exit 1; }',
    'if [ -w "$src" ]; then cp "$tmp" "$src"; else sudo -n cp "$tmp" "$src" || { echo "needs sudo"; exit 1; }; fi',
    'rm -f "$tmp"',
    'pm2 restart garage >/dev/null 2>&1 || true',
    'echo ok',
  ].join('\n');

  const r = await run(script, 60_000);
  if (!r.output.includes('ok')) {
    return {
      ok: false,
      message: r.output.includes('needs sudo')
        ? `cannot write ${path} — run: sudo sed -i 's|^root_domain = ".*"|root_domain = ".${domain}"|' ${path} (the one under [s3_web]), then pm2 restart garage`
        : `could not update ${path}: ${r.output.trim().split('\n').pop() ?? 'unknown error'}`,
    };
  }
  return { ok: true, message: `garage website endpoint now serves .${domain}` };
}
