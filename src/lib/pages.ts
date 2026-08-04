// Cloudflare Pages projects, created from a GitHub repository.
//
// Nothing is built on this device. Cloudflare clones the repo, runs the build
// and serves the result from its edge — which matters most on the hardware this
// panel usually runs on: a phone that Android suspends, and that has no
// business being in the request path for a static site.
//
// Direct Upload was the obvious alternative and is not available here: it needs
// wrangler, wrangler needs workerd, and workerd ships no android build. The
// same shape of constraint as Docker and the Tailscale CLI.

import { ValidationError } from './validate';

const API = 'https://api.cloudflare.com/client/v4';

const TOKEN = () => process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_API_TOKEN ?? '';
const ACCOUNT = () => process.env.CLOUDFLARE_ACCOUNT_ID ?? '';

export function pagesConfigured(): boolean {
  return Boolean(TOKEN() && ACCOUNT());
}

export interface PagesProject {
  name: string;
  subdomain: string;
  url: string;
  domain?: string;
}

async function cf(path: string, init: RequestInit = {}) {
  if (!pagesConfigured()) {
    throw new ValidationError(
      'Cloudflare Pages is not configured — set CLOUDFLARE_API_TOKEN (with Pages: Edit) ' +
        'and CLOUDFLARE_ACCOUNT_ID in the panel env, then run panel-restart.',
    );
  }
  const res = await fetch(`${API}/accounts/${ACCOUNT()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN()}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => null);
  if (!data?.success) {
    const msg = data?.errors?.[0]?.message ?? `Cloudflare API HTTP ${res.status}`;
    // The two failures worth naming, because Cloudflare's wording for them
    // describes neither the cause nor the fix.
    if (/authentication|permission|unauthor/i.test(msg)) {
      throw new ValidationError(
        `${msg} — the token needs Account → Cloudflare Pages → Edit.`,
      );
    }
    if (/not.*installed|github app|access to the repo/i.test(msg)) {
      throw new ValidationError(
        `${msg} — Cloudflare needs read access to the repository. Install the ` +
          'Cloudflare Pages GitHub app once at https://github.com/apps/cloudflare-pages, ' +
          'then create the site again.',
      );
    }
    throw new ValidationError(msg);
  }
  return data.result;
}

/**
 * Create a Pages project wired to a GitHub repo.
 *
 * `repo` is owner/name. The build settings mirror the ones the form already
 * collects for a device-hosted site, so the two paths ask the same questions.
 */
export async function createPagesProject(opts: {
  name: string;
  repo: string;
  branch: string;
  buildCmd: string;
  outDir: string;
}): Promise<PagesProject> {
  const [owner, repoName] = opts.repo.split('/');
  if (!owner || !repoName) {
    throw new ValidationError(`"${opts.repo}" is not owner/repository`);
  }
  const branch = opts.branch || 'main';

  const result = await cf('/pages/projects', {
    method: 'POST',
    body: JSON.stringify({
      name: opts.name,
      production_branch: branch,
      build_config: {
        build_command: opts.buildCmd || null,
        destination_dir: opts.outDir,
        root_dir: '',
      },
      source: {
        type: 'github',
        config: {
          owner,
          repo_name: repoName,
          production_branch: branch,
          deployments_enabled: true,
          production_deployment_enabled: true,
          // Preview builds on every branch cost build minutes for a panel whose
          // whole point is a small, cheap footprint. Production only.
          preview_deployment_setting: 'none',
        },
      },
    }),
  });

  const subdomain = String(result?.subdomain ?? `${opts.name}.pages.dev`);
  return { name: opts.name, subdomain, url: `https://${subdomain}` };
}

/** Attach a custom hostname. Cloudflare creates the DNS record when the zone is theirs. */
export async function attachDomain(project: string, domain: string): Promise<void> {
  await cf(`/pages/projects/${encodeURIComponent(project)}/domains`, {
    method: 'POST',
    body: JSON.stringify({ name: domain }),
  });
}

export async function listPagesProjects(): Promise<PagesProject[]> {
  const result = (await cf('/pages/projects')) as Array<{
    name: string;
    subdomain: string;
    domains?: string[];
  }>;
  return (result ?? []).map((p) => ({
    name: p.name,
    subdomain: p.subdomain,
    url: `https://${p.subdomain}`,
    domain: (p.domains ?? []).find((d) => !d.endsWith('.pages.dev')),
  }));
}
