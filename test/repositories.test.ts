import { rescan } from '../src/server/rescan';
import { handleFavourites } from '../src/server/favourites';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/server/store';
import { ProjectStore } from '../src/server/project-store';
import { githubRepository, handleRepositories } from '../src/server/source/repositories';
import { queueDueSources } from '../src/server/source/jobs';
import { migrateSource, migrateStandaloneSources, migrateIndependentRepositories } from '../src/server/source/schema';
import { containerInfo } from '../src/server/docker';
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
test('only canonical public GitHub locators are accepted', () => {
  assert.equal(githubRepository('https://github.com/example/public.git'), 'example/public');
  for (const value of ['https://evil.test/a/b','https://github.com.evil.test/a/b','https://github.com/a/b/tree/main','https://user:token@github.com/a/b','a/..','a/b?token=secret','git@github.com:a/b']) assert.throws(() => githubRepository(value));
});
test('standalone public repos are idempotent, use default branch, queue and poll without a project', async t => {
  const s = setup(t);
  const response = await handleRepositories(request({ action: 'add', repository: 'example/public' }), s, admin, origin, read);
  assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.queued, true);
  const binding = s.db.prepare('SELECT * FROM source_bindings').get()!;
  assert.equal(binding.project_id, null); assert.equal(binding.branch, 'trunk');
  assert.equal(s.db.prepare('SELECT state FROM source_jobs').get()!.state, 'queued');
  queueDueSources(s); assert.equal(s.db.prepare("SELECT count(*) AS n FROM source_jobs WHERE kind='poll'").get()!.n, 1);
  await handleRepositories(request({ action: 'add', repository: 'https://github.com/example/public.git' }), s, admin, origin, read);
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM source_bindings').get()!.n, 1);
  const member = { userId: 'viewer', administrator: false };
  const list = await handleRepositories(new Request(origin+'/api/data/repositories'), s, member, origin, read);
  assert.deepEqual((await list.json()).bindings, []);
  assert.equal((await handleRepositories(request({ action: 'add', repository: 'example/public' }), s, member, origin, read)).status, 403);
  const badOrigin = new Request(origin+'/api/data/repositories', { method: 'POST', headers: { origin: 'https://evil.test' }, body: '{}' });
  assert.equal((await handleRepositories(badOrigin, s, admin, origin, read)).status, 403);
});
test('repositories reject container associations and retain project access settings', async t => {
  const s = setup(t), projectId = new ProjectStore(s.db, admin).create('App');
  assert.equal((await handleRepositories(request({ action: 'add', repository: 'example/public', resources: ['container'] }), s, admin, origin, read)).status, 400);
  const added = await (await handleRepositories(request({ action: 'add', repository: 'example/public' }), s, admin, origin, read)).json();
  assert.equal((await handleRepositories(request({ action: 'settings', bindingId: added.id, projectId, resources: [] }), s, admin, origin, read)).status, 200);
  assert.equal(s.db.prepare('SELECT project_id FROM source_bindings').get()!.project_id, projectId);
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM source_jobs').get()!.n, 1);
  assert.equal((await handleRepositories(request({ action: 'links', bindingId: added.id, projectId, resources: [] }), s, admin, origin, read)).status, 400);
});
test('runtime metadata does not discover or connect repositories', t => {
  const s = setup(t);
  s.syncInventory([containerInfo({ Id: 'a'.repeat(64), Names: ['/app'], Image: 'app:latest', ImageID: 'sha256:'+'b'.repeat(64), Labels: { 'org.opencontainers.image.source': 'https://github.com/example/public' } })]);
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM source_bindings').get()!.n, 0);
  assert.equal(s.db.prepare("SELECT name FROM sqlite_master WHERE name IN ('source_binding_resources','source_discovery')").all().length, 0);
});
test('migration retains source history and foreign keys when project becomes optional', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON; CREATE TABLE projects(id TEXT PRIMARY KEY); CREATE TABLE resources(id TEXT PRIMARY KEY); INSERT INTO projects VALUES (\'p\')');
    migrateSource(db);
    db.exec(`INSERT INTO source_connections(id,provider,origin,credential) VALUES ('c','github','https://api.github.com',''); INSERT INTO source_repositories VALUES ('r','github','https://api.github.com','42','example/public'); INSERT INTO source_bindings(id,project_id,repository_id,connection_id,branch,folder) VALUES ('b','p','r','c','main',''); INSERT INTO source_jobs(id,binding_id,kind,state,created_at,available_at) VALUES ('j','b','scan','queued',1,1); INSERT INTO source_events VALUES ('e','p','b','created',NULL,1,NULL,'{}');`);
    migrateStandaloneSources(db);
    db.exec("UPDATE source_bindings SET project_id=NULL WHERE id='b'; UPDATE source_events SET project_id=NULL WHERE id='e'");
    assert.equal(db.prepare('SELECT binding_id FROM source_jobs').get()!.binding_id, 'b');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.throws(() => db.exec("DELETE FROM source_bindings WHERE id='b'"));
  } finally { db.close(); }
});

test('public repository additions and link editing work without either scanning pilot', async t => {
  const s = setup(t);
  process.env.KOPES_SOURCE_PILOT = '0'; process.env.KOPES_SOURCE_SCAN_PILOT = '0';
  const result = await handleRepositories(request({ action: 'add', repository: 'example/public' }), s, admin, origin, read);
  assert.equal(result.status, 200);
  const added = await result.json(); assert.equal(added.queued, false);
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM source_jobs').get()!.n, 0);
  const projectId = new ProjectStore(s.db, admin).create('App');
  assert.equal((await handleRepositories(request({ action: 'settings', bindingId: added.id, projectId, resources: [] }), s, admin, origin, read)).status, 200);
  const favourite = () => new Request(origin+'/api/data/favourites', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'resource', key: `repo:${added.id}`, favourite: true }) });
  assert.equal((await handleFavourites(favourite(), s, 'admin', origin, true)).status, 200);
  assert.equal((await handleFavourites(favourite(), s, 'outsider', origin)).status, 404);
});


test('adding from the project overview creates a named project with its repository', async t => {
  const s = setup(t);
  const response = await handleRepositories(request({ action: 'add', repository: 'example/public', asProject: true }), s, admin, origin, read);
  assert.equal(response.status, 200);
  const result = await response.json();
  const project = s.db.prepare('SELECT * FROM projects WHERE id=?').get(result.projectId)!;
  assert.equal(project.name, 'public');
  assert.equal(s.db.prepare('SELECT project_id FROM source_bindings WHERE id=?').get(result.id)!.project_id, project.id);
  assert.equal(s.db.prepare('SELECT actor_id FROM project_events WHERE project_id=?').get(project.id)!.actor_id, admin.userId);
  assert.deepEqual(s.db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('failed repository validation leaves no empty project', async t => {
  const s = setup(t);
  const response = await handleRepositories(request({ action: 'add', repository: 'example/private', asProject: true }), s, admin, origin, async () => { throw new Error('Unavailable'); });
  assert.equal(response.status, 400);
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM projects').get()!.n, 0);
});

test('adding inside a project keeps the repository in that project without creating another', async t => {
  const s = setup(t), projectId = new ProjectStore(s.db, admin).create('Existing');
  const response = await handleRepositories(request({ action: 'add', repository: 'example/public', projectId }), s, admin, origin, read);
  assert.equal(response.status, 200);
  assert.equal(s.db.prepare('SELECT project_id FROM source_bindings').get()!.project_id, projectId);
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM projects').get()!.n, 1);
  const conflicting = await handleRepositories(request({ action: 'add', repository: 'example/public', projectId, asProject: true }), s, admin, origin, read);
  assert.equal(conflicting.status, 400);
});


test('container rescans never queue repository scans and retain cooldown guards', async t => {
  const s = setup(t);
  s.syncInventory([{ id: 'a', name: 'a', image: 'app', target_id: 'image:a', project: '', service: 'a', manager: 'Compose' }]);
  await handleRepositories(request({ action: 'add', repository: 'example/public' }), s, admin, origin, read);
  s.db.exec('DELETE FROM source_jobs');
  assert.equal(rescan(s, 'image:a', admin, 'missing').status, 404);
  assert.equal((await rescan(s, 'image:a', admin, 'a').json()).sourceScans, 0);
  assert.equal(s.db.prepare('SELECT requested FROM targets WHERE id=?').get('image:a')!.requested, 1);
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM source_jobs').get()!.n, 0);
  s.db.exec("UPDATE targets SET status='scanning'");
  assert.equal(rescan(s, 'image:a', admin, 'a').status, 429);
});

test('repository status keeps active branch scans visible ahead of newer polls and deployed-commit jobs', async t => {
  const s = setup(t);
  const added = await (await handleRepositories(request({ action: 'add', repository: 'example/public' }), s, admin, origin, read)).json();
  s.db.prepare("UPDATE source_jobs SET state='running',created_at=1 WHERE binding_id=?").run(added.id);
  const insert = s.db.prepare("INSERT INTO source_jobs(id,binding_id,kind,state,created_at,available_at) VALUES (?,?,?,?,?,1)");
  insert.run('poll', added.id, 'poll', 'complete', 2);
  insert.run('historical', added.id, 'deployed:commit', 'running', 3);
  const get = async () => (await (await handleRepositories(new Request(origin+'/api/data/repositories'), s, admin, origin, read)).json()).bindings[0].jobs[0].state;
  assert.equal(await get(), 'running');
  s.db.prepare("UPDATE source_jobs SET state='queued' WHERE kind='scan'").run();
  assert.equal(await get(), 'queued');
  s.db.prepare("UPDATE source_jobs SET state='failed',created_at=4 WHERE kind='scan'").run();
  assert.equal(await get(), 'failed');
});


test('independence migration deletes associations and cancels deployed jobs without losing scans', t => {
  const s = setup(t);
  s.db.exec(`CREATE TABLE source_binding_resources(binding_id TEXT,resource_id TEXT);
    CREATE TABLE source_discovery(resource_id TEXT,repository TEXT);
    INSERT INTO source_binding_resources VALUES ('b','resource');
    INSERT INTO source_connections(id,provider,origin,credential) VALUES ('c','github','https://api.github.com','');
    INSERT INTO source_repositories VALUES ('r','github','https://api.github.com','1','o/r');
    INSERT INTO source_bindings(id,project_id,repository_id,connection_id,branch,folder) VALUES ('b',NULL,'r','c','main','');
    INSERT INTO source_jobs VALUES ('j','b','deployed:sha','queued',1,1,NULL,0,NULL,NULL);
    INSERT INTO source_snapshots VALUES ('n','r','sha','hash','{}',1);
    INSERT INTO source_scans VALUES ('scan','b','n','j',1,'test','{}','{}');`);
  migrateIndependentRepositories(s.db);
  assert.equal(s.db.prepare('SELECT state FROM source_jobs').get()!.state, 'cancelled');
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM source_scans').get()!.n, 1);
  assert.equal(s.db.prepare("SELECT name FROM sqlite_master WHERE name='source_binding_resources'").get(), undefined);
  assert.deepEqual(s.db.prepare('PRAGMA foreign_key_check').all(), []);
  migrateIndependentRepositories(s.db);
});
