import { NextResponse } from 'next/server';
import { run } from '@/lib/runner';

const LIST_CMD =
  'for f in "$HOME"/backups/pocketbase-*.tar.gz; do [ -f "$f" ] || continue; printf "%s|%s|%s\\n" "$(basename "$f")" "$(du -h "$f" | cut -f1)" "$(date -r "$f" "+%Y-%m-%d %H:%M")"; done';

async function listBackups() {
  const r = await run(LIST_CMD);
  return r.output
    .split('\n')
    .map((line) => line.split('|'))
    .filter((p) => p.length === 3)
    .map(([name, size, modified]) => ({ name, size: size.trim(), modified }))
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

export async function GET() {
  return NextResponse.json({ backups: await listBackups() });
}

// Manual snapshot alongside the nightly cron ones. Note: tars the live WAL-mode
// SQLite dir — fine for these small mostly-idle DBs; the admin UI's built-in
// backups are the guaranteed-consistent option.
export async function POST() {
  const r = await run(
    'tar czf "$HOME/backups/pocketbase-manual-$(date +%Y%m%d-%H%M).tar.gz" -C "$HOME/apps/pocketbase" pb_data',
    120_000,
  );
  if (!r.ok) {
    return NextResponse.json({ error: r.output || 'backup failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, backups: await listBackups() });
}
