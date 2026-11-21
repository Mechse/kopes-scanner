import test from 'node:test';
import assert from 'node:assert/strict';
import { GitProvider, blockedAddress, safeInputPath, validateOrigin } from '../src/server/source/provider';
import { seal, unseal, handleSource } from '../src/server/source/service';
import { Store } from '../src/server/store';
import { ProjectStore } from '../src/server/project-store';
import { SourceError } from '../src/server/source/errors';

test('repository ID summaries are hydrated with the same credentials and immutable identity', async () => {
  const connection = { provider: 'github' as const, origin: 'https://api.github.com', token: 'private-token' };
  const paths: string[] = [];
  const provider = new GitProvider(connection, async (c, path) => {
    assert.equal(c, connection); paths.push(path);
    if (path === '/repositories/99') return { id: 99, full_name: 'owner/renamed' };
    assert.equal(path, '/repos/owner/renamed');
    return { id: 99, full_name: 'owner/renamed', default_branch: 'release/current' };
  });
  assert.deepEqual(await provider.repository('99'), { providerId: '99', name: 'owner/renamed', branch: 'release/current' });
  assert.deepEqual(paths, ['/repositories/99', '/repos/owner/renamed']);
});

test('repository ID hydration rejects changed identities, unsafe names and absent default branches', async () => {
  const connection = { provider: 'github' as const, origin: 'https://api.github.com', token: '' };
  for (const [summary, detail, reason, expectedCalls] of [
    [{ id: 100, full_name: 'owner/private' }, null, 'repository-identity', 1],
    [{ id: 99, full_name: 'owner/private' }, { id: 100, full_name: 'owner/private', default_branch: 'main' }, 'repository-identity', 2],
    [{ id: 99, full_name: 'owner/private' }, { id: 99, full_name: 'owner/private', default_branch: null }, 'default-branch', 2],
    [{ id: 99, full_name: 'owner/..' }, null, 'repository-response', 1],
    [{ id: 99, full_name: 'https://private.example/path?token=secret' }, null, 'repository-response', 1],
  ] as const) {
    let calls = 0;
    const provider = new GitProvider(connection, async () => ++calls === 1 ? summary : detail);
    await assert.rejects(provider.repository('99'), e => e instanceof SourceError && e.reason === reason && !e.message.includes('secret'));
    assert.equal(calls, expectedCalls);
  }
});

test('complete ID metadata needs no hydration, and denied hydration never falls back to anonymous access', async () => {
  const connection = { provider: 'github' as const, origin: 'https://api.github.com', token: 'private-token' };
  let calls = 0;
  const provider = new GitProvider(connection, async () => { calls++; return { id: 99, full_name: 'owner/private', default_branch: 'main' }; });
  assert.equal((await provider.repository('99')).branch, 'main'); assert.equal(calls, 1);
  const denied = new Error('private response must remain internal'); calls = 0;
  const failed = new GitProvider(connection, async (c) => {
    assert.equal(c.token, 'private-token');
    if (++calls === 1) return { id: 99, full_name: 'owner/private' };
    throw denied;
  });
  await assert.rejects(failed.repository('99'), e => e === denied); assert.equal(calls, 2);
});

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
    if (path.includes('/git/trees/')) return { truncated: bad === 'truncated', tree: ['package.json','apps/web/package.json','pnpm-lock.yaml','requirements.txt','backend/uv.lock','backend/pyproject.toml','public/favicon.svg'].map(path => ({ path, type: 'blob', mode: bad === 'symlink' ? '120000' : '100644' })) };
    if (path.endsWith(`/contents/public/favicon.svg?ref=${sha}`)) return { type: 'file', encoding: 'base64', content: Buffer.from('<svg/>').toString('base64') };
    assert.ok(path.endsWith(`?ref=${sha}`)); return { type: 'file', encoding: 'base64', content: Buffer.from('{}').toString('base64') };
  });
  const repo = { providerId: '1', name: 'owner/name', branch: 'main' };
  const bundle = await provider.bundle(repo, sha); assert.equal(Object.keys(bundle.files).length, 6);
  assert.equal(bundle.favicon, `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`);
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

test('generic source API cannot create a GitHub token connection or upgrade public access to one', async t => {
  const store = new Store(':memory:');
  t.after(() => store.db.close());
  const original = process.env.KOPES_SOURCE_PILOT;
  process.env.KOPES_SOURCE_PILOT = '1';
  t.after(() => { if (original === undefined) delete process.env.KOPES_SOURCE_PILOT; else process.env.KOPES_SOURCE_PILOT = original; });
  store.db.exec("INSERT INTO source_connections(id,provider,origin,credential) VALUES ('public','github','https://api.github.com','')");
  const origin = 'https://scanner.test';
  for (const body of [{action:'connect', provider:'github', origin:'https://api.github.com', repository:'owner/repo', token:'token'}, {action:'rotate', connectionId:'public', token:'token'}]) {
    const req = new Request(`${origin}/api/data/source`, {method:'POST', headers:{origin}, body:JSON.stringify(body)});
    const res = await handleSource(req,store,{userId:'admin',administrator:true},{origin,secret:'fixture'},async()=>{ throw new Error('Unexpected network call'); });
    assert.equal(res.status,400);
    assert.match(await res.text(),/Use GitHub settings/);
  }
  assert.deepEqual(store.db.prepare('SELECT auth_kind,credential FROM source_connections').all().map(c=>[c.auth_kind,c.credential]),[['anonymous','']]);
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
