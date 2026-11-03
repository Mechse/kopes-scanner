import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { readConfig, isGithubUsername } from '../src/server/config';
import { containerInfo, inventory, watchEvents } from '../src/server/docker';
import { candidateTags, publicImage } from '../src/server/registry';
import { snapshotHost } from '../src/server/host';
import { compareReports, parseReport } from '../src/server/trivy';
import { scanTarget } from '../src/server/scanner';
import { Store } from '../src/server/store';
import { createAuth, isAllowed, migrateAuth, requireSameOrigin, requireSession } from '../src/server/auth';

const env = { BETTER_AUTH_URL: 'http://localhost:3100', BETTER_AUTH_SECRET: 'testing-only-secret-with-at-least-32-characters', GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-secret', GITHUB_ADMIN_USER: 'Alice' };
const digest = `sha256:${'a'.repeat(64)}`;
const dockerContainer = { Id: 'b'.repeat(64), Names: ['/web-1'], Image: 'nginx:1.26.0', ImageID: digest, Labels: { 'com.docker.compose.project': 'website', 'com.docker.compose.service': 'web' } };
const raw = { SchemaVersion: 2, Metadata: { OS: { Family: 'debian', Name: '12', EOSL: false } }, Results: [{ Target: 'debian', Type: 'debian', Packages: [{ Name: 'libssl3', Version: '3.0.1' }], Vulnerabilities: [
  { VulnerabilityID: 'CVE-2025-0001', PkgName: 'libssl3', InstalledVersion: '3.0.1', FixedVersion: '3.0.2', Severity: 'HIGH', Title: 'Test advisory' },
  { VulnerabilityID: 'CVE-2025-0002', PkgName: 'libssl3', InstalledVersion: '3.0.1', Severity: 'unexpected' },
] }] };
const report = parseReport(JSON.stringify(raw));

test('configuration fails closed; username matching is exact and case-insensitive', () => {
  assert.equal(readConfig(env).intervalHours, 6);
  assert.equal(readConfig(env).admin, 'alice');
  assert.ok(isGithubUsername('octocat'));
  for (const invalid of ['', '-alice', 'alice-', 'alice@example.com', 'alice,bob', 'a'.repeat(40), undefined]) assert.ok(!isGithubUsername(invalid));
  for (const patch of [{ GITHUB_ADMIN_USER: '' }, { GITHUB_ADMIN_USER: 'alice@example.com' }, { GITHUB_ADMIN_USER: 'alice,bob' }, { BETTER_AUTH_SECRET: 'short' }, { BETTER_AUTH_URL: 'http://public.example' }, { BETTER_AUTH_URL: 'https://example.com/path' }, { SCAN_INTERVAL_HOURS: 'NaN' }, { DOCKER_HOST: 'http://proxy:2375/?foo=1' }]) assert.throws(() => readConfig({ ...env, ...patch }));
  assert.throws(() => requireSameOrigin(new Request('http://localhost:3100/api/data/rescan', { method: 'POST', headers: { origin: 'https://attacker.test' } }), env.BETTER_AUTH_URL), (e: unknown) => e instanceof Response && e.status === 403);
  assert.doesNotThrow(() => requireSameOrigin(new Request('http://localhost:3100/api/data/rescan', { headers: { origin: env.BETTER_AUTH_URL } }), env.BETTER_AUTH_URL));
});

test('inventory groups platform labels and uses immutable image IDs', () => {
  assert.equal(containerInfo(dockerContainer).project, 'website');
  assert.equal(containerInfo(dockerContainer).target_id, `image:${digest}`);
  assert.equal(containerInfo({ ...dockerContainer, Labels: { 'coolify.applicationId': 'app-1', 'coolify.name': 'shop' } }).project, 'Coolify · shop');
  assert.equal(containerInfo({ ...dockerContainer, Labels: { 'dokploy.composeId': 'stack-1' } }).manager, 'Dokploy');
  assert.equal(containerInfo({ ...dockerContainer, Labels: {} }).project, 'Standalone');
  assert.throws(() => containerInfo({ ...dockerContainer, ImageID: 'nginx:latest' }));
});

test('registry candidates stay in the same major/variant and exclude moving tags and untrusted registries', () => {
  assert.deepEqual(publicImage('nginx:1.26.0'), { registry: 'registry-1.docker.io', repository: 'library/nginx', tag: '1.26.0', name: 'docker.io/library/nginx' });
  assert.equal(publicImage('ghcr.io/org/app:1.2.0')?.registry, 'ghcr.io');
  assert.equal(publicImage(`nginx@${digest}`), null);
  assert.equal(publicImage('private.example/org/app:1.2'), null);
  assert.equal(publicImage('localhost:5000/app:1.2'), null);
  assert.deepEqual(candidateTags('1.2.0-alpine', ['2.0.0-alpine', '1.3.0', '1.3.0-alpine', '1.4.0-alpine', '1.5.0-alpine', '1.5.0-alpine', 'latest', '1.1.0-alpine']), ['1.5.0-alpine', '1.4.0-alpine']);
  assert.deepEqual(candidateTags('latest', ['2.0.0']), []);
  assert.deepEqual(candidateTags('1.2.0', ['1.3.0-rc1', '1.3.0-beta', '1.3.0-alpine']), []);
});

test('Trivy parsing preserves unknown severities and rejects malformed reports', () => {
  assert.equal(report.findings[0].severity, 'HIGH');
  assert.equal(report.findings[1].severity, 'UNKNOWN');
  assert.equal(report.packages.length, 1);
  assert.equal(report.findings[1].fixed, '');
  assert.throws(() => parseReport('null'), { message: 'Invalid scan report.' });
  assert.throws(() => parseReport('{}'), { message: 'Unsupported or empty scan report; refusing to mark this target clean.' });
  assert.throws(() => parseReport(JSON.stringify({ SchemaVersion: 2, Results: [{ Packages: {} }] })));
  const updated = { ...report, findings: [{ ...report.findings[0], installed: '3.0.2', path: 'different-layer' }] };
  assert.deepEqual(compareReports(report, updated), { removed: 1, introduced: 0, remaining: 1 });
});

test('SQLite queue deduplicates images, preserves successful reports on failure, recovers, and notices replacements', () => {
  const store = new Store(':memory:');
  try {
    const c = containerInfo(dockerContainer);
    store.syncInventory([c, { ...c, id: 'c'.repeat(64), name: 'web-2' }]);
    assert.equal(store.dashboard(6).targets.length, 2);
    const first = store.next(3_600_000)!;
    store.complete(first.id, report, '{"bomFormat":"CycloneDX"}', null, [], 'test');
    store.complete(store.next(3_600_000)!.id, report, '{}', null, [], 'test');
    store.request(first.id);
    assert.equal(store.next(3_600_000)?.id, first.id);
    store.fail(first.id, 'offline');
    assert.deepEqual(store.report(first.id), report);
    assert.equal(store.dashboard(6).targets.find(t => t.id === first.id)?.status, 'error');
    store.request(c.target_id);
    const pending = store.next(3_600_000)!;
    store.recover();
    assert.equal(store.dashboard(6).targets.find(t => t.id === pending.id)?.status, 'queued');
    const replacement = `image:sha256:${'d'.repeat(64)}`;
    store.syncInventory([{ ...c, target_id: replacement }]);
    assert.ok(store.dashboard(6).targets.some(t => t.id === replacement && t.status === 'queued'));
    assert.ok(!store.dashboard(6).targets.some(t => t.id === c.target_id));
  } finally { store.db.close(); }
});

test('host snapshot follows host-root os-release links but excludes unrelated files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kopes-host-test-'));
  const root = join(directory, 'root'), output = join(directory, 'snapshot');
  try {
    await mkdir(join(root, 'etc'), { recursive: true });
    await mkdir(join(root, 'usr/lib'), { recursive: true });
    await mkdir(join(root, 'var/lib/dpkg'), { recursive: true });
    await writeFile(join(root, 'usr/lib/os-release'), 'ID=debian\nVERSION_ID=12\n');
    await symlink('/usr/lib/os-release', join(root, 'etc/os-release'));
    await writeFile(join(root, 'etc/shadow'), 'secret');
    await writeFile(join(root, 'var/lib/dpkg/status'), 'Package: test\nVersion: 1.0\n');
    await snapshotHost(root, output);
    assert.match(await readFile(join(output, 'etc/os-release'), 'utf8'), /debian/);
    await assert.rejects(readFile(join(output, 'etc/shadow')));
    await rm(join(root, 'var/lib/dpkg/status'));
    await symlink('../../../../outside', join(root, 'var/lib/dpkg/status'));
    await assert.rejects(snapshotHost(root, output), /Unsafe symlink/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Docker events preserve starts of existing containers and inventory failure is not an empty inventory', async () => {
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/events')) { res.end(`${JSON.stringify({ Action: 'start', Actor: { ID: dockerContainer.Id } })}\n`); }
    else { res.writeHead(503); res.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const starts: (string | undefined)[] = [];
    await watchEvents(base, id => { starts.push(id); }, new AbortController().signal);
    assert.deepEqual(starts, [dockerContainer.Id]);
    await assert.rejects(inventory(base), /503/);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('Better Auth migrates SQLite, rejects missing sessions and blocks non-allowlisted GitHub profiles', async () => {
  const store = new Store(':memory:');
  try {
    const config = readConfig(env), auth = createAuth(config, store);
    await migrateAuth(auth);
    assert.ok(isAllowed('ALICE', config, store));
    assert.ok(!isAllowed('alice-attacker', config, store));
    assert.ok(!isAllowed(undefined, config, store));
    store.addUser('bob');
    assert.ok(isAllowed('BOB', config, store));
    store.removeUser('bob');
    assert.ok(!isAllowed('bob', config, store));
    const providers = (await auth.$context).socialProviders;
    assert.ok(providers.some(p => p.id === 'github'));
    const map = auth.options.socialProviders?.github?.mapProfileToUser;
    assert.ok(map);
    // Only login is consumed by our mapping; the real provider supplies the remaining profile fields.
    const profile = (login: string) => ({ login }) as Parameters<NonNullable<typeof map>>[0];
    assert.throws(() => map(profile('mallory')));
    assert.deepEqual(map(profile('ALICE')), { githubLogin: 'alice' });
    await assert.rejects(requireSession(new Request(`${config.origin}/api/data/inventory`), auth, config, store), (e: unknown) => e instanceof Response && e.status === 401);
    const context = await auth.$context;
    const user = await context.internalAdapter.createUser({ name: 'Alice', email: 'alice@example.test', emailVerified: true, githubLogin: 'alice' }, { method: 'oauth', oauth: { providerId: 'github', profile: { login: 'alice' } } });
    const session = await context.internalAdapter.createSession(user.id);
    assert.ok(session);
    const signed = `${session.token}.${createHmac('sha256', config.secret).update(session.token).digest('base64')}`;
    const request = new Request(`${config.origin}/api/data/inventory`, { headers: { cookie: `${context.authCookies.sessionToken.name}=${encodeURIComponent(signed)}` } });
    assert.equal((await requireSession(request, auth, config, store)).user.githubLogin, 'alice');
    await assert.rejects(requireSession(request, auth, { ...config, admin: 'bob' }, store), (e: unknown) => e instanceof Response && e.status === 401);
    // Bearer tokens are deliberately not enabled: arbitrary API tokens cannot bypass cookie auth.
    await assert.rejects(requireSession(new Request(`${config.origin}/api/data/inventory`, { headers: { authorization: `Bearer ${session.token}` } }), auth, config, store), (e: unknown) => e instanceof Response && e.status === 401);
    const otherAdmin = { ...config, admin: 'bob' };
    store.addUser('alice');
    assert.equal((await requireSession(request, auth, otherAdmin, store)).user.githubLogin, 'alice');
    store.removeUser('alice');
    await assert.rejects(requireSession(request, auth, otherAdmin, store));
    store.addUser('alice');
    await assert.rejects(requireSession(request, auth, otherAdmin, store), 'Re-granting access must not revive a revoked session.');
  } finally { store.db.close(); }
});

for (const existing of [false, true]) test(`GitHub sign-in stores the verified username for ${existing ? 'an existing' : 'a new'} account`, async () => {
  const store = new Store(':memory:');
  try {
    const config = readConfig(env), auth = createAuth(config, store);
    await migrateAuth(auth);
    const context = await auth.$context;
    const user = existing ? await context.internalAdapter.createUser({ name: 'Alice', email: 'alice@example.test', emailVerified: true }, { method: 'oauth', oauth: { providerId: 'github', profile: { login: 'alice' } } }) : null;
    if (user) await context.internalAdapter.createAccount({ userId: user.id, providerId: 'github', accountId: '42' });
    const provider = context.socialProviders.find(p => p.id === 'github')!;
    const map = auth.options.socialProviders!.github!.mapProfileToUser!;
    const profile = { id: '42', login: 'ALICE' } as Parameters<typeof map>[0];
    // Stub only GitHub's network exchange; exercise the real callback and database update.
    provider.validateAuthorizationCode = async () => ({ accessToken: 'test-access-token', scopes: ['read:user', 'user:email'] });
    provider.getUserInfo = async () => ({
      user: { name: 'Alice', email: 'alice@example.test', emailVerified: true, ...await map(profile) },
      data: profile,
    });
    const signIn = await auth.handler(new Request(`${config.origin}/api/auth/sign-in/social`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', origin: config.origin },
      body: JSON.stringify({ provider: 'github', callbackURL: '/' }),
    }));
    assert.equal(signIn.status, 200);
    const { url } = await signIn.json();
    const state = new URL(url).searchParams.get('state')!;
    const callback = await auth.handler(new Request(`${config.origin}/api/auth/callback/github?code=test-code&state=${encodeURIComponent(state)}`, {
      headers: { cookie: signIn.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ') },
    }));
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get('location'), '/');
    const request = new Request(`${config.origin}/api/data/inventory`, {
      headers: { cookie: callback.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ') },
    });
    const session = await requireSession(request, auth, config, store);
    if (user) assert.equal(session.user.id, user.id);
    assert.equal(session.user.githubLogin, 'alice');
    const update = await auth.handler(new Request(`${config.origin}/api/auth/update-user`, {
      method: 'POST', headers: { cookie: request.headers.get('cookie')!, origin: config.origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ githubLogin: 'mallory' }),
    }));
    assert.equal(update.status, 404);
    assert.equal((await requireSession(request, auth, config, store)).user.githubLogin, 'alice');
  } finally { store.db.close(); }
});

test('scan pipeline persists SBOM and a completed report only after successful matching', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kopes-scan-test-'));
  const store = new Store(directory);
  try {
    const root = join(directory, 'host');
    await mkdir(join(root, 'var/lib/dpkg'), { recursive: true });
    await mkdir(join(root, 'etc'), { recursive: true });
    await writeFile(join(root, 'etc/os-release'), 'ID=debian\nVERSION_ID=12\n');
    await writeFile(join(root, 'var/lib/dpkg/status'), 'Package: libssl3\nVersion: 3.0.1\n');
    const binary = join(directory, 'fake-trivy');
    await writeFile(binary, `#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.writeFileSync(args[args.indexOf('--output')+1], JSON.stringify(args[0]==='sbom'?${JSON.stringify(raw)}:{bomFormat:'CycloneDX'}));\n`, { mode: 0o700 });
    const config = readConfig({ ...env, DATA_DIR: directory, HOST_ROOT: root, TRIVY_BIN: binary });
    store.syncInventory([]);
    await scanTarget(config, store, store.next(1)!, new AbortController().signal);
    assert.equal(store.dashboard(6).targets[0].status, 'ready');
    assert.equal(JSON.parse(store.sbom('host')!).bomFormat, 'CycloneDX');
    assert.deepEqual(store.report('host'), report);
  } finally { store.db.close(); await rm(directory, { recursive: true, force: true }); }
});
