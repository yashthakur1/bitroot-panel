import { NextRequest, NextResponse } from 'next/server';
import { readiness } from '@/lib/readiness';

// Always fresh: the whole point is to reflect what changed on the server since
// you last looked, so a cached answer would be worse than none.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // ?fresh=1 comes from the Re-scan button, and means "ask upstream again"
  // rather than "re-read what we already decided".
  const fresh = req.nextUrl.searchParams.get('fresh') === '1';
  try {
    return NextResponse.json(await readiness(fresh));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
