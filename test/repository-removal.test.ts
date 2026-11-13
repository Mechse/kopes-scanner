import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/server/store';
import { ProjectStore } from '../src/server/project-store';
import { handleRepositories, addPublicRepository } from '../src/server/source/repositories';
const admin = { userId: 'admin', administrator: true };
const origin = 'https://scanner.example';
const read = async (connection: { token: string }, path: string) => {
  assert.equal(connection.token, '');
  return path.includes('/branches/') ? { commit: { sha: 'a'.repeat(40) } } : { id: 42, full_name: 'example/public', default_branch: 'trunk' };
};
function request(body: unknown) { return new Request(origin+'/api/data/repositories', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
function setup(t: any) {
  const flags = [process.env.KOPES_SOURCE_PILOT, process.env.KOPES_SOURCE_SCAN_PILOT];
  process.env.KOPES_SOURCE_PILOT = '1'; process.env.KOPES_SOURCE_SCAN_PILOT = '1';
  const store = new Store(':memory:');
  t.after(() => { store.db.close(); for (const [index, key] of ['KOPES_SOURCE_PILOT','KOPES_SOURCE_SCAN_PILOT'].entries()) { if (flags[index] === undefined) delete process.env[key]; else process.env[key] = flags[index]; } });
  return store;
}
test('removal deletes every binding and source history but preserves projects, runtime and shared credentials', async t => {
  const s = setup(t), project = new ProjectStore(s.db, admin).create('Keep project');
  s.syncInventory([{ id: 'a', name: 'a', image: 'app', target_id: 'image:a', project: 'discovered', service: 'a', manager: 'Compose' }]);
  const resource = String(s.db.prepare('SELECT resource_id FROM runtime_instances').get()!.resource_id);
  const add = async (projectId: string | null, reader = read) => (await (await handleRepositories(request({ action: 'add', repository: 'example/public', projectId, resources: [] }), s, admin, origin, reader)).json()).id;
  const a = await add(null), b = await add(project);
  const other = await add(null, async (_connection, path) => path.includes('/branches/') ? { commit: { sha: 'b'.repeat(40) } } : { id: 43, full_name: 'example/other', default_branch: 'main' });
  const connection = s.db.prepare('SELECT connection_id FROM source_bindings WHERE id=?').get(b)!.connection_id;
  s.db.prepare("UPDATE source_connections SET credential='encrypted-credential' WHERE id=?").run(connection);
  s.db.prepare('UPDATE source_bindings SET connection_id=? WHERE id=?').run(connection, other);
  const repo = s.db.prepare('SELECT repository_id FROM source_bindings WHERE id=?').get(a)!.repository_id;
  s.db.prepare("INSERT INTO source_snapshots VALUES ('snapshot',?,'commit','hash','{}',1)").run(repo);
  for (const id of [a, b]) {
    const job = s.db.prepare('SELECT id FROM source_jobs WHERE binding_id=?').get(id)!.id;
    s.db.prepare("UPDATE source_jobs SET state='running' WHERE id=?").run(job);
    s.db.prepare("INSERT INTO source_scans VALUES (?,?, 'snapshot',?,1,'test','{}','{}')").run(`scan-${id}`, id, job);
    s.db.prepare("INSERT INTO source_events VALUES (?,?,?,'fix-available',NULL,1,NULL,'{}')").run(`event-${id}`, project, id);
    s.db.prepare("INSERT INTO favourites(user_id,scope,key) VALUES ('admin','resource',?)").run(`repo:${id}`);
  }
  const removed = await handleRepositories(request({ action: 'remove', bindingId: a }), s, admin, origin, read);
  assert.equal(removed.status, 200);
  assert.deepEqual(s.db.prepare('SELECT id FROM source_bindings').all().map(r => r.id), [other]);
  for (const table of ['source_scans', 'source_snapshots', 'source_events', 'favourites']) assert.equal(s.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0, table);
  assert.deepEqual(s.db.prepare('SELECT binding_id FROM source_jobs').all().map(r => r.binding_id), [other]);
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM projects WHERE id=?').get(project)!.n, 1);
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM runtime_instances').get()!.n, 1);
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM resources').get()!.n, 1);
  assert.equal(s.db.prepare('SELECT credential FROM source_connections WHERE id=?').get(connection)!.credential, 'encrypted-credential');
  assert.deepEqual(s.db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal((await handleRepositories(request({ action: 'remove', bindingId: a }), s, admin, origin, read)).status, 404);
});

test('removal requires administrator access and same origin even when scanning is disabled', async t => {
  const s = setup(t);
  const { id } = await (await handleRepositories(request({ action: 'add', repository: 'example/public' }), s, admin, origin, read)).json();
  const body = { action: 'remove', bindingId: id };
  assert.equal((await handleRepositories(request(body), s, { userId: 'viewer', administrator: false }, origin, read)).status, 403);
  const crossOrigin = new Request(origin+'/api/data/repositories', { method: 'POST', headers: { origin: 'https://evil.test' }, body: JSON.stringify(body) });
  assert.equal((await handleRepositories(crossOrigin, s, admin, origin, read)).status, 403);
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM source_bindings').get()!.n, 1);
  process.env.KOPES_SOURCE_PILOT = '0'; process.env.KOPES_SOURCE_SCAN_PILOT = '0';
  assert.equal((await handleRepositories(request(body), s, admin, origin, read)).status, 200);
});

test('removed repository identities stay suppressed for automatic additions until explicitly re-added', async t => {
  const s = setup(t);
  const input = { repository: 'example/public', projectId: null, resources: [] };
  const added = await addPublicRepository(s, input, read);
  assert.ok(added);
  assert.equal((await handleRepositories(request({ action: 'remove', bindingId: added.id }), s, admin, origin, read)).status, 200);
  assert.equal(await addPublicRepository(s, input, read, undefined, true), null);
  assert.equal(await addPublicRepository(s, { ...input, repository: 'example/renamed' }, read, undefined, true), null);
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM source_bindings').get()!.n, 0);
  assert.ok(await addPublicRepository(s, input, read));
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM source_removed_repositories').get()!.n, 0);
});

test('an in-flight scan stops after removal without restoring jobs or publishing results', async t => {
  const { runSourceJob } = await import('../src/server/source/jobs');
  const { readConfig } = await import('../src/server/config');
  const { mkdtemp, rm, readdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const s = setup(t), spool = await mkdtemp(join(tmpdir(), 'repository-removal-'));
  const previous = process.env.KOPES_SOURCE_SPOOL;
  process.env.KOPES_SOURCE_SPOOL = spool;
  t.after(async () => { if (previous === undefined) delete process.env.KOPES_SOURCE_SPOOL; else process.env.KOPES_SOURCE_SPOOL = previous; await rm(spool, { recursive: true, force: true }); });
  const added = await addPublicRepository(s, { repository: 'example/public', projectId: null, resources: [] }, read);
  const config = readConfig({ BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: 's'.repeat(32) });
  let calls = 0;
  assert.equal(await runSourceJob(s, config, new AbortController().signal, async (connection, path) => {
    calls++;
    assert.equal((await handleRepositories(request({ action: 'remove', bindingId: added!.id }), s, admin, origin, read)).status, 200);
    return read(connection, path);
  }, async () => ({ allowed: true, reason: null, databaseBytes: 0, journalBytes: 0, free: [], retention: 'preserve-all-evidence' })), true);
  assert.equal(calls, 1);
  for (const table of ['source_jobs', 'source_scans', 'source_snapshots', 'source_bindings']) assert.equal(s.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0, table);
  assert.deepEqual(await readdir(join(spool, 'in')), []);
  assert.deepEqual(await readdir(join(spool, 'out')), []);
});

test('removal rolls back completely if cleanup fails', async t => {
  const s = setup(t);
  const added = await addPublicRepository(s, { repository: 'example/public', projectId: null, resources: [] }, read);
  s.db.exec("CREATE TRIGGER refuse_removal BEFORE DELETE ON source_repositories BEGIN SELECT RAISE(ABORT,'test failure'); END");
  assert.equal((await handleRepositories(request({ action: 'remove', bindingId: added!.id }), s, admin, origin, read)).status, 400);
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM source_jobs').get()!.n, 1);
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM source_bindings').get()!.n, 1);
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM source_removed_repositories').get()!.n, 0);
  assert.deepEqual(s.db.prepare('PRAGMA foreign_key_check').all(), []);
});
