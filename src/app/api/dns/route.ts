import { NextResponse } from 'next/server';
import { dnsConfigured, zoneView } from '@/lib/cloudflare';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!dnsConfigured()) {
    return NextResponse.json(
      { error: 'Cloudflare is not configured. Set CF_ZONE_ID and CF_API_TOKEN.' },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await zoneView());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
