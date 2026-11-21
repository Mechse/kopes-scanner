import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/server/store';
import { ProjectStore } from '../src/server/project-store';
import { handleProjects } from '../src/server/project-api';
import { containerInfo } from '../src/server/docker';
import { resourceKey } from '../src/lib/settings';
import type { Container, Report } from '../src/lib/model';

const a: Container = { id: 'a', name: 'api', project: 'legacy', service: 'api', manager: 'Compose', image: 'app:1', target_id: 'image:old', discoveryKey: 'compose:legacy:api' };
const report: Report = { findings: [], packages: [{ name: 'example', version: '1', type: 'npm', path: '' }], os: '', eol: false };
const admin = { userId: 'admin', administrator: true };

test('stable discovery survives rename, image change and replacement; duplicate names and unknown replacements stay distinct', () => {
  const s = new Store(':memory:');
  try {
    s.syncInventory([a]);
    s.saveSettings('project', a.project, { rescanHours: 24 });
    const id = s.db.prepare('SELECT resource_id FROM runtime_instances WHERE container_id=?').get('a')!.resource_id;
    s.syncInventory([{ ...a, id: 'replacement', name: 'renamed', target_id: 'image:new', project: 'new label' }, { ...a, id: 'other', discoveryKey: 'compose:other:api' }]);
    assert.equal(s.db.prepare('SELECT resource_id FROM runtime_instances WHERE container_id=?').get('replacement')!.resource_id, id);
    assert.equal(s.settings('resource', JSON.stringify(['new label', 'renamed']))!.effective.rescanHours, 24);
    assert.notEqual(s.db.prepare('SELECT resource_id FROM runtime_instances WHERE container_id=?').get('other')!.resource_id, id);
    s.syncInventory([{ ...a, id: 'unknown', discoveryKey: undefined }]);
    assert.notEqual(s.db.prepare('SELECT resource_id FROM runtime_instances WHERE container_id=?').get('unknown')!.resource_id, id);
    assert.equal(s.db.prepare('SELECT active FROM runtime_instances WHERE container_id=?').get('a')!.active, 0);
  } finally { s.db.close(); }
});

test('projects rename without identity changes; moves preserve settings, reset is explicit, no implicit memberships', () => {
  const s = new Store(':memory:');
  try {
    s.syncInventory([a]);
    const p = new ProjectStore(s.db, admin), id = p.create('Portal'), other = p.create('Portal');
    const resource = String(p.unassigned()[0].id);
    s.db.prepare('UPDATE resources SET settings_json=? WHERE id=?').run(JSON.stringify({ rescanHours: 24, notifyFix: false, notifyNewCve: true }), resource);
    assert.equal(p.previewMove(resource, id).preserved.rescanHours, 24);
    p.move(resource, id); p.update(id, 'Renamed', false); p.move(resource, other);
    assert.equal(p.previewMove(resource, id).preserved.rescanHours, 24);
    p.move(resource, id, true);
    assert.equal(p.previewMove(resource, id).preserved.rescanHours, 168);
    assert.equal(p.detail(id).resources.length, 1);
    const member = new ProjectStore(s.db, { userId: 'member', administrator: false });
    assert.deepEqual(member.list(), []);
    assert.throws(() => member.detail(id), /not found/);
    assert.throws(() => member.create('Hidden'), /Administrator/);
    s.db.exec('CREATE TABLE user(id TEXT PRIMARY KEY)');
    s.db.prepare('INSERT INTO user VALUES (?)').run('member');
    p.grant(id, 'member', true);
    assert.deepEqual(member.list().map(x => x.id), [id]);
    p.grant(id, 'member', false);
    assert.equal(member.canRead(id), false);
    p.update(id, 'Renamed', true);
    assert.throws(() => p.move(resource, id), /archived/);
  } finally { s.db.close(); }
});

test('v5 copied database migration preserves legacy rows and imports reports exactly once', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kopes-migration-'));
  let s: Store | undefined;
  try {
    s = new Store(directory); s.syncInventory([a]);
    s.saveSettings('project', a.project, { rescanHours: 24 });
    s.saveSettings('resource', resourceKey(a), { notifyFix: false, displayName: 'Display' });
    s.complete(a.target_id, report, '{"bomFormat":"CycloneDX"}', 'linux/arm64', [], '');
    s.setMeta('sentinel', 'preserved');
    s.addUser('legacy-member');
    s.db.prepare('INSERT INTO pulse_states VALUES (?,?,?,?,?)').run('member', 'CVE-example', 0, 0, 1);
    const originalReport = s.report(a.target_id);
    const tables = [ 'scan_settings', 'display_names', 'pulse_events', 'pulse_states', 'issue_events', 'allowed_users', 'metadata'];
    const before = Object.fromEntries(tables.map(t => [t, s!.db.prepare(`SELECT * FROM ${t}`).all()]));
    // Remove only additive v6 objects to construct a populated v5 migration fixture.
    s.db.exec(`DROP TABLE project_events; DROP TABLE scan_observation_resources; DROP TABLE scan_observations; DROP TABLE runtime_instances;
      DROP TABLE resource_identity_conflicts; DROP TABLE legacy_resource_keys; DROP TABLE resource_aliases; DROP TABLE resources;
      DROP TABLE project_members; DROP TABLE projects; PRAGMA user_version=5;`);
    s.db.close(); s = new Store(directory);
    for (const table of tables) assert.deepEqual(s.db.prepare(`SELECT * FROM ${table}`).all(), before[table], table);
    assert.equal(s.db.prepare('PRAGMA user_version').get()!.user_version, 18);
    assert.deepEqual(s.selectedContainers(), []);
    assert.deepEqual(s.dashboard().containers, []);
    const imported = s.db.prepare('SELECT * FROM scan_observations').all();
    assert.equal(imported.length, 1); assert.equal(imported[0].imported, 1);
    assert.deepEqual(JSON.parse(String(imported[0].report_json)), originalReport);
    const resource = s.db.prepare('SELECT * FROM resources').get()!;
    assert.equal(resource.name, 'Display');
    assert.equal(JSON.parse(String(resource.settings_json)).rescanHours, 24);
    assert.equal(JSON.parse(String(resource.settings_json)).notifyFix, false);
    s.db.close(); s = new Store(directory);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM scan_observations').get()!.n, 1);
    s.syncInventory([]);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM scan_observations').get()!.n, 1);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM resources').get()!.n, 1);
  } finally { s?.db.close(); rmSync(directory, { recursive: true, force: true }); }
});

for (const missingLinks of [true, false]) test(`v10 upgrade preserves history and allows scans (missing links table: ${missingLinks})`, () => {
  const directory = mkdtempSync(join(tmpdir(), 'kopes-observation-migration-'));
  let s = new Store(directory);
  try {
    s.syncInventory([a]);
    s.complete(a.target_id, report, 'existing-sbom', null, [], '');
    const projects = new ProjectStore(s.db, admin);
    projects.move(String(projects.unassigned()[0].id), projects.create('Existing project'));
    const history = s.db.prepare('SELECT * FROM scan_observations').all();
    const resources = s.db.prepare('SELECT * FROM resources').all();
    const links = s.db.prepare('SELECT * FROM scan_observation_resources').all();
    if (missingLinks) s.db.exec('DROP TABLE scan_observation_resources');
    s.db.exec('PRAGMA user_version=10');
    s.db.close(); s = new Store(directory);
    assert.equal(s.db.prepare('PRAGMA user_version').get()!.user_version, 18);
    assert.deepEqual(s.selectedContainers(), [a.id]);
    assert.deepEqual(s.db.prepare('SELECT * FROM scan_observations').all(), history);
    assert.deepEqual(s.db.prepare('SELECT * FROM resources').all(), resources);
    assert.deepEqual(s.db.prepare('SELECT * FROM scan_observation_resources').all(), missingLinks ? [] : links);
    s.complete(a.target_id, report, 'new-sbom', null, [], '');
    const newLinks = s.db.prepare('SELECT * FROM scan_observation_resources').all();
    assert.equal(newLinks.length, missingLinks ? 1 : 2);
    assert.deepEqual(s.db.prepare('PRAGMA foreign_key_check').all(), []);
    s.db.close(); s = new Store(directory);
    assert.deepEqual(s.db.prepare('SELECT * FROM scan_observation_resources').all(), newLinks);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM scan_observations').get()!.n, 2);
  } finally { s.db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('untracking keeps history and removes the image target only after its last running container', () => {
  const s = new Store(':memory:');
  try {
    const other = { ...a, id: 'other', discoveryKey: 'other' };
    s.syncInventory([a, other]);
    const projects = new ProjectStore(s.db, admin), project = projects.create('Selected project');
    projects.move(String(s.db.prepare('SELECT resource_id FROM runtime_instances WHERE container_id=?').get(a.id)!.resource_id), project);
    assert.deepEqual(s.trackedContainers(project).map(c => c.id), [a.id]);
    s.complete(a.target_id, report, 'sbom', null, [], '');
    assert.equal(s.untrackContainer(a.id), true);
    assert.deepEqual(s.selectedContainers(), [other.id]);
    assert.deepEqual(s.dashboard().containers.map(c => c.id), [other.id]);
    assert.ok(s.db.prepare('SELECT 1 FROM targets WHERE id=?').get(a.target_id));
    assert.equal(s.untrackContainer(other.id), true);
    assert.equal(s.untrackContainer(other.id), false);
    assert.equal(s.db.prepare('SELECT 1 FROM targets WHERE id=?').get(a.target_id), undefined);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM scan_observation_resources').get()!.n, 2);
    s.syncInventory([a, other], { add: a.id });
    assert.deepEqual(s.selectedContainers(), [a.id], 'a stale snapshot must not re-track untracked containers');
    s.syncInventory([a]); s.syncInventory([]);
    assert.deepEqual(s.trackedContainers().map(c => c.id), [a.id]);
    assert.equal(s.untrackContainer(a.id), true);
    assert.deepEqual(s.trackedContainers(), []);
  } finally { s.db.close(); }
});

test('each completed scan survives target cleanup independently, including same-millisecond scans', () => {
  const s = new Store(':memory:');
  try {
    s.syncInventory([a]); s.complete(a.target_id, report, 'first', null, [], ''); s.complete(a.target_id, report, 'second', null, [], '');
    s.syncInventory([]);
    assert.deepEqual(s.db.prepare('SELECT sbom FROM scan_observations ORDER BY rowid').all().map(r => r.sbom), ['first', 'second']);
    assert.throws(() => s.complete('missing', report, '', null, [], ''), /Unknown/);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM scan_observations').get()!.n, 2);
  } finally { s.db.close(); }
});

test('project HTTP boundary rejects guessed IDs, member writes, forged roles and cross-origin writes', async () => {
  const s = new Store(':memory:');
  try {
    const id = new ProjectStore(s.db, admin).create('Private');
    const member = { userId: 'member', administrator: false };
    const request = (path: string, body?: unknown, origin = 'https://scanner.test') => new Request(`https://scanner.test/api/data/projects${path}`, body ? { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
    const call = (r: Request, principal = member) => handleProjects(r, s, principal, 'https://scanner.test');
    assert.deepEqual(await (await call(request(''))).json(), []);
    assert.equal((await call(request(`?id=${id}`))).status, 404);
    assert.equal((await call(request('?id=missing'))).status, 404);
    assert.equal((await call(request('?view=unassigned'))).status, 403);
    assert.equal((await call(request('', { action: 'create', name: 'Denied' }))).status, 403);
    assert.equal((await call(request('', { action: 'create', name: 'Denied' }, 'https://evil.test'), admin)).status, 403);
    assert.equal((await call(request('', { action: 'create', name: 'Denied', administrator: true }), admin)).status, 400);
    assert.equal((await call(request(`?id=${id}`), admin)).headers.get('cache-control'), 'private, no-store');
  } finally { s.db.close(); }
});

test('Docker discovery uses explicit keys and never standalone display names', () => {
  const base = { Id: 'a'.repeat(64), ImageID: `sha256:${'b'.repeat(64)}`, Image: 'app:1', Names: ['/name'], Labels: {} };
  assert.equal(containerInfo(base).discoveryKey, undefined);
  const compose = containerInfo({ ...base, Labels: { 'com.docker.compose.project': 'group', 'com.docker.compose.service': 'web' } });
  assert.deepEqual(JSON.parse(compose.discoveryKey!), ['local', 'Compose', 'group', 'web']);
  const coolify = containerInfo({ ...base, Labels: { 'coolify.applicationUuid': 'stable', 'coolify.environmentName': 'production' } });
  assert.deepEqual(JSON.parse(coolify.discoveryKey!), ['local', 'Coolify', 'application', 'stable']);
  assert.equal(coolify.environment, 'production');
});

test('assignment rejects stale previews and shared-image observations remain project scoped', async () => {
  const s = new Store(':memory:');
  try {
    s.syncInventory([a, { ...a, id: 'b', discoveryKey: 'other', project: 'other' }]);
    s.complete(a.target_id, report, 'shared-sbom', null, [], '');
    const p = new ProjectStore(s.db, admin), x = p.create('One'), y = p.create('Two');
    const resources = p.unassigned().map(r => String(r.id));
    const preview = p.previewMove(resources[0], x);
    p.move(resources[0], y);
    assert.throws(() => p.move(resources[0], x, false, preview.revision), /changed/);
    p.move(resources[0], x); p.move(resources[1], y);
    s.db.exec('CREATE TABLE user(id TEXT PRIMARY KEY)'); s.db.prepare('INSERT INTO user VALUES (?)').run('member');
    p.grant(x, 'member', true);
    const member = { userId: 'member', administrator: false };
    const read = (query: string) => handleProjects(new Request(`https://scanner.test/api/data/projects?${query}`), s, member, 'https://scanner.test');
    assert.equal((await read(`view=observations&id=${y}&resourceId=${resources[1]}`)).status, 404);
    assert.equal((await read(`view=observations&id=${x}&resourceId=${resources[1]}`)).status, 404);
    const allowed = await (await read(`view=observations&id=${x}&resourceId=${resources[0]}`)).json();
    assert.equal(allowed.length, 1);
    assert.equal((await read(`view=export&id=${x}&resourceId=${resources[1]}&observationId=${allowed[0].id}`)).status, 404);
    p.grant(x, 'member', false);
    assert.equal((await read(`view=export&id=${x}&resourceId=${resources[0]}&observationId=${allowed[0].id}`)).status, 404);
  } finally { s.db.close(); }
});

test('reset resources inherit later project defaults while preserved resources remain pinned', () => {
  const s=new Store(':memory:');try{
    s.syncInventory([a,{...a,id:'b',discoveryKey:'b'}]);
    const p=new ProjectStore(s.db,admin),id=p.create('Project');const resources=p.unassigned().map(r=>String(r.id));
    p.move(resources[0],id,false);p.move(resources[1],id,true);
    p.setProjectSettings(id,{rescanHours:24,notifyFix:false,notifyNewCve:true});
    assert.equal(JSON.parse(String(p.resource(id,resources[0]).settings_json)).rescanHours,168);
    assert.equal(JSON.parse(String(p.resource(id,resources[1]).settings_json)).rescanHours,24);
    p.resetResourceSettings(id,resources[0]);assert.equal(JSON.parse(String(p.resource(id,resources[0]).settings_json)).rescanHours,24);
  }finally{s.db.close();}
});

test('conflicting aliases never silently combine migrated resources', () => {
  const s=new Store(':memory:');try{
    s.syncInventory([{...a,discoveryKey:undefined},{...a,id:'b',discoveryKey:undefined}]);
    const before=s.db.prepare('SELECT container_id,resource_id FROM runtime_instances ORDER BY container_id').all();
    s.syncInventory([{...a,discoveryKey:'shared-label'},{...a,id:'b',discoveryKey:'shared-label'}]);
    assert.deepEqual(s.db.prepare('SELECT container_id,resource_id FROM runtime_instances ORDER BY container_id').all(),before);
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM resource_identity_conflicts').get()!.n,1);
    s.syncInventory([{...a,id:'replacement',discoveryKey:'shared-label'}]);
    const replacement=s.db.prepare("SELECT resource_id FROM runtime_instances WHERE container_id='replacement'").get()!.resource_id;
    assert.ok(before.every(r=>r.resource_id!==replacement));
  }finally{s.db.close();}
});

test('new and previously unassigned Compose services remain unassigned beside an assigned sibling', () => {
  const s = new Store(':memory:');
  try {
    const worker = { ...a, id: 'worker', name: 'worker', service: 'worker', discoveryKey: 'compose:legacy:worker' };
    s.syncInventory([a, worker]);
    const projects = new ProjectStore(s.db, admin), projectId = projects.create('Repository project');
    const resourceId = String(s.db.prepare("SELECT resource_id FROM runtime_instances WHERE container_id='a'").get()!.resource_id);
    projects.move(resourceId, projectId);
    const before = s.db.prepare('SELECT id,settings_json,inherited_json FROM resources ORDER BY id').all();
    s.syncInventory([worker, a]);
    assert.deepEqual(projects.discoveredGroups(projectId), []);
    assert.equal(projects.detail(projectId).resources.length, 1);
    assert.deepEqual(s.db.prepare('SELECT id,settings_json,inherited_json FROM resources ORDER BY id').all(), before);
    s.syncInventory([worker, a]);
    assert.equal(s.db.prepare("SELECT count(*) AS n FROM project_events WHERE action='discovery-group-expanded'").get()!.n, 0);
    s.syncInventory([worker, a, { ...worker, id: 'new', discoveryKey: 'compose:legacy:new' }]);
    assert.equal(projects.detail(projectId).resources.length, 1);
    assert.equal(projects.list().length, 1);
    assert.deepEqual(s.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { s.db.close(); }
});

for (const scenario of ['split', 'archived', 'name-only', 'non-compose', 'conflict']) test(`Compose grouping does not infer ownership for ${scenario}`, () => {
  const s = new Store(':memory:');
  try {
    const sibling = { ...a, id: 'sibling', discoveryKey: 'compose:legacy:sibling' };
    const extra = { ...a, id: 'extra', discoveryKey: 'compose:legacy:extra' };
    const inventory = [a, sibling, extra].map(c => ({ ...c, manager: scenario === 'non-compose' ? 'Docker' : c.manager }));
    s.syncInventory(inventory);
    const projects = new ProjectStore(s.db, admin), projectId = projects.create('legacy');
    const id = (container: string) => String(s.db.prepare('SELECT resource_id FROM runtime_instances WHERE container_id=?').get(container)!.resource_id);
    if (scenario !== 'name-only') projects.move(id('a'), projectId);
    if (scenario === 'split') projects.move(id('sibling'), projects.create('Other'));
    if (scenario === 'archived') projects.update(projectId, 'legacy', true);
    if (scenario === 'conflict') s.db.prepare('INSERT INTO resource_identity_conflicts VALUES (?,?,?,?)').run('conflict', id('a'), id('sibling'), Date.now());
    s.syncInventory(inventory);
    assert.equal(s.db.prepare('SELECT project_id FROM resources WHERE id=?').get(id('extra'))!.project_id, null);
  } finally { s.db.close(); }
});
