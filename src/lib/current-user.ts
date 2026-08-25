// Who is making this request.
//
// Middleware verifies the identity — an Access JWT, or a signed session — and
// writes it into a header it also strips from the inbound request, so a route
// handler can trust it. Reading process.env.SUPERADMIN_EMAIL instead, which is
// what the panel did before, told you who the *machine* belonged to rather than
// who was asking.

import { headers } from 'next/headers';
import { IDENTITY_HEADER } from '@/middleware';
import { getUser, storeInUse, type Role, type User } from './users';

export async function currentEmail(): Promise<string | null> {
  const h = await headers();
  return h.get(IDENTITY_HEADER);
}

export async function currentUser(): Promise<User | null> {
  const email = await currentEmail();
  return email ? getUser(email) : null;
}

export class ForbiddenError extends Error {}

/**
 * The caller, when they are allowed to administer accounts.
 *
 * Before any account exists everyone who got past the gate is the operator, so
 * this permits the action — refusing would make it impossible to create the
 * first account. Once accounts exist, role is enforced.
 */
export async function requireSuperadmin(): Promise<{ email: string; role: Role }> {
  const email = await currentEmail();
  if (!email) throw new ForbiddenError('not signed in');
  if (!storeInUse()) return { email, role: 'superadmin' };

  const user = getUser(email);
  if (!user || user.disabledAt) throw new ForbiddenError('not signed in');
  if (user.role !== 'superadmin') {
    throw new ForbiddenError('only a superadmin can manage accounts');
  }
  return { email: user.email, role: user.role };
}
