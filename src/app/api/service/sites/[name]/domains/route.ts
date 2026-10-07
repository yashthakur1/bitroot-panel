import { NextRequest, NextResponse } from 'next/server';
import { addDomain, syncSite } from '@/lib/custom-domains';
import { domainError } from '@/lib/custom-domains-http';
import { portForService } from '@/lib/routes';
import { assertName, ValidationError } from '@/lib/validate';

// Service API: attach a domain the portal has already verified the client
// owns (its TXT check), then provision exactly as the operator's own Add does.
export async function POST(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  try {
    const name = assertName((await params).name);
    const port = await portForService(name);
    if (!port) throw new ValidationError(`"${name}" is not a registered static site`);
    const body = await req.json().catch(() => ({}));
    const by = typeof body.by === 'string' ? `client:${body.by.slice(0, 120)}` : 'client';
    addDomain(name, { domain: body.domain, redirectApexToWww: Boolean(body.redirectApexToWww) }, by);
    return NextResponse.json(await syncSite(name, port), { status: 201 });
  } catch (e) {
    return domainError(e);
  }
}
