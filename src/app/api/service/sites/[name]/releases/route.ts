import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { domainError, NO_STORE } from '@/lib/custom-domains-http';
import { listPipelines, recordRun } from '@/lib/pipelines';
import { run } from '@/lib/runner';
import { assertReleaseId, deployInProgress, listReleases } from '@/lib/static-config';
import { assertName, shq, ValidationError } from '@/lib/validate';

// Service API: the builds a static site still has on disk (the last two), and
// rolling back to one. A rollback is a symlink swap — no rebuild — and is
// recorded in the deploy history like any other deploy.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  try {
    const name = assertName((await params).name);
    return NextResponse.json({ releases: await listReleases(name) }, { headers: NO_STORE });
  } catch (e) {
    return domainError(e);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  try {
    const name = assertName((await params).name);
    const body = await req.json().catch(() => ({}));
    const id = assertReleaseId(body.release);
    const by = typeof body.by === 'string' ? body.by.slice(0, 120) : 'client';
    if (await deployInProgress(name)) {
      return NextResponse.json({ error: 'a deploy is running — wait for it to finish' }, { status: 409 });
    }
    const target = (await listReleases(name)).find((r) => r.id === id);
    if (!target) throw new ValidationError('that build is no longer on the server');
    if (target.current) return NextResponse.json({ ok: true, release: id });

    const dir = `"$HOME/apps/static/${name}"`;
    const r = await run(`flock -n ${dir}/.deploy.lock static-site rollback ${shq(name)} ${shq(id)} 2>&1`, 30_000);
    const subject = await run(`cd ${dir}/src && git log -1 --format=%s ${shq(target.sha)} 2>/dev/null || true`);
    const pipeline = (await listPipelines()).find((p) => p.project === name);
    await recordRun({
      id: randomBytes(4).toString('hex'),
      pipelineId: pipeline?.id ?? 'manual',
      at: new Date().toISOString(),
      ok: r.ok,
      sha: target.sha,
      message: `Rollback${subject.output.trim() ? ` — ${subject.output.trim()}` : ` to ${target.sha}`}`,
      pusher: by,
      // The portal finds a site's runs by this header line.
      output: `=== deploying ${name} ===\n${r.output}`,
    }).catch((e) => console.error('[service/releases] could not record run', e));
    if (!r.ok) return NextResponse.json({ error: r.output.trim().split('\n').pop() || 'rollback failed' }, { status: 500 });
    return NextResponse.json({ ok: true, release: id });
  } catch (e) {
    return domainError(e);
  }
}

export const dynamic = 'force-dynamic';
