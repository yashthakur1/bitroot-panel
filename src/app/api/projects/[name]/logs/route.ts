import { NextRequest, NextResponse } from 'next/server';
import { run } from '@/lib/runner';
import { assertName, ValidationError } from '@/lib/validate';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const name = assertName((await params).name);
    const linesParam = Number(req.nextUrl.searchParams.get('lines'));
    const lines = [100, 200, 500, 1000].includes(linesParam) ? linesParam : 200;

    const r = await run(`pm2 logs ${name} --lines ${lines} --nostream`, 30_000);
    return NextResponse.json({ ok: r.ok, logs: r.output });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
