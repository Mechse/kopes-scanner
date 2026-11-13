import test from 'node:test';
import assert from 'node:assert/strict';
import { dependencyScopes } from '../src/lib/dependency-scope';
import type { Analysis } from '../src/server/source/analysis';
test('a development dependency with runtime transitive edges stays development-scoped', () => {
  const a = { roots: [{ id: 'root' }], edges: [{ from: 'root', to: 'tool', scope: 'development' }, { from: 'tool', to: 'dep', scope: 'runtime' }] } as Analysis;
  assert.deepEqual(dependencyScopes(a, { paths: [['root', 'tool', 'dep']], truncated: false }), ['Development']);
  a.edges.push({ from: 'root', to: 'dep', scope: 'runtime' });
  assert.deepEqual(dependencyScopes(a, { paths: [['root', 'tool', 'dep'], ['root', 'dep']], truncated: false }), ['Development', 'Production']);
  assert.deepEqual(dependencyScopes(a, undefined), ['Unknown']);
  assert.deepEqual(dependencyScopes(a, { paths: [['root', 'dep']], truncated: true }), ['Production', 'Unknown']);
});
