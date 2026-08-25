import os from "os";
import { NextRequest, NextResponse } from "next/server";
import {
  checkCloudflare,
  checkDomainUsable,
  setupState,
  writeEnv,
} from "@/lib/setup";
import { syncWebRootDomain } from "@/lib/garage-config";
import { mailConfigured, sendPanelCredentials } from "@/lib/mail";
import { randomBytes } from "crypto";

// Open only while the panel is unconfigured. Once a password exists this route
// would otherwise let anyone who can reach the port rewrite the credentials,
// so from that point on the middleware requires a session like everywhere else.
async function guard() {
  const state = await setupState();
  return state.complete
    ? NextResponse.json({ error: "already configured" }, { status: 403 })
    : null;
}

export async function GET() {
  return NextResponse.json(await setupState());
}

export async function POST(req: NextRequest) {
  const blocked = await guard();
  if (blocked) return blocked;

  try {
    const body = await req.json();
    const step = String(body.step ?? "");

    if (step === "verify-cloudflare") {
      const token = String(body.token ?? "").trim();
      const zone = String(body.zoneId ?? "").trim();
      if (!token || !zone) {
        return NextResponse.json(
          { error: "token and zone id are both required" },
          { status: 400 },
        );
      }
      return NextResponse.json(await checkCloudflare(token, zone));
    }

    // Asked before "save" so the wizard can show the problem next to the field
    // rather than rejecting the whole form at the end.
    if (step === "verify-domain") {
      const domain = String(body.domain ?? "").trim().toLowerCase();
      if (!domain) {
        return NextResponse.json({ error: "a domain is required" }, { status: 400 });
      }
      const token = String(body.cfToken ?? "").trim() || process.env.CF_API_TOKEN;
      return NextResponse.json(await checkDomainUsable(domain, token));
    }

    if (step === "save") {
      const updates: Record<string, string> = {};
      const domain = String(body.domain ?? "")
        .trim()
        .toLowerCase();
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
        return NextResponse.json(
          { error: "a domain like example.com is required" },
          { status: 400 },
        );
      }

      // The shape check above only proves it looks like a domain. It said yes
      // to a suffix two levels below the zone, and every service published
      // under it failed its TLS handshake with an error that named neither the
      // domain nor the certificate. Ask Cloudflare before accepting it.
      const cfToken = String(body.cfToken ?? "").trim() || process.env.CF_API_TOKEN;
      const usable = await checkDomainUsable(domain, cfToken);
      if (!usable.ok && !body.forceDomain) {
        return NextResponse.json(
          // Saving anyway stays possible: the zone may be added to Cloudflare
          // later, or the operator may hold a certificate the panel cannot see.
          { error: usable.reason, domain, zone: usable.zone, canForce: true },
          { status: 400 },
        );
      }
      updates.DOMAIN_SUFFIX = domain;

      const password = String(body.password ?? "");
      if (password.length < 12) {
        return NextResponse.json(
          { error: "the dashboard password must be at least 12 characters" },
          { status: 400 },
        );
      }
      updates.DASHBOARD_PASSWORD = password;
      // Generated rather than asked for: it is a signing key, not something a
      // human should be inventing.
      updates.SESSION_SECRET = randomBytes(32).toString("hex");

      if (body.tailnetHost) {
        updates.TAILNET_HOST = String(body.tailnetHost).trim();
      }
      if (body.cfToken) updates.CF_API_TOKEN = String(body.cfToken).trim();
      if (body.cfZoneId) updates.CF_ZONE_ID = String(body.cfZoneId).trim();
      if (body.tunnelId) updates.TUNNEL_ID = String(body.tunnelId).trim();

      // The address becomes the sign-in identity. SUPERADMIN_EMAIL is already
      // what the panel means by "the admin" — Access policies and the nav both
      // read it — so it is reused rather than adding a second notion that could
      // drift out of step with it.
      const email = String(body.email ?? "").trim();
      if (email) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return NextResponse.json(
            { error: "that does not look like an email address" },
            { status: 400 },
          );
        }
        updates.SUPERADMIN_EMAIL = email;
        updates.NEXT_PUBLIC_SUPERADMIN_EMAIL = email;
      }

      await writeEnv(updates);

      // Create the account rather than only writing DASHBOARD_PASSWORD. A fresh
      // install has no reason to start on the shared credential that every
      // existing install now has to migrate away from.
      let account: string | undefined;
      if (email) {
        try {
          process.env.DASHBOARD_PASSWORD = password;
          process.env.SUPERADMIN_EMAIL = email;
          const { createUser, storeInUse } = await import("@/lib/users");
          if (!storeInUse()) {
            const user = await createUser({ email, password, role: "superadmin" });
            account = `${user.email} is a superadmin account, not a shared password`;
          }
        } catch (e) {
          // Never fatal: .env is already written, so the panel is usable. Say
          // what did not happen instead of failing a completed setup.
          account = `the account could not be created (${(e as Error).message}) — the panel will sign in with the shared password until you migrate from IAM`;
        }
      }

      // Garage resolves a published object's bucket by stripping its own
      // root_domain from the hostname. Left at the old value, every public
      // object returns 404 while the panel reports the route as live.
      const garage = (await syncWebRootDomain(domain)).message;

      // Best-effort, and never blocking: the password is already on screen and
      // in the installer's output, so a mail failure must not leave setup
      // looking incomplete.
      let mail: string | undefined;
      if (email && body.emailCredentials) {
        mail = !mailConfigured()
          ? "email is not configured on this server, so nothing was sent"
          : (
              await sendPanelCredentials({
                to: email,
                url:
                  String(body.panelUrl ?? "").trim() ||
                  `http://localhost:${process.env.PORT ?? 3210}`,
                password,
                server:
                  process.env.TAILNET_HOST?.split(".")[0] ||
                  os.hostname().split(".")[0],
              })
            ).message;
      }

      return NextResponse.json({
        ok: true,
        mail,
        account,
        garage,
        // True again. It used to be misleading: the browser read the domain
        // through NEXT_PUBLIC_ constants inlined at BUILD time, so a restart
        // alone changed nothing and the panel went on showing the previous
        // domain. The browser reads /api/facts at runtime now.
        note: "Saved. Restart the panel for the new configuration to take effect.",
      });
    }

    return NextResponse.json(
      { error: `unknown step: ${step}` },
      { status: 400 },
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
