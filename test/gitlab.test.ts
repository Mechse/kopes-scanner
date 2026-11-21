import test from 'node:test';
import { mkdtemp, rm, readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSourceJob } from '../src/server/source/jobs';
import assert from 'node:assert/strict';
import { Store } from '../src/server/store';
import { readConfig } from '../src/server/config';
import { verifiedProfile } from '../src/server/gitlab-login';
import { createAuth, migrateAuth, requireSession } from '../src/server/auth';
import {
  callbacks,
  connectStart,
  finish,
  gitlabApp,
  saveApp,
  personal,
  claim,
} from '../src/server/source/gitlab';
import { handleGitlab } from '../src/server/source/gitlab-api';
import { handleRepositories } from '../src/server/source/repositories';
import { ProviderError, type ReadJson } from '../src/server/source/provider';
const config = readConfig({
  BETTER_AUTH_URL: 'http://localhost:3100',
  BETTER_AUTH_SECRET: 'test-secret-with-at-least-32-characters',
  GITHUB_ADMIN_USER: 'boss',
  GITHUB_CLIENT_ID: 'gh',
  GITHUB_CLIENT_SECRET: 'gh-test',
});
const { origin, secret } = config;
const req = (path: string, body?: unknown) =>
  new Request(
    origin + path,
    body
      ? {
          method: 'POST',
          headers: { origin, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {},
  );
const cookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
for (const host of ['https://gitlab.com', 'https://git.example.org'])
  test('Verified issuer login without SMTP: ' + host, async (t) => {
    const store = new Store(':memory:');
    t.after(() => store.db.close());
    const previous = process.env.KOPES_GITLAB_ORIGINS;
    process.env.KOPES_GITLAB_ORIGINS = host;
    t.after(() => {
      if (previous === undefined) delete process.env.KOPES_GITLAB_ORIGINS;
      else process.env.KOPES_GITLAB_ORIGINS = previous;
    });
    saveApp(store, secret, host, 'client', 'secret', true);
    store.addUser('member@example.com');
    let verified: boolean | undefined;
    const profile = { sub: '42', iss: host, email: 'member@example.com' };
    let lastCallback: Request;
    const auth = createAuth(config, store, async (c, path, form) => {
      assert.equal(c.origin, host);
      if (path === '/oauth/token') {
        assert.equal(form?.get('redirect_uri'), callbacks(origin).login);
        return { access_token: 'identity-only', scope: 'openid email' };
      }
      assert.equal(path, '/oauth/userinfo');
      assert.equal(c.token, 'identity-only');
      return { ...profile, email_verified: verified };
    });
    await migrateAuth(auth);
    async function callback() {
      const start = await auth.handler(
        req('/api/auth/sign-in/social', { provider: 'gitlab', callbackURL: '/' }),
      );
      const url = new URL((await start.json()).url);
      assert.equal(url.origin, host);
      assert.equal(url.searchParams.get('scope'), 'openid email');
      const request = new Request(
        callbacks(origin).login + '?code=test&state=' + url.searchParams.get('state'),
        { headers: { cookie: cookie(start) } },
      );
      lastCallback = request.clone();
      return auth.handler(request);
    }
    for (verified of [undefined, false]) {
      await callback();
      assert.equal(store.db.prepare('SELECT COUNT(*) n FROM session').get()?.n, 0);
    }
    verified = true;
    assert.throws(() =>
      verifiedProfile(store, config, host, {
        ...profile,
        email_verified: true,
        iss: 'https://different.example',
      }),
    );
    assert.throws(() =>
      verifiedProfile(store, config, host, {
        ...profile,
        email_verified: true,
        email: 'not-invited@example.com',
      }),
    );
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM session').get()?.n, 0);
    const end = await callback();
    assert.equal(end.headers.get('location'), '/');
    const s = await requireSession(
      new Request(origin, { headers: { cookie: cookie(end) } }),
      auth,
      config,
      store,
    );
    await auth.handler(lastCallback!);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM session').get()?.n, 1);
    assert.equal(s.user.accessId, 'gitlab:' + JSON.stringify([host, '42']));
    assert.equal(store.db.prepare('SELECT accessToken FROM account').get()?.accessToken, null);
  });
test('poll a pushed GitLab commit through the worker spool; revocation retains history', async (t) => {
  const s = new Store(':memory:');
  t.after(() => s.db.close());
  await migrateAuth(createAuth(config, s));
  s.db.exec(
    "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,githubLogin) VALUES ('me','me','me@test.org',1,1,1,'boss')",
  );
  saveApp(s, secret, 'https://gitlab.com', 'app', 'secret', false);
  const app = gitlabApp(s)!;
  let sha = 'a'.repeat(40),
    revoked = false;
  const read: ReadJson = async (c, path, form) => {
    if (form)
      return {
        access_token: 'personal-test-token',
        refresh_token: 'refresh-test',
        scope: 'read_api',
        expires_in: 3600,
      };
    assert.equal(c.token, 'personal-test-token');
    if (revoked) throw new ProviderError(401);
    if (path === '/api/v4/user') return { id: 42, username: 'owner' };
    if (path === '/api/v4/projects/10')
      return { id: 10, path_with_namespace: 'group/sub/private', default_branch: 'main' };
    if (path.endsWith('/branches/main')) return { commit: { id: sha } };
    if (path.includes('/repository/tree?')) {
      assert.ok(path.includes(sha));
      return [];
    }
    throw new Error('unexpected path');
  };
  await finish(
    s,
    app,
    origin,
    secret,
    'me',
    'session',
    connectStart(s, app, origin, 'session').searchParams.get('state')!,
    'code',
    async () => {},
    read,
  );
  const spool = await mkdtemp(join(tmpdir(), 'gitlab-poll-'));
  t.after(() => rm(spool, { recursive: true, force: true }));
  for (const [key, value] of Object.entries({
    KOPES_SOURCE_PILOT: '1',
    KOPES_SOURCE_SCAN_PILOT: '1',
    KOPES_SOURCE_SPOOL: spool,
  })) {
    const old = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (old === undefined) delete process.env[key];
      else process.env[key] = old;
    });
  }
  assert.ok(
    (
      await handleRepositories(
        req('/api/data/repositories', {
          action: 'add',
          connectionId: personal(s, 'me')!.id,
          repository: '10',
        }),
        s,
        { userId: 'me', administrator: true },
        origin,
        read,
        secret,
      )
    ).ok,
  );
  await mkdir(join(spool, 'in'));
  await mkdir(join(spool, 'out'));
  for (sha of ['a'.repeat(40), 'b'.repeat(40)]) {
    s.db.exec('UPDATE source_bindings SET next_poll=0');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    let done = false;
    const worker = (async () => {
      while (!done && !controller.signal.aborted) {
        for (const name of await readdir(join(spool, 'in'))) {
          if (!name.endsWith('.json')) continue;
          const text = await readFile(join(spool, 'in', name), 'utf8');
          assert.ok(!text.includes('personal-test-token'));
          const { bundle } = JSON.parse(text);
          assert.equal(bundle.commit, sha);
          await writeFile(
            join(spool, 'out', name),
            JSON.stringify({
              ok: true,
              bundleHash: bundle.hash,
              sbom: '{}',
              analyzer: 'test',
              database: { Version: 2, UpdatedAt: new Date().toISOString() },
              analysis: {
                nodes: [],
                edges: [],
                roots: [],
                findings: [],
                warnings: [],
                manager: 'unknown',
                folder: '',
                analyzerPackages: [],
                coverage: { inputs: 'complete', inventory: 'unknown', graph: 'complete', runtime: 'unknown' },
              },
              paths: {},
            }),
          );
          return;
        }
        await new Promise((r) => setTimeout(r, 5));
      }
    })();
    try {
      await runSourceJob(s, config, controller.signal, read, async () => {});
    } finally {
      done = true;
      clearTimeout(timer);
      await worker;
    }
    assert.equal(s.db.prepare('SELECT head_sha FROM source_bindings').get()?.head_sha, sha);
  }
  s.db.exec("UPDATE user SET githubLogin='former-admin';UPDATE source_bindings SET next_poll=0");
  let requests = 0;
  await runSourceJob(
    s,
    config,
    new AbortController().signal,
    async () => {
      requests++;
      throw new Error('unexpected provider access');
    },
    async () => {},
  );
  assert.equal(requests, 0);
  assert.equal(s.db.prepare('SELECT access_status FROM source_bindings').get()?.access_status, 'blocked');
  assert.equal(personal(s, 'me')?.health, 'connected');
  s.db.exec("UPDATE user SET githubLogin='boss'");
  assert.ok(
    (
      await handleRepositories(
        req('/api/data/repositories', {
          action: 'add',
          connectionId: personal(s, 'me')!.id,
          repository: '10',
        }),
        s,
        { userId: 'me', administrator: true },
        origin,
        read,
        secret,
      )
    ).ok,
  );
  revoked = true;
  s.db.exec('UPDATE source_bindings SET next_poll=0');
  await runSourceJob(s, config, new AbortController().signal, read, async () => {});
  assert.equal(personal(s, 'me')?.health, 'Reauthorization required');
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM source_scans').get()?.n, 2);
});
test('personal grants isolate search, direct import, refresh, reauthorization and disconnect', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gitlab-grants-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const s = new Store(directory),
    second = new Store(directory);
  t.after(() => {
    s.db.close();
    second.db.close();
  });
  const host = 'https://gitlab.com';
  saveApp(s, secret, host, 'test', 'secret', false);
  const app = gitlabApp(s)!;
  let refreshes = 0,
    deny = false;
  const read: ReadJson = async (c, path, form) => {
    assert.equal(c.origin, host);
    if (form) {
      const key = form.get('code') ?? form.get('refresh_token');
      if (!form.has('code')) {
        refreshes++;
        await new Promise((r) => setTimeout(r, 5));
      }
      return {
        access_token: key,
        refresh_token: key,
        scope: 'read_api',
        expires_in: form.has('code') ? 1 : 3600,
      };
    }
    if (path === '/api/v4/user') return { id: c.token === 'A' ? 1 : 2, username: c.token };
    if (path.startsWith('/api/v4/projects?')) {
      assert.equal(new URL(host + path).searchParams.get('page'), '2');
      return c.token === 'A' ? [{ id: 10, path_with_namespace: 'group/sub/private' }] : [];
    }
    if (path === '/api/v4/projects/10' && (deny || c.token !== 'A')) throw new ProviderError(404);
    if (path.includes('/repository/branches/')) return { commit: { id: 'a'.repeat(40) } };
    return {
      id: Number(path.split('/').pop()),
      path_with_namespace: 'group/sub/project',
      default_branch: 'main',
    };
  };
  const ctx = (user: string, admin = true) => ({
    user,
    session: user,
    admin,
    recovery: true,
    recheck: async () => {},
  });
  const call = (u: string, path: string, body?: unknown, admin = true) =>
    handleGitlab(req('/api/data/gitlab' + path, body), s, config, ctx(u, admin), read);
  const bind = (user: string, id: string, repo: string, admin = true, projectId: string | null = null) =>
    handleRepositories(
      req('/api/data/repositories', { action: 'add', connectionId: id, repository: repo, projectId }),
      s,
      { userId: user, administrator: admin },
      origin,
      read,
      secret,
    );
  for (const user of ['A', 'B']) {
    const session = JSON.stringify([user, user]),
      url = connectStart(s, app, origin, session),
      state = url.searchParams.get('state')!;
    assert.equal(url.searchParams.get('scope'), 'read_api');
    assert.throws(() => claim(s, app, state, 'login', session));
    assert.throws(() => claim(s, app, state, 'connect', session + 'x'));
    await finish(s, app, origin, secret, user, session, state, user, async () => {}, read);
    await assert.rejects(finish(s, app, origin, secret, user, session, state, user, async () => {}, read));
  }
  const a = String(personal(s, 'A')!.id),
    b = String(personal(s, 'B')!.id),
    search = (id: string) => '/projects?page=2&connectionId=' + id;
  const results = await Promise.all([
    call('A', search(a)),
    handleGitlab(req('/api/data/gitlab' + search(a)), second, config, ctx('A'), read),
  ]);
  assert.equal(refreshes, 1);
  assert.equal((await results[0].json()).projects[0].path_with_namespace, 'group/sub/private');
  assert.equal((await call('B', search(a))).status, 404);
  assert.deepEqual((await (await call('B', search(b), undefined, false)).json()).projects, []);
  assert.equal((await bind('B', b, '20', false)).status, 403);
  assert.ok(!(await bind('B', a, '10')).ok);
  assert.ok(!(await bind('B', b, '10')).ok);
  assert.ok(!(await bind('A', a, '10', true, 'missing')).ok);
  for (const [u, id, repo] of [
    ['A', a, '10'],
    ['A', a, '11'],
    ['B', b, '20'],
  ])
    assert.ok((await bind(u, id, repo)).ok);
  deny = true;
  assert.ok(!(await bind('A', a, '10')).ok);
  const blocked = () =>
    s.db.prepare("SELECT count(*) n FROM source_bindings WHERE access_status='blocked'").get()?.n;
  assert.equal(blocked(), 1);
  deny = false;
  assert.ok((await bind('A', a, '10')).ok);
  assert.equal(blocked(), 0);
  assert.equal(
    (
      await call('A', '/settings', {
        origin: 'https://git.example.org',
        clientId: 'test',
        password: 'x',
        login: false,
      })
    ).status,
    409,
  );
  assert.ok((await call('A', '/disconnect?connectionId=' + a, {})).ok);
  assert.equal(blocked(), 2);
  assert.equal(personal(s, 'B')?.health, 'connected');
  assert.ok((await call('B', '/reset', {})).ok);
  assert.equal(blocked(), 3);
  assert.equal(gitlabApp(s), undefined);
  const nextHost = 'https://git.example.org',
    oldEnv = process.env.KOPES_GITLAB_ORIGINS;
  process.env.KOPES_GITLAB_ORIGINS = nextHost;
  t.after(() => {
    if (oldEnv === undefined) delete process.env.KOPES_GITLAB_ORIGINS;
    else process.env.KOPES_GITLAB_ORIGINS = oldEnv;
  });
  saveApp(s, secret, nextHost, 'new-app', 'new-secret', false);
  const next = gitlabApp(s)!;
  const nextRead: ReadJson = async (c, path, form) => {
    assert.equal(c.origin, nextHost);
    if (form) {
      assert.equal(form.get('client_secret'), 'new-secret');
      return { access_token: 'other', refresh_token: 'other-refresh', scope: 'read_api', expires_in: 300 };
    }
    assert.equal(c.token, 'other');
    return { id: 1, username: 'other' };
  };
  const state = connectStart(s, next, origin, 'session').searchParams.get('state')!;
  assert.throws(() => claim(s, app, state, 'connect', 'session'));
  await finish(s, next, origin, secret, 'A', 'session', state, 'new-code', async () => {}, nextRead);
  assert.notEqual(personal(s, 'A')!.id, a);
  assert.equal(blocked(), 3);
  await migrateAuth(createAuth(config, s));
  s.db.exec(
    "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,githubLogin) VALUES ('A','A','test@example.org',1,1,1,'member')",
  );
  s.addUser('member');
  s.removeUser('member');
  assert.equal(personal(s, 'A'), undefined);
});
