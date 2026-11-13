import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityEvents, activityResources, type FindingEvent, type ScanEvent } from '../src/lib/activity';
import type { Dashboard, Target } from '../src/lib/model';

const data: Dashboard = {
  containers: [
    { id: 'a', name: 'web', project: 'alpha', target_id: 'shared', image: 'image', service: 'web', manager: 'docker' },
    { id: 'b', name: 'web', project: 'beta', target_id: 'shared', image: 'image', service: 'web', manager: 'docker' },
    { id: 'c', name: 'worker', project: '', target_id: 'worker', image: 'image', service: 'worker', manager: 'docker' },
  ],
  targets: [{ id: 'host', name: 'Host OS', kind: 'host' } as Target],
  inventoryAt: null, inventoryError: null, intervalHours: 24,
};
const findings: FindingEvent[] = ['alpha', 'beta', ''].map((project, i) => ({ seq: i, app: JSON.stringify([project, project ? 'web' : 'worker']), name: 'web', issue: 'CVE-1', package: 'pkg', ecosystem: 'npm', kind: 'discovered', time: 10 + i }));
const scans: ScanEvent[] = [{ seq: 1, target: 'shared', name: 'web in alpha, web in beta', message: 'Scan completed', time: 20 }];

test('project activity includes shared-image scans without unrelated project names or findings', () => {
  const events = activityEvents(activityResources(data, { project: 'alpha' }), findings, scans);
  assert.deepEqual(events.map(e => e.id), ['scan-1', 'finding-0']);
  assert.ok(events.every(e => e.resources.every(r => r.project === 'alpha')));
  assert.ok(!JSON.stringify(events).includes('beta'));
});
test('resource scope matches stable finding identity and rejects mismatched container IDs', () => {
  assert.deepEqual(activityEvents(activityResources(data, { target: 'shared', app: 'b' }), findings, scans).map(e => e.id), ['scan-1', 'finding-1']);
  assert.deepEqual(activityResources(data, { target: 'worker', app: 'a' }), []);
  assert.deepEqual(activityResources(data, { target: 'shared', app: 'missing' }), []);
});
test('empty project, host, and absent scope remain distinct', () => {
  assert.deepEqual(activityEvents(activityResources(data, { project: '' }), findings, scans).map(e => e.id), ['finding-2']);
  assert.deepEqual(activityResources(data, { target: 'host' }).map(r => r.key), ['host']);
  assert.deepEqual(activityResources(data, {}), []);
});
test('shared-image scans appear once with all matching resources', () => {
  const events = activityEvents(activityResources(data, { target: 'shared' }), findings, scans);
  assert.equal(events.filter(e => e.kind === 'scans').length, 1);
  assert.equal(events[0].resources.length, 2);
});

 test('saved project activity follows assigned containers across discovery groups', () => {
  const scope = { containerIds: ['a', 'c'] };
  const events = activityEvents(activityResources(data, scope), findings, scans);
  assert.deepEqual(events.map(e => e.id), ['scan-1', 'finding-2', 'finding-0']);
  assert.ok(events.every(e => e.resources.every(r => r.app !== 'b')));
  assert.deepEqual(activityResources(data, { containerIds: [] }), []);
});
