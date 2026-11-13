import test from 'node:test';
import assert from 'node:assert/strict';
import { verification, deploymentHistory, appendEvidence } from '../src/server/source/provenance';
import { remediationGuidance } from '../src/lib/source-guidance';
import { Store } from '../src/server/store';
import { ProjectStore } from '../src/server/project-store';
const finding = { advisory:'CVE-1',aliases:['GHSA-one'],package:'lodash',version:'4.17.20' };
const evidence = { resourceId:'production',currentImages:['sha256:new'],scannedImage:'sha256:new',scannedAt:10,observedAt:11,coverage:'complete' as const,findings:[],packages:[{name:'lodash',version:'4.17.21'}],linkedCommit:'a'.repeat(40),linkage:'confirmed' as const };
test('runtime verification requires current immutable image, relevant coverage and confirmed linkage', () => {
  assert.equal(verification(finding,evidence).state,'verified');
  assert.equal(verification(finding,{...evidence,scannedImage:'sha256:old'}).state,'unavailable');
  assert.equal(verification(finding,{...evidence,coverage:'unknown'}).state,'unavailable');
  assert.equal(verification(finding,{...evidence,linkage:'producer-label'}).state,'unavailable');
  assert.equal(verification(finding,{...evidence,currentImages:['sha256:new','sha256:old']}).state,'unavailable');
  assert.equal(verification(finding,{...evidence,packages:[]}).state,'not-detected');
  assert.equal(verification(finding,{...evidence,currentImages:['sha256:old'],scannedImage:'sha256:old',findings:[finding]}).state,'affected');
});
test('allowlisted deployment history does not invent actors or image linkage', async () => {
  const records = await deploymentHistory('https://coolify.example','credential','app','resource','staging',async (url, options)=>{
    assert.ok(String(url).includes('/deployments/applications/app?skip=0&take=50'));
    assert.equal(options?.redirect,'error');
    return Response.json([{deployment_uuid:'d',commit:'a'.repeat(40),status:'finished',created_at:'2026-11-09T12:00:00Z',logs:'private',token:'private',actor:'unvalidated'}]);
  });
  assert.equal(records[0].actor,null); assert.equal(records[0].image,null); assert.equal(records[0].strength,'provider-reported');
  assert.ok(!JSON.stringify(records).includes('private'));
});
test('history is append-only and deduplicated independently by project', () => {
  const s = new Store(':memory:'); try {
    const p = new ProjectStore(s.db,{userId:'admin',administrator:true}), a=p.create('A'), b=p.create('B');
    appendEvidence(s,a,'deployment',{id:'one'},1); appendEvidence(s,a,'deployment',{id:'one'},1); appendEvidence(s,b,'deployment',{id:'one'},1);
    appendEvidence(s,a,'deployment-correction',{id:'one',status:'failed'},2);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM source_events').get()!.n,3);
  } finally { s.db.close(); }
});
test('guidance distinguishes patched child from unverified parent and never executes commands', () => {
  const guidance=remediationGuidance('pnpm','parent','lodash','4.17.21',false);
  assert.equal(guidance.compatibleParent,'Unverified'); assert.match(guidance.summary,/not been verified/);
  assert.deepEqual(guidance.commands,['pnpm why lodash','pnpm update parent']);
  assert.equal(remediationGuidance('npm','$(evil)','lodash','',false).commands.length,1);
});

test('upgrading to another vulnerable version is still affected, never verified',()=>{
  assert.equal(verification(finding,{...evidence,findings:[{...finding,version:'4.17.21'}]}).state,'affected');
});

test('separate environments retain source remediation while rollback reopens production and late observations cannot close it',async()=>{
  const {runtimeTransition}=await import('../src/server/source/provenance');
  const staging=runtimeTransition(undefined,finding,{...evidence,resourceId:'staging',observedAt:20});
  const production=runtimeTransition(undefined,finding,{...evidence,observedAt:20});
  assert.equal(staging.state,'verified');assert.equal(production.state,'verified');
  const rollback=runtimeTransition(production,finding,{...evidence,currentImages:['sha256:old'],scannedImage:'sha256:old',findings:[finding],observedAt:30});
  assert.equal(rollback.event,'reopened');assert.equal(staging.state,'verified');
  const late=runtimeTransition(rollback,finding,{...evidence,observedAt:25});
  assert.equal(late.state,'affected');assert.equal(late.event,'late-observation-ignored');
});

test('remediation identifies every introducing parent and follows local workspace manifests',async()=>{
  const {editableDependencies}=await import('../src/lib/source-guidance');
  const graph={roots:[{id:'web',manifest:'apps/web/package.json'},{id:'shared',manifest:'packages/shared/package.json'}],nodes:[{id:'a',name:'parent-a'},{id:'b',name:'parent-b'},{id:'v',name:'lodash'}]};
  assert.deepEqual(editableDependencies(graph,[['web','a','v'],['web','b','v'],['web','shared','v']]),[
    {manifest:'apps/web/package.json',dependency:'parent-a',direct:false},
    {manifest:'apps/web/package.json',dependency:'parent-b',direct:false},
    {manifest:'packages/shared/package.json',dependency:'lodash',direct:true},
  ]);
  assert.equal(remediationGuidance('npm','--config','lodash','4.17.21',false).commands.length,1);
});
