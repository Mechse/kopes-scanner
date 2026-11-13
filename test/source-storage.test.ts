import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, utimes, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/server/store';
import { cleanSourceSpool, sourceStorageStatus, storageAdmission, sourceStorageLimits as limits } from '../src/server/source/storage';
const enough = { databaseBytes: 1024, journalBytes: 0, free: (['database','input','output'] as const).map(location=>({location,bytes:4*1024**3})) };
test('storage admission reserves database and journal growth and checks every mounted filesystem',()=>{
  assert.equal(storageAdmission(enough).allowed,true);
  assert.equal(storageAdmission({...enough,databaseBytes:limits.databaseBytes-limits.resultReserveBytes*2}).allowed,false);
  assert.equal(storageAdmission({...enough,databaseBytes:limits.databaseBytes-limits.resultReserveBytes*2-1,journalBytes:2}).allowed,false);
  for(const location of ['database','input','output']){
    const result=storageAdmission({...enough,free:enough.free.map(f=>({...f,bytes:f.location===location?0:f.bytes}))});
    assert.equal(result.allowed,false);assert.equal(result.retention,'preserve-all-evidence');assert.match(result.reason!,/Historical evidence is retained/);
  }
});
test('retention cleans only abandoned transport files; live claims, recent attempts, symlinks and evidence remain',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'source-retention-')),spool=join(directory,'spool');
  const a='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',c='cccccccc-cccc-cccc-cccc-cccccccccccc';
  try {
    await mkdir(join(spool,'in'),{recursive:true});await mkdir(join(spool,'out'));
    for(const [part,name] of [['in',a+'.json'],['in',a+'.json.tmp'],['out',a+'.json'],['out',b+'.json'],['out',b+'.active'],['in',c+'.json'],['out','keep-evidence.json']])await writeFile(join(spool,part,name),'retained');
    for(const [part,name] of [['in',a+'.json'],['in',a+'.json.tmp'],['out',a+'.json'],['out',b+'.json']])await utimes(join(spool,part,name),0,0);
    const evidence=join(directory,'historical.json');await writeFile(evidence,'historical evidence');await symlink(evidence,join(spool,'out',c+'.json'));
    assert.deepEqual(await cleanSourceSpool(spool),{input:2,output:1});
    assert.equal(await readFile(evidence,'utf8'),'historical evidence');
    assert.ok((await readdir(join(spool,'in'))).includes(c+'.json'));
    assert.ok((await readdir(join(spool,'out'))).includes(b+'.active'));
    assert.deepEqual(await cleanSourceSpool(spool,true),{input:1,output:0});
    assert.equal(await readFile(join(spool,'out',b+'.json'),'utf8'),'retained');
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('real SQLite journal and retained evidence are measured without checkpointing or deleting scans',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'source-journal-')),spool=join(directory,'spool'),store=new Store(directory);
  try {
    await mkdir(join(spool,'in'),{recursive:true});await mkdir(join(spool,'out'));
    store.db.exec('PRAGMA wal_autocheckpoint=0; CREATE TABLE retention_fixture(body TEXT);');
    store.db.prepare('INSERT INTO retention_fixture VALUES (?)').run('evidence'.repeat(100_000));
    const before=store.db.prepare('SELECT body FROM retention_fixture').get();
    const status=await sourceStorageStatus(store,spool);
    assert.ok(status.databaseBytes>500_000);assert.ok(status.journalBytes>500_000);
    assert.deepEqual(store.db.prepare('SELECT body FROM retention_fixture').get(),before);
    assert.deepEqual(status.free.map(f=>f.location).sort(),['database','input','output']);
  }finally{store.db.close();await rm(directory,{recursive:true,force:true});}
});
