// The part that makes custom domains behave like Vercel's: nobody has to come
// back and press Refresh. This polls every site with a custom domain attached
// and runs the same syncSite() the Refresh button calls — so the moment DNS
// propagates, the certificate and HTTPS turn on by themselves.
//
// Deliberately in-process (setInterval under the panel's own pm2 process)
// rather than a cron job or systemd timer: this codebase also targets Termux
// on Android, which has neither, and a check this infrequent has no business
// needing a second scheduling mechanism alongside the one Node already gives us.

import { sitesWithDomains, syncSite } from './custom-domains';
import { portForService } from './routes';

const INTERVAL_MS = 5 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 20_000; // let the server finish booting first

let started = false;
let running = false;

async function tick(): Promise<void> {
  // A slow certbot call (rate-limited, network trouble) must not stack a
  // second tick on top of it — that would mean two certbot calls for the same
  // site racing each other.
  if (running) return;
  running = true;
  try {
    for (const site of sitesWithDomains()) {
      try {
        const port = await portForService(site);
        if (!port) continue; // the site was removed from under its domains
        await syncSite(site, port);
      } catch (e) {
        console.error(`[domain-watcher] ${site}:`, e);
      }
    }
  } catch (e) {
    // sitesWithDomains() itself failing (a locked DB file, a bad path) must not
    // escape as an unhandled rejection from a bare setTimeout/setInterval
    // callback — that has taken the whole process down before.
    console.error('[domain-watcher]', e);
  } finally {
    running = false;
  }
}

/** Idempotent: instrumentation's register() can run more than once per process. */
export function startDomainWatcher(): void {
  if (started) return;
  started = true;
  setTimeout(tick, FIRST_RUN_DELAY_MS).unref();
  setInterval(tick, INTERVAL_MS).unref();
}
