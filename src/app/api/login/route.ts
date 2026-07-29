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
  const passwordOk = a.length === b.length && timingSafeEqual(a, b);

  // An identity is only required once one exists. Installs that predate
  // sign-up, or machines where nobody set an address, keep signing in with the
  // password alone rather than being locked out by a field they never filled.
  const identity = process.env.SUPERADMIN_EMAIL;
  const hasIdentity = Boolean(identity && identity !== 'admin@example.com');
  const emailOk =
    !hasIdentity ||
    String(body.email ?? '').trim().toLowerCase() === identity!.trim().toLowerCase();

  if (!passwordOk || !emailOk) {
    // One message for both: saying which half was wrong tells an attacker
    // whether an address is the right one.
    return NextResponse.json(
      { error: hasIdentity ? 'wrong email or password' : 'wrong password' },
      { status: 401 },
    );
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
