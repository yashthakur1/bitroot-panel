import { NextRequest, NextResponse } from 'next/server';
import { run } from '@/lib/runner';
import { assertName, ValidationError } from '@/lib/validate';
import { recordResidue } from '@/lib/residue';
import { deleteRecordsForHosts } from '@/lib/cloudflare';
import { hostsForPort, portForService } from '@/lib/routes';

const ACTIONS: Record<string, number> = {
  deploy: 600_000,
  start: 60_000,
  stop: 60_000,
  restart: 60_000,
  remove: 120_000,
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const name = assertName((await params).name);
    const body = await req.json();
    const { action } = body;
    const timeout = ACTIONS[action];
    if (!timeout) {
      return NextResponse.json({ error: 'unknown action' }, { status: 400 });
    }

    // Resolve routes before removal: afterwards the ingress rule is gone and
    // the link between this service and its hostnames is unrecoverable.
    const port = action === 'remove' ? await portForService(name) : null;
    const hosts = port ? await hostsForPort(port) : [];

    const r = await run(`project ${action} ${name}`, timeout);

    if (action === 'remove' && r.ok) {
      const deleteDns = body.deleteDns !== false; // opt out, not opt in
      const deleteFiles = body.deleteFiles === true;
      const deleteRepo = body.deleteRepo === true;

      const done: string[] = [r.output.trim()];
      const kept: Array<Parameters<typeof recordResidue>[0][number]> = [];

      if (deleteDns && hosts.length > 0) {
        try {
          const removed = await deleteRecordsForHosts(hosts);
          if (removed.length) done.push(`  deleted DNS record(s): ${removed.join(', ')}`);
        } catch (e) {
          done.push(`  DNS deletion failed: ${(e as Error).message}`);
          kept.push({
            action: `removed service "${name}"`,
            kind: 'dns',
            what: 'Cloudflare DNS record could not be deleted',
            target: hosts.join(', '),
            hint: 'Delete it from the Residue page once Cloudflare is reachable.',
          });
        }
      } else if (hosts.length > 0) {
        kept.push({
          action: `removed service "${name}"`,
          kind: 'dns',
          what: 'Cloudflare DNS record was kept',
          target: hosts.join(', '),
          hint: 'Delete it from the Residue page if the hostname is not coming back.',
        });
      }

      const [dirExists, repoExists] = await Promise.all([
        run(`[ -d "$HOME/apps/${name}" ] && echo yes || true`),
        run(`[ -d "$HOME/repos/${name}.git" ] && echo yes || true`),
      ]);

      if (dirExists.output.includes('yes')) {
        if (deleteFiles) {
          const rm = await run(`rm -rf "$HOME/apps/${name}"`, 120_000);
          done.push(rm.ok ? '  deleted project files' : '  file deletion failed');
        } else {
          kept.push({
            action: `removed service "${name}"`,
            kind: 'files',
            what: 'Project files were kept',
            target: `~/apps/${name}`,
            hint: 'Delete from the Residue page if you no longer need the code or its .env.',
          });
        }
      }

      if (repoExists.output.includes('yes')) {
        if (deleteRepo) {
          const rm = await run(`rm -rf "$HOME/repos/${name}.git"`, 60_000);
          done.push(rm.ok ? '  deleted deploy repo' : '  repo deletion failed');
        } else {
          kept.push({
            action: `removed service "${name}"`,
            kind: 'files',
            what: 'Bare deploy repo was kept',
            target: `~/repos/${name}.git`,
            hint: 'Keeping it lets you redeploy with a git push; delete it to reclaim space.',
          });
        }
      }

      if (kept.length) await recordResidue(kept);
      return NextResponse.json({ ok: true, output: done.join('\n') });
    }

    return NextResponse.json({ ok: r.ok, output: r.output }, { status: r.ok ? 200 : 500 });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
