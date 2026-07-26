import { NextRequest, NextResponse } from 'next/server';
import { ValidationError } from '@/lib/validate';
import { recordResidue } from '@/lib/residue';
import {
  assertDbName,
  pbFetch,
  readRegistry,
  starterCollections,
  writeRegistry,
  PB_URL,
  PB_PUBLIC_URL,
} from '@/lib/pocketbase';

/* eslint-disable @typescript-eslint/no-explicit-any */

async function collectionsWithCounts() {
  const list = await pbFetch('/api/collections?perPage=200');
  const userCollections = (list.items ?? []).filter((c: any) => !c.name.startsWith('_'));
  return Promise.all(
    userCollections.map(async (c: any) => {
      let records = 0;
      try {
        const page = await pbFetch(
          `/api/collections/${encodeURIComponent(c.name)}/records?perPage=1`,
        );
        records = page.totalItems ?? 0;
      } catch {
        // collection may be view-type or restricted
      }
      return { name: c.name, type: c.type, records };
    }),
  );
}

export async function GET() {
  try {
    const [registry, collections] = await Promise.all([readRegistry(), collectionsWithCounts()]);

    const databases = registry.map((db) => {
      const owned = collections.filter((c) => c.name.startsWith(`${db.name}_`));
      return {
        ...db,
        collections: owned,
        records: owned.reduce((n, c) => n + c.records, 0),
        internalUrl: PB_URL,
        publicUrl: PB_PUBLIC_URL,
      };
    });

    const claimed = new Set(databases.flatMap((d) => d.collections.map((c) => c.name)));
    const unassigned = collections.filter((c) => !claimed.has(c.name));

    return NextResponse.json({ databases, unassigned, internalUrl: PB_URL, publicUrl: PB_PUBLIC_URL });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

// Spin up a project database: a named collection namespace with starter
// collections, registered so the panel can show connection details.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = assertDbName(body.name);
    const withAuth = Boolean(body.withAuth);

    const registry = await readRegistry();
    if (registry.some((d) => d.name === name)) {
      return NextResponse.json({ error: `database "${name}" already exists` }, { status: 400 });
    }

    const created: string[] = [];
    for (const collection of starterCollections(name, withAuth)) {
      await pbFetch('/api/collections', {
        method: 'POST',
        body: JSON.stringify(collection),
      });
      created.push(collection.name);
    }

    await writeRegistry([
      ...registry,
      { name, created: new Date().toISOString().slice(0, 16).replace('T', ' '), withAuth },
    ]);

    return NextResponse.json({ ok: true, name, collections: created });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

// Unregister a database. Collections are left intact — deleting data needs to
// be a deliberate act in the admin UI, not a stray click here.
export async function DELETE(req: NextRequest) {
  try {
    const name = assertDbName(req.nextUrl.searchParams.get('name'));
    const registry = await readRegistry();
    await writeRegistry(registry.filter((d) => d.name !== name));

    let kept: string[] = [];
    try {
      const list = await pbFetch('/api/collections?perPage=200');
      kept = (list.items ?? [])
        .map((c: any) => c.name)
        .filter((n: string) => n.startsWith(`${name}_`));
    } catch {
      // admin API unavailable; still record the generic warning
    }

    await recordResidue([
      {
        action: `unregistered database "${name}"`,
        kind: 'data',
        what:
          kept.length > 0
            ? `Collections and their records were kept: ${kept.join(', ')}`
            : 'Any collections under this namespace were kept',
        target: `pocketbase:${name}_*`,
        hint: 'Data is never deleted from here. Drop the collections in the PocketBase admin UI if you truly want them gone.',
      },
    ]);

    return NextResponse.json({ ok: true, keptCollections: kept });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
