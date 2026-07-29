import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, sessionToken } from '@/lib/session';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === '/api/login') return NextResponse.next();
  // The login page has to ask whether this panel wants an email before anyone
  // can log in, so this cannot sit behind the session it is a prerequisite for.
  // It answers yes or no and nothing else - never the address itself.
  if (pathname === '/api/auth-mode') return NextResponse.next();
  // The setup wizard has to be reachable before any credential exists. It
  // refuses itself once the panel is configured, so this does not leave a way
  // in afterwards.
  if (pathname === '/setup' || pathname === '/api/setup') return NextResponse.next();

  const secret = process.env.SESSION_SECRET;
  if (!secret || !process.env.DASHBOARD_PASSWORD) {
    // Nothing to log in with yet, so a login form would be a dead end.
    return NextResponse.redirect(new URL('/setup', req.url));
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token && token === (await sessionToken(secret))) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.redirect(new URL('/', req.url));
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/:path*'],
};
