import { validatePat } from './github-pat';
import { unseal } from './credentials';
import { randomUUID } from 'node:crypto';
import type { Store } from '../store';
import { appRecord, appAuthentication, checkInstallation, installationToken, invalidateConnection, purgeGithubTokens, auditGithub } from './github-app';
import { githubHttp, githubId, githubPages, GithubError, type GithubHttp } from './github-http';

export function restrictInstallation(store: Store, installationId: string, status: string, repositoryIds?: string[]) {
  const installation = store.db.prepare('SELECT * FROM github_installations WHERE id=?').get(installationId);
  if (!installation) return;
  if (!repositoryIds && installation.status===status) return;
  if (repositoryIds) {
    repositoryIds=repositoryIds.filter(id=>store.db.prepare("SELECT 1 FROM github_installation_repositories WHERE installation_id=? AND repository_id=? AND status<>'removed'").get(installationId,id));
    if (!repositoryIds.length) return;
  }
  const connections = store.db.prepare('SELECT id FROM source_connections WHERE installation_id=?').all(installationId);
  store.db.prepare('UPDATE github_installations SET access_revision=access_revision+1,next_check=0,status=CASE WHEN ? THEN status ELSE ? END WHERE id=?').run(Number(!!repositoryIds),status,installationId);
  if (repositoryIds) for (const repo of repositoryIds) store.db.prepare("UPDATE github_installation_repositories SET status='removed',access_revision=access_revision+1 WHERE installation_id=? AND repository_id=?").run(installationId,repo);
  for (const c of connections) {
    invalidateConnection(store,String(c.id),status);
    if (repositoryIds) for (const repo of repositoryIds) store.db.prepare("UPDATE source_bindings SET access_status='blocked',access_revision=access_revision+1,error='Repository access unavailable.' WHERE connection_id=? AND repository_id IN (SELECT id FROM source_repositories WHERE provider_id=?)").run(c.id,repo);
    else store.db.prepare("UPDATE source_bindings SET access_status='blocked',access_revision=access_revision+1,error='Installation access unavailable.' WHERE connection_id=?").run(c.id);
  }
  auditGithub(store,'system','github-access-restricted',installationId);
}
const running = new WeakMap<Store, Set<string>>();
export async function reconcileInstallation(store: Store, id: string, secret: string, http: GithubHttp = githubHttp, authorize: () => Promise<void> = async()=>{}) {
  let busy = running.get(store); if (!busy) { busy = new Set(); running.set(store,busy); } if (busy.has(id)) return; busy.add(id);
  try {
    const installation = store.db.prepare('SELECT * FROM github_installations WHERE id=?').get(id);
    if (!installation || !store.db.prepare('SELECT 1 FROM source_connections WHERE installation_id=? AND disconnected=0').get(id)) return;
    const app = appRecord(store,String(installation.app_id));
    if (app.status !== 'connected') return;
    const remote = await http({path:`/app/installations/${githubId(installation.github_id)}`,token:appAuthentication(app,secret)});
    checkInstallation(app,remote);
    const token = await installationToken(store,id,secret,undefined,http,false,true);
    const rows = await githubPages(http,'/installation/repositories',token,'repositories');
    const staged = rows.map(r => {
      const repoId = githubId(r.id);
      if (typeof r.full_name !== 'string' || r.full_name.length>300 || typeof r.private !== 'boolean' || r.owner?.login?.toLowerCase() !== app.owner_login.toLowerCase()) throw new Error('Incomplete repository listing.');
      return { id:repoId,name:r.full_name,private:r.private };
    });
    if (new Set(staged.map(r=>r.id)).size !== staged.length) throw new Error('Inconsistent repository pagination.');
    await authorize();
    store.transaction(() => {
      // A late response cannot undo a restrictive webhook, disconnect or credential rotation.
      const fresh = store.db.prepare('SELECT access_revision FROM github_installations WHERE id=?').get(id);
      if (fresh?.access_revision !== installation.access_revision || appRecord(store,app.id).credential_revision !== app.credential_revision || !store.db.prepare('SELECT 1 FROM source_connections WHERE installation_id=? AND disconnected=0').get(id)) return;
      const generation = randomUUID();
      for (const repo of staged) store.db.prepare(`INSERT INTO github_installation_repositories(installation_id,repository_id,name,private,status,generation,observed_at) VALUES (?,?,?,?,'active',?,?)
        ON CONFLICT(installation_id,repository_id) DO UPDATE SET name=excluded.name,private=excluded.private,status='active',access_revision=access_revision+CASE WHEN status='active' THEN 0 ELSE 1 END,generation=excluded.generation,observed_at=excluded.observed_at`)
        .run(id,repo.id,repo.name,Number(repo.private),generation,Date.now());
      const removed = store.db.prepare("SELECT repository_id FROM github_installation_repositories WHERE installation_id=? AND generation<>? AND status='active'").all(id,generation);
      if (removed.length) restrictInstallation(store,id,'repository-access-changed',removed.map(r=>String(r.repository_id)));
      store.db.prepare("UPDATE github_installations SET status='active',permissions=?,selection=?,reconciled_at=?,next_check=? WHERE id=?").run(JSON.stringify(remote.permissions),remote.repository_selection ?? 'selected',Date.now(),Date.now()+15*60_000+Math.floor(Math.random()*60_000),id);
      const connections = store.db.prepare('SELECT id FROM source_connections WHERE installation_id=? AND disconnected=0').all(id);
      for (const c of connections) {
        if(installation.status!=='active') store.db.prepare('UPDATE source_bindings SET next_poll=0 WHERE connection_id=?').run(c.id);
        const bindings = store.db.prepare('SELECT b.id,b.access_status,r.provider_id FROM source_bindings b JOIN source_repositories r ON r.id=b.repository_id WHERE b.connection_id=?').all(c.id);
        for (const b of bindings) {
          const allowed = staged.some(r=>r.id===b.provider_id), status = allowed ? 'active' : 'blocked';
          if (status !== b.access_status) {
            store.db.prepare('UPDATE source_bindings SET access_status=?,access_revision=access_revision+1,next_poll=0,error=? WHERE id=?').run(status,allowed ? null : 'Repository access unavailable.',b.id);
            store.db.prepare("UPDATE source_jobs SET state='cancelled' WHERE binding_id=? AND state IN ('queued','running')").run(b.id);
            auditGithub(store,'system',allowed ? 'github-access-restored' : 'github-access-lost',String(b.id));
          }
        }
        store.db.prepare("UPDATE source_connections SET health='connected',validated_at=?,observed_at=? WHERE id=?").run(Date.now(),Date.now(),c.id);
      }
      purgeGithubTokens(store);
    });
  } catch (e) {
    await authorize();
    store.transaction(() => {
      // Incomplete lists never remove unseen repositories. Definitive auth/installation failure pauses work.
      if (e instanceof GithubError && ['access','unavailable'].includes(e.reason)) restrictInstallation(store,id,'access-unavailable');
      else if (e instanceof Error && e.message.startsWith('Installation unavailable')) restrictInstallation(store,id,'suspended-or-unavailable');
      store.db.prepare('UPDATE github_installations SET next_check=? WHERE id=?').run(e instanceof GithubError && e.retryAt ? e.retryAt : Date.now()+60_000,id);
      store.db.prepare("UPDATE source_connections SET health='reconciliation-unavailable' WHERE installation_id=? AND disconnected=0").run(id);
    });
  } finally { busy.delete(id); }
}
export async function reconcileGithub(store: Store, secret: string, http: GithubHttp = githubHttp) {
  const due = store.db.prepare(`SELECT i.id FROM github_installations i WHERE i.next_check<=? AND EXISTS(SELECT 1 FROM source_connections c WHERE c.installation_id=i.id AND c.disconnected=0) ORDER BY i.next_check LIMIT 10`).all(Date.now());
  for (const row of due) await reconcileInstallation(store,String(row.id),secret,http);
  for (const c of store.db.prepare("SELECT id FROM source_connections WHERE auth_kind='pat' AND disconnected=0 AND next_check<=? LIMIT 10").all(Date.now())) await reconcilePatConnection(store,String(c.id),secret,http);
}
export async function reconcilePatConnection(store: Store, id: string, secret: string, http: GithubHttp = githubHttp, authorize: () => Promise<void> = async()=>{}) {
  const c = store.db.prepare("SELECT * FROM source_connections WHERE id=? AND auth_kind='pat' AND disconnected=0").get(id);
  if (!c) return;
  const current = () => store.db.prepare('SELECT credential_version FROM source_connections WHERE id=?').get(c.id)?.credential_version === c.credential_version;
  try {
    if (c.expires_at && Number(c.expires_at)<=Date.now()) throw new GithubError(401,'access');
    const token = unseal(String(c.credential),secret,`${c.id}:${c.origin}`);
    const result = await validatePat(token,String(c.validation_repository),String(c.owner_login),!!c.history,http);
    await authorize();
    if (!current()) return;
    if (!result.privateVerified) throw new GithubError(403,'access');
    const bindings = store.db.prepare('SELECT b.id,b.access_status,b.access_revision,r.provider_id FROM source_bindings b JOIN source_repositories r ON r.id=b.repository_id WHERE b.connection_id=?').all(c.id);
    for (const b of bindings) {
      try {
        const metadata = await http({path:`/repositories/${githubId(b.provider_id)}`,token});
        const read = await validatePat(token,String(metadata.full_name),String(c.owner_login),false,http);
        if (read.repository.providerId!==b.provider_id) throw new GithubError(404,'unavailable');
        await authorize();
        if (!current()) return;
        if (b.access_status!=='active') {
          const changed = store.db.prepare("UPDATE source_bindings SET access_status='active',access_revision=access_revision+1,next_poll=0,error=NULL WHERE id=? AND connection_id=? AND access_revision=?").run(b.id,c.id,b.access_revision);
          if (changed.changes) auditGithub(store,'system','github-access-restored',String(b.id));
        }
      } catch(e) {
        await authorize();
        if (!current()) return;
        if (e instanceof GithubError && ['access','unavailable'].includes(e.reason)) {
          store.transaction(()=>{
            const changed = store.db.prepare("UPDATE source_bindings SET access_status='blocked',access_revision=access_revision+1,error='Repository access unavailable.' WHERE id=? AND connection_id=? AND access_revision=?").run(b.id,c.id,b.access_revision);
            if (changed.changes) {
              store.db.prepare("UPDATE source_jobs SET state='cancelled' WHERE binding_id=? AND state IN ('running','queued')").run(b.id);
              auditGithub(store,'system','github-access-lost',String(b.id));
            }
          });
        }
      }
    }
    await authorize();
    if (!current()) return;
    store.db.prepare("UPDATE source_connections SET health='connected',validated_at=?,observed_at=?,next_check=? WHERE id=?").run(Date.now(),Date.now(),Date.now()+15*60_000,c.id);
  } catch(e) {
    await authorize();
    if (!current()) return;
    store.transaction(()=>{
      if (e instanceof GithubError && ['access','unavailable'].includes(e.reason)) {
        invalidateConnection(store,String(c.id),'access-unavailable');
        store.db.prepare("UPDATE source_bindings SET access_status='blocked',access_revision=access_revision+1,error='Repository access unavailable.' WHERE connection_id=?").run(c.id);
      }
      store.db.prepare("UPDATE source_connections SET observed_at=?,next_check=?,health='validation-unavailable' WHERE id=?").run(Date.now(),e instanceof GithubError && e.retryAt ? e.retryAt : Date.now()+15*60_000,c.id);
    });
  }
}
