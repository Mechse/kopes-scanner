import test from 'node:test';
import assert from 'node:assert/strict';
import { dockerJson, inventory } from '../src/server/docker';

test('Docker connectivity errors identify the proxy without exposing network details', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(dockerJson('http://proxy:2375', '/images/json'), /Docker socket proxy is reachable and healthy/);
});

test('inventory skips Docker with no selections and restricts refreshes to selected IDs', async t => {
  const ids = ['a'.repeat(64), 'b'.repeat(64)];
  const requests: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    requests.push(new URL(url));
    return Response.json(ids.map(Id => ({ Id, Names: [], Image: 'test', ImageID: `sha256:${Id}` })));
  });
  assert.deepEqual(await inventory('http://proxy', []), []);
  assert.equal(requests.length, 0);
  assert.deepEqual((await inventory('http://proxy', [ids[0]])).map(c => c.id), [ids[0]]);
  assert.deepEqual(JSON.parse(requests[0].searchParams.get('filters')!), {id: [ids[0]]});
  assert.equal((await inventory('http://proxy')).length, 2);
});

test('Docker connectivity preserves explicit cancellation', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed'); });
  const controller = new AbortController(); controller.abort(new Error('Scan cancelled'));
  await assert.rejects(dockerJson('http://proxy:2375', '/images/json', controller.signal), /Scan cancelled/);
});
