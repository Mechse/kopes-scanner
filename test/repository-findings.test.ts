import test from 'node:test';
import assert from 'node:assert/strict';
import { repositoryFilters, repositoryFindings } from '../src/lib/repository-findings';
import type { Analysis } from '../src/server/source/analysis';

const analysis: Analysis & { paths: Record<string, { paths: string[][]; truncated: boolean }> } = {
  nodes: [], roots: [], edges: [], paths: {}, warnings: [], analyzerPackages: [], manager: 'npm', folder: '',
  coverage: { inputs: 'complete', inventory: 'complete', graph: 'complete', runtime: 'unknown' },
  findings: ['LOW', 'HIGH', 'HIGH', 'unexpected'].map((severity, i) => ({
    severity, node: `node-${i}`, advisory: i < 3 ? 'GHSA-shared' : 'GHSA-unknown', aliases: ['CVE-alias'],
    package: 'example', version: '1.0.0', fixed: i === 1 ? '2.0.0' : '', title: 'Example finding', file: 'package-lock.json',
  })),
};

test('repository navigation follows severity groups and keeps duplicate occurrences distinct and stable', () => {
  const rows = repositoryFindings(analysis, {});
  assert.deepEqual(rows.map(row => row.sourceNode), ['node-1', 'node-2', 'node-0', 'node-3']);
  assert.equal(rows[3].finding.severity, 'UNKNOWN');
  assert.deepEqual(rows.map(row => row.index), [1, 2, 0, 3]);
});

test('repository list and navigation apply the same combined filters including advisory aliases', () => {
  const rows = repositoryFindings(analysis, { severity: 'HIGH', fixable: true, match: 'cve-ALIAS' });
  assert.deepEqual(rows.map(row => row.sourceNode), ['node-1']);
  assert.deepEqual(repositoryFindings(analysis, { match: 'no match' }), []);
  assert.deepEqual(repositoryFindings(analysis, { scope: 'Production' }), []);
});

test('repository filter URLs discard invalid values', () => {
  assert.deepEqual(repositoryFilters({ severity: 'invalid', scope: 'invalid', match: 5, fixable: 'false' }), {
    severity: undefined, scope: undefined, match: undefined, fixable: undefined, baseImage: undefined,
  });
});

test('repository rows preserve reported CVSS scores, including zero, without inventing missing scores', () => {
  const scores = [
    { score: 9.8, version: 3, source: 'nvd', vector: 'CVSS:3.1/AV:N' },
    { score: 0, version: 2, source: 'vendor' },
    { score: 9.3, version: 4, source: 'nvd' },
    undefined,
  ];
  const rows = repositoryFindings({ ...analysis, findings: analysis.findings.map((finding, i) => ({ ...finding, cvss: scores[i] })) }, {});
  for (const row of rows) assert.deepEqual(row.finding.cvss, scores[row.index]);
});
