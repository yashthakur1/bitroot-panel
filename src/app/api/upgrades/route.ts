import { NextRequest, NextResponse } from 'next/server';
import { runStream } from '@/lib/runner';

// One-click upgrades. Strict allowlist — the target picks a fixed command,
// nothing from the request is interpolated. Output streams live to the UI.
const TARGETS: Record<string, { cmd: string; timeoutMs: number }> = {
  pocketbase: { cmd: 'upgrade-pocketbase', timeoutMs: 900_000 },
  termux: { cmd: 'pkg update -y 2>&1 && pkg upgrade -y 2>&1', timeoutMs: 900_000 },
  pm2: { cmd: 'npm install -g pm2@latest 2>&1 && pm2 update 2>&1', timeoutMs: 600_000 },
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
