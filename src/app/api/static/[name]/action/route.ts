import { NextRequest, NextResponse } from 'next/server';
import { run, runStream } from '@/lib/runner';
import { assertName, ValidationError } from '@/lib/validate';
import { recordResidue } from '@/lib/residue';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const name = assertName((await params).name);
    const { action } = await req.json();

    if (action === 'deploy') {
      // Rebuilds can take minutes on the phone — stream it.
      return new Response(runStream(`static-site deploy ${name}`, 900_000), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    if (action === 'remove') {
      const r = await run(`static-site remove ${name}`, 120_000);
      if (r.ok) {
        await recordResidue([
          {
            action: `removed static site "${name}"`,
            kind: 'files',
            what: 'Source and built files were kept',
            target: `~/apps/static/${name}`,
            hint: 'Delete from the Residue page to reclaim the space.',
          },
          {
            action: `removed static site "${name}"`,
            kind: 'dns',
            what: 'Cloudflare DNS record was not deleted',
            target: `${name}.bitroot.in`,
            hint: 'The hostname stops serving; remove the CNAME in Cloudflare to retire it fully.',
          },
        ]);
      }
      return NextResponse.json({ ok: r.ok, output: r.output }, { status: r.ok ? 200 : 500 });
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
