import test from 'node:test';
import assert from 'node:assert/strict';
import { attributeOrigin, originOf, originSummary } from '../src/lib/finding-origin';
import { relatedContainers, repositoryCoverage, freshness } from '../src/lib/coverage-explanation';
import { imageEvidence, attributeReport } from '../src/server/image-evidence';
import { compareReports, parseReport } from '../src/server/trivy';
import type { Finding, Dashboard, Report } from '../src/lib/model';
const f: Finding = { id: 'CVE-1', package: 'tool', installed: '1', fixed: '2', severity: 'HIGH', title: '', type: 'debian', path: '/', layer: 'b' };
const report = (findings: Finding[]): Report => ({ findings, packages: [], os: '', eol: false });
test('ecosystem and package overlap never establish origin; historical records stay unknown', () => {
  for (const type of ['debian', 'npm', 'python']) assert.equal(attributeOrigin({ ...f, type }, { layers: ['a','b'], commands: {} }).category, 'Unknown');
  assert.equal(originOf(f).category, 'Unknown');
});
test('base attribution requires exact layer prefix, not only shared layers', () => {
  assert.equal(attributeOrigin(f, { layers: ['a','b'], baseLayers: ['a','b'], commands: {} }).category, 'Base image');
  assert.equal(attributeOrigin(f, { layers: ['a','b'], baseLayers: ['b'], commands: {} }).category, 'Unknown');
  assert.equal(attributeOrigin({ ...f, layer: undefined }, { layers: ['a','b'], baseLayers: ['a','b'], commands: {} }).category, 'Unknown');
});
test('tooling needs explicit matching installation evidence; transitive packages stay unknown', () => {
  const evidence = { layers: ['b'], commands: { b: 'RUN npm install -g tool@1' } };
  assert.equal(attributeOrigin(f, evidence).category, 'Added tooling');
  assert.equal(attributeOrigin({ ...f, package: 'transitive' }, evidence).category, 'Unknown');
});
test('origin summaries deduplicate occurrences without conflating different paths', () => {
  const rows = originSummary([f, f, { ...f, path: '/other', fixed: '' }]);
  assert.equal(rows.find(r => r.category === 'Unknown')?.count, 2);
  assert.equal(rows.find(r => r.category === 'Unknown')?.fixable, 1);
  assert.equal(rows.find(r => r.category === 'Unknown')?.counts.HIGH, 2);
});
test('explicit repository URL associations support multiple containers but reject name similarities', () => {
  const data = { targets: [], containers: [
    { id: 'a', name: 'different', sourceRepository: 'https://github.com/acme/kopes.git' },
    { id: 'b', sourceRepository: 'https://github.com/acme/kopes' },
    { id: 'c', name: 'kopes', sourceRepository: 'https://github.com/other/kopes' },
    { id: 'd', name: 'kopes' },
  ] } as unknown as Dashboard;
  assert.deepEqual(relatedContainers('acme/kopes', data).map(r => r.container.id), ['a','b']);
});
test('Kopes discrepancy explains scope without manufacturing origin or clean partial results', () => {
  const analysis = { nodes: Array(292), findings: [], coverage: { inventory: 'complete', inputs: 'complete', graph: 'complete' } };
  assert.match(repositoryCoverage(analysis), /No known vulnerabilities found in 292/);
  assert.match(repositoryCoverage({ ...analysis, coverage: { ...analysis.coverage, inputs: 'partial' } }), /All resolved dependencies assessed; dependency declarations/);
  assert.match(repositoryCoverage(), /not been assessed/);
  assert.equal(freshness(1, 24, 86400002), 'Outdated result; rescan recommended');
  assert.equal(freshness(null, 24), 'Not assessed');
  assert.equal(originSummary(Array.from({length: 362}, (_, i) => ({ ...f, id: `CVE-${i}` }))).find(r => r.category === 'Unknown')?.count, 362);
});
test('image history skips empty layers and attribution persists evidence', () => {
  const raw = JSON.stringify({ Metadata: { ImageConfig: { rootfs: { diff_ids: ['a','b'] }, history: [{ created_by: 'base' }, { empty_layer: true, created_by: 'ENV X=1' }, { created_by: 'RUN npm install -g tool@1' }] } } });
  assert.equal(imageEvidence(raw).commands.b, 'RUN npm install -g tool@1');
  const r = report([f]); attributeReport(r, raw);
  assert.equal(JSON.parse(JSON.stringify(r)).findings[0].origin.category, 'Added tooling');
});
test('comparisons count advisory/package pairs once and distinguish introduced from absent', () => {
  assert.deepEqual(compareReports(report([f, f, { ...f, id: 'CVE-2' }]), report([{ ...f, installed: '2' }, { ...f, id: 'CVE-3' }])), { removed: 1, introduced: 1, remaining: 2 });
});
test('parser retains package layer independently of detection metadata', () => {
  const r = parseReport(JSON.stringify({ SchemaVersion: 2, Results: [{ Type: 'npm', Target: '/app', Vulnerabilities: [{ VulnerabilityID: 'CVE-1', PkgName: 'tool', Layer: { DiffID: 'b' } }] }] }));
  assert.equal(r.findings[0].layer, 'b'); assert.equal(r.findings[0].origin, undefined);
});

test('source-label association survives storage and disappears when label is removed', async () => {
  const { Store } = await import('../src/server/store');
  const store = new Store(':memory:');
  try {
    const container = { id: 'a', name: 'Kopes', image: 'kopes:dev', target_id: 'image:sha256:abc', project: 'p', service: 'web', manager: 'Docker', sourceRepository: 'https://github.com/acme/kopes' };
    store.syncInventory([container]);
    assert.equal(relatedContainers('acme/kopes', store.dashboard()).length, 1);
    store.syncInventory([{ ...container, sourceRepository: undefined }]);
    assert.equal(relatedContainers('acme/kopes', store.dashboard()).length, 0);
  } finally { store.db.close(); }
});

test('application attribution requires workdir history plus install layer and package path', () => {
  const raw = JSON.stringify({ Metadata: { ImageConfig: { rootfs: { diff_ids: ['b'] }, history: [{ empty_layer: true, created_by: 'WORKDIR /app' }, { created_by: 'RUN npm ci' }] } } });
  const r = report([{ ...f, type: 'npm', path: '/app/node_modules/tool/package.json' }, { ...f, type: 'npm', path: '/usr/lib/node_modules/tool/package.json' }]);
  attributeReport(r, raw);
  assert.equal(r.findings[0].origin?.category, 'Application dependencies');
  assert.equal(r.findings[1].origin?.category, 'Unknown');
});

test('mentioned install commands are not installation evidence', () => {
  assert.equal(attributeOrigin(f, { layers: ['b'], commands: { b: 'RUN echo npm install -g tool' } }).category, 'Unknown');
});

test('rebuild verification needs changed platform identity and comparable coverage', async () => {
  const { comparisonLimitation } = await import('../src/lib/image-improvement');
  const r = { ...report([f]), packages: [{ name: 'tool', version: '1', type: 'npm', path: '/' }] };
  assert.equal(comparisonLimitation(r, r, 'Upgrade'), null);
  assert.ok(comparisonLimitation(r, r, 'Rebuild', 'same', 'same'));
  assert.ok(comparisonLimitation(r, r, 'Rebuild', null, 'new'));
  assert.equal(comparisonLimitation(r, r, 'Rebuild', 'old', 'new'), null);
  assert.ok(comparisonLimitation(r, report([]), 'Upgrade'));
  assert.ok(comparisonLimitation(r, { ...r, coverage: 'release-source' }, 'Upgrade'));
  assert.ok(comparisonLimitation(r, { ...r, eol: true }, 'Upgrade'));
});
test('development explanation requires configured command rather than image filename', () => {
  const r = report([f]);
  attributeReport(r, JSON.stringify({ Metadata: { ImageConfig: { config: { Cmd: ['pnpm','dev'] } } } }));
  assert.match(r.imageContext!, /Development tooling may/);
  assert.equal(r.findings[0].origin?.category, 'Unknown');
});


test('compound global installation attributes bundled dependencies only in the installation layer', () => {
  const command = 'RUN /bin/sh -c apt-get update && npm install --global pnpm@10.8.0 && mkdir /data # buildkit';
  const evidence = { layers: ['a', 'b'], commands: { b: command } };
  const bundled = { ...f, type: 'node-pkg', package: 'minimatch', path: 'usr/local/lib/node_modules/pnpm/dist/node_modules/minimatch/package.json' };
  assert.equal(attributeOrigin(bundled, evidence).category, 'Added tooling');
  assert.equal(attributeOrigin({ ...bundled, layer: 'a' }, evidence).category, 'Unknown');
  assert.equal(attributeOrigin({ ...bundled, path: '/app/node_modules/minimatch/package.json' }, evidence).category, 'Unknown');
  for (const command of ['RUN echo "npm install --global pnpm"', 'RUN echo hi # && npm install --global pnpm', 'RUN echo $(npm install --global pnpm)', 'RUN npm install --prefix /other --global pnpm']) {
    assert.equal(attributeOrigin(bundled, { ...evidence, commands: { b: command } }).category, 'Unknown');
  }
});
test('pnpm application installs require workdir, exact layer and dependency path', () => {
  const raw = (command: string) => JSON.stringify({ Metadata: { ImageConfig: { rootfs: { diff_ids: ['b'] }, history: [{ empty_layer: true, created_by: 'WORKDIR /repo' }, { created_by: command }] } } });
  const app = { ...f, type: 'node-pkg', path: 'repo/node_modules/.pnpm/tool@1/node_modules/tool/package.json' };
  const r = report([app]);
  attributeReport(r, raw('RUN /bin/sh -c pnpm install --frozen-lockfile --store-dir /repo/.pnpm-store # buildkit'));
  assert.equal(r.findings[0].origin?.category, 'Application dependencies');
  for (const command of ['RUN cd /other && pnpm install', 'RUN pnpm install --dir=/other', 'RUN echo pnpm install']) {
    attributeReport(r, raw(command)); assert.equal(r.findings[0].origin?.category, 'Unknown');
  }
});
test('direct image parsing preserves distinct package occurrence paths and their layers', () => {
  const r = parseReport(JSON.stringify({ SchemaVersion: 2, Results: [{ Type: 'node-pkg', Target: 'Node.js', Vulnerabilities: ['a', 'b'].map(layer => ({ VulnerabilityID: 'CVE-1', PkgName: 'tool', InstalledVersion: '1', PkgPath: `${layer}/node_modules/tool/package.json`, Layer: { DiffID: layer } })) }] }));
  assert.equal(r.findings.length, 2);
  assert.deepEqual(r.findings.map(f => [f.path, f.layer]), [['a/node_modules/tool/package.json', 'a'], ['b/node_modules/tool/package.json', 'b']]);
});
test('copied binary tooling requires the exact executable path and introducing layer', () => {
  const evidence = { layers: ['b'], commands: { b: 'COPY /usr/local/bin/trivy /usr/local/bin/trivy # buildkit' } };
  assert.equal(attributeOrigin({ ...f, type: 'gobinary', path: 'usr/local/bin/trivy' }, evidence).category, 'Added tooling');
  assert.equal(attributeOrigin({ ...f, type: 'gobinary', path: 'app/server' }, evidence).category, 'Unknown');
});


test('added Debian dependencies require verified base boundary and a real install in their layer', () => {
  const command = 'RUN /bin/sh -c apt-get update && apt-get install --yes --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* && npm install --global pnpm@10.8.0 # buildkit';
  const evidence = { layers: ['a', 'b'], baseLayers: ['a'], baseDigest: 'verified-base', commands: { b: command } };
  for (const name of ['openssl', 'libssl3']) {
    const finding = { ...f, package: name };
    const origin = attributeOrigin(finding, evidence);
    assert.equal(origin.category, 'Added OS dependencies');
    assert.equal(origin.baseDigest, 'verified-base');
    assert.match(origin.explanation, /exact dependency chain is not established/);
    assert.equal(attributeOrigin({ ...finding, layer: 'a' }, evidence).category, 'Base image');
    assert.equal(attributeOrigin({ ...finding, layer: undefined }, evidence).category, 'Unknown');
    assert.equal(attributeOrigin(finding, { ...evidence, baseLayers: undefined }).category, 'Unknown');
    assert.equal(attributeOrigin(finding, { ...evidence, baseLayers: ['other'] }).category, 'Unknown');
    assert.equal(attributeOrigin({ ...finding, type: 'node-pkg' }, evidence).category, 'Unknown');
  }
  for (const command of ['RUN apt-get -y install openssl', 'RUN apt install --no-install-recommends libssl3:arm64=3.0.22-1~deb12u2']) {
    assert.equal(attributeOrigin(f, { ...evidence, commands: { b: command } }).category, 'Added OS dependencies');
  }
});
test('OS attribution rejects simulation, download-only, configuration overrides and mentions', () => {
  for (const command of ['RUN apt-get update', 'RUN apt-get install', 'RUN apt-get install -s openssl', 'RUN apt-get --simulate install openssl', 'RUN apt-get install --download-only openssl', 'RUN apt-get -o Dir=/elsewhere install openssl', 'RUN apt-get install openssl-', 'RUN echo apt-get install openssl', 'RUN echo "apt-get install openssl"', 'RUN echo hi # && apt-get install openssl', 'RUN apk add openssl', 'COPY /tmp/apt-get /usr/bin/apt-get']) {
    assert.equal(attributeOrigin(f, { layers: ['a', 'b'], baseLayers: ['a'], commands: { b: command } }).category, 'Unknown', command);
  }
});
