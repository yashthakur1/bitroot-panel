import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { ForbiddenError, currentEmail, requireSuperadmin } from '@/lib/current-user';
import { discoverAccessIdentity } from '@/lib/access';
import { writeEnv } from '@/lib/setup';
import { getFacts } from '@/lib/facts';
import {
  UserExistsError,
  createUser,
  deleteUser,
  dbPath,
  getUser,
  listUsers,
  migrateFromEnv,
  setDisabled,
  setPassword,
  setRole,
  storeInUse,
  superadminCount,
} from '@/lib/users';

export const dynamic = 'force-dynamic';

function fail(e: unknown) {
  const status = e instanceof ForbiddenError ? 403 : e instanceof UserExistsError ? 409 : 500;
  return NextResponse.json({ error: (e as Error).message }, { status });
}

export async function GET() {
  const me = await currentEmail();
  return NextResponse.json({
    // False means the panel is still on the single shared .env password, and
    // the UI should offer to migrate rather than pretend accounts exist.
    inUse: storeInUse(),
    store: dbPath(),
    engine: 'node:sqlite',
    me,
    users: storeInUse() ? listUsers() : [],
    // Only meaningful before migration: what the first account would be made from.
    envIdentity: storeInUse() ? null : (process.env.SUPERADMIN_EMAIL ?? null),
    accessIdentity: Boolean(process.env.CF_ACCESS_TEAM && process.env.CF_ACCESS_AUD),
  });
}

export async function POST(req: NextRequest) {
  try {
    await requireSuperadmin();
    const body = await req.json().catch(() => ({}));

    if (body.action === 'discover-access') {
      // Without these the panel cannot verify an Access token, so it falls back
      // to asking for a password behind a gate that already knows who you are.
      const facts = await getFacts();
      const found = await discoverAccessIdentity(facts.routedHosts.map((h) => h.toLowerCase()));
      if (!found) {
        return NextResponse.json(
          {
            error:
              'No Cloudflare Access application matches a hostname this machine serves. ' +
              'Put one in front of the panel first, or check the token can read Access.',
          },
          { status: 400 },
        );
      }
      await writeEnv({ CF_ACCESS_TEAM: found.team, CF_ACCESS_AUD: found.aud });
      return NextResponse.json({
        ok: true,
        ...found,
        message:
          `Access identity enabled for "${found.app}" (team ${found.team}). ` +
          'Restart the panel, and anyone Access lets through is signed in as themselves.',
      });
    }

    if (body.action === 'migrate') {
      const first = await migrateFromEnv();
      if (!first) {
        return NextResponse.json(
          { error: 'nothing to migrate — accounts already exist, or .env has no identity' },
          { status: 400 },
        );
      }
      return NextResponse.json({
        ok: true,
        user: first,
        message: `${first.email} is now a real account, with the password you already use`,
      });
    }

    const email = String(body.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'that does not look like an email address' }, { status: 400 });
    }

    // Creating the first account would otherwise retire the shared password
    // and lock out whoever is still relying on it. Bring it across first so the
    // operator's existing credential keeps working.
    if (!storeInUse()) await migrateFromEnv();

    let password = String(body.password ?? '');
    let generated = false;
    if (!password) {
      // A generated password beats a blank one: an account with no way in is
      // just a name, and asking the operator to invent one leads to reuse.
      password = randomBytes(12).toString('base64url');
      generated = true;
    }
    if (password.length < 12) {
      return NextResponse.json({ error: 'the password must be at least 12 characters' }, { status: 400 });
    }

    const user = await createUser({
      email,
      password,
      role: body.role === 'superadmin' ? 'superadmin' : 'member',
    });
    return NextResponse.json({
      ok: true,
      user,
      // Returned once, never stored in the clear. The operator has to pass it on.
      password: generated ? password : undefined,
      message: `${email} can now sign in to this panel`,
    });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const me = await requireSuperadmin();
    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? '').trim().toLowerCase();
    const user = getUser(email);
    if (!user) return NextResponse.json({ error: 'no such account' }, { status: 404 });

    if (body.role === 'member' && user.role === 'superadmin' && superadminCount() <= 1) {
      return NextResponse.json(
        { error: 'that is the last superadmin — promote someone else first' },
        { status: 400 },
      );
    }
    if (body.disabled === true && user.role === 'superadmin' && superadminCount() <= 1) {
      return NextResponse.json(
        { error: 'that is the last superadmin — promote someone else first' },
        { status: 400 },
      );
    }

    if (body.role) setRole(email, body.role === 'superadmin' ? 'superadmin' : 'member');
    if (typeof body.disabled === 'boolean') setDisabled(email, body.disabled);
    if (body.password) {
      if (String(body.password).length < 12) {
        return NextResponse.json({ error: 'the password must be at least 12 characters' }, { status: 400 });
      }
      await setPassword(email, String(body.password));
    }

    return NextResponse.json({
      ok: true,
      user: getUser(email),
      // Worth saying out loud: changing a password or disabling an account ends
      // the sessions already open under it, including the caller's own.
      note: email === me.email ? 'that was your own account — you may need to sign in again' : undefined,
    });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const me = await requireSuperadmin();
    const email = String(new URL(req.url).searchParams.get('email') ?? '').trim().toLowerCase();
    const user = getUser(email);
    if (!user) return NextResponse.json({ error: 'no such account' }, { status: 404 });
    if (user.role === 'superadmin' && superadminCount() <= 1) {
      return NextResponse.json(
        { error: 'that is the last superadmin — promote someone else first' },
        { status: 400 },
      );
    }
    if (email === me.email) {
      return NextResponse.json({ error: 'you cannot delete your own account' }, { status: 400 });
    }
    deleteUser(email);
    return NextResponse.json({ ok: true, message: `${email} can no longer sign in` });
  } catch (e) {
    return fail(e);
  }
}
