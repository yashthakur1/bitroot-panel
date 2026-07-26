import { NextRequest, NextResponse } from 'next/server';
import { run } from '@/lib/runner';

export async function POST(req: NextRequest) {
  const { action } = await req.json().catch(() => ({}));
  if (action !== 'restart') {
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }
  const r = await run('pm2 restart cloudflared', 60_000);
  return NextResponse.json({ ok: r.ok, output: r.output }, { status: r.ok ? 200 : 500 });
}
