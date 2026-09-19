import { NextRequest, NextResponse } from 'next/server';
import { addMembers, removeMember } from '@/lib/groups';
import { currentEmail } from '@/lib/current-user';
import { groupError, readJson } from '@/lib/groups-http';

type Ctx = { params: Promise<{ id: string }> };

/** Add resources: { members: [{ kind, name }], move?: boolean }. */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const body = await readJson(req);
    const result = addMembers(
      (await params).id,
      body.members as Array<{ kind: unknown; name: unknown }>,
      await currentEmail(),
      { move: body.move === true },
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return groupError(e);
  }
}

/** Remove one: ?kind=static&name=rapsap-website. Query, not body, so it works from any client. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const q = req.nextUrl.searchParams;
    removeMember((await params).id, { kind: q.get('kind'), name: q.get('name') });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return groupError(e);
  }
}
