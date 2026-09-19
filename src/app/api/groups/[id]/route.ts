import { NextRequest, NextResponse } from 'next/server';
import { deleteGroup, getGroup, updateGroup } from '@/lib/groups';
import { groupError, NO_STORE, readJson } from '@/lib/groups-http';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    return NextResponse.json({ group: getGroup((await params).id) }, { headers: NO_STORE });
  } catch (e) {
    return groupError(e);
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const body = await readJson(req);
    const group = updateGroup((await params).id, { name: body.name, description: body.description });
    return NextResponse.json({ ok: true, group });
  } catch (e) {
    return groupError(e);
  }
}

// Removes the project and its memberships. What it grouped is not touched: no
// service is stopped, no site unpublished, no bucket emptied.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    deleteGroup((await params).id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return groupError(e);
  }
}
