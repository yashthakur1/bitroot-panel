// What is true about the machine this panel is running on.
//
// Every "why does it show localhost" bug had the same shape: a value the panel
// could have measured was instead assumed — baked into the browser bundle at
// build time from a string in .env that some other file had to spell the same
// way. `NEXT_PUBLIC_TAILNET_IP` in a component and `NEXT_PUBLIC_TAILNET_HOST` in
// .env never matched, so the panel fell back to 127.0.0.1 and told the operator
// their database was at localhost. Nothing failed. It just quietly lied.
//
// So: measure, do not assume. Every field here is detected from the machine, and
// null means "this machine does not have that" — never a plausible-looking
// default. A caller that gets null must say so rather than print a URL that
// cannot work.

import { run, runCached } from './runner';

export interface Facts {
  /** MagicDNS name, without the trailing dot. Null when Tailscale is absent. */
  tailnetHost: string | null;
  /** Hostnames the Cloudflare tunnel actually serves right now. */
  routedHosts: string[];
  /** Suffix used to build public names for new services. */
  domainSuffix: string | null;
  /** 'android' under Termux, otherwise 'linux'. Decides which probes make sense. */
  platform: 'android' | 'linux';
  /** True when a tunnel is configured AND connected. */
  tunnelUp: boolean;
}

/** Is this Termux on Android, or an ordinary Linux box? */
async function detectPlatform(): Promise<Facts['platform']> {
  // getprop exists only on Android. device-info assumed it always did, which is
  // why the Device tab was a column of empty fields on a Linux server.
  const r = await runCached('command -v getprop >/dev/null 2>&1 && echo android || echo linux', 30_000);
  return r.output.trim() === 'android' ? 'android' : 'linux';
}

/**
 * The tailnet name, from Tailscale itself.
 *
 * jq rather than a regex over the JSON: tailscale prints `"DNSName": "…"` with a
 * space after the colon, and the first DNSName in the document belongs to a peer
 * on any host whose own entry is not printed first. The installer got both wrong.
 */
async function detectTailnetHost(): Promise<string | null> {
  const r = await runCached(
    `tailscale status --json 2>/dev/null | jq -r '.Self.DNSName // empty' 2>/dev/null`,
    30_000,
  );
  const host = r.output.trim().replace(/\.$/, '');
  return host || null;
}

/** Hostnames the tunnel serves, read from the config it is actually running. */
async function detectRoutedHosts(): Promise<string[]> {
  const r = await runCached(
    `grep -E '^\\s*-?\\s*hostname:' "$HOME/.cloudflared/config.yml" 2>/dev/null | sed -E 's/.*hostname:\\s*//' || true`,
    30_000,
  );
  return r.output.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** Connected, not merely configured. A tunnel with no edge connection serves nothing. */
async function detectTunnelUp(): Promise<boolean> {
  const r = await run(
    `pm2 jlist 2>/dev/null | node -e '` +
      `let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{` +
      `try{const a=JSON.parse(s).find(x=>x.name==="cloudflared");` +
      `console.log(a&&a.pm2_env&&a.pm2_env.status==="online"?"up":"down")}` +
      `catch(e){console.log("down")}})'`,
    20_000,
  );
  return r.output.trim() === 'up';
}

export async function getFacts(): Promise<Facts> {
  const [tailnetHost, routedHosts, platform, tunnelUp] = await Promise.all([
    detectTailnetHost(),
    detectRoutedHosts(),
    detectPlatform(),
    detectTunnelUp(),
  ]);
  const suffix = process.env.DOMAIN_SUFFIX;
  return {
    tailnetHost,
    routedHosts,
    // 'example.com' is the installer's placeholder, not a configured domain.
    domainSuffix: suffix && suffix !== 'example.com' ? suffix : null,
    platform,
    tunnelUp,
  };
}

/**
 * The public URL for a service, or null.
 *
 * Null when the hostname is not actually routed. The panel used to build this
 * name from the suffix and show it whatever the state of the world, so operators
 * clicked links to hostnames that had never been created — the PocketBase link,
 * the bucket link, and the panel's own address all failed this way.
 */
export function publicUrlFor(name: string, facts: Facts): string | null {
  if (!facts.domainSuffix) return null;
  const host = `${name}.${facts.domainSuffix}`;
  return facts.routedHosts.includes(host) ? `https://${host}` : null;
}

/** The tailnet URL for a local port, or null when there is no tailnet. */
export function tailnetUrlFor(port: number, facts: Facts): string | null {
  return facts.tailnetHost ? `http://${facts.tailnetHost}:${port}` : null;
}
