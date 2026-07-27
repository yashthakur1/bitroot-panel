import { NextRequest, NextResponse } from 'next/server';
import { run } from '@/lib/runner';
import { assertName, ValidationError } from '@/lib/validate';
import { recordResidue } from '@/lib/residue';

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
    const { action } = await req.json();
    const timeout = ACTIONS[action];
    if (!timeout) {
      return NextResponse.json({ error: 'unknown action' }, { status: 400 });
    }

    // Checked before the action runs: afterwards the route is already gone, so
    // we could not tell whether a DNS record was ever created for this name.
    const wasRouted =
      action === 'remove' &&
      (
        await run(
          `grep -c "hostname: ${name}\\." "$HOME/.cloudflared/config.yml" 2>/dev/null || echo 0`,
        )
      ).output.trim() !== '0';

    const r = await run(`project ${action} ${name}`, timeout);

    // `project remove` intentionally keeps files and the DNS record — log what
    // survives so it shows up on the Residue page instead of silently lingering.
    if (action === 'remove' && r.ok) {
      const [dir, repo] = await Promise.all([
        run(`[ -d "$HOME/Downloads/${name}" ] && echo yes || true`),
        run(`[ -d "$HOME/repos/${name}.git" ] && echo yes || true`),
      ]);
      await recordResidue([
        ...(dir.output.includes('yes')
          ? [
              {
                action: `removed service "${name}"`,
                kind: 'files' as const,
                what: 'Project files were kept',
                target: `~/Downloads/${name}`,
                hint: 'Delete from the Residue page if you no longer need the code or its .env.',
              },
            ]
          : []),
        ...(repo.output.includes('yes')
          ? [
              {
                action: `removed service "${name}"`,
                kind: 'files' as const,
                what: 'Bare deploy repo was kept',
                target: `~/repos/${name}.git`,
                hint: 'Keeping it lets you re-deploy with a git push; delete it to reclaim space.',
              },
            ]
          : []),
        ...(wasRouted
          ? [
              {
                action: `removed service "${name}"`,
                kind: 'dns' as const,
                what: 'Cloudflare DNS record was not deleted',
                target: `${name}.bitroot.in`,
                hint: 'The hostname no longer serves anything. Remove the CNAME in the Cloudflare dashboard if you want it gone.',
              },
            ]
          : []),
      ]);
    }

    return NextResponse.json({ ok: r.ok, output: r.output }, { status: r.ok ? 200 : 500 });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
