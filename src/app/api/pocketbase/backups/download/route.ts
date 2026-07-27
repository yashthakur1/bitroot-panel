import { NextRequest, NextResponse } from 'next/server';
import { readHomeFile, run } from '@/lib/runner';
import { shq } from '@/lib/validate';

// Streams a backup archive to the browser so a snapshot can be opened locally
// (SQLite has no network protocol — a copy is the only way to inspect it in a
// desktop client).
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name') ?? '';

  // Only the archives this panel creates, and nothing that could escape the
  // backups directory.
  if (!/^pocketbase-[\w.-]{1,60}\.tar\.gz$/.test(name) || name.includes('..')) {
    return NextResponse.json({ error: 'invalid backup name' }, { status: 400 });
  }

  const stat = await run(
    `[ -f "$HOME/backups/"${shq(name)} ] && stat -c %s "$HOME/backups/"${shq(name)} || true`,
  );
  const size = Number(stat.output.trim());
  if (!size) {
    return NextResponse.json({ error: 'backup not found' }, { status: 404 });
  }

  return new Response(readHomeFile(`backups/${name}`), {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Length': String(size),
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}
