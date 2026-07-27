import { NextRequest, NextResponse } from 'next/server';
import { ValidationError } from '@/lib/validate';
import {
  assertEmail,
  assertUuid,
  canWritePolicies,
  grantAccess,
  revokeAccess,
  setSuperadmin,
  syncSuperadmin,
} from '@/lib/access';

// Whether this token may edit policies — the UI needs to know before it offers
// buttons that would fail.
export async function GET() {
  return NextResponse.json({ canWrite: await canWritePolicies() });
}

// Grant a person access to one or more applications.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = assertEmail(body.email);
    const appIds: string[] = Array.isArray(body.apps) ? body.apps.map(assertUuid) : [];
    if (appIds.length === 0) {
      throw new ValidationError('choose at least one application');
    }
    const touched = await grantAccess(email, appIds);
    return NextResponse.json({
      ok: true,
      granted: touched,
      message: touched.length
        ? `${email} can now sign in to ${touched.join(', ')}`
        : `${email} already had access to those applications`,
    });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

// Promote someone to superadmin, then make sure they are on every application.
export async function PATCH(req: NextRequest) {
  try {
    const { email } = await req.json();
    const safe = assertEmail(email);
    await setSuperadmin(safe);
    const added = await syncSuperadmin();
    return NextResponse.json({
      ok: true,
      superadmin: safe,
      message: added.length
        ? `${safe} is now superadmin and was added to ${added.join(', ')}`
        : `${safe} is now superadmin`,
    });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const email = assertEmail(req.nextUrl.searchParams.get('email'));
    const app = assertUuid(req.nextUrl.searchParams.get('app'));
    await revokeAccess(email, app);
    return NextResponse.json({ ok: true, message: `${email} removed` });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
