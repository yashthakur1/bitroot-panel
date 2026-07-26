import { NextRequest, NextResponse } from 'next/server';
import {
  assertGithubToken,
  deleteGithubToken,
  getGithubToken,
  ghFetch,
  saveGithubToken,
} from '@/lib/github';
import { ValidationError } from '@/lib/validate';

// GET → connection status; POST {token} → connect; DELETE → disconnect.

export async function GET() {
  const token = await getGithubToken();
  if (!token) return NextResponse.json({ connected: false });
  try {
    const user = await ghFetch(token, '/user');
    return NextResponse.json({ connected: true, login: user.login });
  } catch (e) {
    return NextResponse.json({ connected: false, error: (e as Error).message });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const token = assertGithubToken(body.token);
    const user = await ghFetch(token, '/user'); // validates before storing
    await saveGithubToken(token);
    return NextResponse.json({ connected: true, login: user.login });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

export async function DELETE() {
  await deleteGithubToken();
  return NextResponse.json({ connected: false });
}
