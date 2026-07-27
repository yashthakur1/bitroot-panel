import { NextResponse } from 'next/server';
import { getSuperadmin, listApps } from '@/lib/access';

// IAM overview: who can pass the Cloudflare Access gate, aggregated per person
// and per application, plus whether this token may edit those policies.

export async function GET() {
  const superadmin = await getSuperadmin();

  let apps;
  try {
    apps = await listApps();
  } catch (e) {
    return NextResponse.json(
      { configured: false, error: (e as Error).message, apps: [], users: [], superadmin },
      { status: 200 },
    );
  }

  const userMap: Record<string, Array<{ id: string; name: string }>> = {};
  for (const app of apps) {
    for (const p of app.policies) {
      if (p.decision !== 'allow') continue;
      for (const email of p.emails) {
        (userMap[email] ??= []).push({ id: app.id, name: app.name });
      }
    }
  }

  const users = Object.entries(userMap)
    .map(([email, list]) => ({
      email,
      apps: list,
      superadmin: email === superadmin,
    }))
    .sort((a, b) =>
      a.superadmin === b.superadmin ? a.email.localeCompare(b.email) : a.superadmin ? -1 : 1,
    );

  return NextResponse.json({
    configured: true,
    superadmin,
    users,
    apps: apps.map((a) => ({
      id: a.id,
      name: a.name,
      domain: a.domain,
      sessionDuration: a.sessionDuration,
      policies: a.policies.map((p) => ({
        name: p.name,
        decision: p.decision,
        subjects: [
          ...p.emails,
          ...p.otherRules.map((r) =>
            r.email_domain?.domain
              ? `anyone @${r.email_domain.domain}`
              : r.everyone !== undefined
                ? 'everyone'
                : 'other rule',
          ),
        ],
      })),
    })),
  });
}
