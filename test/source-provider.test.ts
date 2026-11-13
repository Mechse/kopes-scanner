import test from 'node:test';
import assert from 'node:assert/strict';
import { GitProvider, blockedAddress, safeInputPath, validateOrigin } from '../src/server/source/provider';
import { seal, unseal, handleSource } from '../src/server/source/service';
import { Store } from '../src/server/store';
import { ProjectStore } from '../src/server/project-store';

test('provider inputs reject traversal and unapproved network destinations', () => {
  for (const path of ['../package.json','/package.json','x/../package.json','x\\package.json','x\0/package.json']) assert.equal(safeInputPath(path), false);
  for (const address of ['127.0.0.1','169.254.169.254','::1','::ffff:127.0.0.1','fe80::1','10.0.0.1']) assert.equal(blockedAddress(address, false), true);
  assert.equal(blockedAddress('10.0.0.1', true), false);
  assert.equal(blockedAddress('169.254.169.254', true), true);
  assert.throws(() => validateOrigin({ provider: 'gitlab', origin: 'https://evil.example', token: '' }, { gitlabOrigins: [] }));
});
test('credentials are authenticated and bound to connection and origin', () => {
  const value = seal('test-token', 'test-secret', 'id:origin');
  assert.ok(!value.includes('test-token')); assert.equal(unseal(value, 'test-secret', 'id:origin'), 'test-token');
  assert.throws(() => unseal(value, 'test-secret', 'another:origin'));
  assert.throws(() => unseal(value, 'wrong', 'id:origin'));
});
test('immutable public bundle keeps root/workspace inputs; truncated trees and symlinks fail closed', async () => {
  const sha = 'a'.repeat(40); let bad = '';
  const provider = new GitProvider({ provider: 'github', origin: 'https://api.github.com', token: '' }, async (_c, path) => {
    if (path.includes('/git/trees/')) return { truncated: bad === 'truncated', tree: ['package.json','apps/web/package.json','pnpm-lock.yaml','requirements.txt','backend/uv.lock','backend/pyproject.toml'].map(path => ({ path, type: 'blob', mode: bad === 'symlink' ? '120000' : '100644' })) };
    assert.ok(path.endsWith(`?ref=${sha}`)); return { type: 'file', encoding: 'base64', content: Buffer.from('{}').toString('base64') };
  });
  const repo = { providerId: '1', name: 'owner/name', branch: 'main' };
  const bundle = await provider.bundle(repo, sha); assert.equal(Object.keys(bundle.files).length, 6);
  await assert.rejects(provider.bundle(repo, 'main'), /immutable/);
  bad = 'truncated'; await assert.rejects(provider.bundle(repo, sha), /incomplete/);
  bad = 'symlink'; await assert.rejects(provider.bundle(repo, sha), /Unsafe/);
});
test('source API is disabled by default and explicit grants are required even for shared repositories', async t => {
  const s = new Store(':memory:');
  const original = process.env.KOPES_SOURCE_PILOT;
  t.after(() => { if (original === undefined) delete process.env.KOPES_SOURCE_PILOT; else process.env.KOPES_SOURCE_PILOT = original; s.db.close(); });
  delete process.env.KOPES_SOURCE_PILOT;
  const options = { secret: 'fixture-secret', origin: 'https://scanner.test' };
  const member = { userId: 'member', administrator: false }, admin = { userId: 'admin', administrator: true };
  const req = new Request('https://scanner.test/api/data/source');
  assert.equal((await handleSource(req, s, admin, options)).status, 503);
  process.env.KOPES_SOURCE_PILOT = '1';
  const p = new ProjectStore(s.db, admin).create('Private project');
  assert.equal((await handleSource(new Request(`https://scanner.test/api/data/source?projectId=${p}`), s, member, options)).status, 404);
  assert.equal((await handleSource(req, s, member, options)).status, 403);
});

test('shared snapshots do not authorize another project scan detail or SBOM export',async t=>{
  const s=new Store(':memory:'),old=process.env.KOPES_SOURCE_PILOT;process.env.KOPES_SOURCE_PILOT='1';
  t.after(()=>{s.db.close();if(old===undefined)delete process.env.KOPES_SOURCE_PILOT;else process.env.KOPES_SOURCE_PILOT=old;});
  const admin={userId:'admin',administrator:true},p=new ProjectStore(s.db,admin),a=p.create('A'),b=p.create('B');
  s.db.exec("CREATE TABLE user(id TEXT PRIMARY KEY); INSERT INTO user VALUES ('member'); INSERT INTO source_connections(id,provider,origin,credential) VALUES ('c','github','https://api.github.com','ciphertext-never-returned'); INSERT INTO source_repositories VALUES ('r','github','https://api.github.com','123','owner/repo');");p.grant(b,'member',true);
  for(const [id,project]of [['a',a],['b',b]])s.db.prepare("INSERT INTO source_bindings(id,project_id,repository_id,connection_id,branch,folder) VALUES (?,?,'r','c','main','')").run(id,project);
  s.db.exec("INSERT INTO source_jobs(id,binding_id,kind,state,created_at,available_at) VALUES ('job','a','scan','complete',1,1); INSERT INTO source_snapshots VALUES ('snapshot','r','commit','hash','{\"sbom\":\"private-sbom\"}',1); INSERT INTO source_scans VALUES ('scan','a','snapshot','job',1,'test','{}','{\"findings\":[]}');");
  const options={secret:'fixture',origin:'https://scanner.test'},member={userId:'member',administrator:false};
  for(const view of ['scan','export']){
    assert.equal((await handleSource(new Request(`https://scanner.test/api/data/source?projectId=${b}&view=${view}&scanId=scan`),s,member,options)).status,404);
    assert.equal((await handleSource(new Request(`https://scanner.test/api/data/source?projectId=${a}&view=${view}&scanId=scan`),s,member,options)).status,404);
  }
  const publicData=await(await handleSource(new Request('https://scanner.test/api/data/source'),s,admin,options)).text();assert.ok(!publicData.includes('ciphertext-never-returned'));
});
