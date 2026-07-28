import { NextRequest, NextResponse } from 'next/server';
import { checkCloudflare, setupState, writeEnv } from '@/lib/setup';
import { randomBytes } from 'crypto';

// Open only while the panel is unconfigured. Once a password exists this route
// would otherwise let anyone who can reach the port rewrite the credentials,
// so from that point on the middleware requires a session like everywhere else.
async function guard() {
  const state = await setupState();
  return state.complete ? NextResponse.json({ error: 'already configured' }, { status: 403 }) : null;
}

export async function GET() {
  return NextResponse.json(await setupState());
}

export async function POST(req: NextRequest) {
  const blocked = await guard();
  if (blocked) return blocked;

  try {
    const body = await req.json();
    const step = String(body.step ?? '');

    if (step === 'verify-cloudflare') {
      const token = String(body.token ?? '').trim();
      const zone = String(body.zoneId ?? '').trim();
      if (!token || !zone) {
        return NextResponse.json({ error: 'token and zone id are both required' }, { status: 400 });
      }
      return NextResponse.json(await checkCloudflare(token, zone));
    }

    if (step === 'save') {
      const updates: Record<string, string> = {};
      const domain = String(body.domain ?? '').trim().toLowerCase();
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
        return NextResponse.json({ error: 'a domain like example.com is required' }, { status: 400 });
      }
      updates.DOMAIN_SUFFIX = domain;
      updates.NEXT_PUBLIC_DOMAIN_SUFFIX = domain;

      const password = String(body.password ?? '');
      if (password.length < 12) {
        return NextResponse.json(
          { error: 'the dashboard password must be at least 12 characters' },
          { status: 400 },
        );
      }
      updates.DASHBOARD_PASSWORD = password;
      // Generated rather than asked for: it is a signing key, not something a
      // human should be inventing.
      updates.SESSION_SECRET = randomBytes(32).toString('hex');

      if (body.tailnetHost) {
        updates.TAILNET_HOST = String(body.tailnetHost).trim();
        updates.NEXT_PUBLIC_TAILNET_HOST = updates.TAILNET_HOST;
      }
      if (body.cfToken) updates.CF_API_TOKEN = String(body.cfToken).trim();
      if (body.cfZoneId) updates.CF_ZONE_ID = String(body.cfZoneId).trim();
      if (body.tunnelId) updates.TUNNEL_ID = String(body.tunnelId).trim();

      await writeEnv(updates);
      return NextResponse.json({
        ok: true,
        // NEXT_PUBLIC_ values are inlined at build time, so the panel has to be
        // rebuilt and restarted before the browser sees them.
        note: 'Saved. Restart the panel for the new configuration to take effect.',
      });
    }

    return NextResponse.json({ error: `unknown step: ${step}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
