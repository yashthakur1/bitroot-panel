import { NextRequest, NextResponse } from 'next/server';
import { addDomain, checkDns, getPublicIp, listDomains, requiredRecord, syncSite } from '@/lib/custom-domains';
import { domainError, NO_STORE } from '@/lib/custom-domains-http';
import { currentEmail } from '@/lib/current-user';
import { portForService } from '@/lib/routes';
import { assertName, ValidationError } from '@/lib/validate';

// GET is read-only: a DNS lookup per domain, nothing written to nginx or
// certbot. The "Refresh" button (POST .../sync) is what actually provisions —
// a page view should not reload nginx.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  try {
    const name = assertName((await params).name);
    const [rows, publicIp] = await Promise.all([listDomains(name), getPublicIp()]);
    const domains = await Promise.all(
      rows.map(async (r) => ({
        ...r,
        dns: await checkDns(r.domain, publicIp),
        record: publicIp ? requiredRecord(r.domain, publicIp) : null,
      })),
    );
    return NextResponse.json({ domains, publicIp }, { headers: NO_STORE });
  } catch (e) {
    return domainError(e);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  try {
    const name = assertName((await params).name);
    const port = await portForService(name);
    if (!port) throw new ValidationError(`"${name}" is not a registered static site`);

    const body = await req.json().catch(() => ({}));
    addDomain(name, { domain: body.domain, redirectApexToWww: Boolean(body.redirectApexToWww) }, await currentEmail());

    // Provision immediately so the response already reflects reality — the
    // operator just added a domain, not "a domain that will show up later".
    const result = await syncSite(name, port);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return domainError(e);
  }
}
