import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { accessIdentifier } from '../src/lib/user-access';
import { Store } from '../src/server/store';
import { createAuth, migrateAuth, requireSession } from '../src/server/auth';
import { readConfig } from '../src/server/config';

const config = readConfig({ BETTER_AUTH_URL: 'http://localhost:3100', BETTER_AUTH_SECRET: 'testing-only-secret-with-at-least-32-characters', GITHUB_CLIENT_ID: 'test', GITHUB_CLIENT_SECRET: 'test', GITHUB_ADMIN_USER: 'admin' });

test('access identifiers accept handles and emails and reject malformed input', () => {
  assert.equal(accessIdentifier(' @Octocat '), 'octocat');
  assert.equal(accessIdentifier(' Private@Example.com '), 'private@example.com');
  for (const value of ['', 'a b', 'a@', '-name', 'a'.repeat(40), null, 'a@example.com\nattacker']) assert.equal(accessIdentifier(value), null);
});

for (const verified of [true, false]) test(`GitHub email access ${verified ? 'accepts' : 'rejects'} a ${verified ? 'verified' : 'unverified'} private secondary email`, async t => {
  const store = new Store(':memory:');
  try {
    const auth = createAuth(config, store);
    await migrateAuth(auth);
    store.addUser('private@example.com', 'admin');
    t.mock.method(globalThis, 'fetch', async (url: string) => Response.json(url.endsWith('/user')
      ? { id: 42, login: 'OCTOCAT', name: 'Octo Cat', avatar_url: 'https://avatars.githubusercontent.com/u/42', email: 'public@example.com' }
      : [{ email: 'primary@example.com', primary: true, verified: true }, { email: 'Private@example.com', primary: false, verified }]));
    const context = await auth.$context;
    const provider = context.socialProviders.find(p => p.id === 'github')!;
    provider.validateAuthorizationCode = async () => ({ accessToken: 'test-token', scopes: ['read:user', 'user:email'] });
    if (!verified) {
      await assert.rejects(provider.getUserInfo({ accessToken: 'test-token' }));
      assert.equal(store.userAccess('admin').people[1].login, null);
      return;
    }
    // Real callback, provider mapping, account persistence and session creation; only GitHub I/O is mocked.
    const signIn = await auth.handler(new Request(`${config.origin}/api/auth/sign-in/social`, {
      method: 'POST', headers: { origin: config.origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'github', callbackURL: '/' }),
    }));
    const state = new URL((await signIn.json()).url).searchParams.get('state');
    const callback = await auth.handler(new Request(`${config.origin}/api/auth/callback/github?code=test&state=${state}`, {
      headers: { cookie: signIn.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ') },
    }));
    assert.equal(callback.headers.get('location'), '/');
    const request = new Request(`${config.origin}/api/data/users`, { headers: { cookie: callback.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ') } });
    const session = await requireSession(request, auth, config, store);
    assert.equal(session.user.githubLogin, 'octocat');
    assert.equal(session.user.githubId, '42');
    const person = store.userAccess('admin').people[1];
    assert.equal(person.email, 'primary@example.com');
    assert.equal(person.name, 'Octo Cat');
    assert.ok(person.lastSignIn);
    assert.equal(store.addUser('octocat', 'admin'), false);
    assert.equal(store.hasUser('impostor', '99'), false);
    // Renames must not leave older sessions that could become valid after a regrant.
    store.matchGithubProfile({ id: '42', login: 'renamed', name: 'Octo Cat', email: 'primary@example.com', image: null }, [], 'admin');
    store.removeUser('private@example.com', 'admin');
    await assert.rejects(requireSession(request, auth, config, store));
    store.addUser('private@example.com', 'admin');
    store.matchGithubProfile({ id: '42', login: 'renamed', name: 'Octo Cat', email: 'primary@example.com', image: null }, ['private@example.com'], 'admin');
    await assert.rejects(requireSession(request, auth, config, store), 'Regrant must not restore old sessions');
    assert.deepEqual(store.userAccess('admin').history.map(event => event.action), ['matched', 'granted', 'revoked', 'matched', 'granted']);
  } finally { store.db.close(); }
});

test('bound accounts survive renames and cannot be claimed by a recycled handle or email', () => {
  const store = new Store(':memory:');
  try {
    store.addUser('octocat');
    store.addUser('private@example.com');
    const profile = { id: '42', login: 'octocat', name: 'Octo', email: 'private@example.com', image: null };
    assert.ok(store.matchGithubProfile(profile, ['private@example.com'], 'admin'));
    assert.ok(store.matchGithubProfile({ ...profile, login: 'renamed' }, [], 'admin'));
    assert.ok(store.hasUser('renamed', '42'));
    assert.ok(!store.hasUser('octocat', '99'));
    assert.ok(!store.matchGithubProfile({ ...profile, id: '99' }, ['private@example.com'], 'admin'));
  } finally { store.db.close(); }
});

test('GitHub API errors fail closed without claiming an email grant', async t => {
  const store = new Store(':memory:');
  try {
    const auth = createAuth(config, store);
    await migrateAuth(auth);
    store.addUser('private@example.com');
    t.mock.method(globalThis, 'fetch', async () => new Response('Unavailable', { status: 503 }));
    const provider = (await auth.$context).socialProviders.find(p => p.id === 'github')!;
    await assert.rejects(provider.getUserInfo({ accessToken: 'test-token' }));
    assert.equal(store.userAccess('admin').people[1].login, null);
  } finally { store.db.close(); }
});

test('version 3 access grants migrate without losing data and reopen safely', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kopes-access-'));
  let store = new Store(directory);
  try {
    store.db.exec("DROP TABLE allowed_users; CREATE TABLE allowed_users(login TEXT PRIMARY KEY); INSERT INTO allowed_users VALUES ('legacy'); PRAGMA user_version=3");
    store.db.close();
    store = new Store(directory);
    assert.ok(store.hasUser('legacy'));
    store.addUser('new@example.com');
    store.db.close();
    store = new Store(directory);
    assert.deepEqual(store.allowedUsers(), ['legacy', 'new@example.com']);
    assert.equal(store.userAccess('admin').history.length, 1);
  } finally { store.db.close(); await rm(directory, { recursive: true, force: true }); }
});
