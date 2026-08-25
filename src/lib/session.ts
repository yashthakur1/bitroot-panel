// Session tokens, shared by the login route (Node) and middleware (Edge).
//
// The previous token was an HMAC of the fixed string 'bitroot-panel-session-v1'.
// That made every logged-in browser hold the *identical* cookie value: it named
// nobody, never expired, and could not be revoked for one person — rotating
// SESSION_SECRET signed everyone out at once. Copied once, it worked for ever.
// With one password shared between several people, that was the weakest link in
// the whole setup.
//
// A token now carries who it is for and when it dies, and is signed so neither
// can be edited. Web Crypto only, because middleware runs on the Edge runtime
// where node:crypto is not available.

export const SESSION_COOKIE = 'bp_session';

/** Long enough not to nag, short enough that a disabled account stops working. */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export interface SessionClaims {
  /** The address this session belongs to. */
  sub: string;
  /** Issued at, seconds since the epoch. */
  iat: number;
  /** Expires at, seconds since the epoch. */
  exp: number;
  /**
   * The account's revision at the moment this was issued. A password change or
   * a disable bumps it, which retires every token already handed out. Absent
   * when the panel is still running on the single .env credential, where there
   * is no account to revise.
   */
  epoch?: number;
}

const encoder = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(text: string): Uint8Array {
  const pad = text.replace(/-/g, '+').replace(/_/g, '/');
  const s = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return b64url(new Uint8Array(sig));
}

/** Compare without leaking, through timing, how much of the signature matched. */
function equals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function issueSession(
  secret: string,
  email: string,
  opts: { epoch?: number; ttlSeconds?: number } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: SessionClaims = {
    sub: email.trim().toLowerCase(),
    iat: now,
    exp: now + (opts.ttlSeconds ?? SESSION_TTL_SECONDS),
    ...(opts.epoch !== undefined ? { epoch: opts.epoch } : {}),
  };
  const payload = b64url(encoder.encode(JSON.stringify(claims)));
  return `${payload}.${await sign(secret, payload)}`;
}

/**
 * Returns the claims, or null for anything that is not a live, intact token.
 *
 * Null covers every failure on purpose. A caller that cannot tell "expired"
 * from "forged" cannot accidentally treat one as the other.
 */
export async function verifySession(
  secret: string,
  token: string | undefined,
): Promise<SessionClaims | null> {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  if (!equals(provided, await sign(secret, payload))) return null;

  try {
    const claims = JSON.parse(new TextDecoder().decode(unb64url(payload))) as SessionClaims;
    if (typeof claims.sub !== 'string' || !claims.sub) return null;
    if (typeof claims.exp !== 'number') return null;
    if (claims.exp <= Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}
