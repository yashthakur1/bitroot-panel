import { NextResponse } from 'next/server';
import { runCached } from '@/lib/runner';
import { CATALOG, assertSafePkg } from '@/lib/catalog';

export interface CliApp {
  name: string;
  version: string;
}

export interface CatalogStatus {
  id: string;
  name: string;
  description: string;
  category: string;
  manager: string;
  pkg: string;
  locked?: string;
  installed: string | null;
  candidate: string | null;
}

// "Installed: (none)" is apt's way of saying absent; treat it as such rather
// than letting the literal string reach the UI.
function clean(v: string | undefined): string | null {
  const s = (v ?? '').trim();
  return !s || s === '(none)' ? null : s;
}

// apt-cache prints one indented block per package:
//   nodejs:
//     Installed: 25.3.0-1
//     Candidate: 26.4.0
function parsePolicy(out: string): Record<string, { installed: string | null; candidate: string | null }> {
  const result: Record<string, { installed: string | null; candidate: string | null }> = {};
  let current = '';
  for (const line of out.split('\n')) {
    const head = line.match(/^(\S+):\s*$/);
    if (head) {
      current = head[1];
      result[current] = { installed: null, candidate: null };
      continue;
    }
    if (!current) continue;
    const inst = line.match(/^\s+Installed:\s*(.*)$/);
    if (inst) result[current].installed = clean(inst[1]);
    const cand = line.match(/^\s+Candidate:\s*(.*)$/);
    if (cand) result[current].candidate = clean(cand[1]);
  }
  return result;
}

export async function GET() {
  const pkgEntries = CATALOG.filter((e) => e.manager === 'pkg');
  const npmEntries = CATALOG.filter((e) => e.manager === 'npm');
  const pkgNames = pkgEntries.map((e) => assertSafePkg(e.pkg));
  npmEntries.forEach((e) => assertSafePkg(e.pkg));

  const [policy, globals, npmLatest] = await Promise.all([
    // One call covers every package: ~50ms, versus a process per package.
    runCached(`apt-cache policy ${pkgNames.join(' ')} 2>/dev/null || true`, 60_000),
    runCached('npm ls -g --depth=0 --json 2>/dev/null || true', 60_000),
    // Each lookup is a network round trip of about a second, and the answer
    // changes on the registry's schedule, not ours - so cache it hard.
    runCached(
      npmEntries
        .map((e) => `printf '${e.pkg}|%s\\n' "$(npm view ${e.pkg} version 2>/dev/null)"`)
        .join('; ') || 'true',
      600_000,
    ),
  ]);

  const policyMap = parsePolicy(policy.output);

  // Globally installed npm packages are the CLI apps: whatever is actually
  // there, rather than a hardcoded list that would drift.
  const cliApps: CliApp[] = [];
  const npmInstalled: Record<string, string> = {};
  try {
    const deps = JSON.parse(globals.output.slice(globals.output.indexOf('{')))?.dependencies ?? {};
    for (const [name, meta] of Object.entries<{ version?: string }>(deps)) {
      const version = meta?.version ?? '';
      npmInstalled[name] = version;
      cliApps.push({ name, version });
    }
  } catch {
    // leave the list empty rather than failing the whole page
  }
  cliApps.sort((a, b) => a.name.localeCompare(b.name));

  const npmLatestMap: Record<string, string | null> = {};
  for (const line of npmLatest.output.split('\n')) {
    const [name, ...rest] = line.trim().split('|');
    if (name) npmLatestMap[name] = clean(rest.join('|'));
  }

  const tools: CatalogStatus[] = CATALOG.map((e) => {
    const status =
      e.manager === 'pkg'
        ? policyMap[e.pkg] ?? { installed: null, candidate: null }
        : { installed: clean(npmInstalled[e.pkg]), candidate: npmLatestMap[e.pkg] ?? null };
    return {
      id: e.id,
      name: e.name,
      description: e.description,
      category: e.category,
      manager: e.manager,
      pkg: e.pkg,
      locked: e.locked,
      installed: status.installed,
      candidate: status.candidate,
    };
  });

  return NextResponse.json({ cliApps, tools });
}
