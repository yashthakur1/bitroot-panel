import { NextResponse } from 'next/server';
import { devicesConfigured, listDevices } from '@/lib/devices';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!devicesConfigured()) {
    return NextResponse.json({ configured: false, devices: [] });
  }
  try {
    return NextResponse.json({ configured: true, devices: await listDevices() });
  } catch (e) {
    return NextResponse.json(
      { configured: true, devices: [], error: (e as Error).message },
      { status: 502 },
    );
  }
}
