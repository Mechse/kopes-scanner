import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { readConfig, configuredProviders } from '../src/server/config';
import { createAuth, migrateAuth, requireSession, isAdministrator } from '../src/server/auth';
import { Store } from '../src/server/store';

const base = { BETTER_AUTH_URL: 'http://localhost:3100', BETTER_AUTH_SECRET: 'test-secret-with-at-least-32-characters' };
const all = { ...base, GITHUB_CLIENT_ID: 'gh', GITHUB_CLIENT_SECRET: 'secret', GITHUB_ADMIN_USER: 'admin',
  GOOGLE_CLIENT_ID: 'google', GOOGLE_CLIENT_SECRET: 'secret', AUTH_ADMIN_EMAIL: 'admin@example.com',
  MICROSOFT_CLIENT_ID: 'ms', MICROSOFT_CLIENT_SECRET: 'secret', SMTP_URL: 'smtps://localhost:465', AUTH_EMAIL_FROM: 'auth@example.com' };
const cookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');

test('no credentials and partial providers start safely; only complete providers are enabled', async () => {
  assert.deepEqual(configuredProviders(readConfig(base)), []);
  assert.deepEqual(configuredProviders(readConfig({ ...all, GITHUB_CLIENT_SECRET: '', MICROSOFT_CLIENT_SECRET: '' })), ['google']);
  assert.deepEqual(configuredProviders(readConfig({ ...all, SMTP_URL: '' })), ['github', 'google']);
  assert.deepEqual(configuredProviders(readConfig(all)), ['github', 'google', 'microsoft']);
  const store = new Store(':memory:');
  try {
    const auth = createAuth(readConfig(base), store); await migrateAuth(auth);
    assert.equal((await auth.$context).socialProviders.length, 0);
    const response = await auth.handler(new Request(`${base.BETTER_AUTH_URL}/api/auth/sign-in/social`, {
      method: 'POST', headers: { origin: base.BETTER_AUTH_URL, 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'github' }),
    }));
    assert.equal(response.status, 404);
  } finally { store.db.close(); }
});

for (const name of ['google', 'microsoft'] as const) test(`${name}: invitation, verification, administrator access and session revocation`, async t => {
  let verificationUrl = '';
  t.mock.method(nodemailer, 'createTransport', () => ({ sendMail: async (message: { text: string }) => {
    verificationUrl = message.text.split('\n').find(line => line.startsWith('http'))!;
  } }));
  const config = readConfig(all), store = new Store(':memory:');
  try {
    const auth = createAuth(config, store); Object.assign(auth.options.rateLimit, { enabled: false }); await migrateAuth(auth);
    const provider = (await auth.$context).socialProviders.find(p => p.id === name)!;
    let profile = { sub: '42', oid: '42', tid: 'tenant-id', name: 'Member', email: 'member@example.com', email_verified: true };
    const originalGetInfo = provider.getUserInfo.bind(provider);
    // Mock only the provider's remote exchange; retain its mapping and the real OAuth callback/session flow.
    provider.validateAuthorizationCode = async () => ({ accessToken: 'test-token' });
    provider.getUserInfo = async () => originalGetInfo({ idToken: `e30.${Buffer.from(JSON.stringify(profile)).toString('base64url')}.signature` });
    await assert.rejects(provider.getUserInfo({ accessToken: 'test-token' }));
    store.addUser(profile.email);
    if (name === 'google') {
      profile.email_verified = false;
      await assert.rejects(provider.getUserInfo({ accessToken: 'test-token' }));
      profile.email_verified = true;
    } else {
      assert.equal((await provider.getUserInfo({ accessToken: 'test-token' }))?.user.emailVerified, false);
    }
    async function signIn() {
      const start = await auth.handler(new Request(`${config.origin}/api/auth/sign-in/social`, {
        method: 'POST', headers: { origin: config.origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: name, callbackURL: '/', errorCallbackURL: '/?authError=1' }),
      }));
      const url = new URL((await start.json()).url);
      if (name === 'microsoft') assert.match(url.pathname, /^\/common\//);
      return auth.handler(new Request(`${config.origin}/api/auth/callback/${name}?code=test&state=${url.searchParams.get('state')}`, { headers: { cookie: cookies(start) } }));
    }
    let callback = await signIn();
    if (name === 'microsoft') {
      assert.match(callback.headers.get('location')!, /email_not_verified/i);
      assert.equal(store.db.prepare('SELECT count(*) AS n FROM session').get()?.n, 0);
      assert.equal(store.db.prepare('SELECT github_id FROM allowed_users WHERE login=?').get(profile.email)?.github_id, null);
      assert.ok(verificationUrl);
      const verified = await auth.handler(new Request(verificationUrl));
      assert.ok(verified.status < 400);
      assert.equal(store.db.prepare('SELECT count(*) AS n FROM session').get()?.n, 0);
      callback = await signIn();
    }
    assert.equal(callback.headers.get('location'), '/');
    const request = new Request(`${config.origin}/api/data/inventory`, { headers: { cookie: cookies(callback) } });
    const session = await requireSession(request, auth, config, store);
    assert.equal(session.user.accessId, `${name}:42`);
    assert.equal(isAdministrator(session.user, config), false);
    assert.ok(store.userAccess(config.admin, config.adminEmail).people.some(p => p.identifier === profile.email && p.lastSignIn));
    store.removeUser(profile.email);
    await assert.rejects(requireSession(request, auth, config, store));
    store.addUser(profile.email);
    await assert.rejects(requireSession(request, auth, config, store));
    await signIn();
    profile = { ...profile, sub: 'attacker', oid: 'attacker' };
    await assert.rejects(provider.getUserInfo({ accessToken: 'test-token' }), 'A recycled email cannot claim a bound grant');
    profile = { ...profile, sub: 'admin', oid: 'admin', email: config.adminEmail };
    callback = await signIn();
    if (name === 'microsoft') { await auth.handler(new Request(verificationUrl)); callback = await signIn(); }
    const adminSession = await requireSession(new Request(config.origin, { headers: { cookie: cookies(callback) } }), auth, config, store);
    assert.ok(isAdministrator(adminSession.user, config));
  } finally { store.db.close(); }
});
