// Disposable DB + packaged worker; provider responses replay immutable public inputs, no credentials/network.
import { mkdtemp, mkdir, chmod, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { backup } from 'node:sqlite';
import assert from 'node:assert/strict';
import { Store } from '../src/server/store';
import { ProjectStore } from '../src/server/project-store';
import { readConfig } from '../src/server/config';
import { enqueueSource } from '../src/server/source/service';
import { runSourceJob, recoverSourceJobs } from '../src/server/source/jobs';
import { cleanSourceSpool, requireSourceStorage, sourceStorageStatus, sourceStorageLimits } from '../src/server/source/storage';
import type { Bundle, ReadJson } from '../src/server/source/provider';
const exec=promisify(execFile),base=await mkdtemp(join(tmpdir(),'kopes-retention-')),spool=join(base,'spool');
for(const part of ['in','out']){await mkdir(join(spool,part),{recursive:true});await chmod(join(spool,part),0o777);}
// Same UID as the deployment worker, but this test writes scanner inputs from the host account.
// The input mode in runSourceJob is private. A test-only Docker worker runs as this host UID.
const uid=process.getuid!(),gid=process.getgid!(),name='kopes-retention-'+randomUUID().slice(0,8);
const config=readConfig({BETTER_AUTH_URL:'http://localhost',BETTER_AUTH_SECRET:'retention-test-secret-with-at-least-32-characters',DATA_DIR:join(base,'data')});
const flags=['KOPES_SOURCE_PILOT','KOPES_SOURCE_SCAN_PILOT','KOPES_SOURCE_SPOOL','KOPES_PROVENANCE_PILOT'];
const previous=Object.fromEntries(flags.map(k=>[k,process.env[k]]));
Object.assign(process.env,{KOPES_SOURCE_PILOT:'1',KOPES_SOURCE_SCAN_PILOT:'1',KOPES_SOURCE_SPOOL:spool,KOPES_PROVENANCE_PILOT:'0'});
let store=new Store(config.dataDir),started=false;
const bundle=JSON.parse(await readFile('/tmp/kopes-public-npm.json','utf8')) as Bundle;
let providerReads=0;
const reader: ReadJson=async (_connection,path)=>{
  providerReads++;
  if(path.startsWith('/repositories/'))return {id:83135958,full_name:'nestjs/typescript-starter',default_branch:'main'};
  if(path.includes('/branches/'))return {commit:{sha:bundle.commit}};
  if(path.includes('/git/trees/'))return {tree:Object.keys(bundle.files).map(path=>({path,type:'blob',mode:'100644'})),truncated:false};
  const file=path.split('/contents/')[1]?.split('?')[0];
  if(file&&bundle.files[file])return {type:'file',encoding:'base64',content:Buffer.from(bundle.files[file]).toString('base64')};
  throw new Error('Unexpected replayed provider path.');
};
const count=(table:string)=>Number(store.db.prepare(`SELECT count(*) n FROM ${table}`).get()!.n);
const evidenceTables=['source_snapshots','source_scans','source_events','source_bindings','source_binding_resources','projects','project_members','scan_settings','display_names','scan_observations','access_history','pulse_states','favourites','allowed_users','resources'];
const digest=(database:Store,table:string)=>createHash('sha256').update(JSON.stringify(database.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())).digest('hex');
try {
  await exec('docker',['run','-d','--rm','--init','--name',name,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user',`${uid}:${gid}`,'--memory','1g','--cpus','1','--pids-limit','64','--tmpfs','/tmp:size=256m,mode=1777','--mount',`type=bind,src=${spool}/in,dst=/spool/in,readonly`,'--mount',`type=bind,src=${spool}/out,dst=/spool/out`,'--mount','type=bind,src=/tmp/kopes-phase0/db,dst=/db/db,readonly','kopes-source-worker:validation']);started=true;
  const p=new ProjectStore(store.db,{userId:'admin',administrator:true}),project=p.create('Retention pilot');
  store.db.exec("INSERT INTO source_connections(id,provider,origin,credential) VALUES ('c','github','https://api.github.com',''); INSERT INTO source_repositories VALUES ('r','github','https://api.github.com','83135958','nestjs/typescript-starter');");
  for(const binding of ['a','b'])store.db.prepare("INSERT INTO source_bindings(id,project_id,repository_id,connection_id,branch,folder,next_poll) VALUES (?,?,'r','c','main','',?)").run(binding,project,Date.now()+86400_000);
  store.db.exec("CREATE TABLE user(id TEXT PRIMARY KEY); INSERT INTO user VALUES ('member'); INSERT INTO allowed_users(login) VALUES ('legacy-member'); INSERT INTO scan_settings VALUES ('resource','host','{\"rescanHours\":24}'); INSERT INTO display_names VALUES ('resource','host','Retained host'); INSERT INTO pulse_states VALUES ('member','CVE-retained',1,0,1); INSERT INTO favourites VALUES ('member','project','retained-project');");
  p.grant(project,'member',true);
  store.syncInventory([{id:'retained-container',name:'Retained API',image:'fixture:1',target_id:'image:retained',project:'Legacy',service:'api',manager:'Compose',discoveryKey:'retained-api'}]);
  const resource=store.db.prepare('SELECT id FROM resources LIMIT 1').get()!;
  store.db.prepare('UPDATE resources SET project_id=? WHERE id=?').run(project,resource.id);
  store.db.prepare('INSERT INTO source_binding_resources VALUES (?,?)').run('a',resource.id);
  store.complete('image:retained',{findings:[],packages:[{name:'retained-package',version:'1',type:'npm',path:'package.json'}],os:'',eol:false},'{"bomFormat":"CycloneDX"}',null,[],'Retained fixture');
  const byteSamples:unknown[]=[];
  for(let i=0;i<30;i++){
    const binding=i%2?'b':'a';enqueueSource(store,binding);assert.equal(await runSourceJob(store,config,new AbortController().signal,reader),true);
    assert.equal(count('source_scans'),i+1);assert.equal(count('source_snapshots'),1);
    if(i%10===9){byteSamples.push({scans:i+1,...await sourceStorageStatus(store,spool)});console.log(JSON.stringify({retainedScans:i+1}));}
  }
  const before=Object.fromEntries(evidenceTables.map(t=>[t,digest(store,t)]));
  // Exercise actual SQLite measurements with a scaled-down threshold, not a pretend full host disk.
  const measured=await sourceStorageStatus(store,spool),reduced={...sourceStorageLimits,databaseBytes:measured.databaseBytes+measured.journalBytes+sourceStorageLimits.resultReserveBytes*2-1};
  enqueueSource(store,'a');const readsBefore=providerReads,attemptsBefore=store.db.prepare("SELECT attempts FROM source_jobs WHERE state='queued'").get()!.attempts;
  assert.equal(await runSourceJob(store,config,new AbortController().signal,reader,(s,path)=>requireSourceStorage(s,path,reduced)),false);
  assert.equal(providerReads,readsBefore);assert.equal(store.db.prepare("SELECT attempts FROM source_jobs WHERE state='queued'").get()!.attempts,attemptsBefore);
  for(const table of evidenceTables)assert.equal(digest(store,table),before[table]);
  assert.match(store.getMeta('source.storage.error')!,/database storage budget/);
  // Restart scanner state with a forgotten attempt. Recovery deletes transport only; worker owns claims.
  const abandoned=randomUUID();await writeFile(join(spool,'in',abandoned+'.json.tmp'),'incomplete transport');
  store.db.exec("UPDATE source_jobs SET state='running' WHERE state='queued'");store.db.close();store=new Store(config.dataDir);
  await cleanSourceSpool(spool,true);recoverSourceJobs(store);
  for(const table of evidenceTables)assert.equal(digest(store,table),before[table]);
  assert.equal(await runSourceJob(store,config,new AbortController().signal,reader),true);assert.equal(count('source_scans'),31);
  assert.equal(store.getMeta('source.storage.error'),'');
  const retained=Object.fromEntries(evidenceTables.map(t=>[t,digest(store,t)]));
  const restoredDir=join(base,'restored');await mkdir(restoredDir);await backup(store.db,join(restoredDir,'kopes.sqlite'));
  const restored=new Store(restoredDir);for(const table of evidenceTables)assert.equal(digest(restored,table),retained[table]);restored.db.close();
  assert.deepEqual(await readdir(join(spool,'in')),[]);assert.deepEqual(await readdir(join(spool,'out')),[]);
  const evidence={observedAt:new Date().toISOString(),publicBundle:{commit:bundle.commit,hash:bundle.hash},provider:'offline replay of previously measured public GitHub inputs',workerUid:'host UID for bind-file ownership; production UID tested separately',retainedScans:count('source_scans'),sharedSnapshots:count('source_snapshots'),sourceEvents:count('source_events'),byteSamples,pressureMeasurement:measured,reducedBudgetBytes:reduced.databaseBytes,pressurePreservesEvidence:true,pressureDoesNotReadProviderOrConsumeAttempts:true,restartPreservesEvidence:true,resumedAfterPressure:true,backupRestoreDigests:retained,backupRestoreVerified:true,zeroSpoolFiles:true,productionDataTouched:false};
  await writeFile('docs/plans/phase-6/retention-evidence.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({passed:true,retainedScans:31}));
} finally {
  if(started)await exec('docker',['stop',name]).catch(()=>{});store.db.close();for(const key of flags){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}await rm(base,{recursive:true,force:true});
}
