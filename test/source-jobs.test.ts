import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/server/store';
import { ProjectStore } from '../src/server/project-store';
import {enqueueSource} from '../src/server/source/service';
import {recoverSourceJobs,queueDueSources,needsSourceAnalysis} from '../src/server/source/jobs';
test('jobs deduplicate, recover interrupted work and refuse disconnected or archived bindings',()=>{
  const s=new Store(':memory:');try{
    const p=new ProjectStore(s.db,{userId:'admin',administrator:true}),project=p.create('P');
    s.db.exec("INSERT INTO source_connections(id,provider,origin,credential) VALUES ('c','github','https://api.github.com',''); INSERT INTO source_repositories VALUES ('r','github','https://api.github.com','1','o/r');");
    s.db.prepare("INSERT INTO source_bindings(id,project_id,repository_id,connection_id,branch,folder) VALUES ('b',?,'r','c','main','')").run(project);
    enqueueSource(s,'b');enqueueSource(s,'b');assert.equal(s.db.prepare('SELECT count(*) AS n FROM source_jobs').get()!.n,1);
    s.db.exec("UPDATE source_jobs SET state='running'");recoverSourceJobs(s);assert.equal(s.db.prepare('SELECT state FROM source_jobs').get()!.state,'queued');
    p.update(project,'P',true);assert.throws(()=>enqueueSource(s,'b'),/not active/);
    p.update(project,'P',false);s.db.exec("UPDATE source_connections SET disconnected=1");assert.throws(()=>enqueueSource(s,'b'),/not active/);
  }finally{s.db.close();}
});

test('an active isolated-worker claim prevents another expensive job after cancellation',async()=>{
  const {sourceWorkerBusy}=await import('../src/server/source/jobs');
  const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const spool=await mkdtemp(join(tmpdir(),'source-claim-')),previous=process.env.KOPES_SOURCE_SPOOL;process.env.KOPES_SOURCE_SPOOL=spool;
  try{
    await mkdir(join(spool,'out'));assert.equal(await sourceWorkerBusy(),false);
    const claim=join(spool,'out','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.active');await writeFile(claim,'active');
    assert.equal(await sourceWorkerBusy(),true);await rm(claim);assert.equal(await sourceWorkerBusy(),false);
  }finally{if(previous===undefined)delete process.env.KOPES_SOURCE_SPOOL;else process.env.KOPES_SOURCE_SPOOL=previous;await rm(spool,{recursive:true,force:true});}
});

test('changed branches, daily advisory refreshes and manual scans trigger analysis', () => {
  const now = 200_000_000;
  assert.equal(needsSourceAnalysis('poll', 'a', 'a', now - 1000, now), false);
  assert.equal(needsSourceAnalysis('poll', 'a', 'b', now - 1000, now), true);
  assert.equal(needsSourceAnalysis('poll', 'a', 'a', now - 86400_000, now), true);
  assert.equal(needsSourceAnalysis('scan', 'a', 'a', now - 1000, now), true);
  assert.equal(needsSourceAnalysis('poll', null, 'a', undefined, now), true);
});

test('unchanged-head polls retry failed analysis and outdated adapters', () => {
  const now = 200_000_000;
  const current = { analyzer: 'trivy:0.76.1;adapter:4' };
  assert.equal(needsSourceAnalysis('poll', 'a', 'a', now - 1000, now, current), false);
  assert.equal(needsSourceAnalysis('poll', 'a', 'a', now - 1000, now, { ...current, error: 'Previous analysis failed' }), true);
  assert.equal(needsSourceAnalysis('poll', 'a', 'a', now - 1000, now, { analyzer: 'trivy:0.76.1;adapter:1' }), true);
  assert.equal(needsSourceAnalysis('poll', 'a', 'a', now - 1000, now, {}), true);
});
