import { NextRequest, NextResponse } from 'next/server';
import { run } from '@/lib/runner';
import { startUpdate, updateLog, versionInfo } from '@/lib/version';
import { syncWebRootDomain } from '@/lib/garage-config';

export const dynamic = 'force-dynamic';

// Things the panel knows how to do, rather than describe. Asking someone to
// uncomment two lines in a YAML file — when the panel can read the tunnel id
// off disk and write them itself — is where this flow stalled.
const ACTIONS: Record<string, { label: string; script: string; timeout?: number }> = {
  // Writes tunnel: and credentials-file: from whatever credentials file exists,
  // dropping any previous or commented-out pair, and leaves ingress untouched.
  'link-tunnel': {
    label: 'link tunnel',
    script: `
      set -e
      cred="$(ls -1 "$HOME"/.cloudflared/*.json 2>/dev/null | head -1)"
      [ -n "$cred" ] || { echo "no tunnel credentials found — run: cloudflared tunnel create \\$(hostname)" >&2; exit 1; }
      uuid="$(basename "$cred" .json)"
      cfg="$HOME/.cloudflared/config.yml"
      [ -f "$cfg" ] || { echo "no config.yml at $cfg" >&2; exit 1; }
      cp "$cfg" "$cfg.bak"
      tmp="$(mktemp)"
      {
        echo "tunnel: $uuid"
        echo "credentials-file: $cred"
        echo
        grep -vE '^[[:space:]]*#?[[:space:]]*(tunnel|credentials-file):' "$cfg"
      } > "$tmp"
      mv "$tmp" "$cfg"
      echo "linked $uuid"
    `,
  },
  'start-tunnel': {
    label: 'start cloudflared',
    script: `
      set -e
      uuid="$(grep -E '^[[:space:]]*tunnel:' "$HOME/.cloudflared/config.yml" | awk '{print $2}')"
      [ -n "$uuid" ] || { echo "config.yml does not name a tunnel yet" >&2; exit 1; }
      pm2 restart cloudflared >/dev/null 2>&1 || \
        pm2 start cloudflared --name cloudflared -- tunnel run "$uuid"
      pm2 save >/dev/null 2>&1 || true
      echo "cloudflared running $uuid"
    `,
    timeout: 60_000,
  },
};

export async function GET() {
  // The update runs detached, so its progress is read from the log rather than
  // held open on the request that started it.
  return NextResponse.json({ log: await updateLog() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  if (body.action === 'update-panel') {
    // Forced: this is a deliberate request to update, and refusing it against
    // an hour-old cache is how "already on the latest release" gets said to
    // someone looking at a newer one.
    const v = await versionInfo(true);
    if (!v.latest || !v.updateAvailable) {
      return NextResponse.json({ error: 'already on the latest release' }, { status: 400 });
    }
    try {
      await startUpdate(v.latest);
      // 202: the work outlives this request, and the process serving it is the
      // one that will be restarted at the end.
      return NextResponse.json({ ok: true, started: true, target: v.latest }, { status: 202 });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  if (body.action === 'sync-garage-domain') {
    const domain = process.env.DOMAIN_SUFFIX;
    if (!domain || domain === 'example.com') {
      return NextResponse.json({ error: 'no domain is set' }, { status: 400 });
    }
    const r = await syncWebRootDomain(domain);
    return NextResponse.json(r.ok ? { ok: true, output: r.message } : { error: r.message }, {
      status: r.ok ? 200 : 500,
    });
  }

  const action = ACTIONS[String(body.action ?? '')];
  if (!action) {
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }

  const r = await run(action.script, action.timeout ?? 30_000);
  if (!r.ok) {
    // The script's own message is the useful part; run() falls back to the
    // command text when there is nothing else, which reads like noise.
    const detail = r.output.startsWith('Command failed') ? '' : `: ${r.output.trim()}`;
    return NextResponse.json({ error: `could not ${action.label}${detail}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, output: r.output.trim() });
}
