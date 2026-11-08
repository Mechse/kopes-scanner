import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/server/store';
import { pulseChanges, hasPulseFix, batchPulse, groupPulse, currentPulseItem, pulseFindingEvent, pulseRank } from '../src/lib/pulse';
import type { Finding, Report } from '../src/lib/model';
const finding: Finding = { id: 'CVE-2026-1234', package: 'openssl', installed: '1', fixed: '', severity: 'HIGH', title: 'Example advisory', type: 'os', path: '' };
const report = (...findings: Finding[]): Report => ({ findings, packages: [], os: 'linux', eol: false });
const complete = (s: Store, r: Report, id = 'host') => s.complete(id, r, '', null, [], '');
test('current Pulse summaries exclude removed risks and fixes while retaining history and action state', () => {
  const events = [
    { seq: 2, time: 200, target: 'removed', name: 'Old app', issue: finding.id, kind: 'fix' as const, finding: { ...finding, severity: 'CRITICAL' as const, fixed: '2' } },
    { seq: 1, time: 100, target: 'current', name: 'App', issue: finding.id, kind: 'discovered' as const, finding },
  ];
  const item = groupPulse(events, { [finding.id]: { dismissed: 2, bookmarked: true } })[0];
  const current = currentPulseItem(item, new Set(['current']))!;
  assert.deepEqual(current.events, [events[1]]);
  assert.deepEqual(current.removedEvents, [events[0]]);
  assert.equal(current.events[0].finding?.severity, 'HIGH');
  assert.equal(hasPulseFix(current), false);
  assert.equal(pulseRank(current), pulseRank({ ...item, events: [events[1]] }));
  assert.equal(current.seq, item.seq);
  assert.equal(current.dismissed, true);
  assert.equal(current.bookmarked, true);
  assert.equal(currentPulseItem(item, new Set()), null);
  const fixed = currentPulseItem({ ...item, events: [events[0], { ...events[1], finding: { ...finding, fixed: '2' } }] }, new Set(['current']))!;
  assert.equal(hasPulseFix(fixed), true);
  const resolved = currentPulseItem({ ...item, events: [events[0], { ...events[1], kind: 'resolved' }] }, new Set(['current']))!;
  assert.equal(resolved.events.every(event => event.kind === 'resolved'), true);
  assert.equal(hasPulseFix(resolved), false);
});
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
    for (const action of ['dismiss', 'bookmark'] as const) assert.equal(s.setPulseState('alice', item.id, item.seq, action), true);
    item = s.pulseFeed('alice')[0];
    assert.equal(item.dismissed, true); assert.equal(item.bookmarked, true);
    assert.equal(s.pulseFeed('bob')[0].dismissed, false);
    assert.equal(s.pulseFeed('bob')[0].bookmarked, false);
    complete(s, report({ ...finding, fixed: '2' }), 'image:second');
    item = s.pulseFeed('alice')[0];
    assert.equal(item.dismissed, false); assert.equal(item.bookmarked, true); assert.equal(hasPulseFix(item), true);
    complete(s, report(), 'image:second'); complete(s, report(), 'image:test');
    item = s.pulseFeed('alice')[0];
    assert.equal(item.events.every(e => e.kind === 'resolved'), true); assert.equal(hasPulseFix(item), false);
    assert.equal(s.setPulseState('alice', 'unknown', item.seq, 'dismiss'), false);
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

test('Pulse navigation selects the highest active finding and preserves resolved CVE details', () => {
  const resolved = { seq: 3, time: 300, target: 'old', name: 'Old app', issue: finding.id, kind: 'resolved' as const, finding: { ...finding, severity: 'CRITICAL' as const } };
  const active = { seq: 2, time: 200, target: 'current', name: 'App', issue: finding.id, kind: 'fix' as const, finding };
  const low = { ...active, seq: 1, target: 'other', finding: { ...finding, severity: 'LOW' as const } };
  const item = { id: finding.id, seq: 3, time: 300, events: [resolved, low, active], dismissed: false, bookmarked: false };
  assert.equal(pulseFindingEvent(item), active);
  assert.deepEqual(item.events, [resolved, low, active]);
  assert.equal(pulseFindingEvent({ ...item, events: [resolved] }), resolved);
  assert.equal(pulseFindingEvent({ ...item, events: [{ ...active, finding: undefined, kind: 'failure' }] }), undefined);
  const current = currentPulseItem(item, new Set(['other']))!;
  assert.equal(pulseFindingEvent(current), low);
});
