// Maps the registry's errors onto HTTP, in one place so every groups route
// answers the same way: a bad request is 400, a clash (a name in use, a
// resource that already has a home) is 409, an unknown project is 404, and only
// something unexpected is 500 — with its message withheld, since that is where a
// stack trace or a filesystem path would leak.

import { NextResponse } from 'next/server';
import { ConflictError, NotFoundError } from './groups';
import { ValidationError } from './validate';

export const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export function groupError(e: unknown): NextResponse {
  if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
  if (e instanceof ConflictError) return NextResponse.json({ error: e.message }, { status: 409 });
  if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
  console.error('[groups]', e);
  return NextResponse.json({ error: 'something went wrong' }, { status: 500 });
}

/** A JSON body, or an empty object: a missing body is a validation problem, not a crash. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
