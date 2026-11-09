import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/server/store';
import { defaultSettings, overridesSchema, resourceKey, scanSettingsSchema } from '../src/lib/settings';
import type { Container, Finding, Report } from '../src/lib/model';
const a: Container = { id: 'a', target_id: 'image:shared', project: 'Alpha', name: 'web', image: 'app:1', service: 'web', manager: 'compose' };
const b: Container = { ...a, id: 'b', project: 'Beta' };
const finding: Finding = { id: 'CVE-2020-1234', package: 'lib', installed: '1', fixed: '', severity: 'LOW', title: 'Old CVE', type: 'os', path: '' };
const report = (...findings: Finding[]): Report => ({ findings, packages: [], os: 'linux', eol: false });
function setup() { const store = new Store(':memory:'); store.syncInventory([a, b]); return store; }
function complete(store: Store, value: Report) { store.complete(a.target_id, value, '{}', null, [], ''); }

test('project defaults, individual overrides and reset survive container recreation', () => {
  const s = setup();
  try {
    assert.deepEqual(s.settings('resource', resourceKey(a))?.effective, defaultSettings);
    s.saveSettings('project', a.project, { ...defaultSettings, rescanHours: 24, notifyNewCve: false });
    s.saveSettings('resource', resourceKey(a), { notifyFix: false });
    assert.deepEqual(s.settings('resource', resourceKey(a))?.effective, { rescanHours: 24, notifyNewCve: false, notifyFix: false });
    s.syncInventory([{ ...a, id: 'replacement', target_id: 'image:new' }, b]);
    assert.equal(s.settings('resource', resourceKey(a))?.effective.notifyFix, false);
    s.saveSettings('resource', resourceKey(a), {});
    assert.equal(s.settings('resource', resourceKey(a))?.effective.notifyFix, true);
    assert.equal(s.settings('resource', resourceKey(b))?.effective.rescanHours, 168);
    assert.equal(s.settings('resource', 'missing'), null);
  } finally { s.db.close(); }
});

test('scheduler uses weekly default, shortest shared interval, manual mode and explicit requests', () => {
  const s = setup();
  try {
    const age = (hours: number) => s.db.prepare("UPDATE targets SET requested=0,status='ready',attempted_at=?,scanned_at=?").run(Date.now()-hours*3600000, Date.now()-hours*3600000);
    age(25); assert.equal(s.next(), null);
    s.saveSettings('project', 'Alpha', { ...defaultSettings, rescanHours: 24 });
    assert.equal(s.next()?.id, a.target_id);
    s.saveSettings('project', 'Alpha', { ...defaultSettings, rescanHours: 0 });
    s.saveSettings('project', 'Beta', { ...defaultSettings, rescanHours: 0 });
    s.saveSettings('resource', 'host', { rescanHours: 0 });
    age(800); assert.equal(s.next(), null);
    s.request(a.target_id); assert.equal(s.next()?.id, a.target_id);
    s.saveSettings('resource', resourceKey(b), { rescanHours: 168 });
    age(169); assert.equal(s.next()?.id, a.target_id);
  } finally { s.db.close(); }
});

test('Pulse respects independent switches, cross-project vulnerability grouping, all severities and unchanged scans', () => {
  const s = setup();
  try {
    s.saveSettings('project', 'Alpha', { ...defaultSettings, notifyNewCve: false });
    s.saveSettings('project', 'Beta', { ...defaultSettings, notifyFix: false });
    complete(s, report(finding));
    assert.deepEqual(s.pulseFeed('user').map(i => i.events[0].project), ['Beta']);
    complete(s, report({ ...finding, fixed: '2' }));
    const items = s.pulseFeed('user');
    assert.equal(items.length, 1);
    assert.equal(items[0].events.find(e => e.project === 'Alpha')?.kind, 'fix');
    assert.equal(items[0].events.find(e => e.project === 'Beta')?.kind, 'discovered');
    const count = s.db.prepare('SELECT count(*) AS n FROM pulse_events').get()!.n;
    complete(s, report({ ...finding, fixed: '2' }));
    assert.equal(s.db.prepare('SELECT count(*) AS n FROM pulse_events').get()!.n, count);
    const fresh = { ...finding, id: 'CVE-2019-9999', fixed: '3' };
    complete(s, report({ ...finding, fixed: '2' }, fresh));
    assert.equal(s.pulseFeed('user').find(i => i.id === fresh.id)?.events.find(e => e.project === 'Alpha')?.kind, 'fix');
  } finally { s.db.close(); }
});

test('settings validation rejects unsupported intervals, unknown fields and non-booleans', () => {
  for (const input of [{ rescanHours: -1 }, { rescanHours: 2 }, { notifyFix: 'false' }, { channel: 'email' }]) assert.equal(overridesSchema.safeParse(input).success, false);
  assert.equal(overridesSchema.safeParse({}).success, true);
  assert.equal(scanSettingsSchema.safeParse({}).success, false);
});

test('new rescan intervals survive saving and become due at the exact interval', context => {
  const now = 2_000_000_000_000;
  context.mock.method(Date, 'now', () => now);
  const s = setup();
  try {
    for (const minutes of [5, 15, 30, 60, 360, 720, 4320, 20160]) {
      // Round-trip through JSON just as the settings form and API do.
      const settings = overridesSchema.parse(JSON.parse(JSON.stringify({ rescanHours: minutes / 60 })));
      s.saveSettings('resource', 'host', settings);
      assert.equal(s.settings('resource', 'host')?.effective.rescanHours, minutes / 60);
      s.db.prepare("UPDATE targets SET requested=0,status='ready',attempted_at=?,scanned_at=?").run(now, now);
      const dueAt = now - minutes * 60_000;
      s.db.prepare("UPDATE targets SET attempted_at=? WHERE id='host'").run(dueAt + 1);
      assert.equal(s.next(), null, `${minutes} minutes: not due early`);
      s.db.prepare("UPDATE targets SET attempted_at=? WHERE id='host'").run(dueAt);
      assert.equal(s.next()?.id, 'host', `${minutes} minutes: due on time`);
    }
  } finally { s.db.close(); }
});
