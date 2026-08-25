// Identity asserted by Cloudflare Access.
//
// Every request Access lets through carries a signed JWT naming the person it
// let through. Verifying that signature tells the panel *who* is asking without
// a password — which is the point: the panel sat behind Access and then asked
// for a shared password anyway, so three people used one credential and no
// action could be attributed to anyone.
//
// Web Crypto only: this runs in middleware, on the Edge runtime.

export const ACCESS_HEADER = 'cf-access-jwt-assertion';

interface Jwk {
  kid: string;
  kty: string;
  alg: string;
  n: string;
  e: string;
}

// One fetch per cold start rather than per request. Cloudflare rotates these
// keys, so the cache has to expire — a stale set rejects everyone.
let cache: { team: string; at: number; keys: CryptoKey[] } | null = null;
const CACHE_MS = 60 * 60 * 1000;

// Typed as ArrayBuffer-backed so Web Crypto accepts it as a BufferSource: the
// default Uint8Array type allows a SharedArrayBuffer, which crypto.subtle will
// not take.
function b64urlToBytes(text: string): Uint8Array<ArrayBuffer> {
  const pad = text.replace(/-/g, '+').replace(/_/g, '/');
  const s = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function keysFor(team: string): Promise<CryptoKey[]> {
  if (cache && cache.team === team && Date.now() - cache.at < CACHE_MS) return cache.keys;

  const res = await fetch(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Access certs returned HTTP ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };

  const keys = await Promise.all(
    (body.keys ?? [])
      .filter((k) => k.kty === 'RSA')
      .map((k) =>
        crypto.subtle.importKey(
          'jwk',
          { kty: k.kty, n: k.n, e: k.e, alg: 'RS256', ext: true },
          { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
          false,
          ['verify'],
        ),
      ),
  );
  cache = { team, at: Date.now(), keys };
  return keys;
}

export interface AccessIdentity {
  email: string;
  /** The Access application this token was minted for. */
  aud: string;
}

/**
 * The verified identity in an Access token, or null.
 *
 * `aud` is checked, not merely read. Every application in a team is signed by
 * the same keys, so without this check a token issued for pocketbase.<domain>
 * would be accepted by the panel — anyone allowed on any one application would
 * reach all of them.
 */
export async function verifyAccessJwt(
  token: string | undefined,
  team: string | undefined,
  expectedAud: string | undefined,
): Promise<AccessIdentity | null> {
  if (!token || !team || !expectedAud) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [rawHeader, rawPayload, rawSig] = parts;

  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(rawHeader))) as {
      alg?: string;
    };
    // Reject "alg": "none" and anything symmetric before touching a key.
    if (header.alg !== 'RS256') return null;

    const data = new TextEncoder().encode(`${rawHeader}.${rawPayload}`);
    const sig = b64urlToBytes(rawSig);

    let ok = false;
    for (const key of await keysFor(team)) {
      if (await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data)) {
        ok = true;
        break;
      }
    }
    if (!ok) return null;

    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(rawPayload))) as {
      email?: string;
      aud?: string | string[];
      exp?: number;
      iss?: string;
    };

    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== 'number' || claims.exp <= now) return null;
    if (claims.iss !== `https://${team}.cloudflareaccess.com`) return null;

    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.includes(expectedAud)) return null;

    const email = (claims.email ?? '').trim().toLowerCase();
    if (!email) return null;

    return { email, aud: expectedAud };
  } catch {
    return null;
  }
}
