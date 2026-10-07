// The one machine-to-machine way into the panel: BitPanel Enterprise (the
// client portal on this same box) managing the static sites it fronts for
// clients — their domains, build settings and deploys — without a person's
// session.
//
// Deliberately narrow:
//  - only paths under /api/service/, and those paths accept nothing else;
//  - a single shared token (BITPANEL_SERVICE_TOKEN, ≥32 chars) in both apps'
//    env — unset means the whole surface answers 404, as if it didn't exist;
//  - loopback only: the Cloudflare Tunnel stamps every request it carries
//    with CF-Connecting-IP, so a request bearing it came from the internet
//    and is refused even with the right token.
// The portal does its own per-client authorization (which org owns which
// site, which role may change production) before it ever calls here.

import { timingSafeEqual } from 'node:crypto';

export const SERVICE_PREFIX = '/api/service/';
export const SERVICE_IDENTITY = 'service:enterprise';

export function serviceToken(): string | null {
  const t = process.env.BITPANEL_SERVICE_TOKEN ?? '';
  return t.length >= 32 ? t : null;
}

export function serviceRequestAllowed(headers: Headers, token: string | null = serviceToken()): boolean {
  if (!token) return false;
  if (headers.get('cf-connecting-ip')) return false;
  const m = /^Bearer (.+)$/.exec(headers.get('authorization') ?? '');
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
