import { personalReader } from './gitlab';
import { sign } from 'node:crypto';
import type { Store } from '../store';
import { GitProvider, ProviderError, type Connection, type ReadJson } from './provider';
import { seal, unseal } from './credentials';
import { githubHttp, githubId, GithubError, type GithubHttp } from './github-http';
import { GithubSettingsError } from './github-settings-error';
import { SourceError } from './errors';

export type GithubApp = { id: string; github_id: string; client_id: string; slug: string; owner_id: string; owner_login: string; owner_type: string; origin: string; private_key: string; client_secret: string; webhook_secret: string; credential_revision: number; history: number; webhook_mode: string; status: string };
export function appRecord(store: Store, id: string) {
  const app = store.db.prepare('SELECT * FROM github_apps WHERE id=?').get(id) as unknown as GithubApp | undefined;
  if (!app || app.status === 'removed') throw new Error('App unavailable.'); return app;
}
export const appSeal = (value: string, secret: string, id: string, kind: string) => seal(value, secret, `kopes.github.v1:${id}:${kind}`);
export function appSecret(app: GithubApp, secret: string, kind: 'private_key' | 'client_secret' | 'webhook_secret') {
  try { return unseal(app[kind], secret, `kopes.github.v1:${app.id}:${kind}`); } catch { throw new SourceError('credentials-unavailable'); }
}
export function appJwt(clientId: string, pem: string, now = Date.now()) {
  if (!Number.isFinite(now) || now < Date.UTC(2020,0,1)) throw new SourceError('server-clock');
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const data = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: clientId, iat: Math.floor(now/1000)-60, exp: Math.floor(now/1000)+540 })}`;
  try { return `${data}.${sign('RSA-SHA256', Buffer.from(data), pem).toString('base64url')}`; } catch { throw new SourceError('app-private-key'); }
}
export function appAuthentication(app: GithubApp, secret: string) { return appJwt(app.client_id, appSecret(app, secret, 'private_key')); }
export function checkPermissions(value: any, history: boolean) {
  if (!value || value.contents !== 'read' || history && value.pull_requests !== 'read' || Object.entries(value).some(([k,v]) => !['contents','metadata','pull_requests'].includes(k) || v !== 'read')) throw new GithubError(403,'access');
}
export async function verifyApp(app: GithubApp, secret: string, http: GithubHttp = githubHttp, verifyWebhook = false) {
  if (app.webhook_mode==='webhook' && (!app.webhook_secret || !appSecret(app,secret,'webhook_secret'))) throw new GithubSettingsError('webhook-secret');
  const remote = await http({ path: '/app', token: appAuthentication(app, secret) });
  if (githubId(remote.id) !== app.github_id || remote.client_id !== app.client_id || remote.owner?.login?.toLowerCase() !== app.owner_login.toLowerCase() || remote.owner?.type !== app.owner_type || app.owner_id && githubId(remote.owner.id) !== app.owner_id || typeof remote.slug !== 'string' || !/^[a-z0-9-]+$/.test(remote.slug)) throw new GithubSettingsError('app-identity');
  if (typeof remote.external_url!=='string' || remote.external_url.replace(/\/$/,'')!==app.origin) throw new GithubSettingsError('app-homepage');
  checkPermissions(remote.permissions, !!app.history);
  if (verifyWebhook && app.webhook_mode==='webhook') {
    const hook = await http({path:'/app/hook/config',token:appAuthentication(app,secret)});
    if (hook.url!==`${app.origin}/api/github/webhooks/${app.id}` || hook.content_type!=='json' || String(hook.insecure_ssl)!=='0') throw new GithubSettingsError('app-hook');
  }
  return { ownerId: githubId(remote.owner.id), slug: remote.slug };
}
export function checkInstallation(app: GithubApp, remote: any) {
  githubId(remote.id);
  if (githubId(remote.app_id) !== app.github_id || githubId(remote.account?.id) !== app.owner_id || remote.account?.login?.toLowerCase() !== app.owner_login.toLowerCase() || remote.suspended_at) throw new GithubError(403,'access');
  checkPermissions(remote.permissions, !!app.history);
}
type Entry = { token: string; expires: number };
type CachedToken = { value?: Entry; pending?: Promise<Entry> };
const caches = new WeakMap<Store, Map<string, CachedToken>>();
export function purgeGithubTokens(store: Store) { caches.delete(store); }
export function auditGithub(store: Store, actor: string, action: string, id: string) {
  store.db.prepare('INSERT INTO access_history(actor,action,identifier,time) VALUES (?,?,?,?)').run(actor, action, id, Date.now());
}
export function invalidateConnection(store: Store, id: string, health: string, disconnect = false) {
  store.db.prepare('UPDATE source_connections SET credential_version=credential_version+1,next_check=0,health=?,disconnected=CASE WHEN ? THEN 1 ELSE disconnected END WHERE id=?').run(health, Number(disconnect), id);
  store.db.prepare("UPDATE source_jobs SET state='cancelled' WHERE binding_id IN (SELECT id FROM source_bindings WHERE connection_id=?) AND state IN ('queued','running')").run(id);
  store.db.prepare('UPDATE source_bindings SET next_poll=0 WHERE connection_id=?').run(id);
  purgeGithubTokens(store);
  auditGithub(store,'system',`github-connection-${health}`,id);
}
/** Captured by a reader/job once; token renewal cannot conceal credential or access changes. */
export function connectionRevision(store: Store, id: string, repositoryId?: string): string {
  const row = store.db.prepare(`SELECT c.*,i.status AS installation_status,i.access_revision,i.app_id,a.status AS app_status,a.credential_revision
    FROM source_connections c LEFT JOIN github_installations i ON i.id=c.installation_id LEFT JOIN github_apps a ON a.id=i.app_id WHERE c.id=?`).get(id);
  if (!row || row.disconnected || row.expires_at && Number(row.expires_at) <= Date.now()) throw new Error('Connection unavailable or expired.');
  let repoRevision = '';
  if (row.auth_kind === 'github_app') {
    if (row.installation_status !== 'active' || row.app_status !== 'connected') throw new Error('Installation access unavailable.');
    if (repositoryId) {
      const repo = store.db.prepare("SELECT access_revision FROM github_installation_repositories WHERE installation_id=? AND repository_id=? AND status='active'").get(row.installation_id!, repositoryId);
      if (!repo) throw new Error('Repository access unavailable.'); repoRevision = String(repo.access_revision);
    }
  }
  return JSON.stringify([row.credential_version,row.installation_id,row.access_revision,row.credential_revision,repoRevision]);
}
export async function installationToken(store: Store, installationId: string, secret: string, repositoryId?: string, http: GithubHttp = githubHttp, force = false, discovery = false) {
  const installation = store.db.prepare('SELECT * FROM github_installations WHERE id=?').get(installationId);
  if (!installation || !discovery && installation.status !== 'active') throw new Error('Installation unavailable.');
  const app = appRecord(store, String(installation.app_id));
  if (!['connected','pending-verification'].includes(app.status)) throw new Error('App unavailable.');
  const permissions = repositoryId ? { contents: 'read', ...(app.history ? { pull_requests: 'read' } : {}) } : { metadata: 'read' };
  const cacheKey = JSON.stringify([app.id,app.credential_revision,installationId,installation.access_revision,repositoryId ?? '*',permissions]);
  let cache = caches.get(store); if (!cache) { cache = new Map(); caches.set(store,cache); }
  let cached = cache.get(cacheKey);
  if (!cached) { cached = {}; cache.set(cacheKey,cached); }
  if (force) cached.value = undefined;
  if (cached.pending) return (await cached.pending).token;
  if (cached.value && cached.value.expires > Date.now()+120_000) return cached.value.token;
  if (repositoryId && !Number.isSafeInteger(Number(githubId(repositoryId)))) throw new Error('Repository identity exceeds supported scope range.');
  const pending = (async () => {
    const result = await http({ method: 'POST', path: `/app/installations/${githubId(installation.github_id)}/access_tokens`, token: appAuthentication(app, secret), body: { permissions, ...(repositoryId ? { repository_ids: [Number(githubId(repositoryId))] } : {}) } });
    const expires = Date.parse(result.expires_at);
    if (typeof result.token !== 'string' || !result.token || /[\r\n]/.test(result.token) || !Number.isFinite(expires) || expires <= Date.now()+120_000) throw new SourceError('installation-token');
    return { token: result.token, expires };
  })();
  cached.pending = pending;
  try { cached.value = await pending; return cached.value.token; } finally { cached.pending = undefined; }
}
export function credentialProvider(store: Store, id: string, secret: string, read: ReadJson, repositoryId?: string, http: GithubHttp = githubHttp, personalAccess?: {user:string;check:()=>void}) {
  const revision = connectionRevision(store,id,repositoryId);
  const row = store.db.prepare('SELECT * FROM source_connections WHERE id=?').get(id)!;
  if(row.auth_kind==='github_app' && !repositoryId) throw new Error('A repository-scoped App reader is required. Use the administrator discovery endpoint to list repositories.');
  const connection: Connection = { provider: row.provider as Connection['provider'], origin: String(row.origin), token: '' };
  const current = () => { if (connectionRevision(store,id,repositoryId) !== revision) throw new Error('Connection changed during operation.'); };
  if(row.auth_kind==='gitlab_oauth') {
    if(!personalAccess || !repositoryId || !/^[1-9]\d*$/.test(repositoryId))throw new Error('Personal project access required.');
    const check=()=>{current();personalAccess.check();};
    return {provider:new GitProvider(connection,personalReader(store,id,personalAccess.user,secret,read,check,repositoryId)),connection,current:check,revision};
  }
  const reader: ReadJson = async (_connection, path) => {
    current();
    const app = row.auth_kind === 'github_app';
    for (let attempt=0; attempt<2; attempt++) {
      let token: string;
      try { token = app ? await installationToken(store,String(row.installation_id),secret,repositoryId,http,attempt>0) : row.credential ? unseal(String(row.credential),secret,`${id}:${row.origin}`) : ''; }
      catch (e) { if(e instanceof GithubError || e instanceof SourceError) throw e; throw new SourceError('credentials-unavailable'); }
      current();
      try {
        const result = app || row.auth_kind === 'pat' ? await http({ path, token }) : await read({ ...connection,token },path);
        current(); return result;
      } catch (e) {
        current(); // A late failure from an old credential must not disable its replacement.
        if (app && attempt === 0 && e instanceof ProviderError && e.status === 401) continue;
        if ((app || row.auth_kind==='pat') && e instanceof ProviderError && [401,403,404].includes(e.status) && !(e instanceof GithubError && e.reason === 'rate-limit') && !(e.status!==401 && /\/(commits|pulls)\//.test(path))) {
          // Cancel publication immediately. Periodic authoritative reconciliation may restore access.
          store.transaction(() => {
            invalidateConnection(store,id,'access-unavailable');
            if(repositoryId) store.db.prepare("UPDATE source_bindings SET access_status='blocked',access_revision=access_revision+1,error='Repository access unavailable.' WHERE connection_id=? AND repository_id IN (SELECT id FROM source_repositories WHERE provider_id=?)").run(id,repositoryId);
            if (row.installation_id) store.db.prepare('UPDATE github_installations SET next_check=0 WHERE id=?').run(row.installation_id);
          });
        }
        throw e;
      }
    }
    throw new Error('Repository access unavailable.');
  };
  return { provider: new GitProvider(connection,reader), connection, current, revision };
}
