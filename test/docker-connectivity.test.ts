import test from 'node:test';
import assert from 'node:assert/strict';
import { dockerJson } from '../src/server/docker';

test('Docker connectivity errors identify the proxy without exposing network details', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(dockerJson('http://proxy:2375', '/images/json'), /Docker socket proxy is reachable and healthy/);
});

test('Docker connectivity preserves explicit cancellation', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed'); });
  const controller = new AbortController(); controller.abort(new Error('Scan cancelled'));
  await assert.rejects(dockerJson('http://proxy:2375', '/images/json', controller.signal), /Scan cancelled/);
});
