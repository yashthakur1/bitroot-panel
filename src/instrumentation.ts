// Next.js's one official "run this once when the server starts" hook.
//
// NEXT_RUNTIME check: this file also loads under the edge runtime (middleware),
// where setInterval and child_process both behave differently or not at all.
// The domain watcher shells out to `static-site` and reads SQLite, so it must
// only ever start under plain Node.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startDomainWatcher } = await import('./lib/domain-watcher');
    startDomainWatcher();
  }
}
