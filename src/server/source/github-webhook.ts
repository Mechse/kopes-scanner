import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Store } from '../store';
import { appRecord, appSecret } from './github-app';
import { githubId } from './github-http';
import { restrictInstallation } from './github-reconcile';
import { boundedBytes } from './body';

/** Durable receipt and minimal work metadata only; never store commit messages or identities. */
export async function githubWebhook(request: Request, store: Store, secret: string, appId: string) {
  const headers = { 'Cache-Control':'no-store' };
  try {
    const app = appRecord(store,appId), raw = await boundedBytes(request,1024*1024);
    const hookSecret = app.webhook_secret ? appSecret(app,secret,'webhook_secret') : '';
    if (!hookSecret) return new Response('Webhook unavailable.',{status:401,headers});
    const signature = request.headers.get('x-hub-signature-256') ?? '';
    if (!/^sha256=[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature.slice(7),'hex'),createHmac('sha256',hookSecret).update(raw).digest())) return new Response('Invalid signature.',{status:401,headers});
    const delivery = request.headers.get('x-github-delivery') ?? '', event = request.headers.get('x-github-event') ?? '';
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(delivery) || !/^[a-z_]{1,80}$/.test(event)) throw new Error();
    const payload = JSON.parse(raw.toString('utf8'));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error();
    const action = typeof payload.action === 'string' ? payload.action.slice(0,80) : '';
    const metadata: { installation?: string; repository?: string; ref?: string; action: string; removed?: string[] } = {action};
    if (['push','installation','installation_repositories'].includes(event)) {
      metadata.installation = githubId(payload.installation?.id);
      if (payload.installation.app_id !== undefined && githubId(payload.installation.app_id) !== app.github_id) throw new Error();
      if (payload.installation.account?.id !== undefined && githubId(payload.installation.account.id) !== app.owner_id) throw new Error();
      if (event === 'push') {
        metadata.repository = githubId(payload.repository?.id);
        if (typeof payload.ref !== 'string' || payload.ref.length>1024) throw new Error(); metadata.ref = payload.ref;
      }
      if (event === 'installation_repositories') {
        if (!Array.isArray(payload.repositories_removed) || payload.repositories_removed.length>10000) throw new Error();
        metadata.removed = payload.repositories_removed.map((r: any)=>githubId(r.id));
      }
    }
    store.transaction(() => {
      const receipt = store.db.prepare('INSERT OR IGNORE INTO github_webhook_deliveries(app_id,delivery_id,event,metadata,received_at) VALUES (?,?,?,?,?)').run(appId,delivery,event,JSON.stringify(metadata),Date.now());
      if (receipt.changes) processDelivery(store,appId,delivery); // Restrictive effects commit before acknowledgment, even with scans disabled.
    });
    return new Response(null,{status:202,headers});
  } catch { return new Response('Invalid or unavailable webhook.',{status:400,headers}); }
}
function processDelivery(store: Store, appId: string, deliveryId: string) {
  const row = store.db.prepare("SELECT * FROM github_webhook_deliveries WHERE app_id=? AND delivery_id=? AND state='queued'").get(appId,deliveryId);
  if (!row) return;
  const data = JSON.parse(String(row.metadata));
  const installation = data.installation ? store.db.prepare('SELECT id FROM github_installations WHERE app_id=? AND github_id=?').get(appId,data.installation) : undefined;
  if (installation) {
    const id = String(installation.id);
    if (row.event === 'installation' && ['deleted','suspend'].includes(data.action)) restrictInstallation(store,id,data.action === 'deleted' ? 'deleted' : 'suspended');
    if (row.event === 'installation_repositories' && data.removed?.length) restrictInstallation(store,id,'repository-access-changed',data.removed);
    // Restoring events only request authoritative reconciliation; never enable access directly.
    if (row.event !== 'push') store.db.prepare('UPDATE github_installations SET next_check=0 WHERE id=?').run(id);
    if (row.event === 'push') store.db.prepare(`UPDATE source_bindings SET next_poll=0 WHERE access_status='active' AND branch=? AND repository_id IN (SELECT id FROM source_repositories WHERE provider='github' AND provider_id=?)
      AND connection_id IN (SELECT id FROM source_connections WHERE installation_id=? AND disconnected=0)`).run(String(data.ref).replace(/^refs\/heads\//,''),data.repository,id);
  }
  store.db.prepare("UPDATE github_webhook_deliveries SET state='complete',processed_at=? WHERE app_id=? AND delivery_id=?").run(Date.now(),appId,deliveryId);
}
export function recoverGithubDeliveries(store: Store) {
  for (const row of store.db.prepare("SELECT app_id,delivery_id FROM github_webhook_deliveries WHERE state='queued' LIMIT 100").all()) store.transaction(()=>processDelivery(store,String(row.app_id),String(row.delivery_id)));
  store.db.prepare("DELETE FROM github_webhook_deliveries WHERE state='complete' AND received_at<?").run(Date.now()-30*86400_000);
}
