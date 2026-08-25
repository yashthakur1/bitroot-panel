#!/usr/bin/env node
//
// route — publish and unpublish hostnames, from a shell.
//
// The panel imports src/lib/routes directly; this is the same module reached
// from the command line, so `tunnel-add` and the panel cannot disagree. That
// was the whole point: a shell implementation and a TypeScript one drifted
// until a bucket had a live DNS record pointing at an ingress rule that no
// longer matched.
//
//   route publish <hostname> <port|service>
//   route unpublish <hostname>
//   route list

import {
  publish,
  unpublish,
  realEffects,
  verifyHostname,
  parseIngress,
  zoneFor as cfZoneFor,
} from "../src/lib/routes";
import { run } from "../src/lib/runner";

function die(msg: string): never {
  process.stderr.write(`route: ${msg}\n`);
  process.exit(1);
}

async function tunnelId(): Promise<string> {
  const r = await run(
    `grep '^tunnel:' "$HOME/.cloudflared/config.yml" 2>/dev/null | awk '{print $2}'`,
  );
  const id = r.output.trim();
  if (!id)
    die(
      "no tunnel in ~/.cloudflared/config.yml — run `cloudflared tunnel create` first",
    );
  return id;
}

/**
 * The zone that actually contains this hostname.
 *
 * The label walk lives in lib/routes so the panel and this CLI cannot disagree
 * about which zone a name belongs to — they used to hold separate copies.
 */
async function zoneFor(hostname: string): Promise<string> {
  const zone = await cfZoneFor(hostname);
  if (zone) return zone.name;

  const suffix = process.env.DOMAIN_SUFFIX;
  if (!suffix || suffix === "example.com") {
    die(
      `could not find a Cloudflare zone for ${hostname}. ` +
        "Check CF_API_TOKEN, or set DOMAIN_SUFFIX in the panel's .env.",
    );
  }
  return suffix;
}

/** A bare number is a local port; anything else is taken as a service URL. */
function toService(arg: string): string {
  if (/^\d+$/.test(arg)) return `http://localhost:${arg}`;
  return arg;
}

async function main() {
  const [cmd, a, b] = process.argv.slice(2);

  if (cmd === "list") {
    const cfg = await run(
      'cat "$HOME/.cloudflared/config.yml" 2>/dev/null || true',
    );
    const routes = parseIngress(cfg.output).filter((e) => e.hostname);
    if (!routes.length) {
      process.stdout.write("  no routes\n");
      return;
    }
    for (const r of routes) {
      const v = await verifyHostname(r.hostname as string);
      const mark = v.ok ? "ok " : "!! ";
      process.stdout.write(`  ${mark} ${r.hostname}  ->  ${r.service}\n`);
      if (!v.ok && v.reason) process.stdout.write(`       ${v.reason}\n`);
    }
    return;
  }

  if (cmd === "publish") {
    if (!a || !b) die("usage: route publish <hostname> <port|service>");
    const [id, zone] = await Promise.all([tunnelId(), zoneFor(a)]);
    const r = await publish(realEffects(id), {
      hostname: a,
      service: toService(b),
      zone,
    });
    if (r.ok) {
      process.stdout.write(
        r.unchanged
          ? `  ${a} was already published and answers\n`
          : `  published https://${a} -> ${toService(b)}\n`,
      );
      return;
    }
    // The reason is the point. "failed" alone sends people to the logs.
    process.stderr.write(
      `  could not publish ${a}\n  ${r.reason ?? "unknown"}\n`,
    );
    if (r.rolledBack)
      process.stderr.write("  the previous configuration was restored\n");
    process.exit(1);
  }

  if (cmd === "unpublish") {
    if (!a) die("usage: route unpublish <hostname>");
    const r = await unpublish(realEffects(await tunnelId()), a);
    if (r.ok) {
      process.stdout.write(
        r.unchanged ? `  ${a} was not published\n` : `  removed ${a}\n`,
      );
      return;
    }
    process.stderr.write(
      `  could not remove ${a}\n  ${r.reason ?? "unknown"}\n`,
    );
    process.exit(1);
  }

  die(
    `unknown command: ${cmd ?? "(none)"}\nusage: route <publish|unpublish|list>`,
  );
}

main().catch((e) => die((e as Error).message));
