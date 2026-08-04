import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Who is signed in. Distinct from /api/auth-mode, which answers only yes-or-no
// before login and deliberately withholds the address — handing an anonymous
// caller half the credential is how a password becomes the only secret. This
// route sits behind the session, where the caller already proved they know it.
export async function GET() {
  const email = process.env.SUPERADMIN_EMAIL ?? '';
  const configured = Boolean(email) && email !== 'admin@example.com';

  // A name nobody set is better derived than defaulted: "yt" beats
  // "Administrator" for telling two panels apart.
  const local = configured ? email.split('@')[0] : '';
  const derived = local
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

  return NextResponse.json({
    email: configured ? email : '',
    name: process.env.ADMIN_NAME || derived || 'Administrator',
    configured,
  });
}
