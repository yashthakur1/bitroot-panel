import { NextRequest, NextResponse } from 'next/server';
import { checkCloudflare, writeEnv } from '@/lib/setup';
import { run } from '@/lib/runner';

export const dynamic = 'force-dynamic';

// A strict allowlist, not "any key the client names". This endpoint writes to
// the file the panel reads its own configuration from, so an open key parameter
// would let an authenticated request set DASHBOARD_PASSWORD or point the panel
// at someone else's storage.
// Each value is also shape-checked. Stripping newlines alone stops one value
// from injecting another key, but it does it by silently mangling the input -
// "evil.com\nDASHBOARD_PASSWORD=x" became one long nonsense domain that was
// accepted and stored. Refusing beats quietly storing something wrong.
const ALLOWED: Record<string, { pattern: RegExp; expected: string }> = {
  CF_API_TOKEN: { pattern: /^[A-Za-z0-9_-]{20,}$/, expected: 'a Cloudflare API token' },
  CF_ZONE_ID: { pattern: /^[a-f0-9]{32}$/i, expected: '32 hexadecimal characters' },
  DOMAIN_SUFFIX: { pattern: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)+$/i, expected: 'a domain like example.com' },
  TAILNET_HOST: { pattern: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)*$/i, expected: 'a hostname like machine.tailnet.ts.net' },
};

function clean(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n]/g, '')
    .trim();
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const values: Record<string, string> = {};

  for (const [key, raw] of Object.entries(body.values ?? {})) {
    const rule = ALLOWED[key];
    if (!rule) {
      return NextResponse.json({ error: `${key} cannot be set from here` }, { status: 400 });
    }
    const value = clean(raw);
    if (!value) continue;
    if (!rule.pattern.test(value)) {
      return NextResponse.json(
        { error: `${key} does not look right — expected ${rule.expected}` },
        { status: 400 },
      );
    }
    values[key] = value;
  }
  if (Object.keys(values).length === 0) {
    return NextResponse.json({ error: 'nothing to save' }, { status: 400 });
  }

  // Verify before writing where verification is possible. Saving a token that
  // does not work, and only finding out when a route fails, is the exact
  // experience this page exists to prevent.
  let verified: Awaited<ReturnType<typeof checkCloudflare>> | null = null;
  if (values.CF_API_TOKEN && values.CF_ZONE_ID) {
    verified = await checkCloudflare(values.CF_API_TOKEN, values.CF_ZONE_ID).catch(() => null);
    if (verified && !verified.ok && !body.force) {
      return NextResponse.json(
        {
          error: 'The token did not pass every check.',
          verified,
          // Saving anyway is legitimate - the panel degrades to what works -
          // but it should be a decision rather than a surprise.
          canForce: true,
        },
        { status: 400 },
      );
    }
  }

  try {
    await writeEnv(values);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  // Restarting is what makes the new values take effect everywhere, but the
  // panel is the process being restarted - it cannot answer this request from
  // the other side of it. Detach it so the response is already on its way.
  if (body.restart) {
    run(
      'nohup sh -c "sleep 1; pm2 restart bitroot-panel --update-env" >/dev/null 2>&1 &',
      5_000,
    ).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    saved: Object.keys(values),
    verified,
    restarting: Boolean(body.restart),
  });
}
