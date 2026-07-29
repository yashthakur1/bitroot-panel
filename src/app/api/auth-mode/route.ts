import { NextResponse } from 'next/server';

// Whether this panel has an email identity, so the login form knows whether to
// ask for one. Deliberately says only yes or no: the address itself is not
// public, and returning it would hand an attacker half the credential.
export const dynamic = 'force-dynamic';

export async function GET() {
  const identity = process.env.SUPERADMIN_EMAIL;
  return NextResponse.json({
    requiresEmail: Boolean(identity && identity !== 'admin@example.com'),
  });
}
