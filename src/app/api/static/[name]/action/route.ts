import { NextRequest, NextResponse } from 'next/server';
import { run, runStream } from '@/lib/runner';
import { assertName, ValidationError } from '@/lib/validate';
import { recordResidue } from '@/lib/residue';
import { deleteRecordsForHosts } from '@/lib/cloudflare';
import { hostsForPort, portForService } from '@/lib/routes';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const name = assertName((await params).name);
    const body = await req.json();
    const { action } = body;

    if (action === 'deploy') {
      // Rebuilds can take minutes on the server — stream it.
      return new Response(runStream(`static-site deploy ${name}`, 900_000), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    if (action === 'remove') {
      const deleteDns = body.deleteDns !== false; // opt out, not opt in
      const deleteFiles = body.deleteFiles === true;

      // Resolve hostnames before removal — afterwards the ingress rule is gone
      // and there is no way to tell which records belonged to this site.
      const port = await portForService(name);
      const hosts = port ? await hostsForPort(port) : [];

      const r = await run(`static-site remove ${name}`, 120_000);
      if (!r.ok) {
        return NextResponse.json({ ok: false, output: r.output }, { status: 500 });
      }

      const done: string[] = [r.output.trim()];
      const kept: Array<Parameters<typeof recordResidue>[0][number]> = [];

      if (deleteDns && hosts.length > 0) {
        try {
          const removed = await deleteRecordsForHosts(hosts);
          if (removed.length) done.push(`  deleted DNS record(s): ${removed.join(', ')}`);
        } catch (e) {
          done.push(`  DNS deletion failed: ${(e as Error).message}`);
          kept.push({
            action: `removed static site "${name}"`,
            kind: 'dns',
            what: 'Cloudflare DNS record could not be deleted',
            target: hosts.join(', '),
            hint: 'Delete it from the Residue page once Cloudflare is reachable.',
          });
        }
      } else if (hosts.length > 0) {
        kept.push({
          action: `removed static site "${name}"`,
          kind: 'dns',
          what: 'Cloudflare DNS record was kept',
          target: hosts.join(', '),
          hint: 'Delete it from the Residue page if the hostname is not coming back.',
        });
      }

      if (deleteFiles) {
        const rm = await run(`rm -rf "$HOME/apps/static/${name}"`, 120_000);
        done.push(rm.ok ? '  deleted source and built files' : '  file deletion failed');
      } else {
        kept.push({
          action: `removed static site "${name}"`,
          kind: 'files',
          what: 'Source and built files were kept',
          target: `~/apps/static/${name}`,
          hint: 'Delete from the Residue page to reclaim the space.',
        });
      }

      if (kept.length) await recordResidue(kept);
      return NextResponse.json({ ok: true, output: done.join('\n') });
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
