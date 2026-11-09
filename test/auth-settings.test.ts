import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/server/store';
import { readConfig, configuredProviders } from '../src/server/config';
import { handleAuthSettings, readAuthConfig, savedAuthRuntime } from '../src/server/auth-settings';
import { migrateAuth } from '../src/server/auth';

const base = readConfig({ BETTER_AUTH_URL: 'http://localhost:3100', BETTER_AUTH_SECRET: 'persistent-secret-with-more-than-32-characters', GITHUB_CLIENT_ID: 'github', GITHUB_CLIENT_SECRET: 'github-secret', GITHUB_ADMIN_USER: 'admin' });
const google = { action: 'save', provider: 'google', clientId: 'google-client', clientSecret: 'private-google-secret', administrator: 'admin@example.com' };
const mail = { action: 'mail', smtpUrl: 'smtps://username:private-password@mail.example.com:465', mailFrom: 'auth@example.com' };
const request = (body?: object, origin = base.origin) => new Request(`${base.origin}/api/data/auth-settings`, body ? { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);

test('administrator and same-origin restrictions apply to every settings action', async () => {
  const store = new Store(':memory:');
  try {
    for (const body of [undefined, google, mail, { action: 'disable', provider: 'google' }]) assert.equal((await handleAuthSettings(request(body), false, 'github', store, base)).status, 403);
    await assert.rejects(handleAuthSettings(request(google, 'https://other.example'), true, 'github', store, base), (error: unknown) => error instanceof Response && error.status === 403);
    assert.equal(store.getMeta('settings.authentication'), undefined);
    assert.equal((await handleAuthSettings(request({ ...google, extra: true }), true, 'github', store, base)).status, 400);
  } finally { store.db.close(); }
});

test('credentials persist encrypted, stay redacted and can be retained only for the same client', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kopes-auth-settings-'));
  let store = new Store(directory);
  try {
    for (const body of [google, mail]) {
      const response = await handleAuthSettings(request(body), true, 'github', store, base);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      const result = await response.text();
      assert.ok(!result.includes(google.clientSecret)); assert.ok(!result.includes('private-password'));
    }
    const saved = store.getMeta('settings.authentication')!;
    assert.ok(!saved.includes(google.clientSecret)); assert.ok(!saved.includes('private-password'));
    store.db.close(); store = new Store(directory);
    const config = readAuthConfig(store, base);
    assert.equal(config.googleSecret, google.clientSecret); assert.equal(config.smtpUrl, mail.smtpUrl);
    assert.equal((await handleAuthSettings(request({ ...google, clientSecret: '' }), true, 'github', store, base)).status, 200);
    assert.equal((await handleAuthSettings(request({ ...google, clientId: 'other', clientSecret: '' }), true, 'github', store, base)).status, 400);
    assert.equal((await handleAuthSettings(request({ ...mail, smtpUrl: '' }), true, 'github', store, base)).status, 200);
    assert.equal(readAuthConfig(store, base).smtpUrl, mail.smtpUrl);
  } finally { store.db.close(); await rm(directory, { recursive: true, force: true }); }
});

test('current method is protected, including shared administrator and Microsoft mail dependencies', async () => {
  const store = new Store(':memory:');
  try {
    for (const body of [{ action: 'disable', provider: 'github' }, { ...google, provider: 'github', administrator: 'other' }]) assert.equal((await handleAuthSettings(request(body), true, 'github', store, base)).status, 400);
    await handleAuthSettings(request(google), true, 'github', store, base);
    const microsoft = { ...google, provider: 'microsoft' };
    assert.equal((await handleAuthSettings(request(microsoft), true, 'github', store, base)).status, 400);
    assert.equal((await handleAuthSettings(request({ ...mail, smtpUrl: 'https://example.com' }), true, 'github', store, base)).status, 400);
    await handleAuthSettings(request(mail), true, 'github', store, base);
    assert.equal((await handleAuthSettings(request(microsoft), true, 'github', store, base)).status, 200);
    assert.equal((await handleAuthSettings(request(mail), true, 'microsoft', store, base)).status, 400);
    assert.equal((await handleAuthSettings(request({ ...microsoft, administrator: 'other@example.com' }), true, 'google', store, base)).status, 400);
    assert.equal((await handleAuthSettings(request({ action: 'disable', provider: 'github' }), true, 'google', store, base)).status, 200);
    assert.deepEqual(configuredProviders(readAuthConfig(store, base)), ['google', 'microsoft']);
    assert.equal((await handleAuthSettings(request({ action: 'disable', provider: 'microsoft' }), true, 'google', store, base)).status, 200);
    assert.equal((await handleAuthSettings(request({ action: 'disable', provider: 'google' }), true, 'google', store, base)).status, 400);
    assert.deepEqual(configuredProviders(readAuthConfig(store, base)), ['google']);
  } finally { store.db.close(); }
});

test('live auth snapshots activate and disable providers without a restart or mutating in-flight requests', async () => {
  const store = new Store(':memory:');
  try {
    const runtime = savedAuthRuntime(store, base), first = runtime();
    await migrateAuth(first.auth);
    assert.equal(runtime(), first);
    await handleAuthSettings(request(google), true, 'github', store, base);
    const second = runtime();
    assert.notEqual(second, first);
    assert.deepEqual(configuredProviders(first.config), ['github']);
    assert.deepEqual(configuredProviders(second.config), ['github', 'google']);
    const response = await second.auth.handler(new Request(`${base.origin}/api/auth/sign-in/social`, {
      method: 'POST', headers: { origin: base.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'google', callbackURL: '/' }),
    }));
    assert.equal(response.status, 200);
    const url = new URL((await response.json()).url);
    assert.equal(url.searchParams.get('client_id'), google.clientId);
    assert.equal(url.searchParams.get('redirect_uri'), `${base.origin}/api/auth/callback/google`);
    await handleAuthSettings(request({ action: 'disable', provider: 'google' }), true, 'github', store, base);
    assert.deepEqual((await runtime().auth.$context).socialProviders.map(p => p.id), ['github']);
  } finally { store.db.close(); }
});
