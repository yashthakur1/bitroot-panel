import os from 'os';
import { NextRequest, NextResponse } from 'next/server';
import { ValidationError } from '@/lib/validate';
import { assertBranch, assertRepoFullName } from '@/lib/github';
import {
  assertPipelineId,
  connectionOptions,
  createPipeline,
  listPipelines,
  listRuns,
  removePipeline,
} from '@/lib/pipelines';

export const dynamic = 'force-dynamic';

// Where GitHub will POST. It has to be a public address: the deploy-webhook
// service, not the panel, because the panel sits behind a session (and often
// behind Cloudflare Access, which GitHub cannot authenticate against).
function deliveryBase(): string | null {
  if (process.env.DEPLOY_HOOK_URL) return process.env.DEPLOY_HOOK_URL.replace(/\/+$/, '');
  const domain = process.env.DOMAIN_SUFFIX;
  if (!domain || domain === 'example.com') return null;
  return `https://deploy.${domain}`;
}

export async function GET() {
  const [pipelines, runs, connections] = await Promise.all([
    listPipelines(),
    listRuns(),
    connectionOptions(),
  ]);
  return NextResponse.json({
    // Secrets stay on the server. The UI never needs them - GitHub already has
    // its copy, and showing it again only creates somewhere else to leak from.
    pipelines: pipelines.map(({ secret, ...rest }) => rest),
    runs,
    connections,
    deliveryBase: deliveryBase(),
    device: process.env.TAILNET_HOST?.split('.')[0] || os.hostname().split('.')[0],
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const base = deliveryBase();
    if (!base) {
      throw new ValidationError(
        'Set a domain first — GitHub needs a public address to deliver to, and there is none without one.',
      );
    }

    const repo = assertRepoFullName(body.repo);
    const branch = assertBranch(body.branch);
    const project = String(body.project ?? '');
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(project)) {
      throw new ValidationError('pick a service to deploy');
    }

    const pipeline = await createPipeline({
      repo,
      branch,
      project,
      connectionId: body.connectionId ?? null,
      deliveryBase: base,
    });
    return NextResponse.json({ ok: true, pipeline: { ...pipeline, secret: undefined } });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = assertPipelineId(new URL(req.url).searchParams.get('id'));
    const { hookRemoved } = await removePipeline(id);
    return NextResponse.json({ ok: true, hookRemoved });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
