import type { GithubSettingsData, GithubConnection, GithubAppView } from '../../lib/github';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Store } from '../store';
import { boundedBody } from './body';
import { seal, unseal } from './credentials';
import { validatePat } from './github-pat';
import { appRecord, appSeal, appSecret, verifyApp, invalidateConnection, auditGithub, type GithubApp } from './github-app';
import { githubHttp, githubId, GithubError, githubErrorMessage, type GithubHttp } from './github-http';
import { startSetup, resumeSetup, ownerSchema, expireSetup, setupHeaders, type GithubContext } from './github-setup';
import { reconcileInstallation, reconcilePatConnection } from './github-reconcile';
import { githubSettingsFailure } from './github-settings-error';
import { githubRepositoryPicker } from './github-repository-picker';

const id = z.string().min(1).max(200), credential = z.string().max(20000).regex(/^[^\r\n]*$/);
const pat = { connectionId:id.optional(), label:z.string().trim().min(1).max(120),owner:ownerSchema,token:credential,repository:z.string().max(300),history:z.boolean().default(false),expiresAt:z.number().int().positive().nullable().default(null) };
const app = { appId:id.optional(),githubId:z.string().regex(/^[1-9][0-9]{0,19}$/),clientId:id,owner:ownerSchema,ownerType:z.enum(['User','Organization']),privateKey:z.string().max(20000),clientSecret:credential,webhookSecret:credential,history:z.boolean().default(false),webhookMode:z.enum(['polling','webhook']).default('polling'),urlsConfirmed:z.literal(true) };
const command = z.discriminatedUnion('action',[
  z.object({action:z.literal('start'),owner:ownerSchema,ownerType:z.enum(['User','Organization']),history:z.boolean().default(false),webhookMode:z.enum(['polling','webhook']).default('polling')}).strict(),
  z.object({action:z.literal('resume'),appId:id}).strict(),
  z.object({action:z.literal('test-pat'),...pat}).strict(),z.object({action:z.literal('save-pat'),...pat}).strict(),
  z.object({action:z.literal('import-app'),...app}).strict(),
  z.object({action:z.literal('refresh'),connectionId:id}).strict(),
  z.object({action:z.literal('disconnect'),connectionId:id}).strict(),
  z.object({action:z.literal('remove-app'),appId:id}).strict(),
]);
export function githubSettings(store: Store, origin: string): GithubSettingsData {
  expireSetup(store);
  return {
    connections:store.db.prepare(`SELECT c.id,c.auth_kind,c.label,c.owner_login,c.health,c.disconnected,c.expires_at,c.validated_at,c.history,c.validation_repository,c.installation_id,i.github_id AS installation_github_id,i.app_id,
      (SELECT COUNT(*) FROM source_bindings b WHERE b.connection_id=c.id) AS repository_count FROM source_connections c LEFT JOIN github_installations i ON i.id=c.installation_id WHERE c.provider='github' AND c.auth_kind IN ('github_app','pat')`).all().map(c=>({...c,manageUrl:c.installation_github_id ? `https://github.com/settings/installations/${c.installation_github_id}`:'https://github.com/settings/personal-access-tokens'} as unknown as GithubConnection)),
    apps:store.db.prepare(`SELECT id,github_id,client_id,slug,owner_login,owner_type,origin,status,history,webhook_mode,updated_at,
      (SELECT status FROM github_setup_attempts t WHERE t.app_id=github_apps.id ORDER BY expires_at DESC LIMIT 1) AS setup_status,
      (SELECT COUNT(*) FROM source_bindings b JOIN source_connections c ON c.id=b.connection_id JOIN github_installations i ON i.id=c.installation_id WHERE i.app_id=github_apps.id) AS repository_count,
      (SELECT MAX(received_at) FROM github_webhook_deliveries d WHERE d.app_id=github_apps.id) AS last_webhook_at FROM github_apps WHERE status<>'removed'`).all().map(a=>({...a,originChanged:a.origin!==origin,urls:{manifest:`${origin}/api/github/manifest/callback`,setup:`${origin}/api/github/install/callback`,authorization:`${origin}/api/github/authorize/callback`,webhook:`${origin}/api/github/webhooks/${a.id}`},manageUrl:`https://github.com/${a.owner_type==='Organization'?`organizations/${a.owner_login}/`:''}settings/apps${a.slug?`/${a.slug}`:''}`} as unknown as GithubAppView)),
  };
}
export async function handleGithub(request: Request, store: Store, context: GithubContext, config: { origin: string; secret: string }, http: GithubHttp = githubHttp) {
  const json = (data: unknown,status=200) => Response.json(data,{status,headers:setupHeaders});
  await context.recheck();
  if (request.method==='GET') {
    if (new URL(request.url).pathname.endsWith('/github-repositories')) {
      if (new URL(request.url).searchParams.get('view') === 'picker') {
        const result = githubRepositoryPicker(store, new URL(request.url));
        return result ? json(result) : json({ error: 'Invalid repository search.' }, 400);
      }
      const url = new URL(request.url), id = url.searchParams.get('connectionId') ?? '', page = Number(url.searchParams.get('page') ?? 1);
      if (!Number.isInteger(page) || page<1 || page>200) return json({error:'Invalid page.'},400);
      const c = store.db.prepare("SELECT * FROM source_connections WHERE id=? AND auth_kind='github_app' AND disconnected=0").get(id);
      if (!c) return json({error:'Select an active App connection.'},400);
      await reconcileInstallation(store,String(c.installation_id),config.secret,http,context.recheck); await context.recheck();
      if (!store.db.prepare("SELECT 1 FROM source_connections c JOIN github_installations i ON i.id=c.installation_id WHERE c.id=? AND c.disconnected=0 AND i.status='active'").get(id)) return json({error:'Installation access unavailable.'},400);
      const rows = store.db.prepare("SELECT repository_id,name,private FROM github_installation_repositories WHERE installation_id=? AND status='active' ORDER BY name LIMIT 51 OFFSET ?").all(c.installation_id!, (page-1)*50);
      return json({repositories:rows.slice(0,50),hasMore:rows.length>50,page});
    }
    return json(githubSettings(store,config.origin));
  }
  if (request.method!=='POST') return json({error:'Method not allowed.'},405);
  if (request.headers.get('origin')!==config.origin) return json({error:'Origin not allowed.'},403);
  let stage = 'request';
  try {
    const body = command.parse(JSON.parse(await boundedBody(request,80000)));
    stage = body.action;
    await context.recheck();
    if (body.action==='start') return json(await startSetup(store,context,config,body));
    if (body.action==='resume') return json(await resumeSetup(store,body.appId,context,config,http));
    if (body.action==='test-pat' || body.action==='save-pat') {
      const previous = body.connectionId ? store.db.prepare("SELECT * FROM source_connections WHERE id=? AND auth_kind='pat'").get(body.connectionId) : undefined;
      if (body.connectionId && !previous || previous?.owner_login && String(previous.owner_login).toLowerCase()!==body.owner.toLowerCase()) throw new Error();
      const token = body.token || (previous?.credential ? unseal(String(previous.credential),config.secret,`${previous.id}:${previous.origin}`) : '');
      const result = await validatePat(token,body.repository,body.owner,body.history,http);
      await context.recheck();
      if (body.action==='test-pat') return json(result);
      if (!result.privateVerified) return json({...result,error:'Private repository reads are required before saving. Empty repositories need a supported dependency input or a nonempty tree first.'},400);
      if (body.expiresAt && body.expiresAt<=Date.now()) return json({error:'Expiry must be in the future.'},400);
      const connectionId = body.connectionId ?? randomUUID();
      store.transaction(()=>{
        if (previous && store.db.prepare('SELECT credential_version FROM source_connections WHERE id=?').get(connectionId)?.credential_version !== previous.credential_version) throw new Error();
        if (previous) invalidateConnection(store,connectionId,'connected');
        store.db.prepare(`INSERT INTO source_connections(id,provider,origin,credential,auth_kind,label,owner_login,expires_at,history,health,validated_at,validation_repository) VALUES (?,'github','https://api.github.com',?,'pat',?,?,?,?,'connected',?,?)
          ON CONFLICT(id) DO UPDATE SET credential=excluded.credential,auth_kind='pat',label=excluded.label,owner_login=excluded.owner_login,expires_at=excluded.expires_at,history=excluded.history,health='connected',validated_at=excluded.validated_at,validation_repository=excluded.validation_repository,disconnected=0`)
          .run(connectionId,seal(token,config.secret,`${connectionId}:https://api.github.com`),body.label,body.owner,body.expiresAt,Number(result.historyAvailable),Date.now(),result.repository.name);
        auditGithub(store,context.userId,previous?'github-pat-replaced':'github-pat-created',connectionId);
      }); return json({id:connectionId,...result});
    }
    if (body.action==='import-app') {
      const previous = body.appId ? appRecord(store,body.appId) : store.db.prepare("SELECT * FROM github_apps WHERE github_id=? AND status='removed'").get(body.githubId) as unknown as GithubApp | undefined;
      const appId = previous?.id ?? randomUUID();
      if (previous && (previous.github_id !== body.githubId || previous.client_id !== body.clientId || previous.owner_login.toLowerCase() !== body.owner.toLowerCase())) throw new Error();
      const candidate: GithubApp = {id:appId,github_id:githubId(body.githubId),client_id:body.clientId,slug:previous?.slug ?? '',owner_id:previous?.owner_id ?? '',owner_login:body.owner,owner_type:body.ownerType,origin:config.origin,
        private_key:body.privateKey ? appSeal(body.privateKey,config.secret,appId,'private_key') : previous?.private_key ?? '',client_secret:body.clientSecret ? appSeal(body.clientSecret,config.secret,appId,'client_secret') : previous?.client_secret ?? '',webhook_secret:body.webhookSecret ? appSeal(body.webhookSecret,config.secret,appId,'webhook_secret') : previous?.webhook_secret ?? '',credential_revision:previous?.credential_revision ?? 1,history:Number(body.history),webhook_mode:body.webhookMode,status:'registered'};
      appSecret(candidate,config.secret,'client_secret');
      if (candidate.webhook_secret) appSecret(candidate,config.secret,'webhook_secret');
      const verified = await verifyApp(candidate,config.secret,http); await context.recheck();
      store.transaction(()=>{
        if (previous && store.db.prepare('SELECT credential_revision FROM github_apps WHERE id=?').get(appId)?.credential_revision !== previous.credential_revision) throw new Error();
        store.db.prepare(`INSERT INTO github_apps(id,github_id,client_id,slug,owner_id,owner_login,owner_type,origin,private_key,client_secret,webhook_secret,history,webhook_mode,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'registered',?,?)
          ON CONFLICT(id) DO UPDATE SET status=CASE WHEN github_apps.status='removed' THEN 'registered' ELSE github_apps.status END,slug=excluded.slug,owner_id=excluded.owner_id,private_key=excluded.private_key,client_secret=excluded.client_secret,webhook_secret=excluded.webhook_secret,origin=excluded.origin,history=excluded.history,webhook_mode=excluded.webhook_mode,credential_revision=credential_revision+1,updated_at=excluded.updated_at`)
          .run(appId,candidate.github_id,candidate.client_id,verified.slug,verified.ownerId,candidate.owner_login,candidate.owner_type,config.origin,candidate.private_key,candidate.client_secret,candidate.webhook_secret,candidate.history,candidate.webhook_mode,Date.now(),Date.now());
        store.db.prepare("UPDATE github_setup_attempts SET status='cancelled',material='' WHERE app_id=? AND status IN ('pending','claimed')").run(appId);
        for (const c of store.db.prepare('SELECT c.id FROM source_connections c JOIN github_installations i ON i.id=c.installation_id WHERE i.app_id=?').all(appId)) invalidateConnection(store,String(c.id),'credentials-updated');
        store.db.prepare('UPDATE github_installations SET next_check=0 WHERE app_id=?').run(appId);
        auditGithub(store,context.userId,previous?'github-app-credentials-updated':'github-app-imported',appId);
      }); return json({appId});
    }
    if (body.action==='remove-app') {
      appRecord(store,body.appId);
      store.transaction(()=>{
        for (const c of store.db.prepare('SELECT c.id FROM source_connections c JOIN github_installations i ON i.id=c.installation_id WHERE i.app_id=?').all(body.appId)) invalidateConnection(store,String(c.id),'disconnected',true);
        store.db.prepare("UPDATE github_apps SET status='removed',private_key='',client_secret='',webhook_secret='',credential_revision=credential_revision+1 WHERE id=?").run(body.appId);
        store.db.prepare("UPDATE github_setup_attempts SET status='cancelled',material='' WHERE app_id=?").run(body.appId);
        auditGithub(store,context.userId,'github-app-removed',body.appId);
      }); return json({ok:true});
    }
    const c = store.db.prepare("SELECT * FROM source_connections WHERE id=? AND provider='github' AND auth_kind IN ('github_app','pat')").get(body.connectionId);
    if (!c) throw new Error();
    if (body.action==='disconnect') {
      store.transaction(()=>{
        invalidateConnection(store,body.connectionId,'disconnected',true);
        store.db.prepare("UPDATE source_connections SET credential='' WHERE id=?").run(body.connectionId);
        if (c.installation_id) store.db.prepare("UPDATE github_setup_attempts SET status='cancelled',material='' WHERE app_id IN (SELECT app_id FROM github_installations WHERE id=?)").run(c.installation_id);
        auditGithub(store,context.userId,'github-disconnected',body.connectionId);
      }); return json({ok:true});
    }
    if (c.disconnected) throw new Error();
    if (c.installation_id) await reconcileInstallation(store,String(c.installation_id),config.secret,http,context.recheck);
    else if(c.auth_kind==='pat') await reconcilePatConnection(store,String(c.id),config.secret,http,context.recheck);
    else {
      const result = await validatePat(unseal(String(c.credential),config.secret,`${c.id}:${c.origin}`),String(c.validation_repository),String(c.owner_login),!!c.history,http);
      await context.recheck();
      if (store.db.prepare('SELECT credential_version FROM source_connections WHERE id=?').get(c.id)?.credential_version!==c.credential_version || !result.privateVerified) throw new Error();
      store.db.prepare("UPDATE source_connections SET health='connected',validated_at=? WHERE id=?").run(Date.now(),c.id);
    }
    await context.recheck(); return json(githubSettings(store,config.origin));
  } catch (error) {
    if(error instanceof GithubError) return json({error:githubErrorMessage(error),reason:error.reason},400);
    const failure = githubSettingsFailure(error,stage); return json(failure.body,failure.status);
  }
}
