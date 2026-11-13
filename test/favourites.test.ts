import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/server/store';
import { handleFavourites, listFavourites } from '../src/server/favourites';
import { resourceKey } from '../src/lib/settings';
import type { Container } from '../src/lib/model';

const origin = 'http://localhost:3100';
const a: Container = { id: 'a', target_id: 'image:shared', project: 'Alpha', name: 'web', image: 'app:1', service: 'web', manager: 'compose' };
const request = (body?: unknown, source = origin) => new Request(`${origin}/api/data/favourites`, body === undefined ? undefined : {
  method: 'POST', headers: { origin: source, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('favourites are personal, independent by level and project, idempotent, and removable', async () => {
  const store = new Store(':memory:');
  try {
    store.syncInventory([a, { ...a, id: 'b', project: 'Beta' }]);
    const project = { scope: 'project', key: 'Alpha' };
    const resource = { scope: 'resource', key: resourceKey(a) };
    const save = (item: object, favourite = true, user = 'alice') => handleFavourites(request({ ...item, favourite }), store, user, origin);
    await save(project); await save(project); await save(resource);
    assert.deepEqual(listFavourites(store, 'alice'), [project, resource]);
    assert.deepEqual(listFavourites(store, 'bob'), []);
    await save(project, true, 'bob');
    await save(project, false);
    assert.deepEqual(listFavourites(store, 'alice'), [resource]);
    assert.deepEqual(listFavourites(store, 'bob'), [project]);
    const read = await handleFavourites(request(), store, 'alice', origin);
    assert.equal(read.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await read.json(), [resource]);
    await save(resource, false);
    assert.deepEqual(listFavourites(store, 'alice'), []);
  } finally { store.db.close(); }
});

test('favourites persist across restarts, display renames, and container replacement', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kopes-favourites-'));
  let store = new Store(directory);
  try {
    store.syncInventory([a]);
    await handleFavourites(request({ scope: 'resource', key: resourceKey(a), favourite: true }), store, 'alice', origin);
    store.saveSettings('resource', resourceKey(a), { displayName: 'New display name' });
    store.db.close();
    store = new Store(directory);
    store.syncInventory([{ ...a, id: 'replacement', target_id: 'image:new' }]);
    assert.deepEqual(listFavourites(store, 'alice'), [{ scope: 'resource', key: resourceKey(a) }]);
  } finally { store.db.close(); await rm(directory, { recursive: true, force: true }); }
});

test('favourites reject invalid input and cross-origin writes; missing resources can be unstarred', async () => {
  const store = new Store(':memory:');
  try {
    store.syncInventory([a]);
    const body = { scope: 'project', key: 'Alpha', favourite: true };
    await assert.rejects(handleFavourites(request(body, 'https://other.example'), store, 'alice', origin), (e: unknown) => e instanceof Response && e.status === 403);
    for (const invalid of [null, {}, { ...body, scope: 'user' }, { ...body, key: 7 }, { ...body, favourite: 'true' }]) {
      assert.equal((await handleFavourites(request(invalid), store, 'alice', origin)).status, 400);
    }
    assert.equal((await handleFavourites(request({ ...body, key: 'missing' }), store, 'alice', origin)).status, 404);
    await handleFavourites(request(body), store, 'alice', origin);
    store.syncInventory([]);
    assert.equal((await handleFavourites(request({ ...body, favourite: false }), store, 'alice', origin)).status, 200);
    assert.deepEqual(listFavourites(store, 'alice'), []);
  } finally { store.db.close(); }
});
