import { NextResponse } from 'next/server';
import { run } from '@/lib/runner';
import pkg from '../../../../package.json';

// Panel configuration overview: runtime facts, the panel's own .env
// (values sent to the authenticated admin; UI masks secrets by default),
// deployed commit, and device health via the existing device-info script.

const SECRET_HINT = /(password|secret|token|key)/i;

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

export async function GET() {
  const [envFile, commit, device, versions] = await Promise.all([
    run('cat "$HOME/apps/bitroot-panel/.env" 2>/dev/null || true'),
    run('git --git-dir="$HOME/repos/bitroot-panel.git" log -1 --format="%h %s (%cr)" 2>/dev/null || true'),
    run('device-info 2>/dev/null || echo "device-info not available"', 30_000),
    run(
      'echo "pocketbase=$(cat $HOME/apps/pocketbase/VERSION 2>/dev/null)"; echo "pm2=$(pm2 --version 2>/dev/null)"; echo "node=$(node --version 2>/dev/null)"; echo "go=$(go version 2>/dev/null | cut -d" " -f3)"',
      30_000,
    ),
  ]);

  const versionMap: Record<string, string> = {};
  for (const line of versions.output.split('\n')) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (m && m[2]) versionMap[m[1]] = m[2].trim();
  }

  const env = envFile.output
    .split('\n')
    .map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({
      key: m[1],
      value: m[2],
      secret: SECRET_HINT.test(m[1]),
    }));

  return NextResponse.json({
    panel: {
      version: pkg.version,
      commit: commit.output.trim() || 'unknown',
      execMode: process.env.EXEC_MODE ?? 'local',
      node: process.version,
      port: process.env.PORT ?? '3210',
      uptimeSec: Math.round(process.uptime()),
    },
    env,
    device: stripAnsi(device.output),
    versions: versionMap,
  });
}
