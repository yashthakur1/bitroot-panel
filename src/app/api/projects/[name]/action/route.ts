import { NextRequest, NextResponse } from 'next/server';
import { run } from '@/lib/runner';
import { assertName, ValidationError } from '@/lib/validate';

const ACTIONS: Record<string, number> = {
  deploy: 600_000,
  start: 60_000,
  stop: 60_000,
  restart: 60_000,
  remove: 120_000,
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const name = assertName((await params).name);
    const { action } = await req.json();
    const timeout = ACTIONS[action];
    if (!timeout) {
      return NextResponse.json({ error: 'unknown action' }, { status: 400 });
    }

    const r = await run(`project ${action} ${name}`, timeout);
    return NextResponse.json({ ok: r.ok, output: r.output }, { status: r.ok ? 200 : 500 });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
