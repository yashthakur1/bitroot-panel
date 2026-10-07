import { NextRequest, NextResponse } from 'next/server';
import { removeDomain, syncSite } from '@/lib/custom-domains';
import { domainError } from '@/lib/custom-domains-http';
import { portForService } from '@/lib/routes';
import { assertName, ValidationError } from '@/lib/validate';

// Service API: detach a domain and drop it from Traefik in the same step.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ name: string; domain: string }> }) {
  try {
    const { name: rawName, domain } = await params;
    const name = assertName(rawName);
    const port = await portForService(name);
    if (!port) throw new ValidationError(`"${name}" is not a registered static site`);
    removeDomain(name, decodeURIComponent(domain));
    return NextResponse.json(await syncSite(name, port));
  } catch (e) {
    return domainError(e);
  }
}
