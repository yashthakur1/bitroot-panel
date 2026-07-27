import { NextResponse } from 'next/server';
import { run, runCached } from '@/lib/runner';
import { pbFetch, PB_URL, PB_PUBLIC_URL } from '@/lib/pocketbase';

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET() {
  const [health, pm2, version, size] = await Promise.all([
    run('curl -s -m 5 http://127.0.0.1:8090/api/health || true'),
    runCached('pm2 jlist'),
    run('cat "$HOME/apps/pocketbase/VERSION" 2>/dev/null || true'),
    run('du -sh "$HOME/apps/pocketbase/pb_data" 2>/dev/null | cut -f1 || true'),
  ]);

  let daemon = { status: 'unknown', uptimeMs: 0, memoryMb: 0, restarts: 0, cpu: 0 };
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
        cpu: pb.monit?.cpu ?? 0,
      };
    }
  } catch {
    // leave unknown
  }

  // Vitals from the admin API (best-effort: never block the status page)
  let collections = 0;
  let records = 0;
  let requests24h: number | null = null;
  let errors24h: number | null = null;
  try {
    const list = await pbFetch('/api/collections?perPage=200');
    const user = (list.items ?? []).filter((c: any) => !c.name.startsWith('_'));
    collections = user.length;
    const counts = await Promise.all(
      user.map(async (c: any) => {
        try {
          const p = await pbFetch(`/api/collections/${encodeURIComponent(c.name)}/records?perPage=1`);
          return p.totalItems ?? 0;
        } catch {
          return 0;
        }
      }),
    );
    records = counts.reduce((a, b) => a + b, 0);

    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    const logs = await pbFetch(
      `/api/logs?perPage=1&filter=${encodeURIComponent(`created >= "${since}"`)}`,
    );
    requests24h = logs.totalItems ?? null;
    const errLogs = await pbFetch(
      `/api/logs?perPage=1&filter=${encodeURIComponent(`created >= "${since}" && level > 0`)}`,
    );
    errors24h = errLogs.totalItems ?? null;
  } catch {
    // admin API unavailable — status card still renders
  }

  return NextResponse.json({
    healthy: health.output.includes('healthy'),
    version: version.output.trim() || 'unknown',
    port: 8090,
    internalUrl: PB_URL,
    publicUrl: PB_PUBLIC_URL,
    dbSize: size.output.trim() || '—',
    collections,
    records,
    requests24h,
    errors24h,
    ...daemon,
  });
}
