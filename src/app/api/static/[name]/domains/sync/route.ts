import { NextRequest, NextResponse } from 'next/server';
import { syncSite } from '@/lib/custom-domains';
import { domainError } from '@/lib/custom-domains-http';
import { portForService } from '@/lib/routes';
import { assertName, ValidationError } from '@/lib/validate';

// The "Refresh" button: re-checks DNS for every domain on the site and, for
// whichever now resolve here, (re)writes the vhost and gets a certificate if
// it does not have one yet. Safe to call repeatedly.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  try {
    const name = assertName((await params).name);
    const port = await portForService(name);
    if (!port) throw new ValidationError(`"${name}" is not a registered static site`);
    return NextResponse.json(await syncSite(name, port));
  } catch (e) {
    return domainError(e);
  }
}
