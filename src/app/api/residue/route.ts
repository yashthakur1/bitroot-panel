import { NextRequest, NextResponse } from 'next/server';
import { run } from '@/lib/runner';
import { assertName, shq, ValidationError } from '@/lib/validate';
import { dismissResidue, readLedger } from '@/lib/residue';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ResidueItem {
  id: string;
  category: string;
  label: string;
  detail: string;
  size: string;
  action?: { type: string; target: string; danger: string };
}

const SCAN = [
  'echo "##project_dirs"',
  'for d in "$HOME"/Downloads/*/; do [ -d "$d" ] || continue; printf "%s|%s\\n" "$(basename "$d")" "$(du -sh "$d" 2>/dev/null | cut -f1)"; done',
  'echo "##app_dirs"',
  'for d in "$HOME"/apps/*/; do [ -d "$d" ] || continue; printf "%s|%s\\n" "$(basename "$d")" "$(du -sh "$d" 2>/dev/null | cut -f1)"; done',
  'echo "##remotes"',
  'for d in "$HOME"/Downloads/*/ "$HOME"/apps/*/; do [ -d "$d.git" ] || [ -d "$d/.git" ] || continue; printf "%s|%s\\n" "$(basename "$d")" "$(git -C "$d" remote get-url origin 2>/dev/null)"; done',
  'echo "##repos"',
  'for d in "$HOME"/repos/*.git; do [ -d "$d" ] || continue; printf "%s|%s\\n" "$(basename "$d" .git)" "$(du -sh "$d" 2>/dev/null | cut -f1)"; done',
  'echo "##backups"',
  'for f in "$HOME"/backups/*.tar.gz; do [ -f "$f" ] || continue; printf "%s|%s|%s\\n" "$(basename "$f")" "$(du -h "$f" | cut -f1)" "$(date -r "$f" +%Y-%m-%d)"; done',
  'echo "##pm2logs"',
  'du -sh "$HOME/.pm2/logs" 2>/dev/null | cut -f1',
  'echo "##npmcache"',
  'du -sh "$HOME/.npm/_cacache" 2>/dev/null | cut -f1',
  'echo "##gocache"',
  'du -sh "$HOME/go/pkg/mod" 2>/dev/null | cut -f1',
  'echo "##bakfiles"',
  'for f in "$HOME"/bin/*.bak*; do [ -f "$f" ] || continue; printf "%s|%s\\n" "$(basename "$f")" "$(du -h "$f" | cut -f1)"; done',
  'echo "##ports"',
  'cat "$HOME/bin/ports.conf" 2>/dev/null | grep -E "^[a-zA-Z0-9_-]+=[0-9]+$" || true',
  'echo "##listening"',
  'ss -tln 2>/dev/null | grep LISTEN || true',
  'echo "##routes"',
  'grep -E "hostname:|service:" "$HOME/.cloudflared/config.yml" 2>/dev/null || true',
].join('; ');

function section(out: string, name: string): string[] {
  const parts = out.split(/^##/m);
  const found = parts.find((p) => p.startsWith(name));
  if (!found) return [];
  return found
    .slice(name.length)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

export async function GET() {
  const [scan, pm2, ledger] = await Promise.all([
    run(SCAN, 120_000),
    run('pm2 jlist'),
    readLedger(),
  ]);

  let apps: any[] = [];
  try {
    const start = pm2.output.indexOf('[');
    if (start >= 0) apps = JSON.parse(pm2.output.slice(start));
  } catch {
    // ignore
  }
  const pm2Names = new Set(apps.map((a) => a.name));
  const runningNames = new Set(
    apps.filter((a) => a.pm2_env?.status === 'online').map((a) => a.name),
  );

  const out = scan.output;
  const items: ResidueItem[] = [];

  const registeredPorts: Record<string, number> = {};
  for (const line of section(out, 'ports')) {
    const [n, p] = line.split('=');
    if (n && p) registeredPorts[n] = Number(p);
  }

  const listening = new Set<number>();
  for (const line of section(out, 'listening')) {
    const m = line.match(/[:*](\d{2,5})\s/);
    if (m) listening.add(Number(m[1]));
  }

  // Whether a directory's code still lives on a git remote decides how
  // consequential deleting it is — surface that in the item detail.
  const remotes: Record<string, string> = {};
  for (const line of section(out, 'remotes')) {
    const [name, url] = line.split('|');
    if (name && url) remotes[name] = url;
  }
  const backedUp = (name: string) =>
    remotes[name]
      ? `Code is on ${remotes[name].replace(/^https:\/\//, '').replace(/\.git$/, '')} — deleting only frees local space.`
      : 'No git remote found — this may be the only copy of the code.';

  const routedHosts: string[] = [];
  for (const line of section(out, 'routes')) {
    const m = line.match(/hostname:\s*(\S+)/);
    if (m) routedHosts.push(m[1]);
  }

  // 1. Project directories with no pm2 process and no port registration
  for (const line of section(out, 'project_dirs')) {
    const [name, size] = line.split('|');
    if (!name) continue;
    if (pm2Names.has(name) || registeredPorts[name]) continue;
    items.push({
      id: `projdir-${name}`,
      category: 'Orphaned project files',
      label: `~/Downloads/${name}`,
      detail: `No pm2 process and no port registration — left behind by \`project remove\`. ${backedUp(name)}`,
      size: size ?? '?',
      action: {
        type: 'rm-project-dir',
        target: name,
        danger: `Permanently deletes ~/Downloads/${name} including any local .env`,
      },
    });
  }

  // 2. App directories (git-push deploys) with no pm2 process
  for (const line of section(out, 'app_dirs')) {
    const [name, size] = line.split('|');
    if (!name || pm2Names.has(name)) continue;
    items.push({
      id: `appdir-${name}`,
      category: 'Orphaned app files',
      label: `~/apps/${name}`,
      detail: `Deployed via git push but no pm2 process is registered for it. ${backedUp(name)}`,
      size: size ?? '?',
      action: {
        type: 'rm-app-dir',
        target: name,
        danger: `Permanently deletes ~/apps/${name} including its .env`,
      },
    });
  }

  // 3. Bare repos whose app no longer exists
  const appDirs = new Set(
    section(out, 'app_dirs').map((l) => l.split('|')[0]).filter(Boolean),
  );
  for (const line of section(out, 'repos')) {
    const [name, size] = line.split('|');
    if (!name || appDirs.has(name)) continue;
    items.push({
      id: `repo-${name}`,
      category: 'Orphaned deploy repos',
      label: `~/repos/${name}.git`,
      detail: 'Bare git remote whose working copy under ~/apps is gone.',
      size: size ?? '?',
      action: {
        type: 'rm-repo',
        target: name,
        danger: `Deletes the bare repo — "git push phone main" for ${name} stops working`,
      },
    });
  }

  // 4. Ports registered but nothing running or listening
  for (const [name, port] of Object.entries(registeredPorts)) {
    if (runningNames.has(name) || listening.has(port)) continue;
    items.push({
      id: `port-${name}`,
      category: 'Stale port registrations',
      label: `${name} = ${port}`,
      detail: 'Reserved in ports.conf but nothing is running or listening on it.',
      size: '—',
      action: {
        type: 'deregister-port',
        target: name,
        danger: `Frees port ${port} in ports.conf (no files touched)`,
      },
    });
  }

  // 5. Backups (informational; oldest are candidates for pruning)
  const backups = section(out, 'backups');
  for (const line of backups) {
    const [file, size, date] = line.split('|');
    if (!file) continue;
    const ageDays = (Date.now() - new Date(date).getTime()) / 86_400_000;
    if (ageDays < 8) continue;
    items.push({
      id: `backup-${file}`,
      category: 'Old backups',
      label: `~/backups/${file}`,
      detail: `Created ${date} — older than the 7-day rolling window.`,
      size: size ?? '?',
      action: {
        type: 'rm-backup',
        target: file,
        danger: 'Deletes this archive permanently',
      },
    });
  }

  // 6. Caches and logs that only ever grow
  const [pm2logs] = section(out, 'pm2logs');
  if (pm2logs && pm2logs !== '0') {
    items.push({
      id: 'pm2-logs',
      category: 'Logs & caches',
      label: 'pm2 logs',
      detail: 'Accumulated stdout/stderr for every app. Flushing keeps apps running.',
      size: pm2logs,
      action: { type: 'flush-pm2-logs', target: 'all', danger: 'Truncates all pm2 log files' },
    });
  }
  const [npmCache] = section(out, 'npmcache');
  if (npmCache) {
    items.push({
      id: 'npm-cache',
      category: 'Logs & caches',
      label: 'npm cache',
      detail: 'Rebuilt automatically on the next install — safe to clear, costs download time.',
      size: npmCache,
      action: { type: 'clean-npm-cache', target: 'all', danger: 'Clears the npm cache' },
    });
  }
  const [goCache] = section(out, 'gocache');
  if (goCache) {
    items.push({
      id: 'go-cache',
      category: 'Logs & caches',
      label: 'Go module cache',
      detail: 'Only needed while rebuilding PocketBase; re-downloaded on the next upgrade.',
      size: goCache,
      action: { type: 'clean-go-cache', target: 'all', danger: 'Clears ~/go/pkg/mod' },
    });
  }

  // 7. Script backups left by panel-driven CLI edits
  for (const line of section(out, 'bakfiles')) {
    const [file, size] = line.split('|');
    if (!file) continue;
    items.push({
      id: `bak-${file}`,
      category: 'Script backups',
      label: `~/bin/${file}`,
      detail: 'Snapshot of a CLI script taken before the panel modified it.',
      size: size ?? '?',
      action: {
        type: 'rm-bak',
        target: file,
        danger: 'Deletes the rollback copy of that script',
      },
    });
  }

  return NextResponse.json({ items, ledger, routedHosts });
}

const CLEANUPS: Record<string, (target: string) => string> = {
  'rm-project-dir': (t) => `rm -rf "$HOME/Downloads/${t}"`,
  'rm-app-dir': (t) => `rm -rf "$HOME/apps/${t}"`,
  'rm-repo': (t) => `rm -rf "$HOME/repos/${t}.git"`,
  'deregister-port': (t) => `sed -i "/^${t}=/d" "$HOME/bin/ports.conf"`,
  'rm-backup': (t) => `rm -f "$HOME/backups/"${shq(t)}`,
  'rm-bak': (t) => `rm -f "$HOME/bin/"${shq(t)}`,
  'flush-pm2-logs': () => 'pm2 flush',
  'clean-npm-cache': () => 'npm cache clean --force',
  'clean-go-cache': () => 'go clean -modcache',
};

// Cleanup. Directory removals re-verify the target is genuinely orphaned
// immediately before deleting — the scan result may be minutes old.
export async function POST(req: NextRequest) {
  try {
    const { type, target } = await req.json();
    const build = CLEANUPS[type];
    if (!build) {
      return NextResponse.json({ error: 'unknown cleanup action' }, { status: 400 });
    }

    let safeTarget = 'all';
    if (['rm-project-dir', 'rm-app-dir', 'rm-repo', 'deregister-port'].includes(type)) {
      safeTarget = assertName(target);
      const check = await run('pm2 jlist');
      try {
        const start = check.output.indexOf('[');
        const apps = JSON.parse(check.output.slice(start));
        if (apps.some((a: any) => a.name === safeTarget)) {
          return NextResponse.json(
            { error: `"${safeTarget}" is registered in pm2 — remove the service first` },
            { status: 400 },
          );
        }
      } catch {
        return NextResponse.json({ error: 'could not verify pm2 state' }, { status: 500 });
      }
    } else if (['rm-backup', 'rm-bak'].includes(type)) {
      if (typeof target !== 'string' || !/^[\w.-]{1,80}$/.test(target) || target.includes('..')) {
        throw new ValidationError('invalid file name');
      }
      safeTarget = target;
    }

    const r = await run(build(safeTarget), 180_000);
    return NextResponse.json({ ok: r.ok, output: r.output }, { status: r.ok ? 200 : 500 });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

// Dismiss a ledger entry once it has been dealt with (or accepted).
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id || !/^[\w-]{1,40}$/.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  await dismissResidue(id);
  return NextResponse.json({ ok: true });
}
