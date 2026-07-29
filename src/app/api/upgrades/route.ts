import { NextRequest, NextResponse } from 'next/server';
import { runStream } from '@/lib/runner';

// One-click upgrades. Strict allowlist — the target picks a fixed command,
// nothing from the request is interpolated. Output streams live to the UI.
const TARGETS: Record<string, { cmd: string; timeoutMs: number }> = {
  pocketbase: { cmd: 'upgrade-pocketbase', timeoutMs: 900_000 },
  termux: { cmd: 'pkg update -y 2>&1 && pkg upgrade -y 2>&1', timeoutMs: 900_000 },
  // pm2 is the one upgrade that can take every service on the machine down,
  // including the panel serving this request. `pm2 update` cycles the daemon
  // and resurrects from the saved dump - but if the dump is stale, or the
  // cycle half-completes, the daemon comes back with an empty process table
  // and nothing is running.
  //
  // So: save first so the dump is current, then upgrade, then check what came
  // back and resurrect if it is empty. The recovery is the part that was
  // missing.
  pm2: {
    cmd: [
      'echo "== saving the current process list =="',
      'pm2 save 2>&1 || true',
      'echo "== installing pm2@latest =="',
      'npm install -g pm2@latest 2>&1',
      'echo "== cycling the pm2 daemon =="',
      'pm2 update 2>&1',
      'sleep 2',
      'if [ "$(pm2 jlist 2>/dev/null | tr -d " \n")" = "[]" ]; then',
      '  echo "== daemon came back empty — restoring from the saved dump =="',
      '  pm2 resurrect 2>&1',
      '  sleep 2',
      'fi',
      'echo "== result =="',
      'pm2 list 2>&1',
    ].join('\n'),
    timeoutMs: 600_000,
  },
};

export async function POST(req: NextRequest) {
  const { target } = await req.json().catch(() => ({}));
  const t = TARGETS[target];
  if (!t) {
    return NextResponse.json({ error: 'unknown upgrade target' }, { status: 400 });
  }
  return new Response(runStream(t.cmd, t.timeoutMs), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}
