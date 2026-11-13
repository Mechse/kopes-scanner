import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBundle, rematchInventory } from '../src/server/source/analysis';
import { sourceInput } from '../src/lib/source-inputs';
import { sourceEmptyMessage } from '../src/lib/source-assessment';
import { sourceFinding } from '../src/server/source/finding-evidence';
import { resultSchema } from '../src/server/source/jobs';
const bundle = (files: Record<string,string>) => ({ files, commit: 'a'.repeat(40), hash: 'b'.repeat(64), collectedAt: 1 });
const target = (file: string) => ({ Target: file, Type: 'pip', Packages: [{ Name: 'requests', Version: '2.19.1' }], Vulnerabilities: [{ PkgName: 'requests', InstalledVersion: '2.19.1', VulnerabilityID: 'CVE-test', Severity: 'HIGH', FixedVersion: '2.32.4' }] });
for (const file of ['requirements.txt', 'requirements-dev.txt', 'requirements_markllm.txt', 'Pipfile.lock', 'poetry.lock', 'uv.lock', 'pylock.toml']) test(`Python ${file} findings survive validation and rematching`, () => {
  assert.ok(sourceInput(`backend/${file}`));
  const analysis = analyzeBundle(bundle({ [file]: 'fixture' }), { SchemaVersion: 2, Results: [target(file)] });
  assert.equal(analysis.findings.length, 1);
  assert.equal(analysis.manager, 'python');
  assert.equal(analysis.coverage.graph, 'partial');
  assert.equal(sourceFinding(analysis.findings[0]).type, 'python-pkg');
  const result = resultSchema.parse({ ok: true, bundleHash: 'b'.repeat(64), sbom: '', analyzer: 'test', database: { Version: 2, UpdatedAt: '' }, analysis, paths: {} });
  assert.equal(result.analysis.nodes.length, 1);
  assert.equal(rematchInventory(analysis, { SchemaVersion: 2, Results: [{ ...target('sbom'), Type: 'python-pkg' }] }).findings.length, 1);
  assert.equal(rematchInventory(analysis, { SchemaVersion: 2, Results: [{ ...target('sbom'), Type: 'npm' }] }).findings.length, 0);
});
test('Python folder scopes do not leak findings from sibling projects', () => {
  const files = { 'api/requirements.txt': '', 'other/requirements.txt': '' };
  const result = analyzeBundle(bundle(files), { SchemaVersion: 2, Results: Object.keys(files).map(target) }, 'api');
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].file, 'api/requirements.txt');
});
test('missing, unsupported, or unpinned inputs never produce a clean result', () => {
  for (const files of [{}, { 'pyproject.toml': '[project]' }, { 'requirements.txt': 'requests>=2' }] as Record<string, string>[]) {
    const result = analyzeBundle(bundle(files), { SchemaVersion: 2, Results: null });
    assert.equal(result.coverage.inventory, 'unknown');
    assert.match(sourceEmptyMessage(result).title, /not assessed/);
  }
  assert.ok(!sourceInput('evil.sh'));
  assert.ok(!sourceInput('trivy.yaml'));
});
test('Python inventory without findings explicitly retains coverage limitations', () => {
  const result = analyzeBundle(bundle({ 'requirements.txt': 'requests==2.19.1' }), { SchemaVersion: 2, Results: [{ ...target('requirements.txt'), Vulnerabilities: [] }] });
  assert.match(sourceEmptyMessage(result).title, /coverage is incomplete/);
});
