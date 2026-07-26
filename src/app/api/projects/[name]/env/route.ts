import { NextRequest, NextResponse } from 'next/server';
import { run } from '@/lib/runner';
import {
  assertEnvKey,
  assertEnvValue,
  assertName,
  shq,
  ValidationError,
} from '@/lib/validate';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const name = assertName((await params).name);
    const r = await run(`cat "$HOME/Downloads/${name}/.env" 2>/dev/null || true`);
    const vars = r.output
      .split('\n')
      .map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => ({ key: m[1], value: m[2] }));
    return NextResponse.json({ vars });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

// Upserts env vars via `project env`, optionally restarting the app after.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const name = assertName((await params).name);
    const body = await req.json();
    const vars: Array<{ key: string; value: string }> = body.vars ?? [];
    if (!Array.isArray(vars) || vars.length === 0) {
      return NextResponse.json({ error: 'no vars provided' }, { status: 400 });
    }

    const pairs = vars
      .map((v) => `${assertEnvKey(v.key)}=${assertEnvValue(v.value)}`)
      .map((kv) => shq(kv))
      .join(' ');

    const r = await run(`project env ${name} ${pairs}`, 60_000);
    let output = r.output;

    if (r.ok && body.restart) {
      const restart = await run(`project restart ${name}`, 60_000);
      output += `\n${restart.output}`;
    }

    return NextResponse.json({ ok: r.ok, output }, { status: r.ok ? 200 : 500 });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
