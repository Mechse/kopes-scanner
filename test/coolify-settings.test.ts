import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/server/store';
import { handleCoolifySettings, readCoolifyConnection, savedCoolifyLookup } from '../src/server/coolify-settings';

const config = { origin: 'https://scanner.example', secret: 'persistent-secret-with-more-than-32-characters', coolifyOrigin: '', coolifyToken: '' };
const request = (body?: object, origin = config.origin) => new Request(`${config.origin}/api/data/coolify`, body ? { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
const save = { action: 'save', url: 'https://coolify.example', token: 'private-api-token' };

test('only administrators can read, save, test or disconnect; writes require same origin', async () => {
  const store = new Store(':memory:');
  try {
    for (const body of [undefined, save, { ...save, action: 'test' }, { action: 'disconnect' }]) {
      assert.equal((await handleCoolifySettings(request(body), false, store, config)).status, 403);
    }
    await assert.rejects(handleCoolifySettings(request(save, 'https://other.example'), true, store, config), (error: unknown) => error instanceof Response && error.status === 403);
    assert.equal(store.getMeta('connection.coolify'), undefined);
  } finally { store.db.close(); }
});

test('saved tokens are encrypted, survive reopening and are never returned to the browser', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kopes-coolify-'));
  let store = new Store(directory);
  try {
    const response = await handleCoolifySettings(request(save), true, store, config);
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.ok(!text.includes(save.token));
    assert.ok(!store.getMeta('connection.coolify')!.includes(save.token));
    store.db.close(); store = new Store(directory);
    assert.equal(readCoolifyConnection(store, config).token, save.token);
    const publicState = await (await handleCoolifySettings(request(), true, store, config)).json();
    assert.deepEqual(publicState, { url: save.url, hasToken: true, enabled: true, source: 'settings' });
    assert.equal((await handleCoolifySettings(request({ ...save, token: '' }), true, store, config)).status, 200);
    assert.equal(readCoolifyConnection(store, config).token, save.token);
  } finally { store.db.close(); await rm(directory, { recursive: true, force: true }); }
});

test('testing unsaved details checks all endpoints without saving and reports safe failures', async () => {
  const store = new Store(':memory:');
  try {
    const urls: string[] = [];
    const fetcher: typeof fetch = async url => { urls.push(String(url)); return Response.json([{ uuid: 'app', name: 'Kopes Test' }]); };
    const response = await handleCoolifySettings(request({ ...save, action: 'test' }), true, store, config, fetcher);
    assert.deepEqual(await response.json(), { ok: true, counts: { applications: 1, services: 1, databases: 1 } });
    assert.equal(urls.length, 3);
    assert.equal(store.getMeta('connection.coolify'), undefined);
    for (const fetcher of [async () => Response.json({ secret: save.token }, { status: 401 }), async () => { throw new Error(save.token); }, async () => new Response('<html>Not an API</html>')]) {
      const failed = await handleCoolifySettings(request({ ...save, action: 'test' }), true, store, config, fetcher);
      assert.equal(failed.status, 502);
      assert.ok(!(await failed.text()).includes(save.token));
    }
  } finally { store.db.close(); }
});

test('changing destination cannot reuse stored tokens; disconnect overrides environment fallback', async () => {
  const store = new Store(':memory:');
  const env = { ...config, coolifyOrigin: save.url, coolifyToken: save.token };
  try {
    for (const action of ['save', 'test']) {
      const response = await handleCoolifySettings(request({ action, url: 'https://other.example', token: '' }), true, store, env, async () => { throw new Error('Must not send a request'); });
      assert.equal(response.status, 400);
    }
    await handleCoolifySettings(request({ action: 'disconnect' }), true, store, env);
    assert.equal(readCoolifyConnection(store, env).token, '');
    assert.equal(readCoolifyConnection(store, env).url, '');
    await handleCoolifySettings(request(save), true, store, env);
    assert.equal(readCoolifyConnection(store, env).token, save.token);
  } finally { store.db.close(); }
});

test('connection changes take effect without restarting and invalid encryption can be replaced', async t => {
  const store = new Store(':memory:');
  t.mock.method(globalThis, 'fetch', async () => Response.json([{ uuid: 'deployment', name: 'Kopes Test' }]));
  try {
    const lookup = savedCoolifyLookup(store, config);
    assert.equal((await lookup())({ 'com.docker.compose.project': 'deployment' }), undefined);
    await handleCoolifySettings(request(save), true, store, config);
    assert.equal((await lookup())({ 'com.docker.compose.project': 'deployment' }), 'Coolify · Kopes Test');
    await handleCoolifySettings(request({ action: 'disconnect' }), true, store, config);
    assert.equal((await lookup())({ 'com.docker.compose.project': 'deployment' }), undefined);
    await handleCoolifySettings(request(save), true, store, config);
    const rotated = { ...config, secret: 'changed-secret' };
    assert.throws(() => readCoolifyConnection(store, rotated));
    assert.equal((await handleCoolifySettings(request(save), true, store, rotated)).status, 200);
    assert.equal(readCoolifyConnection(store, rotated).token, save.token);
  } finally { store.db.close(); }
});
