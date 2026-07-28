import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { SESSION_COOKIE, sessionToken } from '@/lib/session';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const expected = process.env.DASHBOARD_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  if (!expected || !secret) {
    return NextResponse.json({ error: 'server not configured' }, { status: 500 });
  }

  const a = Buffer.from(String(body.password ?? ''));
  const b = Buffer.from(expected);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (!ok) {
    return NextResponse.json({ error: 'wrong password' }, { status: 401 });
  }

  // "Remember me" is a real difference rather than a decorative checkbox:
  // unticked, the cookie gets no maxAge and dies with the browser session.
  // That matters on a borrowed machine, which is exactly when it gets unticked.
  const remember = body.remember !== false;

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await sessionToken(secret), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    ...(remember ? { maxAge: 60 * 60 * 24 * 30 } : {}),
  });
  return res;
}
