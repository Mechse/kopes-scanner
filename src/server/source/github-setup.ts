import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Store } from '../store';
import { appRecord, appSeal, appSecret, appAuthentication, checkInstallation, verifyApp, auditGithub, type GithubApp } from './github-app';
import { githubHttp, githubId, githubPages, type GithubHttp } from './github-http';
import { unseal } from './credentials';
import { GithubSettingsError } from './github-settings-error';
import type { GithubSetupNotice } from '../../lib/github';

export type GithubContext = { userId: string; sessionId: string; recheck: () => Promise<void> };
export const setupHeaders = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
export function setupFailureRedirect(origin: string, notice: GithubSetupNotice) {
  return new Response(null,{status:303,headers:{...setupHeaders,Location:`${origin}/settings?tab=integrations&githubSetup=${notice}`}});
}
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const ownerSchema = z.string().trim().regex(/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i);
export function expireSetup(store: Store, restart = false) {
  store.db.prepare(`UPDATE github_setup_attempts SET status='expired',material='' WHERE status IN ('pending','claimed') AND (? OR expires_at<=?)`).run(Number(restart),Date.now());
}
export function setupState(store: Store, app: GithubApp, context: GithubContext, purpose: string, secret: string, material: object = {}) {
  const state = randomBytes(32).toString('base64url');
  store.transaction(() => {
    store.db.prepare("UPDATE github_setup_attempts SET status='cancelled',material='' WHERE app_id=? AND status IN ('pending','claimed')").run(app.id);
    store.db.prepare(`INSERT INTO github_setup_attempts(state_hash,app_id,user_id,session_hash,purpose,owner_login,status,expires_at,material) VALUES (?,?,?,?,?,?,'pending',?,?)`)
      .run(hash(state),app.id,context.userId,hash(context.sessionId),purpose,app.owner_login,Date.now()+30*60_000,appSeal(JSON.stringify({ ...material, revision: app.credential_revision }),secret,app.id,'setup'));
  }); return state;
}
export function claimSetup(store: Store, state: string, purpose: string, context: GithubContext) {
  expireSetup(store);
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new Error('Setup expired or invalid. Resume from Settings.');
  const attempt = store.db.prepare(`UPDATE github_setup_attempts SET status='claimed',claimed_at=? WHERE state_hash=? AND purpose=? AND user_id=? AND session_hash=? AND status='pending' AND expires_at>? RETURNING *`)
    .get(Date.now(),hash(state),purpose,context.userId,hash(context.sessionId),Date.now());
  if (!attempt) throw new Error('Setup expired or already used. Resume from Settings.');
  return attempt;
}
export function manifest(app: GithubApp) {
  return { name: `Kopes Scanner ${app.id.slice(0,8)}`, url: app.origin, description: 'Read repository dependency inputs for this Kopes installation.', public: false,
    redirect_url: `${app.origin}/api/github/manifest/callback`, setup_url: `${app.origin}/api/github/install/callback`, callback_urls: [`${app.origin}/api/github/authorize/callback`],
    setup_on_update: true, request_oauth_on_install: false,
    // GitHub validates a supplied hook URL even when active=false. Polling has no hook.
    ...(app.webhook_mode === 'webhook' ? { hook_attributes: { url: `${app.origin}/api/github/webhooks/${app.id}`, active: true } } : {}),
    default_permissions: { contents: 'read', ...(app.history ? { pull_requests: 'read' } : {}) }, default_events: app.webhook_mode === 'webhook' ? ['push'] : [] };
}
export async function startSetup(store: Store, context: GithubContext, config: { origin: string; secret: string }, input: { owner: string; ownerType: 'User' | 'Organization'; history: boolean; webhookMode: 'polling' | 'webhook' }) {
  const owner = ownerSchema.parse(input.owner);
  let origin: URL;
  try { origin = new URL(config.origin); } catch { throw new GithubSettingsError('canonical-origin'); }
  if (origin.origin !== config.origin || origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost','127.0.0.1'].includes(origin.hostname))) throw new GithubSettingsError('canonical-origin');
  if (input.webhookMode === 'webhook' && origin.protocol !== 'https:') throw new GithubSettingsError('webhook-origin');
  await context.recheck();
  const id = randomUUID();
  store.db.prepare('INSERT INTO github_apps(id,owner_login,owner_type,origin,history,webhook_mode,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id,owner,input.ownerType,config.origin,Number(input.history),input.webhookMode,Date.now(),Date.now());
  const app = appRecord(store,id), state = setupState(store,app,context,'manifest',config.secret);
  auditGithub(store,context.userId,'github-setup-started',id);
  return { appId: id, manifest: manifest(app), action: `https://github.com/${input.ownerType === 'Organization' ? `organizations/${encodeURIComponent(owner)}/` : ''}settings/apps/new?state=${state}` };
}
export async function resumeSetup(store: Store, appId: string, context: GithubContext, config: { origin: string; secret: string }, http: GithubHttp = githubHttp) {
  const app = appRecord(store,appId);
  if (app.origin !== config.origin) throw new Error('App callback origin changed. Update registered URLs and import the App with the current origin before resuming.');
  const verified = await verifyApp(app,config.secret,http,true); await context.recheck();
  if (appRecord(store,appId).credential_revision !== app.credential_revision) throw new Error('App changed during verification.');
  store.db.prepare("UPDATE github_apps SET owner_id=?,slug=?,status=CASE WHEN status='connected' THEN status ELSE 'pending-installation' END,updated_at=? WHERE id=?").run(verified.ownerId,verified.slug,Date.now(),appId);
  const state = setupState(store,appRecord(store,appId),context,'install',config.secret);
  return { url: `https://github.com/apps/${verified.slug}/installations/new?state=${state}` };
}
const bundle = z.object({ id: z.union([z.string(),z.number()]), client_id: z.string().min(1).max(200), client_secret: z.string().min(1).max(10000), pem: z.string().min(1).max(20000), webhook_secret: z.string().max(10000).nullish(), slug: z.string().regex(/^[a-z0-9-]+$/) });
export async function setupCallback(request: Request, store: Store, context: GithubContext, config: { origin: string; secret: string }, http: GithubHttp = githubHttp) {
  const url = new URL(request.url), step = url.pathname.split('/')[3];
  if (!['manifest','install','authorize'].includes(step)) return new Response('Not found.',{status:404,headers:setupHeaders});
  await context.recheck();
  let attempt: ReturnType<typeof claimSetup> | undefined;
  let notice: GithubSetupNotice = 'state';
  try {
    attempt = claimSetup(store,url.searchParams.get('state') ?? '',step,context);
    const app = appRecord(store,String(attempt.app_id));
    const material = JSON.parse(unseal(String(attempt.material),config.secret,`kopes.github.v1:${app.id}:setup`));
    const stillValid = async () => {
      await context.recheck();
      const fresh = appRecord(store,app.id);
      if (fresh.credential_revision !== material.revision || app.origin !== config.origin || attempt!.owner_login !== app.owner_login || !store.db.prepare("SELECT 1 FROM github_setup_attempts WHERE state_hash=? AND status='claimed' AND expires_at>?").get(attempt!.state_hash,Date.now())) throw new Error('Setup changed or expired.');
    };
    await stillValid();
    const finish = () => store.db.prepare("UPDATE github_setup_attempts SET status='completed',completed_at=?,material='' WHERE state_hash=?").run(Date.now(),attempt!.state_hash);
    if (step === 'manifest') {
      const code = z.string().min(1).max(300).regex(/^[a-zA-Z0-9_-]+$/).parse(url.searchParams.get('code'));
      // Never retry conversion: an interrupted request may already have consumed the code.
      notice = 'exchange';
      const converted = await http({ path: `/app-manifests/${encodeURIComponent(code)}/conversions`, method:'POST' });
      notice = 'credentials';
      const response = bundle.parse(converted);
      await stillValid();
      store.db.prepare("UPDATE github_apps SET github_id=?,client_id=?,slug=?,private_key=?,client_secret=?,webhook_secret=?,status='registered',updated_at=? WHERE id=?")
        .run(githubId(response.id),response.client_id,response.slug,appSeal(response.pem,config.secret,app.id,'private_key'),appSeal(response.client_secret,config.secret,app.id,'client_secret'),response.webhook_secret ? appSeal(response.webhook_secret,config.secret,app.id,'webhook_secret') : '',Date.now(),app.id);
      // Persist before verification, so a transient failure can be resumed with retained credentials.
      finish();
      notice = 'verification';
      const next = await resumeSetup(store,app.id,context,config,http);
      return new Response(null,{status:303,headers:{...setupHeaders,Location:next.url}});
    }
    notice = 'installation';
    if (step === 'install') {
      const installation = githubId(url.searchParams.get('installation_id'));
      // It remains an untrusted hint until both user and App authenticated reads below agree.
      const verifier = randomBytes(32).toString('base64url'); finish();
      store.db.prepare("UPDATE github_apps SET status='pending-verification' WHERE id=? AND status<>'connected'").run(app.id);
      const state = setupState(store,app,context,'authorize',config.secret,{ installation,verifier });
      const redirect = new URL('https://github.com/login/oauth/authorize');
      redirect.search = new URLSearchParams({ client_id:app.client_id, redirect_uri:`${config.origin}/api/github/authorize/callback`, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method:'S256' }).toString();
      return new Response(null,{status:303,headers:{...setupHeaders,Location:redirect.href}});
    }
    const code = z.string().min(1).max(500).parse(url.searchParams.get('code'));
    const oauth = await http({ path:'/login/oauth/access_token',method:'POST',oauth:true,body:{ client_id:app.client_id,client_secret:appSecret(app,config.secret,'client_secret'),code,code_verifier:material.verifier,redirect_uri:`${config.origin}/api/github/authorize/callback` } });
    const userToken = z.string().min(1).max(20000).regex(/^[^\r\n]+$/).parse(oauth.access_token);
    githubId((await http({path:'/user',token:userToken})).id);
    const installations = await githubPages(http,'/user/installations',userToken,'installations');
    const visible = installations.find(i => githubId(i.id) === material.installation);
    if (!visible) throw new Error('Installation not available to the authorizing user. Approval may still be pending.');
    checkInstallation(app,visible);
    // Traverse user-visible repositories too. No user/refresh token is stored or sent to the browser.
    await githubPages(http,`/user/installations/${material.installation}/repositories`,userToken,'repositories');
    const remote = await http({path:`/app/installations/${material.installation}`,token:appAuthentication(app,config.secret)});
    checkInstallation(app,remote); await stillValid();
    store.transaction(() => {
      const local = store.db.prepare('SELECT id FROM github_installations WHERE app_id=? AND github_id=?').get(app.id,material.installation);
      const installationId = local ? String(local.id) : randomUUID();
      store.db.prepare(`INSERT INTO github_installations(id,app_id,github_id,owner_id,owner_login,permissions,selection,status) VALUES (?,?,?,?,?,?,?,'pending')
        ON CONFLICT(app_id,github_id) DO UPDATE SET status='pending',access_revision=access_revision+1,next_check=0`)
        .run(installationId,app.id,material.installation,app.owner_id,app.owner_login,JSON.stringify(remote.permissions),remote.repository_selection ?? 'selected');
      const connection = store.db.prepare('SELECT id FROM source_connections WHERE installation_id=?').get(installationId);
      if (connection) store.db.prepare("UPDATE source_connections SET disconnected=0,credential_version=credential_version+1,health='reconciling' WHERE id=?").run(connection.id);
      else store.db.prepare("INSERT INTO source_connections(id,provider,origin,credential,auth_kind,label,installation_id,owner_login,history,health) VALUES (?,'github','https://api.github.com','','github_app',?,?,?,?,'reconciling')").run(randomUUID(),`${app.owner_login} App`,installationId,app.owner_login,app.history);
      store.db.prepare("UPDATE github_apps SET status='connected',updated_at=? WHERE id=?").run(Date.now(),app.id);
      finish(); auditGithub(store,context.userId,'github-installation-verified',installationId);
    });
    return new Response(null,{status:303,headers:{...setupHeaders,Location:`${config.origin}/settings`}});
  } catch {
    if (attempt) {
      store.db.prepare("UPDATE github_setup_attempts SET status='verification-failed',material='' WHERE state_hash=? AND status IN ('claimed','completed')").run(attempt.state_hash);
      store.db.prepare("UPDATE github_apps SET status='verification-failed' WHERE id=? AND status NOT IN ('connected','removed')").run(attempt.app_id);
    }
    // Only a fixed status survives the redirect; OAuth code/state and provider responses never do.
    return setupFailureRedirect(config.origin,notice);
  }
}
