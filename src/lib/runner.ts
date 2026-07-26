import { execFile } from 'child_process';
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

export function run(command: string, timeoutMs = 30_000): Promise<RunResult> {
  const wrapped = `PATH="$HOME/bin:$PATH" ${command}`;
  const opts = { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 };

  return new Promise((resolve) => {
    const cb = (err: Error | null, stdout: string, stderr: string) => {
      const output = [stdout, stderr].filter(Boolean).join('\n').trim();
      resolve({ ok: !err, output: output || (err ? err.message : '') });
    };

    if (MODE === 'ssh') {
      const key = process.env.SSH_KEY ?? `${os.homedir()}/.ssh/oneplus-deploy-key`;
      const host = process.env.PHONE_HOST ?? '100.127.137.83';
      const port = process.env.PHONE_SSH_PORT ?? '8022';
      execFile(
        'ssh',
        [
          '-i', key,
          '-p', port,
          '-o', 'IdentitiesOnly=yes',
          '-o', 'BatchMode=yes',
          '-o', 'ConnectTimeout=10',
          `user@${host}`,
          wrapped,
        ],
        opts,
        cb,
      );
    } else {
      execFile('sh', ['-c', wrapped], {
        ...opts,
        env: { ...process.env, PATH: `${os.homedir()}/bin:${process.env.PATH}` },
      }, cb);
    }
  });
}
