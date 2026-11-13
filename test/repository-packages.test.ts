import test from 'node:test';
import assert from 'node:assert/strict';
import type { Analysis } from '../src/server/source/analysis';
import { repositoryPackages } from '../src/lib/repository-packages';

const node = (id: string, file = 'package-lock.json', version = '1.0.0') => ({ id, name: 'example', version, file, location: id, dev: false });
const analysis: Analysis = {
  nodes: [node('a'), node('b', 'web/package-lock.json'), node('c', 'requirements.txt'), node('d', 'package-lock.json', '2.0.0'), { ...node('clean'), name: 'no-findings' }],
  roots: [{ id: 'root', workspace: '', manifest: 'package.json', name: 'app' }],
  edges: [{ from: 'root', to: 'a', scope: 'runtime' }, { from: 'root', to: 'b', scope: 'development' }, { from: 'a', to: 'clean', scope: 'runtime' }, { from: 'clean', to: 'a', scope: 'runtime' }],
  findings: ['a', 'b'].map(node => ({ node, advisory: 'CVE-1', aliases: [], package: 'example', version: '1.0.0', fixed: '', severity: 'HIGH', title: 'Example', file: 'package-lock.json' })),
  warnings: [], coverage: { inputs: 'complete', inventory: 'complete', graph: 'complete', runtime: 'unknown' }, analyzerPackages: [], manager: 'mixed', folder: '',
};

test('combines identical package versions across files while retaining ecosystems, versions, and clean packages', () => {
  const packages = repositoryPackages(analysis);
  assert.equal(packages.length, 4);
  const combined = packages.find(p => p.ecosystem === 'npm' && p.version === '1.0.0' && p.name === 'example')!;
  assert.equal(combined.occurrences.length, 2);
  assert.equal(combined.findings.length, 1);
  assert.deepEqual(combined.scopes, ['Development', 'Production']);
  assert.equal(packages.filter(p => p.findings.length).length, 1);
  assert.equal(packages.find(p => p.name === 'no-findings')!.findings.length, 0);
});

test('scope propagation handles cycles and packages with no stored advisory paths', () => {
  const packages = repositoryPackages(analysis);
  assert.deepEqual(packages.find(p => p.name === 'no-findings')!.scopes, ['Production']);
  assert.deepEqual(packages.find(p => p.ecosystem === 'python-pkg')!.scopes, ['Unknown']);
  assert.deepEqual(repositoryPackages({ ...analysis, nodes: [], findings: [] }), []);
});
