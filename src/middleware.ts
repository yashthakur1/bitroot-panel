import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, sessionToken } from '@/lib/session';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === '/api/login') return NextResponse.next();

  const secret = process.env.SESSION_SECRET;
  if (!secret) return new NextResponse('SESSION_SECRET not configured', { status: 500 });

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
