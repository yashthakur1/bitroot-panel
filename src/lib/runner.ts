import { execFile, spawn } from 'child_process';
import os from 'os';

// Executes a command on the OnePlus server.
//
// EXEC_MODE=local  — the panel runs on the phone itself; commands run directly.
// EXEC_MODE=ssh    — the panel runs elsewhere (e.g. dev on a laptop) and
//                    reaches the phone via SSH over Tailscale.
//
// Callers must only pass commands composed from validated tokens (see validate.ts).

const MODE = process.env.EXEC_MODE === 'ssh' ? 'ssh' : 'local';

export interface RunResult {
  ok: boolean;
  output: string;
}

function buildArgv(wrapped: string): string[] {
  if (MODE === 'ssh') {
    const key = process.env.SSH_KEY ?? `${os.homedir()}/.ssh/id_ed25519`;
    const host = process.env.PHONE_HOST ?? '127.0.0.1';
    const port = process.env.PHONE_SSH_PORT ?? '8022';
    return [
      'ssh',
      '-i', key,
      '-p', port,
      '-o', 'IdentitiesOnly=yes',
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',
      `user@${host}`,
      wrapped,
    ];
  }
  return ['sh', '-c', wrapped];
}

function childEnv(): NodeJS.ProcessEnv {
  return MODE === 'ssh'
    ? process.env
    : { ...process.env, PATH: `${os.homedir()}/bin:${process.env.PATH}` };
}

export function run(command: string, timeoutMs = 30_000): Promise<RunResult> {
  // `export` rather than a prefix assignment: a prefix only works before a
  // simple command, and would be a syntax error before `for`/`if`/`while`.
  const wrapped = `export PATH="$HOME/bin:$PATH"; ${command}`;
  const argv = buildArgv(wrapped);

  return new Promise((resolve) => {
    execFile(
      argv[0],
      argv.slice(1),
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, env: childEnv() },
      (err, stdout, stderr) => {
        const output = [stdout, stderr].filter(Boolean).join('\n').trim();
        resolve({ ok: !err, output: output || (err ? err.message : '') });
      },
    );
  });
}

// Short-lived cache for read-only commands that several pages ask for at once
// (`pm2 jlist` above all). Spawning the pm2 CLI is the most expensive thing the
// panel does routinely, so collapsing concurrent callers matters on a phone.
const cache = new Map<string, { at: number; result: Promise<RunResult> }>();

export function runCached(command: string, ttlMs = 3000): Promise<RunResult> {
  const hit = cache.get(command);
  if (hit && Date.now() - hit.at < ttlMs) return hit.result;
  const result = run(command);
  cache.set(command, { at: Date.now(), result });
  return result;
}

// Raw byte stream of a file under $HOME on the phone. Unlike runStream this
// adds no heartbeats or exit markers — anything injected would corrupt a
// binary payload. The caller must have validated the path.
export function readHomeFile(relativePath: string): ReadableStream<Uint8Array> {
  const argv = buildArgv(`cat "$HOME/${relativePath}"`);
  const child = spawn(argv[0], argv.slice(1), { env: childEnv() });

  return new ReadableStream({
    start(controller) {
      child.stdout?.on('data', (d: Buffer) => {
        try {
          controller.enqueue(new Uint8Array(d));
        } catch {
          // client went away
        }
      });
      child.on('error', () => {
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
      child.on('close', () => {
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      child.kill();
    },
  });
}

// Streaming variant: returns the command's combined stdout/stderr as a web
// ReadableStream while it runs, terminated by a "[[EXIT:<code>]]" marker so
// the client can tell success from failure.
//
// Two reliability properties for long deploy pipelines:
//  - "[[HB]]" heartbeat bytes every 15s keep proxies (Cloudflare Tunnel)
//    from dropping the connection during silent phases like git clone.
//  - If the client disconnects, the command KEEPS RUNNING to completion —
//    a half-finished deploy is worse than a wasted stream.
export function runStream(command: string, timeoutMs = 600_000): ReadableStream<Uint8Array> {
  // `export` rather than a prefix assignment: a prefix only works before a
  // simple command, and would be a syntax error before `for`/`if`/`while`.
  const wrapped = `export PATH="$HOME/bin:$PATH"; ${command}`;
  const argv = buildArgv(wrapped);
  const child = spawn(argv[0], argv.slice(1), { env: childEnv() });

  return new ReadableStream({
    start(controller) {
      const killer = setTimeout(() => child.kill(), timeoutMs);
      const push = (d: Buffer) => {
        try {
          controller.enqueue(new Uint8Array(d));
        } catch {
          // stream already closed (client went away); child continues
        }
      };
      const heartbeat = setInterval(() => push(Buffer.from('[[HB]]')), 15_000);
      child.stdout?.on('data', push);
      child.stderr?.on('data', push);
      child.on('error', (e) => push(Buffer.from(`\nerror: ${e.message}\n`)));
      child.on('close', (code) => {
        clearTimeout(killer);
        clearInterval(heartbeat);
        push(Buffer.from(`\n[[EXIT:${code ?? 1}]]`));
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    // Deliberately no cancel() kill: a disconnected browser must not abort
    // a deploy in flight. The timeout above remains the only hard stop.
  });
}
