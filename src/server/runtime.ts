import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readConfig } from './config';
import { Store } from './store';
import { createAuth, migrateAuth } from './auth';
import { inventory, watchEvents } from './docker';
import { scanTarget } from './scanner';

async function initialize() {
  process.umask(0o077);
  const config = readConfig();
  const store = new Store(config.dataDir);
  await mkdir(join(config.dataDir, 'tmp'), { recursive: true, mode: 0o700 });
  const auth = createAuth(config, store);
  await migrateAuth(auth);
  store.recover();
  // Interrupted scans only contain scratch copies; completed SBOMs live transactionally in SQLite.
  for (const name of await readdir(config.dataDir)) if (name.startsWith('scan-')) await rm(join(config.dataDir, name), { recursive: true, force: true });
  const controller = new AbortController();
  const signal = controller.signal;
  let syncing = false;
  async function reconcile() {
    if (syncing || signal.aborted) return;
    syncing = true;
    try { store.syncInventory(await inventory(config.docker)); }
    catch { store.setMeta('inventoryError', 'Docker inventory unavailable. Showing the last successful inventory; check socket proxy connectivity.'); }
    finally { syncing = false; }
  }
  async function poll() {
    while (!signal.aborted) {
      await reconcile();
      await delay(30_000, undefined, { signal }).catch(() => {});
    }
  }
  async function events() {
    while (!signal.aborted) {
      try { await watchEvents(config.docker, startedId => {
        // A restart keeps the container ID, so inventory diffing alone misses it.
        if (startedId) {
          const row = store.db.prepare('SELECT target_id FROM containers WHERE id=?').get(startedId) as { target_id: string } | undefined;
          if (row) store.request(row.target_id);
        }
        void reconcile();
      }, signal); }
      catch { /* Polling reconciles missed events and proxy restarts. */ }
      await delay(5_000, undefined, { signal }).catch(() => {});
    }
  }
  async function worker() {
    while (!signal.aborted) {
      const target = store.next(config.intervalHours * 3_600_000);
      if (target) {
        try { await scanTarget(config, store, target, signal); }
        catch (error) {
          // Do not persist scanner stderr: it can contain image metadata and local paths.
          const message = error instanceof Error && !('stderr' in error) ? error.message : 'Trivy scan failed. Check registry access, available disk/memory, and scanner configuration.';
          store.fail(target.id, message.slice(0, 500));
        }
      } else await delay(2_000, undefined, { signal }).catch(() => {});
    }
  }
  // Host scanning does not depend on a working Docker daemon.
  store.db.prepare("INSERT OR IGNORE INTO targets(id,kind,name) VALUES('host','host','Host OS')").run();
  const tasks = [poll(), events(), worker()];
  for (const task of tasks) task.catch(() => { console.error('A background scanner task stopped unexpectedly. Restart the application.'); controller.abort(); });
  const shutdown = () => { controller.abort(); };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return { config, store, auth, signal };
}
let instance: ReturnType<typeof initialize> | undefined;
export function runtime() { return instance ??= initialize(); }
