import { NextRequest, NextResponse } from 'next/server';
import { run, runWithInput } from '@/lib/runner';
import { applyEnvEdits, EnvFormatError, looksSecret, parseEnv } from '@/lib/env';
import {
  assertEnvKey,
  assertEnvValue,
  assertName,
  shq,
  ValidationError,
} from '@/lib/validate';

const envPath = (name: string) => `$HOME/Downloads/${name}/.env`;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const name = assertName((await params).name);
    const r = await run(`cat "${envPath(name)}" 2>/dev/null || true`);
    const vars = parseEnv(r.output).map((v) => ({
      ...v,
      secret: looksSecret(v.key),
    }));
    return NextResponse.json({ vars });
  } catch (e) {
    // A value the .env format cannot carry is the caller's problem, not a fault.
    const bad = e instanceof ValidationError || e instanceof EnvFormatError;
    return NextResponse.json({ error: (e as Error).message }, { status: bad ? 400 : 500 });
  }
}

/**
 * Upsert env vars, and optionally restart the project so they take effect.
 *
 * Three things this deliberately does NOT do any more:
 *
 *   * It does not pass values as command arguments. `project env NAME KEY=value`
 *     put every value in an argv, readable by anything on the device via `ps`.
 *     The whole file now travels on stdin; the command line carries only the
 *     project name.
 *
 *   * It does not edit the file with `sed`. `project env` ran
 *     `sed -i "s/^${key}=.*&sol;${key}=${val}/"`, so any `/`, `&` or `\` in a value
 *     corrupted the file — `DATABASE_URL=postgres://user:pass@host/db` was enough
 *     to break it. Edits are computed in Node and the finished file is written
 *     atomically.
 *
 *   * It does not report success merely because the file was written. pm2 replays
 *     the environment captured when a process was created and never re-reads
 *     .env, so a plain `pm2 restart` leaves the new value on disk and invisible —
 *     which is exactly what the Devices page has been warning about. After a
 *     restart the running process is inspected, and any key that did not actually
 *     land comes back in `missing`.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const name = assertName((await params).name);
    const body = await req.json();
    const incoming: Array<{ key: string; value: string | null }> = body.vars ?? [];

    if (!Array.isArray(incoming) || incoming.length === 0) {
      return NextResponse.json({ error: 'no vars provided' }, { status: 400 });
    }

    // Validate everything before touching the file, so a bad key in position 9
    // cannot leave the first eight written.
    const changes = incoming.map((v) => ({
      key: assertEnvKey(v.key),
      value: v.value === null ? null : assertEnvValue(v.value),
    }));

    const current = await run(`cat "${envPath(name)}" 2>/dev/null || true`);
    const next = applyEnvEdits(current.output, changes);

    // umask before the redirect so the file is never briefly world-readable, and
    // a rename so a failed write cannot truncate a working .env.
    const write = await runWithInput(
      `d="$HOME/Downloads/${name}"; [ -d "$d" ] || { echo "no such project: ${name}" >&2; exit 1; }; ` +
        `umask 077; cat > "$d/.env.tmp" && mv "$d/.env.tmp" "$d/.env" && echo "wrote $d/.env"`,
      next,
      60_000,
    );

    if (!write.ok) {
      return NextResponse.json({ ok: false, output: write.output }, { status: 500 });
    }

    if (!body.restart) {
      return NextResponse.json({ ok: true, output: write.output, restarted: false });
    }

    // pm2 --update-env copies the environment of the pm2 CLI process into the app,
    // so the values have to be in *this* command's shell. They arrive on stdin as
    // `export K='v'` lines quoted with shq, which sh parses literally: no glob, no
    // `$` expansion, and newlines survive. Sourcing the raw .env instead — as
    // panel-restart does — would hand `KEY="a b"` to the app with the quotes still
    // attached, and cannot express a multi-line value at all.
    const exports = changes
      .filter((c) => c.value !== null)
      .map((c) => `export ${c.key}=${shq(c.value as string)}`)
      .join('\n');

    const restart = await runWithInput(
      `eval "$(cat)"; pm2 restart ${shq(name)} --update-env`,
      exports,
      90_000,
    );

    // Confirm rather than assume. Only key NAMES are read back — printing values
    // would put them in this process's output and, from there, into logs.
    const keys = changes.filter((c) => c.value !== null).map((c) => c.key);
    const probe = await run(
      `pm2 jlist 2>/dev/null | node -e '` +
        `let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{` +
        `try{const a=JSON.parse(s).find(x=>x.name===process.argv[1]);` +
        `const e=(a&&a.pm2_env)||{};` +
        `console.log(process.argv.slice(2).filter(k=>e[k]!==undefined).join(","))}` +
        `catch(err){console.log("")}})' ${shq(name)} ${keys.map(shq).join(' ')}`,
      30_000,
    );

    const applied = probe.output.split(',').filter(Boolean);
    const missing = keys.filter((k) => !applied.includes(k));

    return NextResponse.json({
      ok: restart.ok && missing.length === 0,
      restarted: true,
      applied,
      missing,
      output: [write.output, restart.output].filter(Boolean).join('\n'),
      ...(missing.length
        ? {
            warning:
              `${missing.length} variable(s) were written to .env but are not in the ` +
              `running process. The app may read .env itself at startup, in which case ` +
              `this is harmless; otherwise it needs a full stop/start rather than a restart.`,
          }
        : {}),
    });
  } catch (e) {
    // A value the .env format cannot carry is the caller's problem, not a fault.
    const bad = e instanceof ValidationError || e instanceof EnvFormatError;
    return NextResponse.json({ error: (e as Error).message }, { status: bad ? 400 : 500 });
  }
}
