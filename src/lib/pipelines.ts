// Push-to-deploy: a repo and branch mapped to a service on this machine.
//
// The panel owns the registry and the GitHub side of the wiring - creating the
// webhook, holding its secret. It does not receive the deliveries. Those go to
// the deploy-webhook service, which is the one public surface here and is
// authenticated by GitHub's signature rather than by a session. Keeping the
// authenticated panel off the public path is the entire point of the split.

import { randomBytes } from 'node:crypto';
import { run } from './runner';
import { shq, ValidationError } from './validate';
import { getConnectionToken, getPrimaryToken, listConnections } from './git-connections';

const DIR = '"$HOME/.config/bitroot-panel"';
const FILE = '"$HOME/.config/bitroot-panel/pipelines.json"';
const RUNS = '"$HOME/.config/bitroot-panel/pipeline-runs.json"';

export interface Pipeline {
  id: string;
  /** owner/name */
  repo: string;
  branch: string;
  /** The service on this machine that `project deploy` will act on. */
  project: string;
  connectionId: string | null;
  /** Shared with GitHub; every delivery is signed with it. */
  secret: string;
  /** So the hook can be removed from GitHub when the pipeline is deleted. */
  hookId: number | null;
  createdAt: string;
}

export interface PipelineRun {
  id: string;
  pipelineId: string;
  at: string;
  ok: boolean;
  sha?: string;
  message?: string;
  pusher?: string;
  output?: string;
}

export function assertPipelineId(id: unknown): string {
  if (typeof id !== 'string' || !/^[a-z0-9]{8,32}$/.test(id)) {
    throw new ValidationError('invalid pipeline id');
  }
  return id;
}

export async function listPipelines(): Promise<Pipeline[]> {
  const r = await run(`cat ${FILE} 2>/dev/null || echo "[]"`);
  try {
    const parsed = JSON.parse(r.output.trim() || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writePipelines(list: Pipeline[]): Promise<void> {
  // The secrets live here, so the directory and file stay private. umask
  // before the write rather than chmod after, so there is no window where the
  // file exists and is readable.
  await run(
    `mkdir -p ${DIR} && umask 077 && printf %s ${shq(JSON.stringify(list, null, 2))} > ${FILE}`,
  );
}

export async function listRuns(limit = 30): Promise<PipelineRun[]> {
  const r = await run(`cat ${RUNS} 2>/dev/null || echo "[]"`);
  try {
    const parsed = JSON.parse(r.output.trim() || '[]');
    return Array.isArray(parsed) ? parsed.slice(0, limit) : [];
  } catch {
    return [];
  }
}

// ─── GitHub side ─────────────────────────────────────────────────────────────

async function tokenFor(connectionId: string | null): Promise<string> {
  const token = connectionId ? await getConnectionToken(connectionId) : await getPrimaryToken();
  if (!token) {
    throw new ValidationError(
      'no GitHub connection — add one under Git connections before creating a pipeline',
    );
  }
  return token;
}

async function gh(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // GitHub's message is specific and worth surfacing verbatim - "Not Found"
    // here almost always means the token cannot administer that repo, which is
    // a different problem from the repo not existing.
    throw new ValidationError(
      `GitHub: ${data?.message ?? res.status}${
        res.status === 404 ? ' (the token may lack admin rights on that repository)' : ''
      }`,
    );
  }
  return data;
}

export async function listBranches(repo: string, connectionId: string | null): Promise<string[]> {
  const token = await tokenFor(connectionId);
  const data = await gh(token, `/repos/${repo}/branches?per_page=100`);
  return Array.isArray(data) ? data.map((b: { name: string }) => b.name) : [];
}

// ─── create / remove ─────────────────────────────────────────────────────────

export async function createPipeline(input: {
  repo: string;
  branch: string;
  project: string;
  connectionId: string | null;
  /** Public base of the deploy-webhook service; the id is appended here. */
  deliveryBase: string;
}): Promise<Pipeline> {
  const list = await listPipelines();
  if (list.some((p) => p.repo === input.repo && p.branch === input.branch)) {
    throw new ValidationError(`a pipeline for ${input.repo}@${input.branch} already exists`);
  }

  const token = await tokenFor(input.connectionId);
  const id = randomBytes(8).toString('hex');
  const secret = randomBytes(24).toString('base64url');

  // Only push events, and GitHub signs every delivery with the secret. Without
  // a secret the endpoint would accept anything that knew the URL.
  const hook = await gh(token, `/repos/${input.repo}/hooks`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'web',
      active: true,
      events: ['push'],
      config: {
        // Per-pipeline path, so a delivery identifies which mapping it belongs
        // to before its signature is checked against that pipeline's secret.
        url: `${input.deliveryBase}/gh/${id}`,
        content_type: 'json',
        secret,
        insecure_ssl: '0',
      },
    }),
  });

  const pipeline: Pipeline = {
    id,
    repo: input.repo,
    branch: input.branch,
    project: input.project,
    connectionId: input.connectionId,
    secret,
    hookId: typeof hook?.id === 'number' ? hook.id : null,
    createdAt: new Date().toISOString(),
  };
  await writePipelines([...list, pipeline]);
  return pipeline;
}

export async function removePipeline(id: string): Promise<{ hookRemoved: boolean }> {
  const list = await listPipelines();
  const pipeline = list.find((p) => p.id === id);
  if (!pipeline) throw new ValidationError('no such pipeline');

  // Best effort: a hook we cannot delete (token rotated, repo transferred) must
  // not strand the local record, or the pipeline becomes impossible to remove.
  let hookRemoved = false;
  if (pipeline.hookId) {
    try {
      const token = await tokenFor(pipeline.connectionId);
      await gh(token, `/repos/${pipeline.repo}/hooks/${pipeline.hookId}`, { method: 'DELETE' });
      hookRemoved = true;
    } catch {
      hookRemoved = false;
    }
  }

  await writePipelines(list.filter((p) => p.id !== id));
  return { hookRemoved };
}

export async function connectionOptions() {
  const conns = await listConnections();
  return conns.map((c) => ({ id: c.id, label: c.label ?? c.id }));
}
