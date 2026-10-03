import { NextRequest, NextResponse } from 'next/server';
import { removeDomain, syncSite } from '@/lib/custom-domains';
import { domainError } from '@/lib/custom-domains-http';
import { portForService } from '@/lib/routes';
import { assertName, ValidationError } from '@/lib/validate';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string; domain: string }> },
) {
  try {
    const { name: rawName, domain } = await params;
    const name = assertName(rawName);
    const port = await portForService(name);
    if (!port) throw new ValidationError(`"${name}" is not a registered static site`);

    removeDomain(name, decodeURIComponent(domain));
    // Drop it from the vhost/cert set too — otherwise it keeps serving until
    // the next unrelated sync.
    const result = await syncSite(name, port);
    return NextResponse.json(result);
  } catch (e) {
    return domainError(e);
  }
}
