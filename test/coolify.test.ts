import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoolifyLookup } from '../src/server/coolify';
import { inventory } from '../src/server/docker';
import { readConfig } from '../src/server/config';

const uuid = '2owmarhy34g9havpcfmf2ncl';
const env = { BETTER_AUTH_URL: 'http://localhost:3100', BETTER_AUTH_SECRET: 'a'.repeat(32) };

test('Coolify connection is optional and requires a complete, safe origin and token', () => {
  assert.equal(readConfig(env).coolifyOrigin, '');
  const configured = { ...env, KOPES_COOLIFY_URL: 'https://coolify.example/', COOLIFY_API_TOKEN: 'token' };
  assert.equal(readConfig(configured).coolifyOrigin, 'https://coolify.example');
  for (const patch of [{ KOPES_COOLIFY_URL: '' }, { COOLIFY_API_TOKEN: '' }, { KOPES_COOLIFY_URL: 'https://coolify.example/api/v1' }, { KOPES_COOLIFY_URL: 'https://user:pass@coolify.example' }, { KOPES_COOLIFY_URL: 'http://public.example' }]) {
    assert.throws(() => readConfig({ ...configured, ...patch }));
  }
});

test('Coolify predefined application URLs do not enable the optional API connection', () => {
  const deployed = { ...env, COOLIFY_URL: 'https://scanner.example.test', COOLIFY_API_TOKEN: '' };
  assert.equal(readConfig(deployed).coolifyOrigin, '');
  assert.equal(readConfig({ ...deployed, KOPES_COOLIFY_URL: '' }).coolifyOrigin, '');
  assert.equal(readConfig({ ...deployed, KOPES_COOLIFY_URL: 'https://coolify.example', COOLIFY_API_TOKEN: 'token' }).coolifyOrigin, 'https://coolify.example');
  // Never send an API token to the automatically injected application URL.
  assert.throws(() => readConfig({ ...deployed, COOLIFY_API_TOKEN: 'token' }), /KOPES_COOLIFY_URL/);
});

test('Coolify resolves exact UUIDs and typed legacy IDs, caches and refreshes names', async () => {
  let calls = 0, time = 0, name = 'Kopes Test';
  const request: typeof fetch = async (url, options) => {
    calls++;
    assert.equal(options?.redirect, 'error');
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer test-token');
    return Response.json(String(url).endsWith('/applications') ? [{ uuid, id: 42, name, secret: 'never retain' }]
      : String(url).endsWith('/services') ? [{ uuid: 'service-uuid', id: 42, name: 'Service stack' }] : [{ uuid: 'db-uuid', id: 42, name: 'Database' }]);
  };
  const lookup = createCoolifyLookup('https://coolify.example', 'test-token', request, () => time);
  const [resolve] = await Promise.all([lookup(), lookup()]);
  assert.equal(calls, 3);
  assert.equal(resolve({ 'com.docker.compose.project': uuid }), 'Coolify · Kopes Test');
  assert.equal(resolve({ 'coolify.applicationUuid': uuid }), 'Coolify · Kopes Test');
  assert.equal(resolve({ 'coolify.applicationId': '42' }), 'Coolify · Kopes Test');
  assert.equal(resolve({ 'coolify.serviceId': '42' }), 'Coolify · Service stack');
  assert.equal(resolve({ 'coolify.databaseUuid': 'db-uuid' }), 'Coolify · Database');
  assert.equal(resolve({ 'com.docker.compose.project': `${uuid}-preview` }), undefined);
  assert.equal(resolve({ 'coolify.applicationId': 'undefined' }), undefined);
  await lookup(); assert.equal(calls, 3);
  name = 'Renamed app'; time += 300_000;
  assert.equal((await lookup())({ 'com.docker.compose.project': uuid }), 'Coolify · Renamed app');
  assert.equal(calls, 6);
});

test('API failures keep cached names, permit partial success and never expose response errors', async t => {
  const warnings: unknown[][] = [];
  t.mock.method(console, 'warn', (...args: unknown[]) => warnings.push(args));
  let time = 0, fail = false;
  const request: typeof fetch = async url => {
    if (!String(url).endsWith('/applications')) return Response.json({ error: 'secret' }, { status: 403 });
    if (fail) throw new Error('private-token-and-response');
    return Response.json([{ uuid, name: 'Kopes Test' }]);
  };
  const lookup = createCoolifyLookup('https://coolify.example', 'token', request, () => time);
  assert.equal((await lookup())({ 'com.docker.compose.project': uuid }), 'Coolify · Kopes Test');
  fail = true; time += 300_000;
  assert.equal((await lookup())({ 'com.docker.compose.project': uuid }), 'Coolify · Kopes Test');
  const cold = createCoolifyLookup('https://coolify.example', 'token', request);
  assert.equal((await cold())({ 'com.docker.compose.project': uuid }), undefined);
  assert.ok(!JSON.stringify(warnings).includes('private-token-and-response'));
});

test('malformed responses do not replace a successful cached resource list', async t => {
  t.mock.method(console, 'warn', () => {});
  let time = 0, data: unknown = [{ uuid, name: 'Kopes Test' }];
  const lookup = createCoolifyLookup('https://coolify.example', 'token', async () => Response.json(data), () => time);
  await lookup();
  for (data of [{ unexpected: [] }, [{ uuid, name: null }]]) {
    time += 300_000;
    assert.equal((await lookup())({ 'com.docker.compose.project': uuid }), 'Coolify · Kopes Test');
  }
});

test('matching names from separate apps remain separate groups', async () => {
  const lookup = createCoolifyLookup('https://coolify.example', 'token', async url => Response.json(String(url).endsWith('/applications')
    ? [{ uuid, name: 'App' }, { uuid: 'different-uuid', name: 'App' }] : []));
  const resolve = await lookup();
  assert.notEqual(resolve({ 'com.docker.compose.project': uuid }), resolve({ 'com.docker.compose.project': 'different-uuid' }));
});

test('Docker inventory uses Coolify names across all stack services and preserves scan identity', async t => {
  const container = { Id: 'a'.repeat(64), Names: ['/web'], Image: 'nginx:1', ImageID: `sha256:${'b'.repeat(64)}`, Labels: { 'com.docker.compose.project': uuid } };
  t.mock.method(globalThis, 'fetch', async () => Response.json([container, { ...container, Id: 'c'.repeat(64), Names: ['/db'] },
    { ...container, Id: 'd'.repeat(64), Labels: { ...container.Labels, 'kopes.project': 'Explicit name' } }]));
  const lookup = createCoolifyLookup('https://coolify.example', 'token', async url => Response.json(String(url).endsWith('/applications') ? [{ uuid, name: 'Kopes Test' }] : []));
  const result = await inventory('http://proxy', lookup);
  assert.deepEqual(result.map(c => c.project), ['Coolify · Kopes Test', 'Coolify · Kopes Test', 'Explicit name']);
  assert.equal(result[0].manager, 'Coolify');
  assert.equal(result[0].target_id, `image:${container.ImageID}`);
  assert.equal(result[1].name, 'db');
});
