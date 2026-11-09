import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/server/store';
import { defaultSettings, projectSettingsSchema, resourceSettingsSchema, resourceKey } from '../src/lib/settings';
import { projectName, resourceName } from '../src/lib/display-name';
import { projectLabel } from '../src/lib/project-label';
import type { Container, Report } from '../src/lib/model';

const web: Container = { id: 'web', name: 'web-1', project: 'alpha', target_id: 'image:shared', image: 'app:1', service: 'web', manager: 'compose' };
const other: Container = { ...web, id: 'other', project: 'beta' };
const report: Report = { os: 'linux', eol: false, packages: [], findings: [{ id: 'CVE-2026-1234', package: 'lib', installed: '1', fixed: '', severity: 'HIGH', title: 'Issue', type: 'os', path: '' }] };

test('shared names survive restart and recreation without changing identity, membership, or scan settings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kopes-names-'));
  let store = new Store(dir);
  try {
    store.syncInventory([web, other]);
    store.saveSettings('project', 'alpha', { ...defaultSettings, displayName: 'Production' });
    store.saveSettings('resource', resourceKey(web), { displayName: 'Website' });
    store.saveSettings('resource', 'host', { displayName: 'Main server' });
    assert.deepEqual(store.settings('resource', resourceKey(web))?.effective, defaultSettings);
    assert.equal(store.settings('resource', resourceKey(other))?.displayName, '');
    store.db.close();
    store = new Store(dir);
    store.syncInventory([{ ...web, id: 'replacement', target_id: 'image:new' }, other]);
    const data = store.dashboard();
    const resource = data.containers.find(c => c.id === 'replacement')!;
    assert.equal(resourceName(resource), 'Website');
    assert.equal(resource.name, web.name);
    assert.equal(resource.project, web.project);
    assert.equal(resourceKey(resource), resourceKey(web));
    assert.equal(projectName('alpha', data), 'Production');
    assert.equal(projectLabel('alpha', [resource], data.projectNames).title, 'Production');
    assert.equal(resourceName(data.targets.find(t => t.id === 'host')), 'Main server');
    assert.equal(store.settings('resource', resourceKey(web))?.displayName, 'Website');
    // An older client saving scan settings must not clear the name.
    store.saveSettings('resource', resourceKey(web), { notifyFix: false });
    assert.equal(store.settings('resource', resourceKey(web))?.displayName, 'Website');
    store.saveSettings('resource', resourceKey(web), { displayName: '' });
    store.saveSettings('project', 'alpha', { ...defaultSettings, displayName: '' });
    store.saveSettings('resource', 'host', { displayName: '' });
    const reset = store.dashboard();
    assert.equal(resourceName(reset.containers.find(c => c.id === 'replacement')), web.name);
    assert.equal(projectName('alpha', reset), 'alpha');
    assert.equal(resourceName(reset.targets.find(t => t.id === 'host')), 'Host OS');
  } finally { store.db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('existing activity and Pulse use current names for all users and reset to originals', () => {
  const store = new Store(':memory:');
  try {
    store.syncInventory([web, other]);
    store.complete(web.target_id, report, '{}', null, [], '');
    store.saveSettings('resource', resourceKey(web), { displayName: 'Website' });
    const item = store.pulseFeed('alice')[0];
    assert.equal(item.events.find(e => e.resource === resourceKey(web))?.resourceName, 'Website');
    assert.equal(item.events.find(e => e.resource === resourceKey(other))?.resourceName, other.name);
    assert.deepEqual(store.pulseFeed('bob'), store.pulseFeed('alice'));
    assert.equal(store.timeline().find(e => e.app === resourceKey(web))?.name, 'Website');
    assert.equal(store.activity()[0].name, `Website, ${other.name}`);
    store.saveSettings('resource', resourceKey(web), { displayName: '' });
    assert.equal(store.pulseFeed('alice')[0].events.find(e => e.resource === resourceKey(web))?.resourceName, web.name);
    assert.equal(store.timeline().find(e => e.app === resourceKey(web))?.name, web.name);
    assert.equal(store.settings('resource', 'missing'), null);
    assert.equal(store.saveSettings('project', 'missing', { displayName: 'X' }), null);
  } finally { store.db.close(); }
});

test('names trim whitespace, support reset and Unicode, and reject invalid input', () => {
  assert.equal(resourceSettingsSchema.parse({ displayName: '  Bühne 🚀  ' }).displayName, 'Bühne 🚀');
  assert.equal(resourceSettingsSchema.parse({ displayName: '   ' }).displayName, '');
  assert.equal(projectSettingsSchema.parse({ ...defaultSettings, displayName: 'Project' }).displayName, 'Project');
  for (const displayName of [123, null, 'a'.repeat(121)]) assert.equal(resourceSettingsSchema.safeParse({ displayName }).success, false);
  assert.equal(projectName('constructor', { projectNames: {} }), 'constructor');
});
