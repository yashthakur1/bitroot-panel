// Session token shared by the login route (Node) and middleware (Edge).
// Single-user panel: the token is an HMAC of a fixed message under
// SESSION_SECRET, so it is stable until the secret is rotated.

export const SESSION_COOKIE = 'bp_session';

const encoder = new TextEncoder();

export async function sessionToken(secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode('bitroot-panel-session-v1'));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
