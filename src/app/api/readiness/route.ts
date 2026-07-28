import { NextResponse } from 'next/server';
import { readiness } from '@/lib/readiness';

// Always fresh: the whole point is to reflect what changed on the server since
// you last looked, so a cached answer would be worse than none.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await readiness());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
