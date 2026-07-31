import { NextRequest, NextResponse } from 'next/server';
import { runStream } from '@/lib/runner';
import { startUpdate, versionInfo } from '@/lib/version';

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
      'sleep 3',
      // Counted, not string-compared. A stale daemon prints a banner and colour
      // codes ahead of the JSON, so "is the output exactly []" is never true —
      // precisely when this check is the thing standing between the operator
      // and a machine with nothing running on it.
      'count=$(pm2 jlist 2>/dev/null | node -e \'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const c2=d.replace(/\\x1b\\[[0-9;]*[A-Za-z]/g,"");const m=c2.match(/^\\s*\\[/m);if(!m){console.log(0);return;}try{console.log(JSON.parse(c2.slice(m.index)).length);}catch(e){console.log(0);}});\' 2>/dev/null || echo 0)',
      'if [ "$count" -eq 0 ]; then',
      '  echo "== daemon came back empty — restoring from the saved dump =="',
      '  pm2 resurrect 2>&1',
      '  sleep 3',
      'fi',
      'echo "== result =="',
      'pm2 list 2>&1',
    ].join('\n'),
    timeoutMs: 600_000,
  },
};

export async function POST(req: NextRequest) {
  const { target } = await req.json().catch(() => ({}));

  // The panel cannot stream its own upgrade: the process writing the response
  // is the one being restarted, so the connection dies partway and the UI is
  // left holding a truncated log with no verdict. It runs detached instead and
  // reports through the update log, which survives the restart.
  if (target === 'panel') {
    const v = await versionInfo(true);
    if (!v.latest || !v.updateAvailable) {
      return NextResponse.json({ error: 'already on the latest release' }, { status: 400 });
    }
    try {
      await startUpdate(v.latest);
      return NextResponse.json({ detached: true, target: v.latest }, { status: 202 });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

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
