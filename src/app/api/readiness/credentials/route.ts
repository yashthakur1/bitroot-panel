import { NextRequest, NextResponse } from 'next/server';
import { checkCloudflare, checkDomainUsable, writeEnv } from '@/lib/setup';
import { parseIngress, planMigrate } from '@/lib/routes';
import { run } from '@/lib/runner';
import { syncWebRootDomain } from '@/lib/garage-config';

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

  // A domain that passes the pattern above can still be unusable: Cloudflare's
  // certificate covers the zone and one wildcard level, so a suffix any deeper
  // gives every service a TLS handshake failure. This is the fault that made
  // neevpanel.bitroot.club look like a broken server for a day.
  let domainCheck: Awaited<ReturnType<typeof checkDomainUsable>> | null = null;
  let migration: ReturnType<typeof planMigrate> = [];
  if (values.DOMAIN_SUFFIX) {
    const token = values.CF_API_TOKEN || process.env.CF_API_TOKEN;
    domainCheck = await checkDomainUsable(values.DOMAIN_SUFFIX, token);
    if (!domainCheck.ok && !body.force) {
      return NextResponse.json(
        { error: domainCheck.reason, domainCheck, canForce: true },
        { status: 400 },
      );
    }

    // Routes published under the previous suffix keep the old hostname. Say so
    // instead of leaving the panel showing one domain and serving another.
    const previous = process.env.DOMAIN_SUFFIX;
    if (previous && previous !== values.DOMAIN_SUFFIX) {
      const cfg = await run('cat "$HOME/.cloudflared/config.yml" 2>/dev/null || true');
      migration = planMigrate(
        parseIngress(cfg.output),
        previous,
        values.DOMAIN_SUFFIX,
        domainCheck.zone ?? values.DOMAIN_SUFFIX,
      );
    }
  }

  try {
    await writeEnv(values);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  // Setting the domain has a second consequence: Garage resolves published
  // hostnames by stripping its own root_domain, and if that is left behind
  // every public object 404s. Reconcile it here rather than leaving a
  // configuration that only looks right.
  let garage: string | undefined;
  if (values.DOMAIN_SUFFIX) {
    const r = await syncWebRootDomain(values.DOMAIN_SUFFIX);
    garage = r.message;
  }

  // Restarting is what makes the new values take effect everywhere, but the
  // panel is the process being restarted - it cannot answer this request from
  // the other side of it. Detach it so the response is already on its way.
  if (body.restart) {
    // .env is sourced into the restarting shell first. `pm2 restart` alone
    // restores the environment pm2 captured at first start, and --update-env
    // copies whatever the *calling* shell has - neither reads .env. Without
    // this, a value written a line ago is still invisible to the process.
    run(
      'nohup sh -c "sleep 1; \"$HOME/bin/panel-restart\" || ' +
        'pm2 restart bitroot-panel --update-env" >/dev/null 2>&1 &',
      5_000,
    ).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    saved: Object.keys(values),
    verified,
    domainCheck,
    // Empty unless the domain changed. Each entry is a route that still answers
    // on the old hostname; POST /api/routes with action "migrate" moves them.
    migration,
    garage,
    restarting: Boolean(body.restart),
  });
}
