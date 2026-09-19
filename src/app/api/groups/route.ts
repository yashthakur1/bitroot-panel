import { NextRequest, NextResponse } from 'next/server';
import { createGroup, listGroups, membership } from '@/lib/groups';
import { currentEmail } from '@/lib/current-user';
import { groupError, NO_STORE, readJson } from '@/lib/groups-http';

// Projects: named groups of services, static sites, buckets and routes. The
// registry only records membership by name — see lib/groups.ts.

export async function GET() {
  try {
    return NextResponse.json(
      // `membership` lets any list of resources show which project each belongs
      // to with one request, instead of one lookup per row.
      { groups: listGroups(), membership: membership() },
      { headers: NO_STORE },
    );
  } catch (e) {
    return groupError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await readJson(req);
    const group = createGroup({ name: body.name, description: body.description }, await currentEmail());
    return NextResponse.json({ ok: true, group }, { status: 201 });
  } catch (e) {
    return groupError(e);
  }
}
