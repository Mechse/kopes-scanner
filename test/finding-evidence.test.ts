import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/server/store';
import { findingEvidence, annotateReport, syncSourcePulse } from '../src/server/source/finding-evidence';
import { currentPulseItem } from '../src/lib/pulse';
import type { Analysis } from '../src/server/source/analysis';
const admin = { userId: 'admin', administrator: true };
const viewer = { userId: 'viewer', administrator: false };
const analysis: Analysis = { manager: 'npm', folder: '', roots: [{ id: 'root', name: 'app', workspace: '', manifest: 'package.json' }],
  nodes: [{ id: 'node', name: 'dep', version: '1.0.0', file: 'package-lock.json', location: 'node_modules/dep', dev: false }], edges: [{ from: 'root', to: 'node', scope: 'runtime' }],
  findings: [{ advisory: 'GHSA-example', aliases: ['CVE-2026-12345'], node: 'node', package: 'dep', version: '1.0.0', fixed: '2.0.0', severity: 'HIGH', title: 'Example', file: 'package-lock.json' }],
  analyzerPackages: [], warnings: [], coverage: { inputs: 'complete', inventory: 'complete', graph: 'complete', runtime: 'unknown' } };
function setup() {
  const s = new Store(':memory:');
  s.db.exec(`INSERT INTO source_connections(id,provider,origin,credential) VALUES ('c','github','https://api.github.com','');
    INSERT INTO source_repositories VALUES ('r','github','https://api.github.com','1','owner/app');
    INSERT INTO source_bindings(id,repository_id,connection_id,branch,folder) VALUES ('b','r','c','main','');`);
  return s;
}
function scan(s: Store, id: string, at: number, a = analysis, kind = 'poll') {
  s.db.prepare("INSERT INTO source_jobs(id,binding_id,kind,state,created_at,available_at) VALUES (?,'b',?,'complete',?,?)").run(id, kind, at, at);
  s.db.prepare("INSERT INTO source_snapshots VALUES (?,'r',?,?, '{}',?)").run(id, id.padEnd(40,'a'), id, at);
  s.db.prepare("INSERT INTO source_scans VALUES (?,'b',?,?,?,'trivy','{}',?)").run(id, id, id, at, JSON.stringify(a));
}
test('source-only CVEs have stable Pulse state, authorized visibility, and remain visible without runtime targets', () => {
  const s = setup(); try {
    scan(s, 'one', 1);
    const visible = syncSourcePulse(s, admin);
    const item = s.pulseFeed('admin', visible)[0];
    assert.equal(item.id, 'CVE-2026-12345');
    assert.ok(currentPulseItem(item, new Set()));
    assert.equal(s.setPulseState('admin', item.id, item.seq, 'bookmark', visible), true);
    syncSourcePulse(s, admin);
    assert.equal(s.pulseFeed('admin', visible)[0].seq, item.seq);
    assert.equal(s.pulseFeed('admin', visible)[0].bookmarked, true);
    assert.deepEqual(findingEvidence(s, viewer), []);
    assert.deepEqual(s.pulseFeed('viewer', syncSourcePulse(s, viewer)), []);
    assert.equal(findingEvidence(s, admin)[0].edits[0].manifest, 'package.json');
    assert.equal(findingEvidence(s, admin)[0].linkage, 'unknown');
    s.db.exec("UPDATE source_bindings SET enabled=0");
    assert.deepEqual(s.pulseFeed('admin', syncSourcePulse(s, admin)), []);
  } finally { s.db.close(); }
});
test('partial source scans cannot resolve findings; complete scans can; deployment scans do not replace branch scans', () => {
  const s = setup(); try {
    scan(s, 'one', 1); const visible = syncSourcePulse(s, admin);
    scan(s, 'two', 2, { ...analysis, findings: [], coverage: { ...analysis.coverage, inputs: 'partial' } }); syncSourcePulse(s, admin);
    assert.notEqual(s.pulseFeed('admin', visible)[0].events[0].kind, 'resolved');
    scan(s, 'three', 3, { ...analysis, findings: [] }); syncSourcePulse(s, admin);
    assert.equal(s.pulseFeed('admin', visible)[0].events[0].kind, 'resolved');
    scan(s, 'deployed', 4, analysis, 'deployed:sha');
    assert.deepEqual(findingEvidence(s, admin), []);
  } finally { s.db.close(); }
});
test('repository evidence stays independent even when a runtime advisory matches', () => {
  const s = setup(); try {
    scan(s, 'one', 1);
    s.syncInventory([{ id: 'container', name: 'app', image: 'app:1', target_id: 'image:one', project: '', service: 'app', manager: 'Compose' }]);
    const f = { id: 'CVE-2026-12345', package: 'dep', installed: '1.0.0', fixed: '2.0.0', title: '', severity: 'HIGH' as const, path: '/app/node_modules/dep', type: 'node-pkg' };
    const report = { findings: [f], packages: [], os: '', eol: false };
    s.db.prepare("UPDATE targets SET report_json=?,scanned_at=10 WHERE id='image:one'").run(JSON.stringify(report));
    const evidence = findingEvidence(s, admin);
    assert.deepEqual(evidence[0].runtime, []);
    assert.equal(annotateReport(report, 'image:one', evidence).findings[0].detection, 'container');
    assert.equal(annotateReport(report, 'image:unrelated', evidence).findings[0].detection, 'container');
    assert.equal(annotateReport({ ...report, findings: [{ ...f, installed: '1.1.0' }] }, 'image:one', evidence).findings[0].detection, 'container');
    assert.equal(annotateReport({ ...report, findings: [{ ...f, type: 'deb' }] }, 'image:one', evidence).findings[0].detection, 'container');
    assert.equal(annotateReport({ ...report, coverage: 'release-source' }, 'image:one', evidence).findings[0].detection, 'unknown');
    s.db.prepare("UPDATE targets SET report_json=?").run(JSON.stringify({ ...report, coverage: 'release-source' }));
    assert.deepEqual(findingEvidence(s, admin)[0].runtime, []);
  } finally { s.db.close(); }
});

test('codebase detail renders dependency guidance and scan limitations without implying verified deployment', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { EvidenceDetails } = await import('../src/components/finding-evidence');
  const s = setup(); try {
    scan(s, 'one', 1);
    const html = renderToStaticMarkup(createElement(EvidenceDetails, { evidence: findingEvidence(s, admin)[0] }));
    for (const text of ['Detected in codebase', 'package-lock.json', 'package.json', 'npm update dep', 'Production']) assert.ok(html.includes(text), text);
    assert.ok(!html.includes('Matched in both'));
  } finally { s.db.close(); }
});
