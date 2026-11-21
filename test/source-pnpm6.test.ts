import test from 'node:test';
import assert from 'node:assert/strict';
import { stringify } from 'yaml';
import { analyzeBundle, introductionPaths } from '../src/server/source/analysis';
import { resultSchema } from '../src/server/source/jobs';

function fixture(version: string | number = '6.0') {
  const manifest = { name: 'fixture', dependencies: { 'parent-a': '^1.0.0', 'old-lodash': 'npm:lodash@4.17.20', '@scope/lib': '^1.0.0' }, devDependencies: { 'parent-b': '^1.0.0' }, optionalDependencies: { optional: '^1.0.0' } };
  const importer = { dependencies: { 'parent-a': { specifier: '^1.0.0', version: '1.0.0' }, 'old-lodash': { specifier: 'npm:lodash@4.17.20', version: '/lodash@4.17.20' }, '@scope/lib': { specifier: '^1.0.0', version: '1.0.0' } }, devDependencies: { 'parent-b': { specifier: '^1.0.0', version: '1.0.0' } }, optionalDependencies: { optional: { specifier: '^1.0.0', version: '1.0.0' } } };
  const packages = {
    '/parent-a@1.0.0': { dependencies: { lodash: '4.17.20' } },
    '/parent-b@1.0.0': { dependencies: { lodash: '4.17.20' }, dev: true },
    '/lodash@4.17.20': {},
    '/@scope/lib@1.0.0': { dependencies: { 'peer-user': '1.0.0(peer-host@2.0.0)' } },
    '/peer-user@1.0.0(peer-host@2.0.0)': { dependencies: { 'peer-host': '2.0.0' }, peerDependencies: { 'peer-host': '^2.0.0', 'optional-peer': '*' }, peerDependenciesMeta: { 'optional-peer': { optional: true } } },
    '/peer-host@2.0.0': {},
    '/optional@1.0.0': { optional: true },
  };
  const lock = { lockfileVersion: version, ...importer, packages };
  const bundle = { commit: 'a'.repeat(40), hash: 'b'.repeat(64), collectedAt: 1, files: { 'package.json': JSON.stringify(manifest), 'pnpm-lock.yaml': stringify(lock) } as Record<string,string> };
  const report = { SchemaVersion: 2, Results: [{ Target: 'pnpm-lock.yaml', Packages: [
    { Name: 'parent-a', Version: '1.0.0' }, { Name: 'parent-b', Version: '1.0.0' }, { Name: 'lodash', Version: '4.17.20' }, { Name: '@scope/lib', Version: '1.0.0' }, { Name: 'peer-user', Version: '1.0.0' }, { Name: 'peer-host', Version: '2.0.0' }, { Name: 'optional', Version: '1.0.0' },
  ], Vulnerabilities: [{ VulnerabilityID: 'CVE-fixture', PkgName: 'lodash', InstalledVersion: '4.17.20', FixedVersion: '4.17.21', Severity: 'HIGH' }] }] };
  return { bundle, lock, manifest, importer, report };
}

for (const version of ['6.0', 6]) test(`pnpm ${version}: root importer, aliases, scoped packages and peer variants retain findings and paths`, () => {
  const { bundle, report } = fixture(version), result = analyzeBundle(bundle, report);
  assert.equal(result.manager, 'pnpm');
  assert.equal(result.nodes.length, 7);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.coverage, { inputs: 'complete', inventory: 'complete', graph: 'complete', runtime: 'unknown' });
  assert.equal(result.findings.length, 1);
  assert.equal(introductionPaths(result, result.findings[0].node).paths.length, 3);
  assert.ok(result.nodes.find(n => n.name === 'parent-b')!.dev);
  for (const scope of ['runtime','development','optional','peer']) assert.ok(result.edges.some(e => e.scope === scope), scope);
  assert.ok(result.edges.some(e => e.requestedName === 'old-lodash' && e.to === result.findings[0].node));
  assert.ok(result.edges.some(e => e.scope === 'peer' && e.requestedName === 'peer-host'));
  assert.equal(resultSchema.shape.analysis.safeParse(result).success, true);
});

test('pnpm v6 workspaces follow links and keep manifest validation', () => {
  const { bundle, lock, manifest, importer, report } = fixture();
  const root = { dependencies: { shared: { specifier: 'workspace:*', version: 'link:packages/shared' } } };
  bundle.files['package.json'] = JSON.stringify({ name: 'root', dependencies: { shared: 'workspace:*' } });
  bundle.files['packages/shared/package.json'] = JSON.stringify(manifest);
  bundle.files['pnpm-lock.yaml'] = stringify({ lockfileVersion: '6.0', importers: { '.': root, 'packages/shared': importer }, packages: lock.packages });
  const result = analyzeBundle(bundle, report);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.roots.length, 2);
  assert.ok(introductionPaths(result, result.findings[0].node).paths.some(path => path[0].endsWith('#workspace:') && path[1].endsWith('#workspace:packages/shared')));
  bundle.files['packages/shared/package.json'] = JSON.stringify({ ...manifest, dependencies: { ...manifest.dependencies, 'parent-a': '^2.0.0' } });
  assert.ok(analyzeBundle(bundle, report).warnings.some(w => w.includes('Manifest/lockfile mismatch')));
});

test('pnpm v6 missing dependencies remain partial and unsupported lockfiles remain unassessed', () => {
  const { bundle, lock, report } = fixture();
  delete (lock.packages as Record<string,unknown>)['/lodash@4.17.20'];
  bundle.files['pnpm-lock.yaml'] = stringify(lock);
  const partial = analyzeBundle(bundle, report);
  assert.equal(partial.coverage.graph, 'partial');
  assert.ok(partial.warnings.some(w => w.includes('Unresolved runtime dependency lodash')));
  assert.ok(partial.warnings.some(w => w.includes('could not be attributed')));
  for (const version of ['5.4', '10.0']) {
    const unknown = analyzeBundle(fixture(version).bundle, report);
    assert.equal(unknown.coverage.inventory, 'unknown');
    assert.ok(unknown.warnings.some(w => w.includes('Unsupported lockfile version')));
  }
});
