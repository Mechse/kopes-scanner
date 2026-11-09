import test from 'node:test';
import assert from 'node:assert/strict';
import { projectLabel } from '../src/lib/project-label';
import type { Container } from '../src/lib/model';

const id = '2owmarhy34g9havpcfmf2ncl';
const resource = (service: string, image = 'ghcr.io/example/scanner:1.0'): Container => ({
  id: 'container', name: 'generated-name', image, project: id, service, manager: 'Compose', target_id: 'image:123',
});

test('opaque project titles describe services while retaining the full deployment reference', () => {
  const containers = [resource('web'), resource('postgres'), resource('web')];
  assert.deepEqual(projectLabel(id, containers), { title: 'postgres + web', detail: id });
  assert.deepEqual(projectLabel(`Coolify · ${id}`, containers), { title: 'postgres + web', detail: `Coolify · ${id}` });
  assert.deepEqual(projectLabel('Kopes Test', containers), { title: 'Kopes Test', detail: 'postgres + web' });
  assert.equal(containers[0].project, id);
});

test('opaque titles fall back to image names and bound long summaries', () => {
  assert.equal(projectLabel(id, [resource('')]).title, 'scanner');
  assert.equal(projectLabel(id, [resource(id)]).title, 'scanner');
  assert.equal(projectLabel(id, [resource('', `${id}:latest`)]).title, 'Container');
  assert.equal(projectLabel(id, []).title, 'Unnamed deployment');
  assert.equal(projectLabel(id, ['a', 'b', 'c', 'd'].map(name => resource(name))).title, 'a + b + c + 1 more');
  assert.equal(projectLabel('a-readable-project-name', []).title, 'a-readable-project-name');
});
