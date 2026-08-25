import { NextRequest, NextResponse } from "next/server";
import { parseIngress } from "@/lib/routes";
import { run, runCached } from "@/lib/runner";
import { assertName, shq, ValidationError } from "@/lib/validate";
import { dismissResidue, readLedger } from "@/lib/residue";
import {
  deleteDnsRecord,
  dnsConfigured,
  listTunnelRecords,
} from "@/lib/cloudflare";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ResidueItem {
  id: string;
  category: string;
  label: string;
  detail: string;
  size: string;
  hint?: string;
  manual?: boolean;
  action?: { type: string; target: string; danger: string };
}

const SCAN = [
  'echo "##project_dirs"',
  'for d in "$HOME"/Downloads/*/; do [ -d "$d" ] || continue; printf "%s|%s\\n" "$(basename "$d")" "$(du -sh "$d" 2>/dev/null | cut -f1)"; done',
  'echo "##app_dirs"',
  'for d in "$HOME"/apps/*/; do [ -d "$d" ] || continue; n=$(basename "$d"); [ "$n" = "static" ] && continue; printf "%s|%s\\n" "$n" "$(du -sh "$d" 2>/dev/null | cut -f1)"; done',
  'echo "##remotes"',
  'for d in "$HOME"/Downloads/*/ "$HOME"/apps/*/; do [ -d "$d.git" ] || [ -d "$d/.git" ] || continue; printf "%s|%s\\n" "$(basename "$d")" "$(git -C "$d" remote get-url origin 2>/dev/null)"; done',
  'echo "##repos"',
  'for d in "$HOME"/repos/*.git; do [ -d "$d" ] || continue; printf "%s|%s\\n" "$(basename "$d" .git)" "$(du -sh "$d" 2>/dev/null | cut -f1)"; done',
  'echo "##backups"',
  'for f in "$HOME"/backups/*.tar.gz; do [ -f "$f" ] || continue; printf "%s|%s|%s\\n" "$(basename "$f")" "$(du -h "$f" | cut -f1)" "$(date -r "$f" +%Y-%m-%d)"; done',
  'echo "##pm2logs"',
  'du -sh "$HOME/.pm2/logs" 2>/dev/null | cut -f1',
  'echo "##npmcache"',
  'du -sh "$HOME/.npm/_cacache" 2>/dev/null | cut -f1',
  'echo "##gocache"',
  'du -sh "$HOME/go/pkg/mod" 2>/dev/null | cut -f1',
  'echo "##bakfiles"',
  'for f in "$HOME"/bin/*.bak*; do [ -f "$f" ] || continue; printf "%s|%s\\n" "$(basename "$f")" "$(du -h "$f" | cut -f1)"; done',
  'echo "##ports"',
  'cat "$HOME/bin/ports.conf" 2>/dev/null | grep -E "^[a-zA-Z0-9_-]+=[0-9]+$" || true',
  'echo "##listening"',
  // Android blocks netlink, so ss sees nothing; probe each registered port.
  'for e in $(grep -E "^[a-zA-Z0-9_-]+=[0-9]+$" "$HOME/bin/ports.conf" 2>/dev/null); do p=${e#*=}; (timeout 1 bash -c "</dev/tcp/127.0.0.1/$p" 2>/dev/null && echo "$p") & done; wait',
  'echo "##tmp"',
  'for e in "$HOME"/tmp/*; do [ -e "$e" ] || continue; printf "%s|%s\\n" "$(basename "$e")" "$(du -sh "$e" 2>/dev/null | cut -f1)"; done',
  'echo "##static_dirs"',
  'for d in "$HOME"/apps/static/*/; do [ -d "$d" ] || continue; n=$(basename "$d"); [ -f "$HOME/etc/nginx/sites/$n.conf" ] && continue; printf "%s|%s\\n" "$n" "$(du -sh "$d" 2>/dev/null | cut -f1)"; done',
  'echo "##dnscreated"',
  'cat "$HOME/.config/bitpanel/dns-created.txt" 2>/dev/null || true',
  'echo "##routes"',
  'grep -E "hostname:|service:" "$HOME/.cloudflared/config.yml" 2>/dev/null || true',
].join("; ");

function section(out: string, name: string): string[] {
  const parts = out.split(/^##/m);
  const found = parts.find((p) => p.startsWith(name));
  if (!found) return [];
  return found
    .slice(name.length)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export async function GET() {
  const [scan, pm2, ledger] = await Promise.all([
    run(SCAN, 120_000),
    runCached("pm2 jlist"),
    readLedger(),
  ]);

  let apps: any[] = [];
  try {
    const start = pm2.output.indexOf("[");
    if (start >= 0) apps = JSON.parse(pm2.output.slice(start));
  } catch {
    // ignore
  }
  const pm2Names = new Set(apps.map((a) => a.name));
  const runningNames = new Set(
    apps.filter((a) => a.pm2_env?.status === "online").map((a) => a.name),
  );

  const out = scan.output;
  const items: ResidueItem[] = [];

  const registeredPorts: Record<string, number> = {};
  for (const line of section(out, "ports")) {
    const [n, p] = line.split("=");
    if (n && p) registeredPorts[n] = Number(p);
  }

  const listening = new Set<number>(
    section(out, "listening")
      .map((l) => Number(l.trim()))
      .filter((n) => Number.isInteger(n) && n > 0),
  );

  // Whether a directory's code still lives on a git remote decides how
  // consequential deleting it is — surface that in the item detail.
  const remotes: Record<string, string> = {};
  for (const line of section(out, "remotes")) {
    const [name, url] = line.split("|");
    if (name && url) remotes[name] = url;
  }
  const backedUp = (name: string) =>
    remotes[name]
      ? `Code is on ${remotes[name].replace(/^https:\/\//, "").replace(/\.git$/, "")} — deleting only frees local space.`
      : "No git remote found — this may be the only copy of the code.";

  // The shared parser, on the grepped lines. The last place that read this
  // format with its own regex — five routes had five of them, each with its own
  // blind spots.
  const routedHosts = parseIngress(section(out, "routes").join("\n"))
    .map((e) => e.hostname)
    .filter((h): h is string => Boolean(h));

  // 1. Project directories with no pm2 process and no port registration
  for (const line of section(out, "project_dirs")) {
    const [name, size] = line.split("|");
    if (!name) continue;
    if (pm2Names.has(name) || registeredPorts[name]) continue;
    items.push({
      id: `projdir-${name}`,
      category: "Orphaned project files (legacy location)",
      label: `~/Downloads/${name}`,
      detail: `In the old ~/Downloads location with no pm2 process and no port registration. ${backedUp(name)}`,
      size: size ?? "?",
      action: {
        type: "rm-project-dir",
        target: name,
        danger: `Permanently deletes ~/Downloads/${name} including any local .env`,
      },
      hint: "Keep it if you may redeploy this project; the panel will reuse the directory.",
    });
  }

  // 2. App directories (git-push deploys) with no pm2 process
  for (const line of section(out, "app_dirs")) {
    const [name, size] = line.split("|");
    if (!name || pm2Names.has(name)) continue;
    items.push({
      id: `appdir-${name}`,
      category: "Orphaned app files",
      label: `~/apps/${name}`,
      detail: `Deployed via git push but no pm2 process is registered for it. ${backedUp(name)}`,
      size: size ?? "?",
      action: {
        type: "rm-app-dir",
        target: name,
        danger: `Permanently deletes ~/apps/${name} including its .env`,
      },
      hint: "If this was a git-push app, its deploy repo under ~/repos may also be listed below.",
    });
  }

  // 2b. Static sites whose nginx vhost is gone
  for (const line of section(out, "static_dirs")) {
    const [name, size] = line.split("|");
    if (!name) continue;
    items.push({
      id: `staticdir-${name}`,
      category: "Orphaned static sites",
      label: `~/apps/static/${name}`,
      detail: `Removed from nginx, so nothing serves it — the source and built files remain. ${backedUp(name)}`,
      size: size ?? "?",
      hint: "Deleting frees the space; keeping it lets you re-create the site without cloning again.",
      action: {
        type: "rm-static-dir",
        target: name,
        danger: `Permanently deletes ~/apps/static/${name} (source and build output)`,
      },
    });
  }

  // 3. Bare repos whose app no longer exists
  const appDirs = new Set(
    section(out, "app_dirs")
      .map((l) => l.split("|")[0])
      .filter(Boolean),
  );
  for (const line of section(out, "repos")) {
    const [name, size] = line.split("|");
    if (!name || appDirs.has(name)) continue;
    items.push({
      id: `repo-${name}`,
      category: "Orphaned deploy repos",
      label: `~/repos/${name}.git`,
      detail: "Bare git remote whose working copy under ~/apps is gone.",
      size: size ?? "?",
      action: {
        type: "rm-repo",
        target: name,
        danger: `Deletes the bare repo — pushing to the deploy remote for ${name} stops working`,
      },
      hint: "Only delete once you are sure you will not push to this app again.",
    });
  }

  // 4. Ports registered but nothing running or listening
  for (const [name, port] of Object.entries(registeredPorts)) {
    if (runningNames.has(name) || listening.has(port)) continue;
    items.push({
      id: `port-${name}`,
      category: "Stale port registrations",
      label: `${name} = ${port}`,
      detail:
        "Reserved in ports.conf but nothing is running or listening on it.",
      size: "—",
      action: {
        type: "deregister-port",
        target: name,
        danger: `Frees port ${port} in ports.conf (no files touched)`,
      },
      hint: "Safe to free — the reservation is only used to stop two services claiming one port.",
    });
  }

  // 5. DNS records pointing at the tunnel with no ingress rule behind them.
  // Read from Cloudflare directly, so records created outside the panel are
  // caught too — and deletable now that the token carries DNS write.
  const routedSet = new Set(routedHosts);
  if (dnsConfigured()) {
    try {
      for (const rec of await listTunnelRecords()) {
        if (routedSet.has(rec.name)) continue;
        items.push({
          id: `dns-${rec.name}`,
          category: "Cloudflare DNS records",
          label: rec.name,
          detail:
            "CNAME points at your tunnel but no ingress rule serves it — visitors get a 404.",
          size: "—",
          hint: "Deleting removes the record from Cloudflare. Publishing a service on this hostname later recreates it automatically.",
          action: {
            type: "delete-dns",
            target: rec.id,
            danger: `Deletes the ${rec.name} CNAME from Cloudflare`,
          },
        });
      }
    } catch {
      // DNS unreachable or token lacks access — fall back to the local record
      for (const host of section(out, "dnscreated")) {
        if (!host.includes(".") || routedSet.has(host)) continue;
        items.push({
          id: `dns-${host}`,
          category: "Cloudflare DNS records",
          label: host,
          detail:
            "CNAME likely still points at your tunnel with nothing serving it.",
          size: "—",
          manual: true,
          hint: "Could not reach the Cloudflare API — delete it in the dashboard (DNS → Records), then dismiss this.",
          action: {
            type: "forget-dns",
            target: host,
            danger: "Only stops BitPanel tracking this hostname",
          },
        });
      }
    }
  }

  // 6. Backups (informational; oldest are candidates for pruning)
  const backups = section(out, "backups");
  for (const line of backups) {
    const [file, size, date] = line.split("|");
    if (!file) continue;
    const ageDays = (Date.now() - new Date(date).getTime()) / 86_400_000;
    if (ageDays < 8) continue;
    items.push({
      id: `backup-${file}`,
      category: "Old backups",
      label: `~/backups/${file}`,
      detail: `Created ${date} — older than the 7-day rolling window.`,
      size: size ?? "?",
      action: {
        type: "rm-backup",
        target: file,
        danger: "Deletes this archive permanently",
      },
    });
  }

  // 5b. Scratch space: anything left in ~/tmp by a download, build workspace
  // or test run. Nothing here is load-bearing — the tools that use it recreate
  // what they need.
  for (const line of section(out, "tmp")) {
    const [name, size] = line.split("|");
    if (!name) continue;
    items.push({
      id: `tmp-${name}`,
      category: "Temporary files",
      label: `~/tmp/${name}`,
      detail: "Scratch space from a download, build workspace or test run.",
      size: size ?? "?",
      hint: "Safe to delete — anything that needs it will recreate it.",
      action: {
        type: "rm-tmp",
        target: name,
        danger: `Deletes ~/tmp/${name}`,
      },
    });
  }

  // 6. Caches and logs that only ever grow
  const [pm2logs] = section(out, "pm2logs");
  if (pm2logs && pm2logs !== "0") {
    items.push({
      id: "pm2-logs",
      category: "Logs & caches",
      label: "pm2 logs",
      detail:
        "Accumulated stdout/stderr for every app. Flushing keeps apps running.",
      size: pm2logs,
      hint: "Flush after you have read anything you need — running apps keep logging normally.",
      action: {
        type: "flush-pm2-logs",
        target: "all",
        danger: "Truncates all pm2 log files",
      },
    });
  }
  const [npmCache] = section(out, "npmcache");
  if (npmCache) {
    items.push({
      id: "npm-cache",
      category: "Logs & caches",
      label: "npm cache",
      detail:
        "Rebuilt automatically on the next install — safe to clear, costs download time.",
      size: npmCache,
      hint: "Clearing costs nothing but slower first installs afterwards.",
      action: {
        type: "clean-npm-cache",
        target: "all",
        danger: "Clears the npm cache",
      },
    });
  }
  const [goCache] = section(out, "gocache");
  if (goCache) {
    items.push({
      id: "go-cache",
      category: "Logs & caches",
      label: "Go module cache",
      detail:
        "Only needed while rebuilding PocketBase; re-downloaded on the next upgrade.",
      size: goCache,
      hint: "Only needed during a PocketBase upgrade — it re-downloads automatically.",
      action: {
        type: "clean-go-cache",
        target: "all",
        danger: "Clears ~/go/pkg/mod",
      },
    });
  }

  // 7. Script backups left by panel-driven CLI edits
  for (const line of section(out, "bakfiles")) {
    const [file, size] = line.split("|");
    if (!file) continue;
    items.push({
      id: `bak-${file}`,
      category: "Script backups",
      label: `~/bin/${file}`,
      detail: "Snapshot of a CLI script taken before the panel modified it.",
      size: size ?? "?",
      action: {
        type: "rm-bak",
        target: file,
        danger: "Deletes the rollback copy of that script",
      },
      hint: "Keep the most recent one until you are happy the upgraded script behaves.",
    });
  }

  return NextResponse.json({ items, ledger, routedHosts });
}

const CLEANUPS: Record<string, (target: string) => string> = {
  "rm-project-dir": (t) => `rm -rf "$HOME/Downloads/${t}"`,
  "rm-app-dir": (t) => `rm -rf "$HOME/apps/${t}"`,
  "rm-repo": (t) => `rm -rf "$HOME/repos/${t}.git"`,
  "rm-static-dir": (t) => `rm -rf "$HOME/apps/static/${t}"`,
  "rm-tmp": (t) => `rm -rf "$HOME/tmp/"${shq(t)}`,
  "deregister-port": (t) => `sed -i "/^${t}=/d" "$HOME/bin/ports.conf"`,
  "rm-backup": (t) => `rm -f "$HOME/backups/"${shq(t)}`,
  "rm-bak": (t) => `rm -f "$HOME/bin/"${shq(t)}`,
  "forget-dns": (t) =>
    `sed -i "/^${t.replace(/\./g, "\\.")}$/d" "$HOME/.config/bitpanel/dns-created.txt"`,
  "flush-pm2-logs": () => "pm2 flush",
  "clean-npm-cache": () => "npm cache clean --force",
  "clean-go-cache": () => "go clean -modcache",
};

// Cleanup. Directory removals re-verify the target is genuinely orphaned
// immediately before deleting — the scan result may be minutes old.
export async function POST(req: NextRequest) {
  try {
    const { type, target } = await req.json();

    // Handled through the Cloudflare API rather than a shell command.
    if (type === "delete-dns") {
      if (typeof target !== "string" || !/^[a-f0-9]{32}$/.test(target)) {
        throw new ValidationError("invalid DNS record id");
      }
      await deleteDnsRecord(target);
      return NextResponse.json({ ok: true, output: "DNS record deleted." });
    }

    const build = CLEANUPS[type];
    if (!build) {
      return NextResponse.json(
        { error: "unknown cleanup action" },
        { status: 400 },
      );
    }

    let safeTarget = "all";
    if (
      [
        "rm-project-dir",
        "rm-app-dir",
        "rm-repo",
        "rm-static-dir",
        "deregister-port",
      ].includes(type)
    ) {
      safeTarget = assertName(target);
      const check = await runCached("pm2 jlist");
      try {
        const start = check.output.indexOf("[");
        const apps = JSON.parse(check.output.slice(start));
        if (apps.some((a: any) => a.name === safeTarget)) {
          return NextResponse.json(
            {
              error: `"${safeTarget}" is registered in pm2 — remove the service first`,
            },
            { status: 400 },
          );
        }
      } catch {
        return NextResponse.json(
          { error: "could not verify pm2 state" },
          { status: 500 },
        );
      }
    } else if (type === "rm-tmp") {
      if (
        typeof target !== "string" ||
        !/^[\w.-]{1,80}$/.test(target) ||
        target.includes("..")
      ) {
        throw new ValidationError("invalid temporary file name");
      }
      safeTarget = target;
    } else if (type === "forget-dns") {
      if (typeof target !== "string" || !/^[a-z0-9.-]{1,80}$/.test(target)) {
        throw new ValidationError("invalid hostname");
      }
      safeTarget = target;
    } else if (["rm-backup", "rm-bak"].includes(type)) {
      if (
        typeof target !== "string" ||
        !/^[\w.-]{1,80}$/.test(target) ||
        target.includes("..")
      ) {
        throw new ValidationError("invalid file name");
      }
      safeTarget = target;
    }

    const r = await run(build(safeTarget), 180_000);
    return NextResponse.json(
      { ok: r.ok, output: r.output },
      { status: r.ok ? 200 : 500 },
    );
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

// Dismiss a ledger entry once it has been dealt with (or accepted).
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id || !/^[\w-]{1,40}$/.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  await dismissResidue(id);
  return NextResponse.json({ ok: true });
}
