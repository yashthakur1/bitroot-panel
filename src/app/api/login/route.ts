import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, issueSession } from '@/lib/session';
import { authenticate, storeInUse } from '@/lib/users';

/**
 * Sign in.
 *
 * Two modes, and which one is live depends on whether accounts exist:
 *
 *  - Accounts exist: the address and password are checked against that person's
 *    own record, so sessions name them and can be ended for them alone.
 *  - No accounts: the original single DASHBOARD_PASSWORD, unchanged. Installs
 *    that predate accounts keep working rather than being locked out by an
 *    update, and can migrate when their operator chooses to.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'server not configured' }, { status: 500 });
  }

  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');

  // "Remember me" is a real difference rather than a decorative checkbox:
  // unticked, the cookie gets no maxAge and dies with the browser session.
  // That matters on a borrowed machine, which is exactly when it gets unticked.
  const remember = body.remember !== false;

  let token: string | null = null;

  if (storeInUse()) {
    const user = await authenticate(email, password);
    if (user) token = await issueSession(secret, user.email, { epoch: user.epoch });
  } else {
    const expected = process.env.DASHBOARD_PASSWORD;
    if (!expected) {
      return NextResponse.json({ error: 'server not configured' }, { status: 500 });
    }
    const a = Buffer.from(password);
    const b = Buffer.from(expected);
    const passwordOk = a.length === b.length && timingSafeEqual(a, b);

    // An identity is only required once one exists. Installs that predate
    // sign-up, or machines where nobody set an address, keep signing in with
    // the password alone rather than being locked out by a field they never
    // filled.
    const identity = process.env.SUPERADMIN_EMAIL;
    const hasIdentity = Boolean(identity && identity !== 'admin@example.com');
    const emailOk = !hasIdentity || email === identity!.trim().toLowerCase();

    if (passwordOk && emailOk) {
      token = await issueSession(secret, hasIdentity ? identity! : 'admin');
    }
  }

  if (!token) {
    // One message whichever half was wrong: saying which tells an attacker
    // whether an address is the right one.
    return NextResponse.json({ error: 'wrong email or password' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    // Even "remember me" now ends when the token does. The old cookie outlived
    // any notion of a session because the token inside it never expired.
    ...(remember ? { maxAge: SESSION_TTL_SECONDS } : {}),
  });
  return res;
}
