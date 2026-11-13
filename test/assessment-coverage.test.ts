import test from 'node:test';
import assert from 'node:assert/strict';
import { containerCoverageAreas, repositoryCoverageAreas } from '../src/lib/assessment-coverage';
import type { Report } from '../src/lib/model';

const states = (areas: ReturnType<typeof containerCoverageAreas>) => areas.map(area => area.status);
const report: Report = { packages: [{ name: 'example', version: '1', type: 'npm', path: '' }], findings: [], os: 'alpine 3', eol: false };

test('repository chart separates inventory from declaration and graph limitations', () => {
  assert.deepEqual(states(repositoryCoverageAreas()), ['unavailable', 'unavailable', 'unavailable']);
  assert.deepEqual(states(repositoryCoverageAreas({ nodes: [{}], coverage: { inventory: 'complete', inputs: 'partial', graph: 'complete' } })), ['complete', 'partial', 'complete']);
  assert.deepEqual(states(repositoryCoverageAreas({ nodes: [], coverage: { inventory: 'unknown', inputs: 'partial', graph: 'partial' } })), ['unavailable', 'unavailable', 'unavailable']);
  assert.deepEqual(states(repositoryCoverageAreas({ nodes: [{}], coverage: { inventory: 'unknown', inputs: 'partial', graph: 'partial' } })), ['partial', 'partial', 'partial']);
});

test('container chart preserves release-source, EOL, and missing data limitations', () => {
  assert.deepEqual(states(containerCoverageAreas(null)), ['unavailable', 'unavailable']);
  assert.deepEqual(states(containerCoverageAreas(report)), ['complete', 'complete']);
  assert.deepEqual(states(containerCoverageAreas({ ...report, coverage: 'release-source' })), ['partial', 'unavailable']);
  assert.deepEqual(states(containerCoverageAreas({ ...report, eol: true })), ['complete', 'partial']);
  assert.deepEqual(states(containerCoverageAreas({ ...report, packages: [], os: '' })), ['unavailable', 'unavailable']);
});
