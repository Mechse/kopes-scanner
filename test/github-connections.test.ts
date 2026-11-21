import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, generateKeyPairSync, verify } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/server/store';
import { migrateSource, migrateGithubConnections } from '../src/server/source/schema';
import { seal, unseal } from '../src/server/source/credentials';
import { appRecord, appSeal, appJwt, appSecret, credentialProvider, installationToken, invalidateConnection, connectionRevision, purgeGithubTokens } from '../src/server/source/github-app';
import { GithubError, githubHttp, githubId, githubPages, type GithubHttp } from '../src/server/source/github-http';
import { startSetup, resumeSetup, setupState, claimSetup, setupCallback, expireSetup, manifest, type GithubContext } from '../src/server/source/github-setup';
import { handleGithub, githubSettings } from '../src/server/source/github-connections';
import { githubSettingsFailure } from '../src/server/source/github-settings-error';
import { githubSetupNotice, githubConnectionGroups } from '../src/lib/github';
import { validatePat } from '../src/server/source/github-pat';
import { reconcileInstallation, restrictInstallation, reconcileGithub } from '../src/server/source/github-reconcile';
import { githubWebhook, recoverGithubDeliveries } from '../src/server/source/github-webhook';
import { handleRepositories } from '../src/server/source/repositories';
import { enqueueSource, connectionFor } from '../src/server/source/service';
import { runSourceJob } from '../src/server/source/jobs';
import { readConfig } from '../src/server/config';

const config = {origin:'https://scanner.example',secret:'test-deployment-secret-at-least-32-characters'};
const {privateKey,publicKey} = generateKeyPairSync('rsa',{modulusLength:2048});
const pem = privateKey.export({type:'pkcs8',format:'pem'}).toString();
const context: GithubContext = {userId:'admin',sessionId:'session-a',recheck:async()=>{}};
const owner = {id:123,login:'owner',type:'User'};
const remoteApp = {external_url:config.origin,id:42,client_id:'client-id',slug:'kopes-test',owner,permissions:{contents:'read',metadata:'read'}};
const remoteInstallation = {id:321,app_id:42,account:owner,permissions:remoteApp.permissions,suspended_at:null,repository_selection:'selected'};
const remoteRepo = {id:99,full_name:'owner/private',default_branch:'main',private:true,owner};
const branch = {commit:{sha:'a'.repeat(40)}};
function fixture(t: any) {
  const s = new Store(':memory:'); t.after(()=>s.db.close());
  s.db.prepare("INSERT INTO github_apps(id,github_id,client_id,slug,owner_id,owner_login,owner_type,origin,private_key,client_secret,webhook_secret,webhook_mode,status,created_at,updated_at) VALUES ('app','42','client-id','kopes-test','123','owner','User',?,?,?,?,'polling','connected',1,1)")
    .run(config.origin,appSeal(pem,config.secret,'app','private_key'),appSeal('client-secret',config.secret,'app','client_secret'),appSeal('hook-secret',config.secret,'app','webhook_secret'));
  s.db.prepare("INSERT INTO github_installations(id,app_id,github_id,owner_id,owner_login,permissions,selection,status) VALUES ('install','app','321','123','owner',?,'selected','active')").run(JSON.stringify(remoteApp.permissions));
  s.db.exec("INSERT INTO source_connections(id,provider,origin,credential,auth_kind,label,installation_id,owner_login) VALUES ('connection','github','https://api.github.com','','github_app','Owner App','install','owner'); INSERT INTO source_repositories VALUES ('repo','github','https://api.github.com','99','owner/private'); INSERT INTO source_bindings(id,repository_id,connection_id,branch,folder,next_poll) VALUES ('binding','repo','connection','main','',9999999999999); INSERT INTO github_installation_repositories(installation_id,repository_id,name,private,status,generation,observed_at) VALUES ('install','99','owner/private',1,'active','first',1)");
  return s;
}
test('settings groups installation access with its App, not another credential for the same owner', t=>{
  const s=fixture(t);
  s.db.exec("INSERT INTO source_connections(id,provider,origin,credential,auth_kind,label,owner_login) VALUES ('token','github','https://api.github.com','','pat','Backup','owner')");
  const data=githubSettings(s,config.origin);
  const all=githubConnectionGroups(data,'owner');
  assert.deepEqual(all.apps.map(g=>[g.app.id,g.installations.map(c=>c.id)]),[['app',['connection']]]);
  assert.deepEqual(all.standalone.map(c=>c.id),['token']);
  assert.equal(githubConnectionGroups(data,'Owner App').apps.length,1);
  assert.equal(githubConnectionGroups(data,'Backup').apps.length,0);
  assert.equal(githubConnectionGroups({...data,connections:[]},'').apps.length,1);
});
const never = async()=>{throw new Error('Unexpected anonymous or legacy fallback');};
const api: GithubHttp = async request => {
  if(request.path==='/app')return remoteApp;
  if(request.path==='/app/installations/321')return remoteInstallation;
  if(request.path.endsWith('/access_tokens')) return {token:'opaque-installation-token',expires_at:new Date(Date.now()+3600_000).toISOString()};
  if(request.path.startsWith('/installation/repositories'))return {repositories:[remoteRepo]};
  if(request.path.startsWith('/repos/')||request.path.startsWith('/repositories/')) {
    if(request.path.includes('/branches/'))return branch;
    if(request.path.includes('/git/trees/'))return {tree:[{path:'package.json',mode:'100644',type:'blob'}],truncated:false};
    if(request.path.includes('/contents/'))return {type:'file',encoding:'base64',content:Buffer.from('{"name":"private-fixture"}').toString('base64')};
    if(request.path.includes('/pulls'))return [];
    return remoteRepo;
  }
  throw new Error('Unexpected fixture path');
};
function post(body: unknown,path='github') {return new Request(`${config.origin}/api/data/${path}`,{method:'POST',headers:{origin:config.origin},body:JSON.stringify(body)});}
function callback(step:string,state:string,extra:Record<string,string>={}) {return new Request(`${config.origin}/api/github/${step}/callback?${new URLSearchParams({state,...extra})}`);}
function hook(payload: unknown,event='installation',delivery='delivery-1',signature=true) {
  const raw = JSON.stringify(payload);return new Request(`${config.origin}/api/github/webhooks/app`,{method:'POST',headers:{'x-github-event':event,'x-github-delivery':delivery,'x-hub-signature-256':`sha256=${signature?createHmac('sha256','hook-secret').update(raw).digest('hex'):'0'.repeat(64)}`},body:raw});
}

test('prepare registration accepts trimmed owner on local HTTP polling without contacting GitHub',async t=>{
  const s=new Store(':memory:');t.after(()=>s.db.close());
  const local={...config,origin:'http://localhost:3100'};
  const request=new Request(local.origin+'/api/data/github',{method:'POST',headers:{origin:local.origin},body:JSON.stringify({action:'start',owner:'  owner  ',ownerType:'User',history:false,webhookMode:'polling'})});
  const response=await handleGithub(request,s,context,local,never), result=await response.json();
  assert.equal(response.status,200);assert.equal(result.manifest.url,local.origin);
  assert.equal(Object.hasOwn(result.manifest,'hook_attributes'),false);assert.deepEqual(result.manifest.default_events,[]);
  assert.equal(result.manifest.redirect_url,local.origin+'/api/github/manifest/callback');
  assert.equal(result.manifest.setup_url,local.origin+'/api/github/install/callback');
  assert.deepEqual(result.manifest.callback_urls,[local.origin+'/api/github/authorize/callback']);
  const app=appRecord(s,result.appId);assert.equal(app.owner_login,'owner');
  const state=new URL(result.action).searchParams.get('state')!;
  assert.equal(claimSetup(s,state,'manifest',context)!.owner_login,'owner');
  assert.throws(()=>claimSetup(s,state,'manifest',context));
});
test('prepare registration distinguishes invalid input, local webhooks, schema and write failures without leaking data',async t=>{
  const s=new Store(':memory:');t.after(()=>s.db.close());
  const body={action:'start',owner:'owner',ownerType:'User',webhookMode:'polling'};
  for(const invalid of ['@owner','https://github.com/owner','Owner Name']) {
    const response=await handleGithub(post({...body,owner:invalid}),s,context,config,never), result=await response.json();
    assert.equal(response.status,400);assert.equal(result.reason,'invalid-input');assert.match(result.error,/without @/);assert.ok(!result.error.includes(invalid));
  }
  const local={...config,origin:'http://localhost:3100'};
  const response=await handleGithub(new Request(local.origin+'/api/data/github',{method:'POST',headers:{origin:local.origin},body:JSON.stringify({...body,webhookMode:'webhook'})}),s,context,local,never);
  assert.equal((await response.json()).reason,'webhook-origin');
  const malformed=await handleGithub(new Request(config.origin+'/api/data/github',{method:'POST',headers:{origin:config.origin},body:'{"token":"secret-invalid-json'}),s,context,config,never);
  const invalidJson=await malformed.json();assert.equal(invalidJson.reason,'invalid-json');assert.ok(!JSON.stringify(invalidJson).includes('secret-invalid-json'));
  assert.equal(s.db.prepare('SELECT count(*) n FROM github_apps').get()!.n,0);
  s.db.exec('PRAGMA query_only=ON');
  const readonly=await handleGithub(post(body),s,context,config,never);
  assert.equal(readonly.status,500);assert.equal((await readonly.json()).reason,'database-write');
  s.db.exec('PRAGMA query_only=OFF; ALTER TABLE github_apps RENAME COLUMN webhook_mode TO old_webhook_mode');
  const schema=await handleGithub(post(body),s,context,config,never);
  assert.equal(schema.status,500);assert.equal((await schema.json()).reason,'database-schema');
});
test('settings errors redact arbitrary messages, SQL and authorization response bodies',async t=>{
  for(const [error,reason] of [
    [new Error('secret-token https://private.example/?state=secret-code'),'unexpected'],
    [Object.assign(new Error('secret SQL'),{code:'ERR_SQLITE_ERROR',errcode:5}),'database-busy'],
    [Object.assign(new Error('secret SQL'),{code:'ERR_SQLITE_ERROR',errcode:13}),'storage-full'],
    [Object.assign(new Error('secret SQL'),{code:'ERR_SQLITE_ERROR',errcode:1032}),'database-write'],
    [new Response('secret session details',{status:403}),'administrator-session'],
  ] as const) {
    const failure=githubSettingsFailure(error,'start');assert.equal(failure.body.reason,reason);assert.ok(!JSON.stringify(failure).includes('secret'));
  }
  const s=new Store(':memory:');t.after(()=>s.db.close());let checks=0;
  const response=await handleGithub(post({action:'start',owner:'owner',ownerType:'User'}),s,{...context,recheck:async()=>{if(++checks>1)throw new Response('secret',{status:403});}},config,never);
  assert.equal(response.status,403);assert.equal((await response.json()).reason,'administrator-session');
  assert.equal(s.db.prepare('SELECT count(*) n FROM github_apps').get()!.n,0);
});

test('v15 migration keeps legacy secrets, history and identity, backfills kinds and reopens idempotently',()=>{
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON; CREATE TABLE projects(id TEXT PRIMARY KEY); CREATE TABLE resources(id TEXT PRIMARY KEY);');migrateSource(db);
    const encrypted = seal('original-token',config.secret,'pat:https://api.github.com');
    db.prepare("INSERT INTO source_connections(id,provider,origin,credential) VALUES ('pat','github','https://api.github.com',?)").run(encrypted);
    db.exec("INSERT INTO source_connections(id,provider,origin,credential) VALUES ('public','github','https://api.github.com',''),('gitlab','gitlab','https://gitlab.com','legacy-cipher'); PRAGMA user_version=14");
    migrateGithubConnections(db);migrateGithubConnections(db);
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version,15);
    assert.equal(db.prepare("SELECT auth_kind FROM source_connections WHERE id='pat'").get()!.auth_kind,'legacy_pat');
    assert.equal(db.prepare("SELECT auth_kind FROM source_connections WHERE id='gitlab'").get()!.auth_kind,'legacy_token');
    assert.equal(db.prepare("SELECT auth_kind FROM source_connections WHERE id='public'").get()!.auth_kind,'anonymous');
    assert.equal(unseal(String(db.prepare("SELECT credential FROM source_connections WHERE id='pat'").get()!.credential),config.secret,'pat:https://api.github.com'),'original-token');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally {db.close();}
});
test('App empty static credentials are never anonymous or usable by synchronous legacy resolution',t=>{
  const s=fixture(t);assert.throws(()=>connectionFor(s,'connection',config.secret));
  assert.equal(s.db.prepare("SELECT count(*) n FROM source_connections WHERE auth_kind='anonymous'").get()!.n,0);
  assert.throws(()=>appSecret(appRecord(s,'app'),'wrong-secret','private_key'),/Credentials unavailable/);
  assert.throws(()=>unseal(appRecord(s,'app').private_key,config.secret,'kopes.github.v1:other:private_key'));
});
test('JWT uses client ID, RS256 and bounded skew; secret material is not serialized to settings',t=>{
  const s=fixture(t),now=Date.now(),jwt=appJwt('client-id',pem,now),[header,claims,signature]=jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header,'base64url').toString()),{alg:'RS256',typ:'JWT'});
  assert.deepEqual(JSON.parse(Buffer.from(claims,'base64url').toString()),{iss:'client-id',iat:Math.floor(now/1000)-60,exp:Math.floor(now/1000)+540});
  assert.ok(verify('RSA-SHA256',Buffer.from(`${header}.${claims}`),publicKey,Buffer.from(signature,'base64url')));
  assert.throws(()=>appJwt('client-id',pem,0),/clock/);
  const settings=JSON.stringify(githubSettings(s,config.origin));
  for(const forbidden of [pem,'client-secret','hook-secret',appRecord(s,'app').private_key])assert.ok(!settings.includes(forbidden));
});
test('token scopes, concurrent refresh, opaque long tokens, expiry and credential revisions isolate caches',async t=>{
  const s=fixture(t),requests:any[]=[],longToken='opaque'+'.'.repeat(9000);
  const http:GithubHttp=async r=>{requests.push(r);await Promise.resolve();return {token:longToken,expires_at:new Date(Date.now()+3600_000).toISOString()};};
  const tokens=await Promise.all(Array.from({length:12},()=>installationToken(s,'install',config.secret,'99',http)));
  assert.equal(requests.length,1);assert.ok(tokens.every(t=>t===longToken));assert.deepEqual(requests[0].body,{permissions:{contents:'read'},repository_ids:[99]});
  await installationToken(s,'install',config.secret,'100',http);assert.equal(requests.length,2);
  await installationToken(s,'install',config.secret,undefined,http);assert.equal(requests.length,3);
  assert.equal(requests[2].body.repository_ids,undefined);
  s.db.exec("UPDATE github_apps SET credential_revision=credential_revision+1");await installationToken(s,'install',config.secret,'99',http);assert.equal(requests.length,4);
  purgeGithubTokens(s);await assert.rejects(installationToken(s,'install',config.secret,'99',async()=>({token:'expired',expires_at:new Date().toISOString()})),/expired/);
});
test('App reads renew once on 401 without credential fallback and reject changed revisions after awaits',async t=>{
  const s=fixture(t);let mints=0,reads=0;
  const http:GithubHttp=async r=>{if(r.path.endsWith('/access_tokens')){mints++;return {token:`token-${mints}`,expires_at:new Date(Date.now()+3600_000).toISOString()};}if(++reads===1)throw new GithubError(401,'access');return remoteRepo;};
  const access=credentialProvider(s,'connection',config.secret,never,'99',http);
  assert.equal((await access.provider.repository('99')).providerId,'99');assert.equal(mints,2);assert.equal(reads,2);
  const changed=credentialProvider(s,'connection',config.secret,never,'99',async r=>{const result=await api(r);invalidateConnection(s,'connection','changed');return result;});
  await assert.rejects(changed.provider.repository('99'),/changed/);
});
test('a second 401 cancels work; rate limits do not revoke a connection',async t=>{
  const s=fixture(t);enqueueSource(s,'binding');const before=connectionRevision(s,'connection','99');
  await assert.rejects(credentialProvider(s,'connection',config.secret,never,'99',async r=>{if(r.path.endsWith('/access_tokens'))return api(r);throw new GithubError(403,'rate-limit',Date.now()+60_000);}).provider.repository('99'));
  assert.equal(connectionRevision(s,'connection','99'),before);
  await assert.rejects(credentialProvider(s,'connection',config.secret,never,'99',async r=>{if(r.path.endsWith('/access_tokens'))return api(r);throw new GithubError(401,'access');}).provider.repository('99'));
  assert.equal(s.db.prepare('SELECT state FROM source_jobs').get()!.state,'cancelled');
});
test('fixed-host transport rejects cross-host OAuth/bearer combinations and malformed paths without sending',async()=>{
  for(const request of [{path:'//evil.test'},{path:'https://evil.test'},{path:'/app',oauth:true,method:'POST' as const},{path:'/login/oauth/access_token',oauth:true,method:'POST' as const,token:'secret'},{path:'/app\\evil'}])await assert.rejects(githubHttp(request));
  for(const value of [0,-1,'-2','2.5','1e3',Number.MAX_SAFE_INTEGER+1])assert.throws(()=>githubId(value));
});
test('single-use setup state is session/user/step bound, expires, survives reads and is purged on restart',async t=>{
  const s=fixture(t),app=appRecord(s,'app');
  const state=setupState(s,app,context,'install',config.secret);
  for(const other of [{...context,userId:'other'},{...context,sessionId:'other'}])assert.throws(()=>claimSetup(s,state,'install',other));
  assert.throws(()=>claimSetup(s,state,'authorize',context));
  claimSetup(s,state,'install',context);assert.throws(()=>claimSetup(s,state,'install',context));
  const expired=setupState(s,app,context,'install',config.secret);s.db.exec('UPDATE github_setup_attempts SET expires_at=1');assert.throws(()=>claimSetup(s,expired,'install',context));
  const restart=setupState(s,app,context,'install',config.secret);expireSetup(s,true);assert.throws(()=>claimSetup(s,restart,'install',context));
  assert.equal(s.db.prepare("SELECT count(*) n FROM github_setup_attempts WHERE material<>''").get()!.n,0);
});
test('manifest registration uses canonical URLs and polling mode, persists encrypted credentials before failed verification',async t=>{
  const s=new Store(':memory:');t.after(()=>s.db.close());
  const start=await startSetup(s,context,config,{owner:'owner',ownerType:'User',history:false,webhookMode:'polling'});
  assert.equal(start.manifest.public,false);assert.deepEqual(start.manifest.default_events,[]);assert.equal(Object.hasOwn(start.manifest,'hook_attributes'),false);
  const state=new URL(start.action).searchParams.get('state')!;let conversions=0;
  const http:GithubHttp=async r=>{if(r.path.includes('/conversions')){conversions++;return {...remoteApp,pem,client_secret:'client-secret',webhook_secret:'hook-secret'};}throw new GithubError(503,'temporary');};
  const result=await setupCallback(callback('manifest',state,{code:'conversion-code'}),s,context,config,http);
  assert.equal(result.status,303);assert.equal(result.headers.get('Referrer-Policy'),'no-referrer');assert.equal(result.headers.get('Location'),config.origin+'/settings?tab=integrations&section=github&githubSetup=verification');
  const saved=appRecord(s,start.appId);assert.equal(saved.status,'verification-failed');assert.equal(appSecret(saved,config.secret,'private_key'),pem);
  await setupCallback(callback('manifest',state,{code:'conversion-code'}),s,context,config,http);assert.equal(conversions,1);
  const resumed=await resumeSetup(s,start.appId,context,config,api);assert.match(resumed.url,/installations\/new\?state=/);
});
test('polling manifest conversion accepts absent webhook secrets and still saves App credentials securely',async t=>{
  for (const webhook_secret of [null,undefined,'']) {
    const s=new Store(':memory:');t.after(()=>s.db.close());
    const start=await startSetup(s,context,config,{owner:'owner',ownerType:'User',history:false,webhookMode:'polling'});
    const state=new URL(start.action).searchParams.get('state')!;let conversions=0;
    const http:GithubHttp=async r=>{
      if(r.path.includes('/conversions')) {conversions++;return {...remoteApp,pem,client_secret:'client-secret',webhook_secret};}
      return api(r);
    };
    const result=await setupCallback(callback('manifest',state,{code:'one-use-code'}),s,context,config,http);
    assert.match(result.headers.get('Location')!,/^https:\/\/github.com\/apps\/kopes-test\/installations\/new\?state=/);
    const saved=appRecord(s,start.appId);assert.equal(saved.status,'pending-installation');assert.equal(saved.webhook_secret,'');
    assert.notEqual(saved.private_key,pem);assert.equal(appSecret(saved,config.secret,'private_key'),pem);assert.equal(appSecret(saved,config.secret,'client_secret'),'client-secret');
    assert.equal(s.db.prepare('SELECT count(*) n FROM source_connections').get()!.n,0);
    await setupCallback(callback('manifest',state,{code:'one-use-code'}),s,context,config,http);assert.equal(conversions,1);
  }
});
test('webhook mode retains converted credentials but blocks installation without a webhook secret',async t=>{
  const s=new Store(':memory:');t.after(()=>s.db.close());
  const start=await startSetup(s,context,config,{owner:'owner',ownerType:'User',history:false,webhookMode:'webhook'});
  const state=new URL(start.action).searchParams.get('state')!;
  const result=await setupCallback(callback('manifest',state,{code:'one-use-code'}),s,context,config,async()=>({...remoteApp,pem,client_secret:'client-secret',webhook_secret:null}));
  assert.equal(new URL(result.headers.get('Location')!).searchParams.get('githubSetup'),'verification');
  assert.equal(appSecret(appRecord(s,start.appId),config.secret,'private_key'),pem);
  const resume=await handleGithub(post({action:'resume',appId:start.appId}),s,context,config,never);
  assert.equal(resume.status,400);assert.equal((await resume.json()).reason,'webhook-secret');
  assert.equal(s.db.prepare('SELECT count(*) n FROM source_connections').get()!.n,0);
});
test('polling App imports need no webhook secret and empty secrets cannot authenticate webhooks',async t=>{
  const s=new Store(':memory:');t.after(()=>s.db.close());
  const body={action:'import-app',githubId:'42',clientId:'client-id',owner:'owner',ownerType:'User',privateKey:pem,clientSecret:'client-secret',webhookSecret:'',webhookMode:'polling',urlsConfirmed:true};
  const response=await handleGithub(post(body),s,context,config,api);assert.equal(response.status,200);
  const {appId}=await response.json();assert.equal(appRecord(s,appId).webhook_secret,'');
  const enabled=await handleGithub(post({...body,appId,webhookMode:'webhook'}),s,context,config,api);
  assert.equal(enabled.status,400);assert.equal((await enabled.json()).reason,'webhook-secret');assert.equal(appRecord(s,appId).webhook_mode,'polling');
  for (const stored of ['',appSeal('',config.secret,appId,'webhook_secret')]) {
    s.db.prepare('UPDATE github_apps SET webhook_secret=? WHERE id=?').run(stored,appId);
    const raw='{}',signature=createHmac('sha256','').update(raw).digest('hex');
    const request=new Request(config.origin+'/api/github/webhooks/'+appId,{method:'POST',headers:{'x-hub-signature-256':'sha256='+signature,'x-github-event':'ping','x-github-delivery':'empty-secret'},body:raw});
    assert.equal((await githubWebhook(request,s,config.secret,appId)).status,401);
  }
  assert.equal(s.db.prepare('SELECT count(*) n FROM github_webhook_deliveries').get()!.n,0);
});
test('callback failures redirect with fixed notices and never expose provider errors or callback secrets',async t=>{
  const s=new Store(':memory:');t.after(()=>s.db.close());
  for (const phase of ['exchange','credentials'] as const) {
    const start=await startSetup(s,context,config,{owner:'owner',ownerType:'User',history:false,webhookMode:'polling'});
    const state=new URL(start.action).searchParams.get('state')!;
    const result=await setupCallback(callback('manifest',state,{code:'secret-code'}),s,context,config,async()=>{if(phase==='exchange')throw new Error('secret-provider-response');return {pem:'secret-key'};});
    const location=result.headers.get('Location')!;
    assert.equal(location,config.origin+'/settings?tab=integrations&section=github&githubSetup='+phase);assert.ok(!location.includes('secret'));assert.ok(!location.includes(state));
    assert.equal(result.headers.get('Referrer-Policy'),'no-referrer');assert.equal(appRecord(s,start.appId).private_key,'');
  }
  assert.equal(githubSetupNotice('verification'),'verification');
  for(const value of ['secret-code','__proto__','constructor',null,{}])assert.equal(githubSetupNotice(value),undefined);
});
test('organization manifest requests only selected permissions; domain changes block resume',async t=>{
  const s=new Store(':memory:');t.after(()=>s.db.close());
  const result=await startSetup(s,context,config,{owner:'org',ownerType:'Organization',history:true,webhookMode:'webhook'});
  assert.match(result.action,/organizations\/org\/settings\/apps\/new/);assert.deepEqual(result.manifest.default_permissions,{contents:'read',pull_requests:'read'});
  assert.deepEqual(result.manifest.hook_attributes,{url:`${config.origin}/api/github/webhooks/${result.appId}`,active:true});
  assert.deepEqual(result.manifest.default_events,['push']);
  const app=appRecord(s,result.appId);assert.ok(Object.values(manifest(app)).length);
  await assert.rejects(resumeSetup(s,result.appId,context,{...config,origin:'https://other.example'},api),/origin/);
});
async function authorization(s:Store) {
  const state=setupState(s,appRecord(s,'app'),context,'install',config.secret);
  const response=await setupCallback(callback('install',state,{installation_id:'321'}),s,context,config,api);
  const redirect=new URL(response.headers.get('Location')!);assert.equal(redirect.searchParams.get('code_challenge_method'),'S256');
  return {state:redirect.searchParams.get('state')!,challenge:redirect.searchParams.get('code_challenge')!};
}
function authorizationApi(challenge:string,alter?:(path:string,value:any)=>any):GithubHttp {return async r=>{
  let value:any;
  if(r.oauth){assert.equal(createHash('sha256').update(String(r.body?.code_verifier)).digest('base64url'),challenge);value={access_token:'temporary-user-token',refresh_token:'must-not-persist'};}
  else if(r.path==='/user')value={id:100};
  else if(r.path.startsWith('/user/installations/321/repositories'))value={repositories:[remoteRepo]};
  else if(r.path.startsWith('/user/installations?'))value={installations:[remoteInstallation]};
  else value=await api(r);
  return alter?alter(r.path,value):value;
};}
test('installation hint alone never activates access; independent user+App verification and PKCE complete association',async t=>{
  const s=fixture(t);s.db.exec("UPDATE source_connections SET disconnected=1; UPDATE github_apps SET status='pending-installation'; UPDATE github_installations SET status='pending'");
  const auth=await authorization(s);assert.equal(s.db.prepare('SELECT disconnected FROM source_connections').get()!.disconnected,1);
  const result=await setupCallback(callback('authorize',auth.state,{code:'user-code'}),s,context,config,authorizationApi(auth.challenge));
  assert.equal(result.headers.get('Location'),config.origin+'/settings');assert.equal(s.db.prepare('SELECT disconnected FROM source_connections').get()!.disconnected,0);
  assert.equal(appRecord(s,'app').status,'connected');
  const material=JSON.stringify(s.db.prepare('SELECT * FROM github_setup_attempts').all());assert.ok(!material.includes('temporary-user-token')&&!material.includes('must-not-persist'));assert.equal(s.db.prepare("SELECT count(*) n FROM github_setup_attempts WHERE material<>''").get()!.n,0);
});
for(const scenario of ['forged-installation','wrong-owner','wrong-app','suspended','pending-approval','pkce-failure','revoked-admin','disconnect-race'] as const)test(`setup fails closed: ${scenario}`,async t=>{
  const s=fixture(t);s.db.exec("UPDATE source_connections SET disconnected=1");const auth=await authorization(s);let revoked=false;
  const http=authorizationApi(auth.challenge,(path,value)=>{
    if(path==='/login/oauth/access_token'&&scenario==='pkce-failure')throw new GithubError(400,'invalid');
    if(path.startsWith('/user/installations?')) {
      if(scenario==='pending-approval'||scenario==='forged-installation')return {installations:[]};
      if(scenario==='wrong-owner')return {installations:[{...remoteInstallation,account:{...owner,id:999}}]};
      if(scenario==='wrong-app')return {installations:[{...remoteInstallation,app_id:999}]};
      if(scenario==='suspended')return {installations:[{...remoteInstallation,suspended_at:new Date().toISOString()}]};
    }
    if(path==='/app/installations/321') {
      if(scenario==='revoked-admin')revoked=true;
      if(scenario==='disconnect-race')s.db.exec("UPDATE github_setup_attempts SET status='cancelled',material=''");
    }
    return value;
  });
  await setupCallback(callback('authorize',auth.state,{code:'code'}),s,{...context,recheck:async()=>{if(revoked)throw new Error('Admin revoked');}},config,http);
  assert.equal(s.db.prepare('SELECT disconnected FROM source_connections').get()!.disconnected,1);
});
test('unsolicited, missing and tampered installation callbacks cannot create a connection',async t=>{
  const s=fixture(t);s.db.exec("UPDATE source_connections SET disconnected=1");
  for(const state of ['', 'x'.repeat(43)])await setupCallback(callback('install',state,{installation_id:'321'}),s,context,config,never);
  const state=setupState(s,appRecord(s,'app'),context,'install',config.secret);await setupCallback(callback('install',state),s,context,config,never);
  assert.equal(s.db.prepare('SELECT disconnected FROM source_connections').get()!.disconnected,1);
});
test('PAT validation requires private metadata, branch, tree and actual supported input reads; optional PR failure is separate',async()=>{
  const paths:string[]=[];const result=await validatePat('opaque-token','owner/private','owner',true,async r=>{paths.push(r.path);if(r.path.includes('/pulls'))throw new GithubError(403,'access');return api(r);});
  assert.equal(result.privateVerified,true);assert.equal(result.inputCount,1);assert.equal(result.historyAvailable,false);assert.ok(paths.some(p=>p.includes('/contents/')));
  await assert.rejects(validatePat('opaque-token','owner/private','owner',false,async r=>{if(r.path.includes('/contents/'))throw new GithubError(403,'access');return api(r);}));
  const publicResult=await validatePat('opaque-token','owner/private','owner',false,async r=>{const value=await api(r);return r.path==='/repos/owner/private'?{...value,private:false}:value;});assert.equal(publicResult.privateVerified,false);assert.match(publicResult.warning!,/Public reads/);
});
test('PAT save retests exact credentials, failed replacement retains secret, blank retains, expiry and disconnect stop future reads',async t=>{
  const s=new Store(':memory:');t.after(()=>s.db.close());
  const body={action:'save-pat',label:'Private token',owner:'owner',token:'working-token',repository:'owner/private',history:false};
  let response=await handleGithub(post(body),s,context,config,api);assert.equal(response.status,200);const {id}=await response.json();
  const before=s.db.prepare('SELECT * FROM source_connections WHERE id=?').get(id)!;
  response=await handleGithub(post({...body,connectionId:id,token:'bad-token'}),s,context,config,async()=>{throw new GithubError(401,'access');});assert.equal(response.status,400);
  assert.equal(s.db.prepare('SELECT credential FROM source_connections WHERE id=?').get(id)!.credential,before.credential);
  response=await handleGithub(post({...body,connectionId:id,token:''}),s,context,config,async r=>{assert.equal(r.token,'working-token');return api(r);});assert.equal(response.status,200);
  assert.equal(githubSettings(s,config.origin).connections[0].expires_at,null);
  const reader=credentialProvider(s,id,config.secret,never,undefined,api);
  await handleGithub(post({action:'disconnect',connectionId:id}),s,context,config,api);await assert.rejects(reader.provider.repository('99'));
  assert.equal(s.db.prepare('SELECT credential FROM source_connections WHERE id=?').get(id)!.credential,'');
});
test('PAT test never persists secrets; public and empty repository validation do not pass private gate',async t=>{
  const s=new Store(':memory:');t.after(()=>s.db.close());const body={action:'test-pat',label:'Test',owner:'owner',token:'test-token',repository:'owner/private'};
  await handleGithub(post(body),s,context,config,api);assert.equal(s.db.prepare('SELECT count(*) n FROM source_connections').get()!.n,0);
  const response=await handleGithub(post({...body,action:'save-pat'}),s,context,config,async r=>r.path==='/repos/owner/private'?{...remoteRepo,private:false}:api(r));assert.equal(response.status,400);
  const empty=await validatePat('token','owner/private','owner',false,async r=>{if(r.path.includes('/branches/'))throw new GithubError(409,'temporary');return api(r);});assert.equal(empty.readiness,'empty-repository');assert.equal(empty.privateVerified,false);
});
test('reconciliation stages full pagination; interrupted lists preserve access, complete removal blocks and recovery restores',async t=>{
  const s=fixture(t);enqueueSource(s,'binding');
  await reconcileInstallation(s,'install',config.secret,async r=>{if(r.path.startsWith('/installation/repositories')) {if(r.path.includes('page=2'))throw new GithubError(503,'temporary');return {repositories:Array.from({length:100},(_,i)=>({...remoteRepo,id:1000+i}))};}return api(r);});
  assert.equal(s.db.prepare('SELECT status FROM github_installation_repositories WHERE repository_id=?').get('99')!.status,'active');
  await reconcileInstallation(s,'install',config.secret,async r=>r.path.startsWith('/installation/repositories')?{repositories:[]}:api(r));
  assert.equal(s.db.prepare('SELECT access_status FROM source_bindings').get()!.access_status,'blocked');assert.equal(s.db.prepare('SELECT state FROM source_jobs').get()!.state,'cancelled');
  await reconcileInstallation(s,'install',config.secret,api);assert.equal(s.db.prepare('SELECT access_status FROM source_bindings').get()!.access_status,'active');
});
test('late authoritative responses cannot restore a suspension or disconnect occurring during listing',async t=>{
  const s=fixture(t);await reconcileInstallation(s,'install',config.secret,async r=>{const result=await api(r);if(r.path.startsWith('/installation/repositories'))restrictInstallation(s,'install','suspended');return result;});
  assert.equal(s.db.prepare('SELECT status FROM github_installations').get()!.status,'suspended');assert.throws(()=>connectionRevision(s,'connection','99'));
});
test('signed lifecycle webhooks work with scanning disabled, deduplicate, store no bodies, and never restore on unsuspend alone',async t=>{
  const s=fixture(t);enqueueSource(s,'binding');const payload={action:'suspend',installation:remoteInstallation,private_commit_message:'DO-NOT-PERSIST'};
  assert.equal((await githubWebhook(hook(payload,'installation','bad',false),s,config.secret,'app')).status,401);
  assert.equal((await githubWebhook(hook(payload),s,config.secret,'app')).status,202);
  const revision=s.db.prepare('SELECT access_revision FROM github_installations').get()!.access_revision;
  await githubWebhook(hook(payload),s,config.secret,'app');assert.equal(s.db.prepare('SELECT access_revision FROM github_installations').get()!.access_revision,revision);
  assert.equal(s.db.prepare('SELECT state FROM source_jobs').get()!.state,'cancelled');
  assert.ok(!JSON.stringify(s.db.prepare('SELECT * FROM github_webhook_deliveries').all()).includes('DO-NOT-PERSIST'));
  await githubWebhook(hook({action:'unsuspend',installation:remoteInstallation},'installation','unsuspend'),s,config.secret,'app');assert.equal(s.db.prepare('SELECT status FROM github_installations').get()!.status,'suspended');
  await reconcileInstallation(s,'install',config.secret,api);assert.equal(s.db.prepare('SELECT status FROM github_installations').get()!.status,'active');
});
test('repository removal blocks only affected bindings; queued durable receipts recover, unknown installations never activate',async t=>{
  const s=fixture(t);
  await githubWebhook(hook({action:'removed',installation:remoteInstallation,repositories_removed:[{id:99}]},'installation_repositories'),s,config.secret,'app');assert.equal(s.db.prepare('SELECT access_status FROM source_bindings').get()!.access_status,'blocked');
  s.db.prepare("INSERT INTO github_webhook_deliveries(app_id,delivery_id,event,metadata,received_at) VALUES ('app','restart','installation',?,?)").run(JSON.stringify({installation:'321',action:'deleted'}),Date.now());recoverGithubDeliveries(s);assert.equal(s.db.prepare("SELECT state FROM github_webhook_deliveries WHERE delivery_id='restart'").get()!.state,'complete');
  await githubWebhook(hook({action:'created',installation:{...remoteInstallation,id:999}},'installation','new'),s,config.secret,'app');assert.equal(s.db.prepare('SELECT count(*) n FROM github_installations').get()!.n,1);
});
test('webhooks reject oversized, malformed and wrong App/owner relationships',async t=>{
  const s=fixture(t);
  for(const payload of [null,[],{action:'deleted',installation:{...remoteInstallation,app_id:999}},{action:'deleted',installation:{...remoteInstallation,account:{id:999}}},{action:'deleted',installation:{}},{junk:'x'.repeat(1024*1024)}])assert.equal((await githubWebhook(hook(payload),s,config.secret,'app')).status,400);
  assert.equal(s.db.prepare('SELECT status FROM github_installations').get()!.status,'active');
});
test('settings require current admin and same origin; revocation during PAT reads leaves no credentials',async t=>{
  const s=new Store(':memory:');t.after(()=>s.db.close());
  await assert.rejects(handleGithub(new Request(config.origin+'/api/data/github'),s,{...context,recheck:async()=>{throw new Error('No admin');}},config,api));
  assert.equal((await handleGithub(new Request(config.origin+'/api/data/github',{method:'POST',body:'{}'}),s,context,config,api)).status,403);
  let revoked=false;const response=await handleGithub(post({action:'save-pat',label:'Token',owner:'owner',token:'secret',repository:'owner/private'}),s,{...context,recheck:async()=>{if(revoked)throw new Error();}},config,async r=>{revoked=true;return api(r);});assert.equal(response.status,400);assert.equal(s.db.prepare('SELECT count(*) n FROM source_connections').get()!.n,0);
});
test('polling alone detects installation suspension and PAT revocation without worker flags',async t=>{
  const s=fixture(t);await reconcileGithub(s,config.secret,async r=>r.path==='/app/installations/321'?{...remoteInstallation,suspended_at:'2026-11-15'}:api(r));assert.throws(()=>connectionRevision(s,'connection','99'));
  s.db.prepare("INSERT INTO source_connections(id,provider,origin,credential,auth_kind,owner_login,validation_repository) VALUES ('pat','github','https://api.github.com',?,'pat','owner','owner/private')").run(seal('token',config.secret,'pat:https://api.github.com'));
  await reconcileGithub(s,config.secret,async()=>{throw new GithubError(401,'access');});assert.equal(s.db.prepare("SELECT credential_version FROM source_connections WHERE id='pat'").get()!.credential_version,2);
});

test('repository selection is explicit, scoped and server-resolved; switching preserves immutable identity and project/history',async t=>{
  const s=fixture(t);const admin={userId:'admin',administrator:true};
  let scopes:any[]=[];
  const http:GithubHttp=async r=>{if(r.path.endsWith('/access_tokens'))scopes.push(r.body);return api(r);};
  const added=await handleRepositories(post({action:'add',connectionId:'connection',repository:'owner/private'},'repositories'),s,admin,config.origin,never,config.secret,context.recheck,http);
  assert.equal(added.status,200);assert.ok(scopes.every(s=>JSON.stringify(s.repository_ids)==='[99]'));
  const excluded=await handleRepositories(post({action:'add',connectionId:'connection',repository:'owner/excluded'},'repositories'),s,admin,config.origin,never,config.secret,context.recheck,http);assert.equal(excluded.status,400);
  const anonymous=await handleRepositories(post({action:'add',repository:'owner/private'},'repositories'),s,admin,config.origin,async c=>{assert.equal(c.token,'');throw new GithubError(404,'unavailable');},config.secret);assert.equal(anonymous.status,400);
  s.db.prepare("INSERT INTO source_connections(id,provider,origin,credential,auth_kind,owner_login) VALUES ('pat','github','https://api.github.com',?,'pat','owner')").run(seal('private-token',config.secret,'pat:https://api.github.com'));
  const before=s.db.prepare("SELECT repository_id,project_id FROM source_bindings WHERE id='binding'").get();
  const switched=await handleRepositories(post({action:'switch',bindingId:'binding',connectionId:'pat'},'repositories'),s,admin,config.origin,never,config.secret,context.recheck,http);assert.equal(switched.status,200);
  assert.deepEqual(s.db.prepare("SELECT repository_id,project_id FROM source_bindings WHERE id='binding'").get(),before);
  const mismatch=await handleRepositories(post({action:'switch',bindingId:'binding',connectionId:'connection'},'repositories'),s,admin,config.origin,never,config.secret,context.recheck,async r=>r.path==='/repositories/99'?{...remoteRepo,id:100}:api(r));assert.equal(mismatch.status,400);
  assert.equal(s.db.prepare("SELECT connection_id FROM source_bindings WHERE id='binding'").get()!.connection_id,'pat');
});
test('App key rotation verifies before replacing; disconnect and removal retain evidence but erase local secrets',async t=>{
  const s=fixture(t),original=appRecord(s,'app').private_key;
  const body={action:'import-app',appId:'app',githubId:'42',clientId:'client-id',owner:'owner',ownerType:'User',privateKey:'invalid-key',clientSecret:'',webhookSecret:'',urlsConfirmed:true};
  assert.equal((await handleGithub(post(body),s,context,config,api)).status,400);assert.equal(appRecord(s,'app').private_key,original);
  const reader=credentialProvider(s,'connection',config.secret,never,'99',api);
  assert.equal((await handleGithub(post({...body,privateKey:pem}),s,context,config,api)).status,200);
  await assert.rejects(reader.provider.repository('99'),/changed/);
  assert.equal((await handleGithub(post({action:'remove-app',appId:'app'}),s,context,config,api)).status,200);
  const removed=s.db.prepare("SELECT * FROM github_apps WHERE id='app'").get()!;for(const field of ['private_key','client_secret','webhook_secret'])assert.equal(removed[field],'');
  assert.equal(s.db.prepare('SELECT count(*) n FROM source_bindings').get()!.n,1);
});
test('partial paginated totals never qualify as complete access snapshots',async()=>{
  await assert.rejects(githubPages(async()=>({repositories:[],total_count:5}),'/installation/repositories','opaque','repositories'),/Incomplete/);
});
test('push only schedules explicitly bound tracked branches and never trusts webhook head SHAs',async t=>{
  const s=fixture(t);
  await githubWebhook(hook({installation:remoteInstallation,repository:remoteRepo,ref:'refs/tags/main',after:'b'.repeat(40)},'push','tag'),s,config.secret,'app');
  assert.equal(s.db.prepare('SELECT next_poll FROM source_bindings').get()!.next_poll,9999999999999);
  await githubWebhook(hook({installation:remoteInstallation,repository:remoteRepo,ref:'refs/heads/main',after:'b'.repeat(40)},'push','branch'),s,config.secret,'app');
  assert.equal(s.db.prepare('SELECT next_poll FROM source_bindings').get()!.next_poll,0);assert.equal(s.db.prepare('SELECT head_sha FROM source_bindings').get()!.head_sha,null);
});
test('encrypted App credentials survive database reopen; pending setup can be explicitly invalidated after restore',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'github-reopen-'));let s=new Store(dir);
  try {
    const start=await startSetup(s,context,config,{owner:'owner',ownerType:'User',history:false,webhookMode:'polling'});
    s.db.prepare('UPDATE github_apps SET private_key=? WHERE id=?').run(appSeal(pem,config.secret,start.appId,'private_key'),start.appId);
    s.db.close();s=new Store(dir);assert.equal(appSecret(appRecord(s,start.appId),config.secret,'private_key'),pem);
    expireSetup(s,true);assert.equal(s.db.prepare('SELECT material FROM github_setup_attempts').get()!.material,'');assert.deepEqual(s.db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally {s.db.close();await rm(dir,{recursive:true,force:true});}
});

// These are deterministic worker-protocol simulations, NOT live GitHub or Trivy validation.
for(const race of ['input-collection','worker-dispatch','analysis-running','final-publication','successful-scan','summary-metadata-scan'] as const)test(`scan publication fence with simulated worker: ${race}`,async t=>{
  const s=fixture(t),spool=await mkdtemp(join(tmpdir(),'github-job-race-'));
  const keys=['KOPES_SOURCE_PILOT','KOPES_SOURCE_SCAN_PILOT','KOPES_SOURCE_SPOOL'],old=keys.map(k=>process.env[k]);
  Object.assign(process.env,{KOPES_SOURCE_PILOT:'1',KOPES_SOURCE_SCAN_PILOT:'1',KOPES_SOURCE_SPOOL:spool});
  let stopped=false,admissions=0;
  try {
    await mkdir(join(spool,'in'));await mkdir(join(spool,'out'));enqueueSource(s,'binding');
    const worker=(async()=>{
      while(!stopped){
        for(const name of await readdir(join(spool,'in'))){
          if(!name.endsWith('.json'))continue;
          const envelope=JSON.parse(await readFile(join(spool,'in',name),'utf8'));
          assert.ok(!JSON.stringify(envelope).includes('opaque-installation-token'));
          if(race==='analysis-running')invalidateConnection(s,'connection','disconnected',true);
          const output={ok:true,bundleHash:envelope.bundle.hash,sbom:'{}',analyzer:'test',database:{Version:2,UpdatedAt:new Date().toISOString()},analysis:{nodes:[],edges:[],roots:[],findings:[],warnings:[],manager:'unknown',folder:'',analyzerPackages:[],coverage:{inputs:'complete',inventory:'unknown',graph:'complete',runtime:'unknown'}},paths:{}};
          await writeFile(join(spool,'out',name),JSON.stringify(output));return;
        }
        await new Promise(resolve=>setTimeout(resolve,5));
      }
    })();
    const read:GithubHttp=async r=>{const value=await api(r);if(race==='input-collection'&&r.path.includes('/git/trees/'))restrictInstallation(s,'install','repository-access-changed',['99']);if(race==='summary-metadata-scan'&&r.path==='/repositories/99')return {id:remoteRepo.id,full_name:remoteRepo.full_name};return value;};
    const admission=async()=>{admissions++;if(race==='worker-dispatch'&&admissions===2||race==='final-publication'&&admissions===3)invalidateConnection(s,'connection','disconnected',true);};
    const result=await runSourceJob(s,readConfig({BETTER_AUTH_URL:config.origin,BETTER_AUTH_SECRET:config.secret}),new AbortController().signal,never,admission,read);
    stopped=true;await worker;assert.equal(result,true);
    const success=race==='successful-scan'||race==='summary-metadata-scan';
    assert.equal(s.db.prepare('SELECT count(*) n FROM source_scans').get()!.n,success?1:0);
    assert.equal(s.db.prepare('SELECT state FROM source_jobs').get()!.state,success?'complete':'cancelled');
    assert.deepEqual(await readdir(join(spool,'in')),[]);assert.deepEqual(await readdir(join(spool,'out')),[]);
  } finally {stopped=true;keys.forEach((k,i)=>{if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i];});await rm(spool,{recursive:true,force:true});}
});

for (const failure of ['deployment-secret','private-key','token-expiry','metadata','branch','unexpected'] as const) test(`private scan reports safe access diagnostics and retains history: ${failure}`, async t => {
  const s=fixture(t), spool=await mkdtemp(join(tmpdir(),'github-access-error-'));
  const keys=['KOPES_SOURCE_PILOT','KOPES_SOURCE_SCAN_PILOT','KOPES_SOURCE_SPOOL'],old=keys.map(k=>process.env[k]);
  Object.assign(process.env,{KOPES_SOURCE_PILOT:'1',KOPES_SOURCE_SCAN_PILOT:'1',KOPES_SOURCE_SPOOL:spool});
  try {
    s.db.exec("INSERT INTO source_jobs(id,binding_id,kind,state,created_at,available_at) VALUES ('old-job','binding','scan','complete',1,1); INSERT INTO source_snapshots VALUES ('old-snapshot','repo','old-commit','old-hash','{}',1); INSERT INTO source_scans VALUES ('old-scan','binding','old-snapshot','old-job',1,'test','{}','{}');");
    if(failure==='private-key')s.db.prepare("UPDATE github_apps SET private_key=? WHERE id='app'").run(appSeal('invalid-secret-key',config.secret,'app','private_key'));
    const http: GithubHttp=async request=>{
      if(failure==='token-expiry'&&request.path.endsWith('/access_tokens'))return {token:'secret-token',expires_at:new Date(Date.now()-1000).toISOString()};
      if(request.path==='/repositories/99'){
        if(failure==='metadata')return {id:99,full_name:'private secret response'};
        if(failure==='unexpected')throw new Error('secret-token private response https://private.example/');
      }
      if(failure==='branch'&&request.path.includes('/branches/'))return {commit:{sha:'secret-invalid-commit'}};
      return api(request);
    };
    enqueueSource(s,'binding');
    await runSourceJob(s,readConfig({BETTER_AUTH_URL:config.origin,BETTER_AUTH_SECRET:failure==='deployment-secret'?'wrong-secret-at-least-32-characters':config.secret}),new AbortController().signal,never,async()=>{},http);
    const job=s.db.prepare("SELECT state,error FROM source_jobs WHERE id<>'old-job'").get()!;
    assert.equal(job.state,'queued');
    const error=String(job.error);
    const reason={ 'deployment-secret':'credentials-unavailable', 'private-key':'app-private-key', 'token-expiry':'installation-token', metadata:'repository-response', branch:'branch-head', unexpected:'report this scan stage' }[failure];
    assert.ok(error.includes(reason),error);
    assert.match(error,failure==='branch'?/Default branch lookup failed/:/Repository metadata lookup failed/);
    for(const secret of ['secret-token','invalid-secret-key','private response','secret-invalid-commit','https://private.example/'])assert.ok(!error.includes(secret));
    assert.equal(s.db.prepare("SELECT error FROM source_bindings WHERE id='binding'").get()!.error,error);
    assert.equal(s.db.prepare('SELECT count(*) n FROM source_scans').get()!.n,1);
    assert.deepEqual(await readdir(join(spool,'in')),[]);
  } finally { keys.forEach((k,i)=>{if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i];});await rm(spool,{recursive:true,force:true}); }
});

test('removing and reimporting the same App retains its local identity and requires fresh installation verification',async t=>{
  const s=fixture(t);await handleGithub(post({action:'remove-app',appId:'app'}),s,context,config,api);
  const response=await handleGithub(post({action:'import-app',githubId:'42',clientId:'client-id',owner:'owner',ownerType:'User',privateKey:pem,clientSecret:'new-secret',webhookSecret:'new-hook',urlsConfirmed:true}),s,context,config,api);
  assert.equal(response.status,200);assert.equal((await response.json()).appId,'app');assert.equal(appRecord(s,'app').status,'registered');
  assert.equal(s.db.prepare('SELECT disconnected FROM source_connections').get()!.disconnected,1);
});
test('PAT polling verifies each bound repository before restoring access and cancels revoked selected bindings',async t=>{
  const s=fixture(t);
  s.db.exec("UPDATE source_connections SET disconnected=1 WHERE id='connection'");
  s.db.prepare("INSERT INTO source_connections(id,provider,origin,credential,auth_kind,owner_login,validation_repository) VALUES ('pat','github','https://api.github.com',?,'pat','owner','owner/private')").run(seal('token',config.secret,'pat:https://api.github.com'));
  s.db.exec("UPDATE source_bindings SET connection_id='pat'");enqueueSource(s,'binding');
  await reconcileGithub(s,config.secret,async r=>{if(r.path==='/repositories/99')throw new GithubError(404,'unavailable');return api(r);});
  assert.equal(s.db.prepare('SELECT access_status FROM source_bindings').get()!.access_status,'blocked');assert.equal(s.db.prepare('SELECT state FROM source_jobs').get()!.state,'cancelled');
  s.db.exec("UPDATE source_connections SET next_check=0 WHERE id='pat'");await reconcileGithub(s,config.secret,api);
  assert.equal(s.db.prepare('SELECT access_status FROM source_bindings').get()!.access_status,'active');
});
test('admin refresh rechecks authorization after provider awaits and does not commit on revocation',async t=>{
  const s=fixture(t);let revoked=false;
  await assert.rejects(reconcileInstallation(s,'install',config.secret,async r=>{const result=await api(r);if(r.path.startsWith('/installation/repositories'))revoked=true;return result;},async()=>{if(revoked)throw new Error('Administrator revoked');}));
  assert.equal(s.db.prepare('SELECT reconciled_at FROM github_installations').get()!.reconciled_at,null);
});
test('HMAC verification uses exact bytes, not a decoded/re-encoded approximation',async t=>{
  const s=fixture(t),raw=Buffer.from([0x7b,0x22,0x78,0x22,0x3a,0x22,0xff,0x22,0x7d]);
  const request=new Request(config.origin+'/api/github/webhooks/app',{method:'POST',headers:{'x-github-event':'ping','x-github-delivery':'raw-bytes','x-hub-signature-256':'sha256='+createHmac('sha256','hook-secret').update(raw.toString('utf8')).digest('hex')},body:raw});
  assert.equal((await githubWebhook(request,s,config.secret,'app')).status,401);
});

test('bounded HTTPS transport pins public DNS, refuses redirects, classifies limits and keeps errors secret-free',async()=>{
  const {createGithubHttp}=await import('../src/server/source/github-http');
  const {EventEmitter}=await import('node:events');
  let calls=0,observed:any;
  function transport(status:number,headers:Record<string,string>,body:string) {
    return createGithubHttp({lookup:(async()=>[{address:'140.82.112.5',family:4}]) as any,request:((url:any,options:any,callback:any)=>{
      calls++;observed={url,options};const request=new EventEmitter() as any;
      request.destroy=()=>request.emit('error',new Error('provider body must not leak'));
      request.end=()=>queueMicrotask(()=>{const response=new EventEmitter() as any;response.statusCode=status;response.headers=headers;response.resume=()=>{};callback(response);response.emit('data',Buffer.from(body));response.emit('end');});return request;
    }) as any});
  }
  assert.deepEqual(await transport(200,{},'{"ok":true}')({path:'/app',token:'opaque-secret'}),{ok:true});
  assert.equal(observed.url.hostname,'api.github.com');assert.equal(observed.options.headers.Authorization,'Bearer opaque-secret');
  observed.options.lookup('api.github.com',{},(error:any,address:string,family:number)=>{assert.equal(error,null);assert.equal(address,'140.82.112.5');assert.equal(family,4);});
  calls=0;await assert.rejects(transport(302,{location:'https://evil.example'},'secret-provider-response')({path:'/app'}),e=>e instanceof GithubError&&!e.message.includes('secret-provider-response'));assert.equal(calls,1);
  await assert.rejects(transport(403,{'x-ratelimit-remaining':'0','retry-after':'120'},'secret')({path:'/app'}),e=>e instanceof GithubError&&e.reason==='rate-limit'&&e.retryAt>Date.now()+110_000);
  await assert.rejects(transport(200,{},'x'.repeat(8*1024*1024+1))({path:'/app'}),e=>e instanceof GithubError&&!e.message.includes('provider body'));
  const blocked=createGithubHttp({lookup:(async()=>[{address:'127.0.0.1',family:4}]) as any,request:(()=>{throw new Error('Must not connect');}) as any});await assert.rejects(blocked({path:'/app'}),e=>e instanceof GithubError&&e.reason==='invalid');
});
test('cached installation tokens renew automatically before returned expiry without a user session',async t=>{
  const s=fixture(t),initial=Date.now();let now=initial,mints=0;
  t.mock.method(Date,'now',()=>now);
  const http:GithubHttp=async()=>({token:`token-${++mints}`,expires_at:new Date(now+3600_000).toISOString()});
  assert.equal(await installationToken(s,'install',config.secret,'99',http),'token-1');
  now+=3500_000;
  assert.equal(await installationToken(s,'install',config.secret,'99',http),'token-2');assert.equal(mints,2);
});

test('late provider denial with old credentials cannot disable a replacement connection',async t=>{
  const s=fixture(t);
  const reader=credentialProvider(s,'connection',config.secret,never,'99',async r=>{
    if(r.path.endsWith('/access_tokens'))return api(r);
    invalidateConnection(s,'connection','credentials-updated');
    throw new GithubError(403,'access');
  });
  await assert.rejects(reader.provider.repository('99'),/changed/);
  assert.equal(s.db.prepare('SELECT health FROM source_connections').get()!.health,'credentials-updated');
});
test('PAT access checks have their own schedule and stale revalidation cannot restore a switched binding',async t=>{
  const s=fixture(t);s.db.prepare("INSERT INTO source_connections(id,provider,origin,credential,auth_kind,owner_login,validation_repository,observed_at,next_check) VALUES ('pat','github','https://api.github.com',?,'pat','owner','owner/private',?,0)").run(seal('token',config.secret,'pat:https://api.github.com'),Date.now());
  s.db.exec("UPDATE source_bindings SET connection_id='pat',access_status='blocked'");
  await reconcileGithub(s,config.secret,async r=>{
    if(r.path==='/repositories/99')s.db.exec("UPDATE source_bindings SET connection_id='connection',access_revision=access_revision+1");
    return api(r);
  });
  assert.equal(s.db.prepare("SELECT connection_id FROM source_bindings").get()!.connection_id,'connection');
  assert.equal(s.db.prepare("SELECT access_status FROM source_bindings").get()!.access_status,'blocked');
  assert.ok(Number(s.db.prepare("SELECT next_check FROM source_connections WHERE id='pat'").get()!.next_check)>Date.now());
});

test('resume verifies canonical homepage and webhook configuration before issuing installation state',async t=>{
  const s=fixture(t);s.db.exec("UPDATE github_apps SET webhook_mode='webhook'");
  await assert.rejects(resumeSetup(s,'app',context,config,async r=>r.path==='/app'?{...remoteApp,external_url:'https://old.example'}:api(r)),/canonical/);
  await assert.rejects(resumeSetup(s,'app',context,config,async r=>r.path==='/app/hook/config'?{url:'https://old.example/hook',content_type:'json',insecure_ssl:'0'}:api(r)),/webhook/);
  const result=await resumeSetup(s,'app',context,config,async r=>r.path==='/app/hook/config'?{url:config.origin+'/api/github/webhooks/app',content_type:'json',insecure_ssl:'0'}:api(r));
  assert.match(result.url,/installations\/new/);
});
