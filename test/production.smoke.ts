import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../src/server/store';
import { readConfig } from '../src/server/config';
import { createAuth, migrateAuth } from '../src/server/auth';

test('standalone production output: SSR, assets, auth, access control and data', { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kopes-production-'));
  const docker = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/containers/json') res.end('[]');
    else if (req.url?.startsWith('/events')) res.end('');
    else { res.writeHead(404); res.end(); }
  });
  docker.listen(0, '127.0.0.1'); await once(docker, 'listening');
  const portProbe = createServer(); portProbe.listen(0, '127.0.0.1'); await once(portProbe, 'listening');
  const port = (portProbe.address() as { port: number }).port;
  await new Promise<void>(done => portProbe.close(() => done()));
  const origin = `http://localhost:${port}`;
  const env = { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: 'smoke-test-random-looking-secret-123456789', GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-secret', GITHUB_ADMIN_USER: 'alice',
    DATA_DIR: join(directory, 'data'), HOST_ROOT: join(directory, 'missing-host'), TRIVY_BIN: '/nonexistent-test-trivy', DOCKER_HOST: `http://127.0.0.1:${(docker.address() as { port: number }).port}` };
  let child: ReturnType<typeof spawn> | undefined;
  let output = '';
  try {
    await cp(resolve('.output'), join(directory, '.output'), { recursive: true });
    const config = readConfig(env), store = new Store(config.dataDir);
    const auth = createAuth(config, store); await migrateAuth(auth);
    const context = await auth.$context;
    const user = await context.internalAdapter.createUser({ name: 'Alice', email: 'alice@example.test', githubLogin: 'alice', emailVerified: true }, { method: 'oauth', oauth: { providerId: 'github', profile: { login: 'alice' } } });
    const session = await context.internalAdapter.createSession(user.id);
    const signed = `${session.token}.${createHmac('sha256', config.secret).update(session.token).digest('base64')}`;
    const cookie = `${context.authCookies.sessionToken.name}=${encodeURIComponent(signed)}`;
    store.addUser('bob');
    const member = await context.internalAdapter.createUser({ name: 'Bob', email: 'bob@example.test', githubLogin: 'bob', emailVerified: true }, { method: 'oauth', oauth: { providerId: 'github', profile: { login: 'bob' } } });
    const memberSession = await context.internalAdapter.createSession(member.id);
    const memberSigned = `${memberSession.token}.${createHmac('sha256', config.secret).update(memberSession.token).digest('base64')}`;
    const memberCookie = `${context.authCookies.sessionToken.name}=${encodeURIComponent(memberSigned)}`;
    store.syncInventory([]);
    store.next(3_600_000);
    store.complete('host', { findings: [], packages: [{ name: 'test-package', version: '1', type: 'debian', path: 'debian' }], os: 'debian 12', eol: false }, '{"bomFormat":"CycloneDX"}', null, [], 'Test fixture');
    store.db.close();
    child = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout!.on('data', chunk => { output += chunk; }); child.stderr!.on('data', chunk => { output += chunk; });
    let healthy = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (child.exitCode !== null) throw new Error(`Server exited: ${output}`);
      try { if ((await fetch(`${origin}/healthz`)).ok) { healthy = true; break; } } catch { /* Startup. */ }
      await delay(100);
    }
    assert.ok(healthy, output);
    const page = await fetch(origin);
    assert.equal(page.status, 200, output);
    const html = await page.text();
    assert.match(html, /<title>Host security · kopes\.dev<\/title>/);
    assert.match(html, /aria-label="kopes\.dev host security"/);
    assert.match(html, /aria-label="kopes\.dev"/);
    assert.match(html, /kopes\.dev · Local vulnerability scanning/);
    assert.doesNotMatch(html, /trivy/i);
    assert.doesNotMatch(html, /kopes\.ai/i);
    const asset = html.match(/(?:href|src)="(\/assets\/[^" ]+\.(?:css|js))"/);
    assert.ok(asset, 'SSR should link a compiled CSS/JS asset');
    assert.equal((await fetch(origin + asset[1])).status, 200);
    for (const path of ['inventory', 'report?id=host', 'sbom?id=host', 'users']) assert.equal((await fetch(`${origin}/api/data/${path}`)).status, 401);
    const data = await fetch(`${origin}/api/data/inventory`, { headers: { cookie } });
    assert.equal(data.status, 200, await data.clone().text());
    assert.equal(data.headers.get('cache-control'), 'no-store');
    const dashboard = await data.json();
    assert.equal(dashboard.targets[0].summary.os, 'debian 12');
    assert.equal(dashboard.isAdmin, true);
    const memberData = await fetch(`${origin}/api/data/inventory`, { headers: { cookie: memberCookie } });
    assert.equal(memberData.status, 200);
    assert.equal((await memberData.json()).isAdmin, false);
    assert.equal((await fetch(`${origin}/api/data/users`, { headers: { cookie: memberCookie } })).status, 403);
    const changeAccess = (body: unknown, sessionCookie = cookie, requestOrigin = origin) => fetch(`${origin}/api/data/users`, { method: 'POST', headers: { cookie: sessionCookie, origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await changeAccess({ action: 'add', login: 'mallory' }, memberCookie)).status, 403);
    assert.equal((await changeAccess({ action: 'add', login: 'mallory' }, cookie, 'https://attacker.example')).status, 403);
    for (const body of [null, { action: 'add', login: 'alice' }, { action: 'remove', login: 'ALICE' }, { action: 'add', login: 'user@example.com' }, { action: 'oops', login: 'bob' }]) assert.equal((await changeAccess(body)).status, 400);
    assert.equal((await fetch(`${origin}/api/data/users`, { method: 'POST', headers: { cookie, origin }, body: '{' })).status, 400);
    const added = await changeAccess({ action: 'add', login: ' CAROL ' });
    assert.equal(added.status, 200);
    assert.deepEqual(await added.json(), { admin: 'alice', users: ['bob', 'carol'] });
    assert.equal((await changeAccess({ action: 'remove', login: 'bob' })).status, 200);
    assert.equal((await fetch(`${origin}/api/data/inventory`, { headers: { cookie: memberCookie } })).status, 401);
    assert.equal((await changeAccess({ action: 'add', login: 'bob' })).status, 200);
    assert.equal((await fetch(`${origin}/api/data/inventory`, { headers: { cookie: memberCookie } })).status, 401);
    const persisted = new Store(config.dataDir);
    try { assert.deepEqual(persisted.allowedUsers(), ['bob', 'carol']); } finally { persisted.db.close(); }
    assert.equal((await fetch(`${origin}/api/data/report?id=host`, { headers: { cookie } })).status, 200);
    const sbom = await fetch(`${origin}/api/data/sbom?id=host`, { headers: { cookie } });
    assert.match(sbom.headers.get('content-disposition')!, /attachment/);
    assert.equal((await sbom.json()).bomFormat, 'CycloneDX');
    assert.equal((await fetch(`${origin}/api/data/rescan?id=host`, { method: 'POST', headers: { cookie, origin: 'https://attacker.example' } })).status, 403);
    const sessionResponse = await fetch(`${origin}/api/auth/get-session`, { headers: { cookie } });
    assert.equal(sessionResponse.status, 200);
    assert.equal((await sessionResponse.json()).user.githubLogin, 'alice');
    const signIn = await fetch(`${origin}/api/auth/sign-in/social`, { method: 'POST', headers: { 'Content-Type': 'application/json', origin }, body: JSON.stringify({ provider: 'github', callbackURL: '/' }) });
    assert.equal(signIn.status, 200, await signIn.clone().text());
    assert.match((await signIn.json()).url, /^https:\/\/github.com\/login\/oauth\/authorize/);
  } finally {
    if (child && child.exitCode === null) {
      const stopped = once(child, 'exit'); child.kill('SIGTERM');
      const killer = setTimeout(() => child?.kill('SIGKILL'), 3000);
      await stopped; clearTimeout(killer);
    }
    docker.closeAllConnections(); await new Promise<void>(done => docker.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
});
