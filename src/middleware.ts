import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/session';
import { ACCESS_HEADER, verifyAccessJwt } from '@/lib/access-jwt';
import { getUser, storeInUse } from '@/lib/users';

// Runs on the Node runtime rather than the Edge one, so it can read the account
// store. That is what makes disabling somebody take effect on their next
// request instead of whenever their token happened to expire.
export const config = {
  matcher: ['/dashboard/:path*', '/api/:path*'],
  runtime: 'nodejs',
};

/** The header route handlers read to learn who is asking. */
export const IDENTITY_HEADER = 'x-bitpanel-user';

function allow(req: NextRequest, email: string) {
  // Set from the verified identity only. The inbound value is overwritten
  // rather than merged: a client that sends its own x-bitpanel-user must not
  // be able to choose who the panel thinks it is.
  const headers = new Headers(req.headers);
  headers.set(IDENTITY_HEADER, email);
  return NextResponse.next({ request: { headers } });
}

function deny(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/api')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.redirect(new URL('/', req.url));
}

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
  const configured = Boolean(secret) && (storeInUse() || Boolean(process.env.DASHBOARD_PASSWORD));
  if (!secret || !configured) {
    // Nothing to log in with yet, so a login form would be a dead end.
    return NextResponse.redirect(new URL('/setup', req.url));
  }

  // Cloudflare Access has already identified this person and signed a token
  // saying so. Believing it is the whole point of putting Access in front: the
  // panel used to demand a shared password on top, which is why three people
  // held one credential.
  const identity = await verifyAccessJwt(
    req.headers.get(ACCESS_HEADER) ?? undefined,
    process.env.CF_ACCESS_TEAM,
    process.env.CF_ACCESS_AUD,
  );
  if (identity) {
    // Known here, but disabled: Access lets them to the door, the panel decides
    // whether they come in. Removing them at Cloudflare is the other half and
    // is what IAM does.
    const user = storeInUse() ? getUser(identity.email) : null;
    if (!user || !user.disabledAt) return allow(req, identity.email);
    return deny(req);
  }

  const claims = await verifySession(secret, req.cookies.get(SESSION_COOKIE)?.value);
  if (!claims) return deny(req);

  if (storeInUse()) {
    const user = getUser(claims.sub);
    if (!user || user.disabledAt) return deny(req);
    // The token was issued before the account changed - a new password, or a
    // disable that has since been lifted. Either way it is no longer current.
    if (claims.epoch !== undefined && claims.epoch !== user.epoch) return deny(req);
  }

  return allow(req, claims.sub);
}
