import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceAssessment } from '../src/lib/source-assessment';

test('source status distinguishes unsupported input from a complete zero-finding scan', () => {
  assert.equal(sourceAssessment({ inventoryCoverage: 'unknown', packageCount: 0, occurrences: 0 }), 'Not assessed');
  assert.equal(sourceAssessment({ inventoryCoverage: 'complete', packageCount: 292, occurrences: 0 }), 'Scanned');
  assert.equal(sourceAssessment({ inventoryCoverage: 'unknown', packageCount: 10, occurrences: 2 }), 'Partially assessed');
  assert.equal(sourceAssessment({ occurrences: 0 }), 'Not assessed');
});

import { sourceCoverageDetail } from '../src/lib/source-assessment';
import { repositoryCoverage } from '../src/lib/coverage-explanation';
test('complete inventory with unverified declarations does not claim packages were unassessed', () => {
  const analysis = { nodes: Array(1479), findings: Array(456), warnings: ['Dependency declaration not verified: grunt-env', 'Dependency declaration not verified: grunt-if'], coverage: { inventory: 'complete', inputs: 'partial', graph: 'complete' } };
  assert.match(repositoryCoverage(analysis), /456 findings in 1479 repository dependency instances. All resolved dependencies assessed; 2 dependency declarations could not be verified/);
  assert.ok(!repositoryCoverage(analysis).includes('not assessed'));
  assert.match(sourceCoverageDetail({ ...analysis, coverage: { ...analysis.coverage, inventory: 'unknown' } }), /some dependencies could not be assessed/);
  assert.match(sourceCoverageDetail({ ...analysis, warnings: ['Old scan constraint mismatch'], coverage: { ...analysis.coverage, graph: 'partial' } }), /declarations or paths could not be fully verified/);
  assert.match(sourceCoverageDetail({ ...analysis, warnings: analysis.warnings.slice(0,1) }), /1 dependency declaration could/);
});
