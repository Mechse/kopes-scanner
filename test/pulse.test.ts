import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/server/store';
import { pulseChanges, hasPulseFix, batchPulse, groupPulse } from '../src/lib/pulse';
import type { Finding, Report } from '../src/lib/model';
const finding: Finding = { id: 'CVE-2026-1234', package: 'openssl', installed: '1', fixed: '', severity: 'HIGH', title: 'Example advisory', type: 'os', path: '' };
const report = (...findings: Finding[]): Report => ({ findings, packages: [], os: 'linux', eol: false });
const complete = (s: Store, r: Report, id = 'host') => s.complete(id, r, '', null, [], '');
test('Pulse records meaningful transitions without repeating unchanged scans', () => {
  assert.equal(pulseChanges(null, report(finding))[0].kind, 'discovered');
  assert.deepEqual(pulseChanges(report(finding), report(finding)), []);
  assert.equal(pulseChanges(report(finding), report({ ...finding, fixed: '2' }))[0].kind, 'fix');
  assert.equal(pulseChanges(report(finding), report())[0].kind, 'resolved');
  assert.equal(pulseChanges(report(finding), report({ ...finding, severity: 'CRITICAL' }))[0].kind, 'changed');
});
test('Pulse groups targets and persists isolated user actions; new changes resurface', () => {
  const s = new Store(':memory:');
  try {
    s.syncInventory([{ id: 'container', target_id: 'image:test', name: 'Web', image: 'test', project: 'Website', service: '', manager: '' }, { id: 'second', target_id: 'image:second', name: 'API', image: 'test2', project: 'Backend', service: '', manager: '' }]);
    complete(s, report(finding), 'image:second'); complete(s, report(finding), 'image:test');
    let item = s.pulseFeed('alice')[0];
    assert.equal(s.pulseFeed('alice').length, 1); assert.equal(item.events.length, 2);
    for (const action of ['read', 'dismiss', 'bookmark'] as const) assert.equal(s.setPulseState('alice', item.id, item.seq, action), true);
    item = s.pulseFeed('alice')[0];
    assert.equal(item.read, true); assert.equal(item.dismissed, true); assert.equal(item.bookmarked, true);
    assert.equal(s.pulseFeed('bob')[0].read, false);
    complete(s, report({ ...finding, fixed: '2' }), 'image:second');
    item = s.pulseFeed('alice')[0];
    assert.equal(item.read, false); assert.equal(item.dismissed, false); assert.equal(item.bookmarked, true); assert.equal(hasPulseFix(item), true);
    complete(s, report(), 'image:second'); complete(s, report(), 'image:test');
    item = s.pulseFeed('alice')[0];
    assert.equal(item.events.every(e => e.kind === 'resolved'), true); assert.equal(hasPulseFix(item), false);
    assert.equal(s.setPulseState('alice', 'unknown', item.seq, 'read'), false);
  } finally { s.db.close(); }
});
test('coverage changes do not falsely resolve findings, and scan recovery replaces failures', () => {
  const s = new Store(':memory:');
  try {
    s.syncInventory([]); complete(s, report(finding));
    complete(s, { ...report(), coverage: 'release-source' });
    assert.equal(s.pulseFeed('alice').find(i => i.events[0].issue === finding.id)?.events[0].kind, 'coverage');
    s.fail('host', 'Scanner unavailable');
    assert.equal(s.pulseFeed('alice').find(i => i.events[0].issue === 'scan:host')?.events[0].kind, 'failure');
    complete(s, report());
    assert.equal(s.pulseFeed('alice').find(i => i.events[0].issue === 'scan:host')?.events[0].kind, 'recovered');
  } finally { s.db.close(); }
});

test('bursts fold five or more findings for the same resources without duplicating vulnerabilities', () => {
  const time = new Date(2026, 10, 7, 12).getTime();
  const events = Array.from({length: 6}, (_, i) => ({seq: i + 1, target: 'host', name: 'Host', time: time + i * 60_000, issue: `CVE-${i}`, kind: 'discovered' as const, finding}));
  const items = groupPulse(events, {});
  assert.equal(batchPulse(items).length, 1);
  assert.equal(batchPulse(items)[0].items.length, 6);
  assert.equal(batchPulse(items.slice(0, 4)).length, 4);
  const separated = [...items.slice(0, 5), {...items[5], time: time - 900_000}];
  assert.equal(batchPulse(separated).length, 2);
  assert.equal(batchPulse(items.map((item, i) => ({...item, events: [{...item.events[0], target: String(i)}]}))).length, 6);
});
