import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig, configuredProviders } from '../src/server/config';
import { createAuth, migrateAuth, requireSession, isAdministrator } from '../src/server/auth';
import { Store } from '../src/server/store';

const tid = '00000000-0000-0000-0000-000000000001', oid = '00000000-0000-0000-0000-000000000002', adminOid = '00000000-0000-0000-0000-000000000003';
const base = { BETTER_AUTH_URL: 'http://localhost:3100', BETTER_AUTH_SECRET: 'test-secret-with-at-least-32-characters' };
const all = { ...base, GITHUB_CLIENT_ID: 'gh', GITHUB_CLIENT_SECRET: 'secret', GITHUB_ADMIN_USER: 'admin',
  GOOGLE_CLIENT_ID: 'google', GOOGLE_CLIENT_SECRET: 'secret', AUTH_ADMIN_EMAIL: 'admin@example.com',
  MICROSOFT_CLIENT_ID: 'ms', MICROSOFT_CLIENT_SECRET: 'secret', MICROSOFT_ADMIN_ID: `microsoft:${tid}:${adminOid}` };
const cookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');

test('only complete providers are enabled', async () => {
  assert.deepEqual(configuredProviders(readConfig(base)), []);
  assert.deepEqual(configuredProviders(readConfig({ ...all, GITHUB_CLIENT_SECRET: '', MICROSOFT_CLIENT_SECRET: '' })), ['google']);
  assert.deepEqual(configuredProviders(readConfig({ ...all, MICROSOFT_ADMIN_ID: '' })), ['github', 'google']);
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

for (const name of ['google', 'microsoft'] as const) test(`${name}: approval, administrator access and session revocation`, async () => {
  const config = readConfig(all), store = new Store(':memory:');
  try {
    const auth = createAuth(config, store); Object.assign(auth.options.rateLimit, { enabled: false }); await migrateAuth(auth);
    const provider = (await auth.$context).socialProviders.find(p => p.id === name)!;
    let profile = { sub: '42', oid, tid, name: 'Member', email: name === 'microsoft' ? config.adminEmail : 'member@example.com', email_verified: true };
    const originalGetInfo = provider.getUserInfo.bind(provider);
    provider.validateAuthorizationCode = async () => ({ accessToken: 'test-token' });
    provider.getUserInfo = async () => originalGetInfo({ idToken: `e30.${Buffer.from(JSON.stringify(profile)).toString('base64url')}.signature` });
    async function signIn() {
      const start = await auth.handler(new Request(`${config.origin}/api/auth/sign-in/social`, {
        method: 'POST', headers: { origin: config.origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: name, callbackURL: '/', errorCallbackURL: '/?authError=1' }),
      }));
      const url = new URL((await start.json()).url);
      if (name === 'microsoft') assert.match(url.pathname, /^\/common\//);
      return auth.handler(new Request(`${config.origin}/api/auth/callback/${name}?code=test&state=${url.searchParams.get('state')}`, { headers: { cookie: cookies(start) } }));
    }
    const identifier = name === 'microsoft' ? `microsoft:${tid}:${oid}` : profile.email;
    if (name === 'google') await assert.rejects(provider.getUserInfo({ accessToken: 'test-token' }));
    store.addUser(profile.email);
    if (name === 'google') {
      profile.email_verified = false;
      await assert.rejects(provider.getUserInfo({ accessToken: 'test-token' }));
      profile.email_verified = true;
    } else {
      await signIn();
      assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM session').get()?.n, 0);
      assert.deepEqual(store.userAccess(config.admin).pending.map(row => ({...row})),  [{identifier, email: profile.email}]);
      assert.ok(store.addUser(identifier));
    }
    let callback = await signIn();
    assert.equal(callback.headers.get('location'), '/');
    const request = new Request(config.origin, { headers: { cookie: cookies(callback) } });
    const session = await requireSession(request, auth, config, store);
    assert.equal(session.user.accessId, name === 'microsoft' ? identifier : 'google:42');
    assert.equal(isAdministrator(session.user, config), false);
    assert.ok(store.userAccess(config.admin, config.adminEmail).people.some(p => p.identifier === identifier && p.lastSignIn));
    store.removeUser(identifier);
    await assert.rejects(requireSession(request, auth, config, store));
    if (name === 'microsoft') await assert.rejects(provider.getUserInfo({ accessToken: 'test-token' }));
    store.addUser(identifier);
    await assert.rejects(requireSession(request, auth, config, store));
    await signIn();
    profile = { ...profile, sub: 'attacker', tid: adminOid };
    await assert.rejects(provider.getUserInfo({ accessToken: 'test-token' }));
    if (name === 'microsoft') {
      const otherId = `microsoft:${adminOid}:${oid}`;
      assert.ok(store.addUser(otherId));
      const other = await signIn();
      const otherSession = await requireSession(new Request(config.origin, {headers: {cookie: cookies(other)}}), auth, config, store);
      assert.equal(otherSession.user.accessId, otherId);
      assert.notEqual(otherSession.user.id, session.user.id);
    }
    profile = { ...profile, sub: 'admin', oid: adminOid, tid, email: config.adminEmail };
    callback = await signIn();
    const adminSession = await requireSession(new Request(config.origin, { headers: { cookie: cookies(callback) } }), auth, config, store);
    assert.ok(isAdministrator(adminSession.user, config));
  } finally { store.db.close(); }
});
