import { NextRequest, NextResponse } from 'next/server';
import { checkDns, getPublicIp, listDomains, requiredRecord } from '@/lib/custom-domains';
import { domainError, NO_STORE } from '@/lib/custom-domains-http';
import { setPipelineBranch } from '@/lib/pipelines';
import { deployInProgress, readStaticConfig, updateStaticConfig } from '@/lib/static-config';
import { assertName } from '@/lib/validate';

// Service API (lib/service-auth.ts): one static site's settings and domains,
// for the client portal. Read-only GET — DNS lookups, nothing provisioned.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  try {
    const name = assertName((await params).name);
    const [config, publicIp, deploying] = await Promise.all([readStaticConfig(name), getPublicIp(), deployInProgress(name)]);
    const domains = await Promise.all(
      listDomains(name).map(async (r) => ({
        ...r,
        dns: await checkDns(r.domain, publicIp),
        record: publicIp ? requiredRecord(r.domain, publicIp) : null,
      })),
    );
    return NextResponse.json({ config, domains, publicIp, deploying }, { headers: NO_STORE });
  } catch (e) {
    return domainError(e);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  try {
    const name = assertName((await params).name);
    const body = await req.json().catch(() => ({}));
    const before = await readStaticConfig(name);
    const config = await updateStaticConfig(name, {
      branch: body.branch,
      buildScript: body.buildScript,
      outDir: body.outDir,
    });
    if (config.branch !== before.branch) await setPipelineBranch(name, config.branch);
    return NextResponse.json({ config });
  } catch (e) {
    return domainError(e);
  }
}
