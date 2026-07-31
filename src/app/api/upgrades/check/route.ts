import { NextResponse } from 'next/server';
import { run } from '@/lib/runner';
import { versionInfo } from '@/lib/version';

// Availability check for the one-click upgrade targets. Best-effort: any
// source that fails is reported as "unknown" rather than blocking the page.

function normalize(v: string): string {
  return v.trim().replace(/^v/, '');
}

export async function GET() {
  // Forced: this endpoint only runs when someone presses "check for updates",
  // and answering that from an hour-old cache is how a release published
  // minutes ago stays invisible.
  const panel = await versionInfo(true).catch(() => null);

  const [pbCurrent, pmCurrent, aptList] = await Promise.all([
    run('cat "$HOME/apps/pocketbase/VERSION" 2>/dev/null || true'),
    run('pm2 --version 2>/dev/null || true'),
    run('apt list --upgradable 2>/dev/null | grep -c "upgradable from" || true', 60_000),
  ]);

  let pbLatest = '';
  try {
    const res = await fetch('https://api.github.com/repos/pocketbase/pocketbase/releases/latest', {
      cache: 'no-store',
    });
    if (res.ok) pbLatest = (await res.json()).tag_name ?? '';
  } catch {
    // offline
  }

  let pmLatest = '';
  try {
    const res = await fetch('https://registry.npmjs.org/pm2/latest', { cache: 'no-store' });
    if (res.ok) pmLatest = (await res.json()).version ?? '';
  } catch {
    // offline
  }

  const pendingPackages = Number(aptList.output.trim()) || 0;

  return NextResponse.json({
    panel: {
      current: normalize(panel?.installed ?? ''),
      latest: normalize(panel?.latest ?? ''),
      updateAvailable: !!panel?.updateAvailable,
    },
    pocketbase: {
      current: normalize(pbCurrent.output),
      latest: normalize(pbLatest),
      updateAvailable:
        !!pbLatest && !!pbCurrent.output.trim() && normalize(pbCurrent.output) !== normalize(pbLatest),
    },
    pm2: {
      current: normalize(pmCurrent.output),
      latest: normalize(pmLatest),
      updateAvailable:
        !!pmLatest && !!pmCurrent.output.trim() && normalize(pmCurrent.output) !== normalize(pmLatest),
    },
    termux: {
      current: pendingPackages ? `${pendingPackages} pending` : 'up to date',
      latest: '',
      updateAvailable: pendingPackages > 0,
    },
  });
}
