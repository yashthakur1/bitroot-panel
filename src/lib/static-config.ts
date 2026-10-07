// A static site's build settings — the branch it tracks, the npm script that
// builds it, and the folder that script leaves the site in. They live in the
// site's `.staticrc`, which `static-site` sources before every build.
//
// What can change here is deliberately narrower than what `static-site create`
// accepts. These settings are editable from the client portal, and the build
// runs on this host, not in a container: so the build command is only ever
// `npm run <script>` (the script itself is in the client's own repo, which they
// already control), never free text, and the repo URL is not editable at all —
// it is fetched with this host's git credentials.

import { run, runWithInput } from './runner';
import { assertName, shq, ValidationError } from './validate';

export interface StaticConfig {
  repo: string;
  branch: string;
  /** The npm script `npm run` builds with, or '' when the site is served as-is. */
  buildScript: string;
  outDir: string;
  port: number;
}

const siteDir = (name: string) => `"$HOME/apps/static/${assertName(name)}"`;

export function assertBranch(v: unknown): string {
  const b = typeof v === 'string' ? v.trim() : '';
  if (
    !/^[A-Za-z0-9._/-]{1,100}$/.test(b) ||
    b.startsWith('-') ||
    b.startsWith('/') ||
    b.endsWith('/') ||
    b.endsWith('.lock') ||
    b.includes('..') ||
    b.includes('//')
  ) {
    throw new ValidationError('that is not a valid branch name');
  }
  return b;
}

export function assertBuildScript(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s === '') return '';
  if (!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,39}$/.test(s)) {
    throw new ValidationError('the build script is the name of a script in package.json, like "build"');
  }
  return s;
}

export function assertOutDir(v: unknown): string {
  const s = typeof v === 'string' ? v.trim().replace(/^\.\/+/, '').replace(/\/+$/, '') : '';
  if (!s || !/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(s) || s.split('/').some((p) => p === '..' || p === '.')) {
    throw new ValidationError('the output folder is a path inside the repo, like "dist" or "build/site"');
  }
  return s;
}

/** Reverses bash's `printf %q` for the plain values `static-site create` writes (backslash escapes). */
function unq(v: string): string {
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  return v.replace(/\\(.)/g, '$1');
}

export function parseStaticrc(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = unq(m[2]);
  }
  return out;
}

export function toConfig(rc: Record<string, string>): StaticConfig {
  const cmd = rc.BUILD_CMD ?? '';
  const script = /^npm run (\S+)$/.exec(cmd)?.[1] ?? (cmd ? cmd : '');
  return {
    repo: rc.REPO ?? '',
    branch: rc.BRANCH || 'main',
    buildScript: script,
    outDir: rc.OUT_DIR || 'dist',
    port: Number(rc.PORT) || 0,
  };
}

/** Writes values the way `static-site` sources them; every value is pre-validated, so single quotes are safe. */
export function renderStaticrc(rc: Record<string, string>): string {
  return (
    Object.entries(rc)
      .map(([k, v]) => `${k}=${shq(v)}`)
      .join('\n') + '\n'
  );
}

async function readRc(name: string): Promise<Record<string, string>> {
  const r = await run(`cat ${siteDir(name)}/.staticrc 2>/dev/null`);
  if (!r.ok || !r.output.trim()) throw new ValidationError(`"${name}" is not a registered static site`);
  return parseStaticrc(r.output);
}

export async function readStaticConfig(name: string): Promise<StaticConfig> {
  return toConfig(await readRc(name));
}

/**
 * Applies a settings change. A new branch is checked out right away (after
 * confirming it exists on the remote, so a typo can't leave the checkout
 * broken); nothing is rebuilt — the next deploy, manual or on push, picks
 * the new settings up.
 */
export async function updateStaticConfig(
  name: string,
  input: { branch?: unknown; buildScript?: unknown; outDir?: unknown },
): Promise<StaticConfig> {
  const rc = await readRc(name);
  const dir = siteDir(name);

  if (input.buildScript !== undefined) {
    const s = assertBuildScript(input.buildScript);
    rc.BUILD_CMD = s ? `npm run ${s}` : '';
  }
  if (input.outDir !== undefined) rc.OUT_DIR = assertOutDir(input.outDir);

  if (input.branch !== undefined) {
    const branch = assertBranch(input.branch);
    if (branch !== (rc.BRANCH || 'main')) {
      const exists = await run(`cd ${dir}/src && git ls-remote --exit-code --heads origin ${shq(branch)}`, 30_000);
      if (!exists.ok) throw new ValidationError(`there is no branch "${branch}" in the repository`);
      const sw = await run(
        `cd ${dir}/src && git fetch origin ${shq(`+refs/heads/${branch}:refs/remotes/origin/${branch}`)} && ` +
          `git checkout -B ${shq(branch)} ${shq(`origin/${branch}`)} && git branch --set-upstream-to=${shq(`origin/${branch}`)}`,
        120_000,
      );
      if (!sw.ok) throw new ValidationError(`could not switch to "${branch}": ${sw.output.split('\n').pop()}`);
    }
    rc.BRANCH = branch;
  }

  const w = await runWithInput(`umask 077 && cat > ${dir}/.staticrc`, renderStaticrc(rc), 10_000);
  if (!w.ok) throw new Error(`could not save settings: ${w.output}`);
  return toConfig(rc);
}

/** True while a build for this site is running — two builds in one checkout would trample each other. */
export async function deployInProgress(name: string): Promise<boolean> {
  const r = await run(`pgrep -f ${shq(`static-site deploy ${assertName(name)}$`)} >/dev/null && echo yes || true`);
  return r.output.trim() === 'yes';
}
