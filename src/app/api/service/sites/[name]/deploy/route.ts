import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { listPipelines, recordRun } from '@/lib/pipelines';
import { run, runStream } from '@/lib/runner';
import { deployInProgress } from '@/lib/static-config';
import { assertName, shq } from '@/lib/validate';

// Service API: "Deploy now" from the client portal. Streams the same
// `static-site deploy` a push runs, and records it in pipeline-runs.json so it
// appears in the deploy history next to the push-triggered ones.
export async function POST(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  let name: string;
  try {
    name = assertName((await params).name);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  if (await deployInProgress(name)) {
    return NextResponse.json({ error: 'a deploy is already running — wait for it to finish' }, { status: 409 });
  }
  const body = await req.json().catch(() => ({}));
  const by = typeof body.by === 'string' ? body.by.slice(0, 120) : 'client';
  const pipeline = (await listPipelines()).find((p) => p.project === name);

  const dir = `"$HOME/apps/static/${name}"`;
  const source = runStream(`flock -n ${dir}/.deploy.lock static-site deploy ${shq(name)} 2>&1 || exit 1`, 900_000);

  // Tee: the portal reads the stream live, and the full text is recorded once
  // it ends — even if the portal disconnects half way (runStream never aborts
  // a deploy on disconnect).
  let text = '';
  const decoder = new TextDecoder();
  const tee = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      text += decoder.decode(chunk, { stream: true });
      controller.enqueue(chunk);
    },
    async flush() {
      const exit = /\[\[EXIT:(\d+)\]\]\s*$/.exec(text);
      const output = text.replace(/\[\[HB\]\]/g, '').replace(/\n?\[\[EXIT:\d+\]\]\s*$/, '');
      const head = await run(`cd ${dir}/src && git log -1 --format='%h%x09%s' 2>/dev/null || true`);
      const [sha, ...msg] = head.output.trim().split('\t');
      await recordRun({
        id: randomBytes(4).toString('hex'),
        pipelineId: pipeline?.id ?? 'manual',
        at: new Date().toISOString(),
        ok: exit?.[1] === '0',
        sha: sha || undefined,
        message: `Manual deploy${msg.length ? ` — ${msg.join('\t')}` : ''}`,
        pusher: by,
        // The portal finds a site's runs by this header line; keep it even
        // when a long build log is trimmed to its tail.
        output: output.length > 8000 ? `=== deploying ${name} ===\n…\n${output.slice(-8000)}` : output,
      }).catch((e) => console.error('[service/deploy] could not record run', e));
    },
  });

  // Keep draining even if the reader goes away, so flush() still records the run.
  const [toClient, toRecord] = source.pipeThrough(tee).tee();
  void toRecord.pipeTo(new WritableStream()).catch(() => {});
  return new Response(toClient, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
  });
}

export const dynamic = 'force-dynamic';
