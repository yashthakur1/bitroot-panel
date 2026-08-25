import { NextRequest, NextResponse } from "next/server";
import { parseIngress, portOf } from "@/lib/routes";
import { run, runStream } from "@/lib/runner";
import {
  assertHostname,
  assertName,
  assertPort,
  assertRepo,
  shq,
  ValidationError,
} from "@/lib/validate";
import { assertBranch, assertRepoFullName, getGithubToken } from "@/lib/github";
import { assertConnectionId, cloneUrlFor } from "@/lib/git-connections";
import { attachDomain, createPagesProject } from "@/lib/pages";

const DOMAIN_SUFFIX = process.env.DOMAIN_SUFFIX ?? "example.com";

// The build command is executed on the server. An authenticated admin can
// already run arbitrary code via a repo's package scripts, so this is not a
// new capability — but disallow shell metacharacters so a typo can't chain
// commands.
function assertBuildCmd(cmd: unknown): string {
  if (cmd === undefined || cmd === null || cmd === "") return "";
  if (
    typeof cmd !== "string" ||
    cmd.length > 120 ||
    !/^[\w @./:=-]+$/.test(cmd)
  ) {
    throw new ValidationError(
      "build command may only contain letters, digits, spaces and - _ . / : = @",
    );
  }
  return cmd;
}

function assertOutDir(dir: unknown): string {
  if (
    typeof dir !== "string" ||
    !/^[\w./-]{1,60}$/.test(dir) ||
    dir.includes("..")
  ) {
    throw new ValidationError("invalid output directory");
  }
  return dir;
}

export async function GET() {
  const [list, cfg] = await Promise.all([
    run("static-site list 2>/dev/null || true"),
    run('cat "$HOME/.cloudflared/config.yml" 2>/dev/null || true'),
  ]);

  // Match routes to sites by PORT, not by name. A hostname is free to differ
  // from the site name (parenthing-website → parenthing-website-waitlist), and
  // assuming they match meant a routed site kept showing as private.
  const portToHosts: Record<number, string[]> = {};
  // parseIngress, not another copy. Same flaw as the others: matching only
  // `://localhost:` hid any route pointing at 127.0.0.1, so a published site
  // showed as private.
  for (const e of parseIngress(cfg.output)) {
    if (!e.hostname) continue;
    const port = portOf(e.service);
    if (port !== null) (portToHosts[port] ??= []).push(e.hostname);
  }

  const sites = list.output
    .split("\n")
    .map((line) => line.split("|"))
    .filter((p) => p.length === 5 && p[0])
    .map(([name, port, size, state, branch]) => {
      const hosts = portToHosts[Number(port)] ?? [];
      return {
        name,
        port: Number(port),
        size,
        served: state === "served",
        branch,
        url: hosts.length > 0 ? `https://${hosts[0]}` : null,
        // a port can carry several hostnames; the detail page shows them all
        urls: hosts.map((h) => `https://${h}`),
      };
    });

  return NextResponse.json({ sites });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = assertName(body.name);
    // A Pages site has no local listener, so demanding a port would reject
    // a valid request and reserve a number nothing is listening on.
    const port = body.destination === "pages" ? 0 : assertPort(body.port);
    const branch = body.branch ? assertBranch(body.branch) : "";
    const buildCmd = assertBuildCmd(body.buildCmd);
    const outDir = assertOutDir(body.outDir ?? "dist");
    const internal = body.environment === "private";

    let repoUrl: string;
    if (body.source === "github") {
      const full = assertRepoFullName(body.repo);
      if (!(await getGithubToken())) {
        return NextResponse.json(
          { error: "GitHub not connected" },
          { status: 400 },
        );
      }
      // Pin the connection so git picks that account's stored credential.
      const connectionId = body.connectionId
        ? assertConnectionId(body.connectionId)
        : undefined;
      repoUrl = connectionId
        ? cloneUrlFor(connectionId, full)
        : `https://github.com/${full}.git`;
    } else {
      repoUrl = assertRepo(body.repo);
    }

    // Cloudflare Pages: no shell, no build, no stream. Cloudflare clones and
    // builds the repo itself, so this device does nothing beyond making the
    // call — which is the whole reason to offer it on a phone.
    if (body.destination === "pages") {
      if (body.source !== "github") {
        return NextResponse.json(
          {
            error:
              "Pages builds from a connected GitHub repository — pick one above.",
          },
          { status: 400 },
        );
      }
      const domain = body.domain ? assertHostname(String(body.domain)) : "";
      const project = await createPagesProject({
        name,
        repo: assertRepoFullName(body.repo),
        branch,
        buildCmd,
        outDir,
      });
      // A failed custom domain must not read as a failed deploy: the site is
      // already live on pages.dev at this point.
      let domainError = "";
      if (domain) {
        try {
          await attachDomain(name, domain);
        } catch (e) {
          domainError = (e as Error).message;
        }
      }
      return NextResponse.json({
        ok: true,
        destination: "pages",
        url: project.url,
        domain: domain || undefined,
        domainError: domainError || undefined,
      });
    }

    const cmd =
      `BUILD_CMD=${shq(buildCmd)} OUT_DIR=${shq(outDir)} GIT_TERMINAL_PROMPT=0 ` +
      `static-site create ${name} ${port} ${shq(repoUrl)} ${shq(branch)}` +
      (internal ? " --no-tunnel" : "");

    return new Response(runStream(cmd, 900_000), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
