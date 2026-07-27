import { NextRequest, NextResponse } from 'next/server';
import { run, runStream } from '@/lib/runner';
import { assertName, assertPort, assertRepo, shq, ValidationError } from '@/lib/validate';
import { assertBranch, assertRepoFullName, getGithubToken } from '@/lib/github';

const DOMAIN_SUFFIX = process.env.DOMAIN_SUFFIX ?? 'bitroot.in';

// The build command is executed on the phone. An authenticated admin can
// already run arbitrary code via a repo's package scripts, so this is not a
// new capability — but disallow shell metacharacters so a typo can't chain
// commands.
function assertBuildCmd(cmd: unknown): string {
  if (cmd === undefined || cmd === null || cmd === '') return '';
  if (typeof cmd !== 'string' || cmd.length > 120 || !/^[\w @./:=-]+$/.test(cmd)) {
    throw new ValidationError(
      'build command may only contain letters, digits, spaces and - _ . / : = @',
    );
  }
  return cmd;
}

function assertOutDir(dir: unknown): string {
  if (typeof dir !== 'string' || !/^[\w./-]{1,60}$/.test(dir) || dir.includes('..')) {
    throw new ValidationError('invalid output directory');
  }
  return dir;
}

export async function GET() {
  const [list, cfg] = await Promise.all([
    run('static-site list 2>/dev/null || true'),
    run('cat "$HOME/.cloudflared/config.yml" 2>/dev/null || true'),
  ]);

  const routed = new Set(
    [...cfg.output.matchAll(/hostname:\s*([\w-]+)\./g)].map((m) => m[1]),
  );

  const sites = list.output
    .split('\n')
    .map((line) => line.split('|'))
    .filter((p) => p.length === 5 && p[0])
    .map(([name, port, size, state, branch]) => ({
      name,
      port: Number(port),
      size,
      served: state === 'served',
      branch,
      url: routed.has(name) ? `https://${name}.${DOMAIN_SUFFIX}` : null,
    }));

  return NextResponse.json({ sites });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = assertName(body.name);
    const port = assertPort(body.port);
    const branch = body.branch ? assertBranch(body.branch) : '';
    const buildCmd = assertBuildCmd(body.buildCmd);
    const outDir = assertOutDir(body.outDir ?? 'dist');
    const internal = body.environment === 'private';

    let repoUrl: string;
    if (body.source === 'github') {
      const full = assertRepoFullName(body.repo);
      if (!(await getGithubToken())) {
        return NextResponse.json({ error: 'GitHub not connected' }, { status: 400 });
      }
      repoUrl = `https://github.com/${full}.git`;
    } else {
      repoUrl = assertRepo(body.repo);
    }

    const cmd =
      `BUILD_CMD=${shq(buildCmd)} OUT_DIR=${shq(outDir)} GIT_TERMINAL_PROMPT=0 ` +
      `static-site create ${name} ${port} ${shq(repoUrl)} ${shq(branch)}` +
      (internal ? ' --no-tunnel' : '');

    return new Response(runStream(cmd, 900_000), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
