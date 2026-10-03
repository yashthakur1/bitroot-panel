// Same mapping groups-http.ts gives for projects, for custom domains: a bad
// request is 400, a clash is 409, an unknown domain is 404, anything else is
// 500 with its message withheld.

import { NextResponse } from 'next/server';
import { ConflictError, NotFoundError } from './custom-domains';
import { ValidationError } from './validate';

export const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export function domainError(e: unknown): NextResponse {
  if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
  if (e instanceof ConflictError) return NextResponse.json({ error: e.message }, { status: 409 });
  if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
  console.error('[custom-domains]', e);
  return NextResponse.json({ error: 'something went wrong' }, { status: 500 });
}
