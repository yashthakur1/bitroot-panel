import { NextResponse } from 'next/server';

/* eslint-disable @typescript-eslint/no-explicit-any */

// IAM overview: reads Cloudflare Access apps + policies for the zone and
// aggregates them into a per-user view. Requires CF_API_TOKEN and CF_ZONE_ID
// in the panel's environment (read access to Access apps is enough).

function subjectLabel(inc: any): string {
  if (inc.email?.email) return inc.email.email;
  if (inc.email_domain?.domain) return `anyone @${inc.email_domain.domain}`;
  if (inc.everyone !== undefined) return 'everyone';
  if (inc.group?.id) return `group:${inc.group.id}`;
  return JSON.stringify(inc);
}

export async function GET() {
  const token = process.env.CF_API_TOKEN;
  const zone = process.env.CF_ZONE_ID;
  if (!token || !zone) {
    return NextResponse.json({ configured: false, apps: [], users: [] });
  }

  let data: any;
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${zone}/access/apps`,
      { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
    );
    data = await res.json();
  } catch (e) {
    return NextResponse.json(
      { configured: true, error: `Cloudflare API unreachable: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  if (!data.success) {
    return NextResponse.json(
      { configured: true, error: data.errors?.[0]?.message ?? 'Cloudflare API error' },
      { status: 502 },
    );
  }

  const apps = (data.result ?? []).map((a: any) => ({
    name: a.name,
    domain: a.domain,
    sessionDuration: a.session_duration,
    policies: (a.policies ?? []).map((p: any) => ({
      name: p.name,
      decision: p.decision,
      subjects: (p.include ?? []).map(subjectLabel),
    })),
  }));

  const userMap: Record<string, Set<string>> = {};
  for (const app of apps) {
    for (const p of app.policies) {
      if (p.decision !== 'allow') continue;
      for (const s of p.subjects) {
        (userMap[s] ??= new Set()).add(app.name);
      }
    }
  }
  const users = Object.entries(userMap)
    .map(([email, appNames]) => ({ email, apps: [...appNames] }))
    .sort((a, b) => a.email.localeCompare(b.email));

  return NextResponse.json({ configured: true, apps, users });
}
