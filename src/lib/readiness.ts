// What the panel can actually do on this machine right now.
//
// Every capability here is optional and independently broken-able: a Cloudflare
// token missing one permission, Tailscale installed but not logged in, Garage
// running but unreachable. The panel degrades quietly when one is absent, which
// is correct behaviour and terrible feedback - you discover it when a feature
// silently does nothing. This probes each one and says what it costs you.

import { readFile } from 'fs/promises';
import path from 'path';
import { run } from './runner';
import { checkCloudflare } from './setup';

const ENV_PATH = process.env.BITPANEL_ENV_PATH ?? path.join(process.cwd(), '.env');

export type Status = 'ready' | 'partial' | 'missing';

export interface Step {
  id: string;
  title: string;
  status: Status;
  /** One line on what was actually found, not what should be true. */
  detail: string;
  /** Features that do not work until this is ready. */
  unlocks: string[];
  /** Commands to run on the server, in order. */
  fix?: string[];
  /** Where to get the credential this needs. */
  link?: { href: string; label: string };
  /** Per-permission or per-check breakdown, when there is one. */
  checks?: Array<{ name: string; ok: boolean }>;
  /** Nothing else can be judged until this is done. */
  required?: boolean;
}

async function env(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(ENV_PATH, 'utf8');
    const out: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) out[m[1]] = m[2].trim();
    }
    return { ...out, ...(process.env as Record<string, string>) };
  } catch {
    return process.env as Record<string, string>;
  }
}

// run() returns err.message when a command produces no output and exits
// non-zero - and that message embeds the whole command, so a substring search
// for a marker matches the `echo marker` that was looking for it. Every probe
// below therefore ends in `; true` to keep the exit status clean, and matches
// whole lines rather than substrings.
function emitted(output: string, marker: string): boolean {
  return output.split('\n').some((l) => l.trim() === marker);
}

async function has(binary: string): Promise<boolean> {
  const r = await run(`command -v ${binary} >/dev/null 2>&1 && echo yes; true`, 10_000);
  return emitted(r.output, 'yes');
}

async function panelStep(e: Record<string, string>): Promise<Step> {
  const ok = Boolean(e.DASHBOARD_PASSWORD && e.SESSION_SECRET);
  return {
    id: 'panel',
    title: 'Panel access',
    required: true,
    status: ok ? 'ready' : 'missing',
    detail: ok
      ? 'Password and session secret are set.'
      : 'No dashboard password — the panel would redirect to the setup wizard.',
    unlocks: ['Signing in at all'],
    fix: ok ? undefined : ['Open /setup and complete the wizard'],
  };
}

async function domainStep(e: Record<string, string>): Promise<Step> {
  const domain = e.DOMAIN_SUFFIX && e.DOMAIN_SUFFIX !== 'example.com' ? e.DOMAIN_SUFFIX : null;
  return {
    id: 'domain',
    title: 'Domain',
    status: domain ? 'ready' : 'missing',
    detail: domain
      ? `Routes are created under ${domain}.`
      : 'No domain set, so there is nothing to build public hostnames from.',
    unlocks: ['Public URLs for services', 'Published storage buckets'],
    fix: domain
      ? undefined
      : ['Set DOMAIN_SUFFIX in ~/apps/bitroot-panel/.env', 'pm2 restart bitroot-panel --update-env'],
  };
}

async function cloudflareStep(e: Record<string, string>): Promise<Step> {
  const unlocks = ['DNS records for new services', 'Edge caching for public buckets', 'Access policies'];
  if (!e.CF_API_TOKEN || !e.CF_ZONE_ID) {
    return {
      id: 'cloudflare',
      title: 'Cloudflare API',
      status: 'missing',
      detail: 'No API token, so the panel cannot create routes or cache rules.',
      unlocks,
      link: {
        href: 'https://dash.cloudflare.com/profile/api-tokens',
        label: 'Create a token',
      },
      fix: [
        'Set CF_API_TOKEN and CF_ZONE_ID in ~/apps/bitroot-panel/.env',
        'pm2 restart bitroot-panel --update-env',
      ],
    };
  }

  // A token missing one permission looks identical to a correct one until a
  // cache rule fails with a bare 403, so ask Cloudflare rather than assume.
  const result = await checkCloudflare(e.CF_API_TOKEN, e.CF_ZONE_ID).catch(() => null);
  if (!result) {
    return {
      id: 'cloudflare',
      title: 'Cloudflare API',
      status: 'partial',
      detail: 'Token is set but Cloudflare could not be reached to verify it.',
      unlocks,
    };
  }
  const failed = result.permissions.filter((p) => !p.ok);
  return {
    id: 'cloudflare',
    title: 'Cloudflare API',
    status: result.ok ? 'ready' : 'partial',
    detail: result.ok
      ? `Token verified against ${result.zoneName ?? 'the zone'}.`
      : `${failed.length} of ${result.permissions.length} permission checks failed.`,
    unlocks,
    checks: result.permissions.map((p) => ({ name: p.name, ok: p.ok })),
    link: result.ok
      ? undefined
      : { href: 'https://dash.cloudflare.com/profile/api-tokens', label: 'Edit the token' },
  };
}

async function tunnelStep(): Promise<Step> {
  const unlocks = ['Serving public URLs without opening a port'];
  if (!(await has('cloudflared'))) {
    return {
      id: 'tunnel',
      title: 'Cloudflare Tunnel',
      status: 'missing',
      detail: 'cloudflared is not installed.',
      unlocks,
      fix: ['Install cloudflared, then: cloudflared tunnel login'],
    };
  }
  // The installer always writes a config skeleton, so the presence of an
  // "ingress:" block proves nothing. A tunnel is real only when the login
  // certificate and a credentials file exist and config.yml names the tunnel -
  // testing for the skeleton reported a configured tunnel on a machine that had
  // never been logged in, and then offered a restart command for a process that
  // did not exist.
  const [probe, running] = await Promise.all([
    run(
      'test -f "$HOME/.cloudflared/cert.pem" && echo cert; ' +
        'ls "$HOME"/.cloudflared/*.json >/dev/null 2>&1 && echo creds; ' +
        'grep -Eq "^[[:space:]]*tunnel:[[:space:]]*[^#[:space:]]" "$HOME/.cloudflared/config.yml" 2>/dev/null && echo named; true',
      15_000,
    ),
    run('pm2 jlist 2>/dev/null || true', 15_000),
  ]);
  const loggedIn = emitted(probe.output, 'cert');
  const created = emitted(probe.output, 'creds');
  const named = emitted(probe.output, 'named');
  const known = /"name"\s*:\s*"cloudflared"/.test(running.output);
  const up = /"name"\s*:\s*"cloudflared"[\s\S]{0,400}?"status"\s*:\s*"online"/.test(running.output);

  if (!loggedIn) {
    return {
      id: 'tunnel',
      title: 'Cloudflare Tunnel',
      status: 'missing',
      detail: 'cloudflared is installed but not logged in to Cloudflare yet.',
      unlocks,
      fix: ['cloudflared tunnel login', 'cloudflared tunnel create $(hostname)'],
    };
  }
  if (!created || !named) {
    return {
      id: 'tunnel',
      title: 'Cloudflare Tunnel',
      status: 'partial',
      detail: created
        ? 'A tunnel exists, but config.yml does not name it yet.'
        : 'Logged in, but no tunnel has been created.',
      unlocks,
      fix: created
        ? ['Uncomment tunnel: and credentials-file: in ~/.cloudflared/config.yml']
        : ['cloudflared tunnel create $(hostname)'],
    };
  }
  return {
    id: 'tunnel',
    title: 'Cloudflare Tunnel',
    status: up ? 'ready' : 'partial',
    detail: up
      ? 'Tunnel configured and running.'
      : known
        ? 'Tunnel is configured but the cloudflared process is stopped.'
        : 'Tunnel is configured but nothing is running it.',
    unlocks,
    // Offering "pm2 restart" for a process pm2 has never heard of just errors.
    fix: up
      ? undefined
      : known
        ? ['pm2 restart cloudflared']
        : ['pm2 start cloudflared --name cloudflared -- tunnel run $(hostname)', 'pm2 save'],
  };
}

async function tailscaleStep(e: Record<string, string>): Promise<Step> {
  const unlocks = ['Private URLs for unpublished services', 'Reaching storage without exposing it'];
  if (!(await has('tailscale'))) {
    return {
      id: 'tailscale',
      title: 'Tailscale',
      status: 'missing',
      detail: 'Not installed. Services stay reachable only from this machine.',
      unlocks,
      link: { href: 'https://tailscale.com/download', label: 'Install Tailscale' },
      fix: ['curl -fsSL https://tailscale.com/install.sh | sh', 'sudo tailscale up'],
    };
  }
  const r = await run('tailscale status --json 2>/dev/null || true', 15_000);
  let host: string | null = null;
  try {
    host = (JSON.parse(r.output.slice(r.output.indexOf('{')))?.Self?.DNSName ?? '').replace(/\.$/, '') || null;
  } catch {
    host = null;
  }
  if (!host) {
    return {
      id: 'tailscale',
      title: 'Tailscale',
      status: 'partial',
      detail: 'Installed but not logged in, so it has no name on the tailnet yet.',
      unlocks,
      fix: ['sudo tailscale up'],
    };
  }
  // Must be the full tailnet name, not the short hostname: private URLs are
  // built from this value, and a bare hostname only resolves where MagicDNS
  // search domains happen to be set up - which is not everywhere.
  const recorded = e.TAILNET_HOST;
  if (recorded !== host) {
    return {
      id: 'tailscale',
      title: 'Tailscale',
      status: 'partial',
      detail: !recorded
        ? `Logged in as ${host}, but TAILNET_HOST is unset, so no private URLs are offered.`
        : recorded === host.split('.')[0]
          ? `Logged in as ${host}, but TAILNET_HOST is the short name "${recorded}" — private URLs built from it only resolve where MagicDNS search domains are configured.`
          : `Logged in as ${host}, but TAILNET_HOST is set to "${recorded}".`,
      unlocks,
      fix: [`Set TAILNET_HOST=${host} in ~/apps/bitroot-panel/.env`, 'pm2 restart bitroot-panel --update-env'],
    };
  }
  return {
    id: 'tailscale',
    title: 'Tailscale',
    status: 'ready',
    detail: `Logged in as ${host}.`,
    unlocks,
  };
}

async function storageStep(e: Record<string, string>): Promise<Step> {
  const unlocks = ['Buckets, uploads and presigned links'];
  if (!e.GARAGE_ADMIN_TOKEN) {
    return {
      id: 'storage',
      title: 'Object storage',
      status: 'missing',
      detail: 'No Garage admin token, so the panel cannot manage buckets.',
      unlocks,
      fix: ['Set GARAGE_ADMIN_TOKEN in ~/apps/bitroot-panel/.env', 'pm2 restart bitroot-panel --update-env'],
    };
  }
  let reachable = false;
  try {
    const res = await fetch(`${e.GARAGE_ADMIN_URL ?? 'http://127.0.0.1:3903'}/health`, {
      headers: { Authorization: `Bearer ${e.GARAGE_ADMIN_TOKEN}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    reachable = res.ok;
  } catch {
    reachable = false;
  }
  return {
    id: 'storage',
    title: 'Object storage',
    status: reachable ? 'ready' : 'partial',
    detail: reachable ? 'Garage is running and the token works.' : 'Token is set but Garage did not answer.',
    unlocks,
    fix: reachable ? undefined : ['pm2 restart garage'],
  };
}

async function pocketbaseStep(): Promise<Step> {
  const unlocks = ['Project databases', 'Scheduled backups'];
  const r = await run(
    'test -x "$HOME/apps/pocketbase/pocketbase" && echo installed; ' +
      'test -f "$HOME/apps/pocketbase/.superuser" && echo cred; true',
    15_000,
  );
  if (!emitted(r.output, 'installed')) {
    return {
      id: 'pocketbase',
      title: 'PocketBase',
      status: 'missing',
      detail: 'Not installed.',
      unlocks,
      fix: ['Re-run the installer, or download PocketBase into ~/apps/pocketbase'],
    };
  }
  let healthy = false;
  try {
    const res = await fetch(`${process.env.POCKETBASE_URL ?? 'http://127.0.0.1:8090'}/api/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    healthy = res.ok;
  } catch {
    healthy = false;
  }
  // A missing credential is no longer a blocker: the panel creates its own
  // service account on first use. Worth showing, but not as a failure.
  return {
    id: 'pocketbase',
    title: 'PocketBase',
    status: healthy ? 'ready' : 'partial',
    detail: healthy
      ? emitted(r.output, 'cred')
        ? 'Running, with the panel service account in place.'
        : 'Running. The panel will create its service account when first used.'
      : 'Installed but not answering on its port.',
    unlocks,
    fix: healthy ? undefined : ['pm2 restart pocketbase'],
  };
}

export interface Readiness {
  steps: Step[];
  ready: number;
  total: number;
  scannedAt: string;
}

export async function readiness(): Promise<Readiness> {
  const e = await env();
  // Probed concurrently: several shell out or hit the network, and doing them
  // in series makes the page feel broken on modest hardware.
  const steps = await Promise.all([
    panelStep(e),
    domainStep(e),
    cloudflareStep(e),
    tunnelStep(),
    tailscaleStep(e),
    storageStep(e),
    pocketbaseStep(),
  ]);
  return {
    steps,
    ready: steps.filter((s) => s.status === 'ready').length,
    total: steps.length,
    scannedAt: new Date().toISOString(),
  };
}
