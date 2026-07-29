// What the panel can actually do on this machine right now.
//
// Every capability here is optional and independently broken-able: a Cloudflare
// token missing one permission, Tailscale installed but not logged in, Garage
// running but unreachable. The panel degrades quietly when one is absent, which
// is correct behaviour and terrible feedback - you discover it when a feature
// silently does nothing. This probes each one and says what it costs you.

import os from 'os';
import { readFile } from 'fs/promises';
import path from 'path';
import { run } from './runner';
import { checkCloudflare, detectTailnet } from './setup';
import { versionInfo } from './version';
import { adminBindAddr, bindIsLoopback, webRootDomain } from './garage-config';
import { parsePm2Json, stripAnsi } from './ports';

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
  link?: { href: string; label: string; logo?: string };
  /** Things the panel can do itself, rather than describing them. */
  actions?: Array<{ id: string; label: string; note?: string }>;
  /** Per-permission or per-check breakdown, when there is one. */
  checks?: Array<{ name: string; ok: boolean }>;
  /** Ordered steps for a credential that has to be created somewhere else. */
  guide?: string[];
  /** Exactly what a token must be granted, and why each one is needed. */
  grants?: Array<{ scope: string; permission: string; why: string; missed?: boolean }>;
  /**
   * Values the panel can write to .env itself. Telling someone to SSH in and
   * edit a file, from a web panel whose whole job is to save them that trip, is
   * the wrong answer when the value is a string it could just accept.
   */
  fields?: Array<{
    key: string;
    label: string;
    hint?: string;
    secret?: boolean;
    /** Prefilled when the panel already knows the right answer. */
    suggestion?: string;
  }>;
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
    // An empty process.env value must not mask a real one from the file. The
    // installer writes blank placeholders, pm2 captures them at first start,
    // and dotenv refuses to overwrite anything already set - so the blank
    // outlives every later edit and the panel reports a credential missing
    // while it sits in the file, filled in.
    const merged = { ...out };
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === 'string' && v !== '') merged[k] = v;
    }
    return merged;
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
    fields: domain
      ? undefined
      : [{ key: 'DOMAIN_SUFFIX', label: 'Domain', hint: 'A service called blog becomes blog.<domain>.' }],
  };
}

// Everything needed to produce a correct token, shown before the token exists
// rather than after it fails. The account-level grant is the one people miss:
// cache rulesets live at the account, not the zone, so a token with every zone
// permission and none of that one looks complete and fails with a bare 403 the
// first time a bucket is published.
const CF_GRANTS: NonNullable<Step['grants']> = [
  { scope: 'Zone', permission: 'DNS · Edit', why: 'creates the DNS record behind each route' },
  { scope: 'Zone', permission: 'Cache Rules · Edit', why: 'the edge cache rule for published buckets' },
  { scope: 'Zone', permission: 'Cache Purge · Purge', why: 'clears the edge when you replace a file' },
  {
    scope: 'Account',
    permission: 'Account Rulesets · Edit',
    why: 'cache rules are stored on the account, not the zone — without this the rule fails with a bare 403',
    missed: true,
  },
];

const TAILNET_FIELD = {
  key: 'TAILNET_HOST',
  label: 'Tailnet hostname',
  hint: 'The full name, e.g. machine.tailnet.ts.net — private URLs are built from it.',
};

const CF_FIELDS = [
  {
    key: 'CF_API_TOKEN',
    label: 'API token',
    hint: 'Shown once by Cloudflare when you create it.',
    secret: true,
  },
  {
    key: 'CF_ZONE_ID',
    label: 'Zone ID',
    hint: "On the zone's Overview page, right-hand sidebar.",
  },
];

const CF_GUIDE = [
  'In Cloudflare, open My Profile → API Tokens → Create Token, and pick "Create Custom Token".',
  'Give it the four permissions below. The Account one is a separate row from the Zone ones.',
  'Under Zone Resources, include the specific zone you route under.',
  'Create the token and copy it now — Cloudflare shows the value once and never again.',
  'Open that zone\'s Overview page and copy the Zone ID from the right-hand sidebar.',
];

async function cloudflareStep(e: Record<string, string>): Promise<Step> {
  const unlocks = ['DNS records for new services', 'Edge caching for public buckets', 'Access policies'];
  if (!e.CF_API_TOKEN || !e.CF_ZONE_ID) {
    return {
      id: 'cloudflare',
      title: 'Cloudflare API',
      status: 'missing',
      detail: 'No API token, so the panel cannot create routes or cache rules.',
      unlocks,
      guide: CF_GUIDE,
      grants: CF_GRANTS,
      fields: CF_FIELDS,
      link: {
        href: 'https://dash.cloudflare.com/profile/api-tokens',
        label: 'Open Cloudflare API tokens',
      },
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
    guide: result.ok ? undefined : CF_GUIDE,
    grants: result.ok ? undefined : CF_GRANTS,
    fields: result.ok ? undefined : CF_FIELDS,
    link: result.ok
      ? undefined
      : { href: 'https://dash.cloudflare.com/profile/api-tokens', label: 'Edit the token' },
  };
}

// pm2 jlist is JSON, so read it as JSON. The previous check looked for
// "status":"online" within 400 characters of the process name, and pm2_env is
// far larger than that - so a process that was plainly running was reported
// stopped, right after the panel had started it.
async function pm2Status(name: string): Promise<'online' | 'stopped' | 'absent'> {
  const r = await run('pm2 jlist 2>/dev/null || true', 15_000);
  const list = parsePm2Json(r.output);
  const proc = list.find((p: { name?: string }) => p?.name === name);
  if (!proc) return 'absent';
  return proc?.pm2_env?.status === 'online' ? 'online' : 'stopped';
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
  const [probe, procStatus] = await Promise.all([
    run(
      'test -f "$HOME/.cloudflared/cert.pem" && echo cert; ' +
        'ls "$HOME"/.cloudflared/*.json >/dev/null 2>&1 && echo creds; ' +
        'grep -Eq "^[[:space:]]*tunnel:[[:space:]]*[^#[:space:]]" "$HOME/.cloudflared/config.yml" 2>/dev/null && echo named; true',
      15_000,
    ),
    pm2Status('cloudflared'),
  ]);
  const loggedIn = emitted(probe.output, 'cert');
  const created = emitted(probe.output, 'creds');
  const named = emitted(probe.output, 'named');
  const known = procStatus !== 'absent';
  const up = procStatus === 'online';

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
      actions: created ? [{ id: 'link-tunnel', label: 'Point config.yml at this tunnel' }] : undefined,
      fix: created ? undefined : ['cloudflared tunnel create $(hostname)'],
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
    actions: up ? undefined : [{ id: 'start-tunnel', label: known ? 'Restart cloudflared' : 'Start cloudflared' }],
  };
}

async function tailscaleStep(e: Record<string, string>): Promise<Step> {
  const unlocks = ['Private URLs for unpublished services', 'Reaching storage without exposing it'];
  const [cli, net] = await Promise.all([has('tailscale'), detectTailnet()]);

  if (!net.address && !net.host) {
    return cli
      ? {
          id: 'tailscale',
          title: 'Tailscale',
          status: 'partial',
          detail: 'Installed but not logged in, so it has no name on the tailnet yet.',
          unlocks,
          fix: ['sudo tailscale up'],
        }
      : os.platform() === 'android'
        ? {
            id: 'tailscale',
            title: 'Tailscale',
            status: 'missing',
            detail:
              'Not connected. On Android, Tailscale is an app rather than a package — install it, sign in, and the panel picks up the rest by itself.',
            unlocks,
            link: {
              href: 'https://play.google.com/store/apps/details?id=com.tailscale.ipn',
              label: 'Get Tailscale on Google Play',
              logo: '/images/tailscale.svg',
            },
          }
        : {
            id: 'tailscale',
            title: 'Tailscale',
            status: 'missing',
            detail: 'Not installed. Services stay reachable only from this machine.',
            unlocks,
            link: {
              href: 'https://tailscale.com/download',
              label: 'Install Tailscale',
              logo: '/images/tailscale.svg',
            },
            fix: ['curl -fsSL https://tailscale.com/install.sh | sh', 'sudo tailscale up'],
          };
  }

  const where = net.address ? ` at ${net.address}` : '';
  const how = net.viaCli ? '' : ' Detected without the CLI, which is normal on Android.';

  if (net.host && e.TAILNET_HOST === net.host) {
    return {
      id: 'tailscale',
      title: 'Tailscale',
      status: 'ready',
      detail: `On the tailnet${where} as ${net.host}.${how}`,
      unlocks,
    };
  }

  // The name is known, so offer it rather than asking anyone to retype what is
  // already on screen.
  if (net.host) {
    return {
      id: 'tailscale',
      title: 'Tailscale',
      status: 'partial',
      detail: !e.TAILNET_HOST
        ? `On the tailnet${where} as ${net.host}, but TAILNET_HOST is unset so no private URLs are offered.${how}`
        : `On the tailnet as ${net.host}, but TAILNET_HOST is set to "${e.TAILNET_HOST}".`,
      unlocks,
      fields: [{ ...TAILNET_FIELD, suggestion: net.host }],
    };
  }

  return {
    id: 'tailscale',
    title: 'Tailscale',
    status: 'partial',
    detail: `On the tailnet${where}, but its name could not be resolved, so TAILNET_HOST has to be set by hand.`,
    unlocks,
    fields: [TAILNET_FIELD],
  };
}

// pm2 upgraded on disk while the running daemon stayed on the old version is a
// state the machine can sit in indefinitely: everything looks installed, and
// the process table is empty. It took a production outage to notice, so the
// panel should say it out loud.
async function pm2Step(): Promise<Step> {
  const raw = await run('pm2 list 2>&1 | head -20; true', 20_000);
  // pm2 colours this output, and the version numbers come back wrapped in
  // escape codes that would otherwise be printed to the operator verbatim.
  const out = stripAnsi(raw.output);
  const stale = /out-of-date/i.test(out);
  if (!stale) {
    return {
      id: 'pm2',
      title: 'Process manager',
      status: 'ready',
      detail: 'pm2 is running the version installed on disk.',
      unlocks: [],
    };
  }
  const inMem = /In memory PM2 version:\s*(\S+)/.exec(out)?.[1] ?? 'an older version';
  const local = /Local PM2 version:\s*(\S+)/.exec(out)?.[1] ?? 'the installed one';
  return {
    id: 'pm2',
    title: 'Process manager',
    status: 'partial',
    detail: `pm2 ${local} is installed but the running daemon is still ${inMem}. Cycling it restarts every service on this machine, including the panel.`,
    unlocks: ['Services surviving a reboot', 'Anything the panel starts or restarts'],
    actions: [{ id: 'refresh-pm2', label: 'Cycle the pm2 daemon', note: 'Saves the process list first, then restores it if the daemon comes back empty. Every service restarts.' }],
  };
}

async function panelVersionStep(fresh: boolean): Promise<Step> {
  const v = await versionInfo(fresh);
  const unlocks = ['Fixes and features released since this was installed'];

  if (v.unpinned) {
    // Installed from a branch rather than a release. Nothing is broken, but
    // there is no version to compare against, so nothing can be offered.
    return {
      id: 'version',
      title: 'Panel version',
      status: 'ready',
      detail: `Running ${v.commit ? `commit ${v.commit}` : 'an untagged build'} — installed from a branch, so there is no release to compare against.`,
      unlocks: [],
    };
  }
  if (!v.latest) {
    return {
      id: 'version',
      title: 'Panel version',
      status: 'ready',
      detail: `Running ${v.installed}. The registry could not be reached, so whether anything newer exists is unknown.`,
      unlocks: [],
    };
  }
  if (!v.updateAvailable) {
    return {
      id: 'version',
      title: 'Panel version',
      status: 'ready',
      detail: `Running ${v.installed}, which is the latest release.`,
      unlocks: [],
    };
  }
  return {
    id: 'version',
    title: 'Panel version',
    status: 'partial',
    detail: `${v.latest} is available — this is running ${v.installed}.`,
    unlocks,
    actions: [
      {
        id: 'update-panel',
        label: `Update to ${v.latest}`,
        note: 'Fetches the release, installs, builds and restarts. Several minutes on a phone.',
      },
    ],
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
      fix: ['Set GARAGE_ADMIN_TOKEN in ~/apps/bitroot-panel/.env', 'panel-restart'],
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
  if (!reachable) {
    return {
      id: 'storage',
      title: 'Object storage',
      status: 'partial',
      detail: 'Token is set but Garage did not answer.',
      unlocks,
      fix: ['pm2 restart garage'],
    };
  }

  // Two things can be wrong while Garage is up and answering, and a machine can
  // have both, so they are collected rather than raced for a single early
  // return: fixing one should not hide the other for a refresh.
  const details: string[] = [];
  const actions: Step['actions'] = [];
  let issueUnlocks: string[] = [];

  // The admin API creates buckets, mints S3 keys and rewrites the cluster
  // layout, with a bearer token as the only thing in front of it. Installs
  // before 0.1.8 bound it to "[::]:3903" - every interface - while the port
  // table promised loopback. Nothing off this machine needs to reach it.
  const adminBind = await adminBindAddr();
  if (adminBind && !bindIsLoopback(adminBind)) {
    details.push(
      `The Garage admin API is bound to ${adminBind}, which is every interface — it should answer on loopback only.`,
    );
    actions.push({
      id: 'secure-garage-admin',
      label: 'Bind admin API to 127.0.0.1',
      note: 'Rewrites [admin] api_bind_addr in garage.toml and restarts Garage. The S3 API and website endpoint are left reachable.',
    });
    issueUnlocks = unlocks;
  }

  // Garage's website endpoint resolves a Host to a bucket by stripping this.
  // When it disagrees with the domain the panel publishes under, every public
  // object 404s - from Garage, which reads exactly like a missing file.
  const domain = e.DOMAIN_SUFFIX && e.DOMAIN_SUFFIX !== 'example.com' ? e.DOMAIN_SUFFIX : null;
  const webRoot = await webRootDomain();
  if (domain && webRoot && webRoot !== domain) {
    details.push(
      `Its website endpoint serves .${webRoot} while the panel publishes under ${domain} — published objects will 404.`,
    );
    actions.push({ id: 'sync-garage-domain', label: `Point Garage at ${domain}` });
    issueUnlocks = [...new Set([...issueUnlocks, 'Public URLs for published buckets'])];
  }

  if (details.length) {
    return {
      id: 'storage',
      title: 'Object storage',
      status: 'partial',
      detail: `Garage is running, but: ${details.join(' ')}`,
      unlocks: issueUnlocks,
      actions,
    };
  }

  return {
    id: 'storage',
    title: 'Object storage',
    status: 'ready',
    detail: 'Garage is running and the token works.',
    unlocks,
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

export async function readiness(fresh = false): Promise<Readiness> {
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
    panelVersionStep(fresh),
    pm2Step(),
  ]);
  return {
    steps,
    ready: steps.filter((s) => s.status === 'ready').length,
    total: steps.length,
    scannedAt: new Date().toISOString(),
  };
}
