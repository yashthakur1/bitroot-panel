import os from 'os';
import { NextResponse } from 'next/server';

// Which machine am I looking at. Small and separate from /api/config because the
// nav asks for it on every page and config is expensive to assemble.
export const dynamic = 'force-dynamic';

export async function GET() {
  // The tailnet name when there is one, since that is what the panel's own URLs
  // use; otherwise whatever this box calls itself.
  const name = process.env.TAILNET_HOST?.split('.')[0] || os.hostname().split('.')[0];
  return NextResponse.json({
    name,
    // Node reports "android" under Termux, which is the one distinction worth
    // surfacing - it is the platform with the sharpest differences.
    platform: os.platform() === 'android' ? 'Android · Termux' : `${os.type()} ${os.arch()}`,
  });
}
