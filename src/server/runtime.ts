import { startupFailure, type StartupStage } from './startup-error';
import { expireSetup } from './source/github-setup';
import { reconcileGithub } from './source/github-reconcile';
import { recoverGithubDeliveries } from './source/github-webhook';
import { cleanSourceSpool } from './source/storage';
import { recoverSourceJobs, runSourceJob, sourceWorkerBusy } from './source/jobs';
import { isMainThread } from 'node:worker_threads';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readConfig } from './config';
import { Store } from './store';
import { migrateAuth } from './auth';
import { savedAuthRuntime } from './auth-settings';
import { inventory, watchEvents } from './docker';
import { NoPackageCoverage } from './trivy';
import { scanTarget } from './scanner';

async function initialize() {
  let stage: StartupStage = 'configuration';
  try {
    // Vite sets the process-wide mask before starting its development worker.
    if (isMainThread) process.umask(0o077);
    const config = readConfig();
    stage = 'database';
    const store = new Store(config.dataDir);
    stage = 'filesystem';
    await mkdir(join(config.dataDir, 'tmp'), { recursive: true, mode: 0o700 });
    stage = 'authentication';
    const getAuth = savedAuthRuntime(store, config);
    const { auth } = getAuth();
    await migrateAuth(auth);
    stage = 'source-recovery';
    store.recover();
    if(process.env.KOPES_SOURCE_SPOOL) await cleanSourceSpool(process.env.KOPES_SOURCE_SPOOL,true);
    expireSetup(store,true);
    recoverGithubDeliveries(store);
    store.db.prepare("UPDATE github_installations SET next_check=0,status=CASE WHEN status='active' THEN 'pending' ELSE status END").run();
    store.db.prepare("UPDATE source_connections SET next_check=0 WHERE auth_kind='pat'").run();
    await reconcileGithub(store,config.secret);
    recoverSourceJobs(store);
    // Interrupted scans only contain scratch copies; completed SBOMs live transactionally in SQLite.
    stage = 'filesystem';
    for (const name of await readdir(config.dataDir)) if (name.startsWith('scan-')) await rm(join(config.dataDir, name), { recursive: true, force: true });
    const controller = new AbortController();
    const signal = controller.signal;
    // Serialize additions and refreshes so an older Docker snapshot cannot undo an add.
    let pending: Promise<void> = Promise.resolve();
    let activeScan: { id: string; controller: AbortController } | undefined;
    function syncSelected(id?: string, action: 'add' | 'remove' = 'add') {
      const task = pending.then(async () => {
        if (id && action === 'remove') {
          const removed = store.untrackContainer(id);
          if (removed && activeScan && !store.db.prepare('SELECT 1 FROM targets WHERE id=?').get(activeScan.id)) activeScan.controller.abort();
          return removed;
        }
        const ids = store.selectedContainers();
        if (id && !ids.includes(id)) ids.push(id);
        const containers = await inventory(config.docker, ids);
        if (id && !containers.some(c => c.id === id)) return false;
        store.syncInventory(containers, { add: id });
        return true;
      });
      pending = task.then(() => {}, () => {});
      return task;
    }
    let syncing = false;
    async function reconcile() {
      if (syncing || signal.aborted) return;
      syncing = true;
      try {
        await syncSelected();
      }
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
      let sourceTurn = false;
      while (!signal.aborted) {
        if (await sourceWorkerBusy()) { await delay(500, undefined, { signal }).catch(() => {}); continue; }
        if (sourceTurn) { sourceTurn = false; if (await runSourceJob(store, config, signal)) continue; }
        const target = store.next();
        if (target) {
          sourceTurn = true;
          const scan = new AbortController();
          activeScan = { id: target.id, controller: scan };
          try { await scanTarget(config, store, target, AbortSignal.any([signal, scan.signal])); }
          catch (error) {
            // Do not persist scanner stderr: it can contain image metadata and local paths.
            const message = error instanceof Error && !('stderr' in error) ? error.message : 'Scan failed. Check registry access, available disk/memory, and scanner configuration.';
            if (!scan.signal.aborted) store.fail(target.id, message.slice(0, 500), error instanceof NoPackageCoverage ? 'unassessed' : 'error');
          } finally { activeScan = undefined; }
        } else if (!await runSourceJob(store, config, signal)) await delay(2_000, undefined, { signal }).catch(() => {});
      }
    }
    // Host scanning does not depend on a working Docker daemon.
    store.db.prepare("INSERT OR IGNORE INTO targets(id,kind,name) VALUES('host','host','Host OS')").run();
    async function githubLifecycle() {
      while (!signal.aborted) {
        try { expireSetup(store); recoverGithubDeliveries(store); await reconcileGithub(store,config.secret); } catch { /* Retry durable work without logging credentials or payloads. */ }
        await delay(30_000,undefined,{signal}).catch(()=>{});
      }
    }
    const tasks = [poll(), events(), worker(), githubLifecycle()];
    for (const task of tasks) task.catch(() => { console.error('A background scanner task stopped unexpectedly. Restart the application.'); controller.abort(); });
    const shutdown = () => { controller.abort(); };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
    return { baseConfig: config, store, getAuth, signal, syncSelected };
  } catch (error) { throw startupFailure(stage,error); }
}
let instance: ReturnType<typeof initialize> | undefined;
export async function runtime() {
  const state = await (instance ??= initialize().catch(error => { console.error(error.message); throw error; }));
  try { return { ...state, ...state.getAuth() }; }
  catch (error) { throw startupFailure('authentication',error); }
}
