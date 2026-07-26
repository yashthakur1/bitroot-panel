import { NextRequest, NextResponse } from 'next/server';
import { run } from '@/lib/runner';
import { shq, ValidationError } from '@/lib/validate';

function assertEmail(email: unknown): string {
  if (
    typeof email !== 'string' ||
    email.length > 120 ||
    !/^[^\s@'"`]+@[^\s@'"`]+\.[^\s@'"`]+$/.test(email)
  ) {
    throw new ValidationError('invalid email address');
  }
  return email;
}

function assertPassword(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < 10 || pw.length > 100 || /[\n\r]/.test(pw)) {
    throw new ValidationError('password must be 10-100 characters, no newlines');
  }
  return pw;
}

// Create a new superuser or reset an existing one via the PocketBase CLI.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = assertEmail(body.email);
    const password = assertPassword(body.password);

    const r = await run(
      `"$HOME/apps/pocketbase/pocketbase" superuser upsert ${shq(email)} ${shq(password)} --dir "$HOME/apps/pocketbase/pb_data"`,
      60_000,
    );
    return NextResponse.json({ ok: r.ok, output: r.output }, { status: r.ok ? 200 : 500 });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
