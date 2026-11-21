import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/server/store';
import { seal, unseal } from '../src/server/source/credentials';
import { reconcileGithub } from '../src/server/source/github-reconcile';
import { expireSetup } from '../src/server/source/github-setup';
import { recoverGithubDeliveries } from '../src/server/source/github-webhook';
import { startupFailure } from '../src/server/startup-error';

for (const incomplete of [true,false]) test(`v16 opens ${incomplete?'early':'complete'} v15 databases without losing credentials or history`,async()=>{
  const dir=mkdtempSync(join(tmpdir(),'kopes-v15-startup-'));
  let store: Store | undefined;
  const secret='stable-deployment-secret-at-least-32-characters';
  try {
    store=new Store(dir);
    const encrypted=seal('retained-token',secret,'legacy:https://api.github.com');
    store.db.prepare("INSERT INTO source_connections(id,provider,origin,credential,auth_kind) VALUES ('legacy','github','https://api.github.com',?,'legacy_pat')").run(encrypted);
    store.db.exec("INSERT INTO source_repositories VALUES ('repo','github','https://api.github.com','99','owner/repo'); INSERT INTO source_bindings(id,repository_id,connection_id,branch,folder) VALUES ('binding','repo','legacy','main',''); INSERT INTO source_jobs(id,binding_id,kind,state,created_at,available_at) VALUES ('job','binding','scan','complete',1,1); INSERT INTO source_snapshots VALUES ('snapshot','repo','commit','hash','{}',1); INSERT INTO source_scans VALUES ('scan','binding','snapshot','job',1,'test','{}','{}'); PRAGMA user_version=15;");
    if(incomplete) {
      store.db.exec('ALTER TABLE source_connections DROP COLUMN next_check');
      assert.throws(()=>store!.db.prepare("UPDATE source_connections SET next_check=0 WHERE auth_kind='pat'").run(),/no such column/);
    }
    const history=store.db.prepare('SELECT * FROM source_scans').all();
    store.db.close();store=undefined;store=new Store(dir);
    assert.equal(store.db.prepare('PRAGMA user_version').get()!.user_version,17);
    assert.equal(store.db.prepare('SELECT next_check FROM source_connections').get()!.next_check,0);
    assert.equal(store.db.prepare('SELECT credential FROM source_connections').get()!.credential,encrypted);
    assert.equal(unseal(encrypted,secret,'legacy:https://api.github.com'),'retained-token');
    assert.deepEqual(store.db.prepare('SELECT * FROM source_scans').all(),history);
    expireSetup(store,true);recoverGithubDeliveries(store);
    store.db.prepare("UPDATE source_connections SET next_check=0 WHERE auth_kind='pat'").run();
    await reconcileGithub(store,secret,async()=>{throw new Error('No network requests expected');});
    assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);
    store.db.close();store=undefined;store=new Store(dir);
    assert.deepEqual(store.db.prepare('SELECT * FROM source_scans').all(),history);
  } finally {store?.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('startup diagnostics identify stages without echoing secrets, URLs, paths or SQL data',()=>{
  for(const stage of ['configuration','database','filesystem','authentication','source-recovery'] as const) {
    const failure=startupFailure(stage,new Error('private-key secret-token /private/path https://secret.example'));
    assert.equal(failure.stage,stage);assert.doesNotMatch(failure.message,/private-key|secret-token|private\/path|secret\.example/);
    assert.equal(startupFailure('configuration',failure),failure);
  }
  assert.match(startupFailure('source-recovery',new Error('no such column: next_check')).message,/database schema is incomplete/);
  assert.match(startupFailure('configuration',new Error('Set BETTER_AUTH_SECRET in your deployment environment, or run pnpm run setup for local installation.')).message,/Set BETTER_AUTH_SECRET/);
  assert.match(startupFailure('database',Object.assign(new Error('secret'),{code:'EACCES'})).message,/write permissions/);
});
