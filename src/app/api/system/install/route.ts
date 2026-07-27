import { NextRequest, NextResponse } from 'next/server';
import { runStream } from '@/lib/runner';
import { assertSafePkg, findEntry } from '@/lib/catalog';

// Install or upgrade one catalog entry, streaming the package manager's output
// so the UI can show it as it happens rather than after a silent wait.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === 'string' ? body.id : '';

  const entry = findEntry(id);
  if (!entry) {
    // Unknown id rather than unknown package: the catalog is the whole
    // permitted surface, so there is nothing to look up beyond it.
    return NextResponse.json({ error: `not in the catalog: ${id || '(missing id)'}` }, { status: 400 });
  }
  if (entry.locked) {
    return NextResponse.json({ error: entry.locked }, { status: 400 });
  }

  const pkg = assertSafePkg(entry.pkg);
  const cmd =
    entry.manager === 'pkg'
      ? // -y alone still stops on a modified config file; force-confold keeps
        // the existing one so an install can never block on a prompt nobody
        // can answer.
        `DEBIAN_FRONTEND=noninteractive pkg install -y -o Dpkg::Options::=--force-confold ${pkg}`
      : `npm install -g ${pkg}@latest`;

  return new Response(runStream(cmd, 900_000), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}
