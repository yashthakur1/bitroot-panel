import { NextResponse } from 'next/server';
import { run } from '@/lib/runner';

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET() {
  const [health, pm2, version] = await Promise.all([
    run('curl -s -m 5 http://127.0.0.1:8090/api/health || true'),
    run('pm2 jlist'),
    run('cat "$HOME/apps/pocketbase/VERSION" 2>/dev/null || "$HOME/apps/pocketbase/pocketbase" --version 2>/dev/null || true'),
  ]);

  let daemon = { status: 'unknown', uptimeMs: 0, memoryMb: 0, restarts: 0 };
  try {
    const start = pm2.output.indexOf('[');
    const apps = JSON.parse(pm2.output.slice(start));
    const pb = apps.find((a: any) => a.name === 'pocketbase');
    if (pb) {
      daemon = {
        status: pb.pm2_env?.status ?? 'unknown',
        uptimeMs:
          pb.pm2_env?.status === 'online' && pb.pm2_env?.pm_uptime
            ? Date.now() - pb.pm2_env.pm_uptime
            : 0,
        memoryMb: Math.round((pb.monit?.memory ?? 0) / 1024 / 1024),
        restarts: pb.pm2_env?.restart_time ?? 0,
      };
    }
  } catch {
    // leave unknown
  }

  return NextResponse.json({
    healthy: health.output.includes('healthy'),
    version: version.output.trim().replace(/^pocketbase version\s*/i, '') || 'unknown',
    port: 8090,
    ...daemon,
  });
}
