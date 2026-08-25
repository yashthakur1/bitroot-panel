import { NextRequest, NextResponse } from "next/server";
import { run } from "@/lib/runner";
import {
  migrate,
  parseIngress,
  portOf,
  realEffects,
  verifyHostname,
} from "@/lib/routes";
import { checkDomainUsable } from "@/lib/setup";
import { recordResidue } from "@/lib/residue";

// Live status per route, so a broken one can be diagnosed here rather than by
// asking someone to read a config file. Each check is an observation, not a
// claim from configuration: the tunnel listing a route and the route working are
// different things, and every failure we have hit was the gap between them.
export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = await run('cat "$HOME/.cloudflared/config.yml" 2>/dev/null || true');
  const entries = parseIngress(cfg.output).filter((e) => e.hostname);

  // In parallel: each check makes a real HTTPS request, and doing four in
  // sequence is four round trips the operator waits through.
  const routes = await Promise.all(
    entries.map(async (e) => {
      const verify = await verifyHostname(e.hostname as string);
      return {
        hostname: e.hostname as string,
        service: e.service,
        port: portOf(e.service),
        comment: e.comment ?? null,
        ok: verify.ok,
        checks: verify.checks,
        reason: verify.reason ?? null,
      };
    }),
  );

  return NextResponse.json({ routes }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Move every route from the old domain suffix to the new one.
 *
 * Separate from saving the domain on purpose. Saving writes one string; this
 * creates DNS records and rewrites the tunnel config, so it stays an explicit
 * decision the operator makes after seeing the list of what would move.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (String(body.action ?? "") !== "migrate") {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  const from = String(body.from ?? "").trim().toLowerCase();
  const to = String(body.to ?? "").trim().toLowerCase();
  if (!from || !to || from === to) {
    return NextResponse.json(
      { error: "from and to must both be given and must differ" },
      { status: 400 },
    );
  }

  const tunnelId = process.env.TUNNEL_ID;
  if (!tunnelId) {
    return NextResponse.json(
      { error: "TUNNEL_ID is not set, so DNS records cannot be created" },
      { status: 400 },
    );
  }

  const check = await checkDomainUsable(to, process.env.CF_API_TOKEN);
  if (!check.ok) {
    return NextResponse.json({ error: check.reason }, { status: 400 });
  }

  try {
    const result = await migrate(realEffects(tunnelId), {
      from,
      to,
      zone: check.zone ?? to,
    });
    // Each move leaves the old DNS record deleted and a new one created. A
    // skipped route is the one thing that outlives this call, so it is the one
    // thing worth writing down.
    await recordResidue(
      result.skipped.map((step) => ({
        action: `route not moved to ${to}`,
        kind: "dns" as const,
        what: `${step.from} still answers on the old domain`,
        target: step.from,
        hint: step.reason ?? "re-run the migration once the domain is usable",
      })),
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
