// What version of the panel is running here, and is there a newer one.
//
// npm is the release channel of record: the tag, the published package and the
// installer all carry the same version, so asking the registry avoids GitHub's
// unauthenticated rate limit and needs no credential.

import { run } from './runner';
import { shq } from './validate';

const APP = '"$HOME/apps/bitroot-panel"';

export interface VersionInfo {
  /** e.g. "0.1.1", or null when this was not installed from a tag. */
  installed: string | null;
  /** Short commit, always available. */
  commit: string | null;
  /** Latest published, or null if the registry could not be reached. */
  latest: string | null;
  updateAvailable: boolean;
  /** True when running a branch rather than a release. */
  unpinned: boolean;
}

function clean(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = /^v?(\d+\.\d+\.\d+)/.exec(v.trim());
  return m ? m[1] : null;
}

// Numeric compare per field. String comparison gets 0.10.0 vs 0.9.0 wrong, and
// that is exactly the release where it would start mattering.
function newer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

let cached: { at: number; latest: string | null } | null = null;

async function latestPublished(): Promise<string | null> {
  // Cached for an hour: this is checked on every visit to the setup page, and
  // the answer changes at the pace of releases.
  if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached.latest;
  try {
    const res = await fetch('https://registry.npmjs.org/bitpanel/latest', {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const v = res.ok ? clean((await res.json())?.version) : null;
    cached = { at: Date.now(), latest: v };
    return v;
  } catch {
    cached = { at: Date.now(), latest: null };
    return null;
  }
}

export async function versionInfo(): Promise<VersionInfo> {
  const [marker, described, head] = await Promise.all([
    run(`cat ${APP}/.bitpanel-version 2>/dev/null || true`, 10_000),
    run(`git -C ${APP} describe --tags --exact-match 2>/dev/null || true`, 15_000),
    run(`git -C ${APP} rev-parse --short HEAD 2>/dev/null || true`, 15_000),
  ]);

  // git is asked first - it reflects what is checked out right now, where the
  // marker file only reflects what the installer last wrote.
  const installed =
    clean(described.output) || clean(marker.output.match(/^ref=(.*)$/m)?.[1]) || null;
  const commit = head.output.trim().split('\n').pop()?.trim() || null;
  const latest = await latestPublished();

  return {
    installed,
    commit: commit && /^[0-9a-f]{6,40}$/.test(commit) ? commit : null,
    latest,
    updateAvailable: Boolean(installed && latest && newer(latest, installed)),
    unpinned: !installed,
  };
}

// Runs detached and writes to a log: a build takes minutes on a phone, and the
// process being restarted at the end is the one serving the request that asked
// for it. Progress is read back from the log rather than held on a connection.
export const UPDATE_LOG = '"$HOME/.config/bitroot-panel/update.log"';

export async function startUpdate(target: string): Promise<void> {
  const tag = `v${target.replace(/^v/, '')}`;
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('invalid version');

  // Written to a file and then run, rather than passed inline. The script has
  // to survive one layer of sh -c already; nesting quotes through a second is
  // how a working command becomes a silently truncated one.
  const script = [
    'set -e',
    'APP="$HOME/apps/bitroot-panel"',
    'LOG="$HOME/.config/bitroot-panel/update.log"',
    'mkdir -p "$HOME/.config/bitroot-panel"',
    'exec > "$LOG" 2>&1',
    `echo "== updating to ${tag} =="`,
    'cd "$APP"',
    `git fetch --depth 1 origin "refs/tags/${tag}:refs/tags/${tag}"`,
    `git checkout -q --detach "${tag}"`,
    'echo "== installing dependencies =="',
    // Build tools live in devDependencies, and an inherited NODE_ENV=production
    // would omit exactly the ones the build needs.
    'env -u NODE_ENV npm install --include=dev --no-audit --no-fund',
    'echo "== building =="',
    'NODE_OPTIONS=--max-old-space-size=2048 npm run build',
    '{ echo "ref=$(git describe --tags --always 2>/dev/null)";',
    '  echo "commit=$(git rev-parse --short HEAD 2>/dev/null)";',
    '  echo "installed=$(date -u +%Y-%m-%dT%H:%M:%SZ)"; } > "$APP/.bitpanel-version"',
    'echo "== restarting =="',
    'set -a; . "$APP/.env" 2>/dev/null || true; set +a',
    'pm2 restart bitroot-panel --update-env',
    'echo "== done =="',
  ].join('\n');

  await run(
    `mkdir -p "$HOME/.config/bitroot-panel" && printf %s ${shq(script)} > "$HOME/.config/bitroot-panel/update.sh" && ` +
      'nohup sh "$HOME/.config/bitroot-panel/update.sh" >/dev/null 2>&1 &',
    15_000,
  );
}

export async function updateLog(): Promise<string> {
  const r = await run(`cat ${UPDATE_LOG} 2>/dev/null || true`, 10_000);
  return r.output.slice(-4000);
}
