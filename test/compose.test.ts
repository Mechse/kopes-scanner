import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('Compose supports a public checkout, Coolify values, local ports and Desktop without weakening isolation', { skip: !process.env.DOCKER_TEST }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kopes-compose-test-'));
  try {
    for (const file of ['compose.yaml', 'compose.local.yaml', 'compose.desktop.yaml', 'compose.dev.yaml', 'compose.https.yaml', 'Caddyfile']) await cp(file, join(directory, file));
    // No .env: simulate the variables Coolify generates and the three user inputs.
    const env = { ...process.env, BETTER_AUTH_URL: '', BETTER_AUTH_SECRET: '', SERVICE_URL_SCANNER_3100: 'https://scanner.example.test', SERVICE_PASSWORD_64_AUTH: 'a'.repeat(64), GITHUB_CLIENT_ID: 'test-id', GITHUB_CLIENT_SECRET: 'test-secret', GITHUB_ADMIN_USER: 'alice' };
    const config = (files: string[], environment: NodeJS.ProcessEnv = env) => JSON.parse(execFileSync('docker', [
      'compose', '-f', 'compose.yaml', ...files.flatMap(file => ['-f', file]), 'config', '--format', 'json',
    ], { cwd: directory, env: environment, encoding: 'utf8', timeout: 10_000 }));
    const linux = config([]), local = config(['compose.local.yaml']), desktop = config(['compose.local.yaml', 'compose.desktop.yaml']);
    const unconfigured = config([], { ...env, GITHUB_CLIENT_ID: '', GITHUB_CLIENT_SECRET: '', GITHUB_ADMIN_USER: '' });
    assert.equal(unconfigured.services.scanner.environment.GITHUB_CLIENT_ID, '');
    assert.equal(unconfigured.services.scanner.environment.GITHUB_CLIENT_SECRET, '');
    assert.equal(unconfigured.services.scanner.environment.GITHUB_ADMIN_USER, '');
    assert.equal(linux.services.scanner.build.context, await realpath(directory));
    assert.equal(linux.services.scanner.build.dockerfile, 'Dockerfile');
    assert.equal(linux.services['socket-proxy'].build.dockerfile, 'Dockerfile.socket-proxy');
    assert.equal(linux.services['socket-proxy'].volumes.length, 1);
    assert.equal(linux.services['socket-proxy'].volumes[0].source, '/var/run/docker.sock');
    assert.equal(linux.services['socket-proxy'].ports, undefined);
    assert.deepEqual(Object.keys(linux.services['socket-proxy'].networks), ['proxy']);
    assert.equal(linux.services.scanner.ports, undefined);
    assert.equal(linux.services.scanner.env_file, undefined);
    assert.equal(linux.services.scanner.environment.BETTER_AUTH_URL, env.SERVICE_URL_SCANNER_3100);
    assert.equal(linux.services.scanner.environment.BETTER_AUTH_SECRET, env.SERVICE_PASSWORD_64_AUTH);
    assert.equal(linux.services.scanner.environment.GITHUB_ADMIN_USER, 'alice');
    assert.equal(local.services.scanner.ports[0].host_ip, '127.0.0.1');
    assert.equal(local.services.scanner.ports[0].published, '3100');
    const manual = config([], { ...env, BETTER_AUTH_URL: 'http://localhost:3100', BETTER_AUTH_SECRET: 'b'.repeat(64) });
    assert.equal(manual.services.scanner.environment.BETTER_AUTH_URL, 'http://localhost:3100');
    assert.equal(manual.services.scanner.environment.BETTER_AUTH_SECRET, 'b'.repeat(64));
    const https = config(['compose.https.yaml'], { ...env, CADDY_DOMAIN: 'scanner.example.test' });
    assert.deepEqual(https.services.scanner, linux.services.scanner);
    assert.deepEqual(https.services['socket-proxy'], linux.services['socket-proxy']);
    assert.deepEqual(Object.keys(https.services.caddy.networks), ['outbound']);
    assert.deepEqual(https.services.caddy.ports.map((p: { published: string }) => p.published), ['80', '443']);
    assert.equal(https.services.caddy.environment.CADDY_DOMAIN, 'scanner.example.test');
    assert.ok(https.services.caddy.volumes.some((v: { target: string; read_only: boolean }) => v.target === '/etc/caddy/Caddyfile' && v.read_only));
    assert.ok(https.volumes['caddy-data']);
    for (const mode of ['local', 'https']) {
      await writeFile(join(directory, '.env'), `COMPOSE_FILE='compose.yaml:compose.${mode}.yaml'\nCADDY_DOMAIN='scanner.example.test'\n`);
      const selected = JSON.parse(execFileSync('docker', ['compose', 'config', '--format', 'json'], {
        cwd: directory, env: { ...env, COMPOSE_FILE: undefined, COMPOSE_PROJECT_NAME: undefined }, encoding: 'utf8', timeout: 10_000,
      }));
      assert.equal(Boolean(selected.services.caddy), mode === 'https');
      assert.equal(Boolean(selected.services.scanner.ports), mode === 'local');
      assert.equal(selected.name, 'kopes');
    }
    const root = linux.services.scanner.volumes.find((v: { target: string }) => v.target === '/host');
    assert.equal(root.source, '/');
    assert.equal(root.read_only, true);
    assert.equal(root.bind.propagation, 'rslave');
    assert.equal(desktop.services.scanner.volumes.length, 1);
    assert.equal(desktop.services.scanner.volumes[0].target, '/data');
    assert.deepEqual(desktop.services.scanner.tmpfs, ['/tmp:size=64m,mode=1777', '/host:ro,size=64k,mode=0555']);
    assert.equal(desktop.services.scanner.read_only, true);
    assert.deepEqual(desktop.services['socket-proxy'], linux.services['socket-proxy']);
    assert.equal(desktop.networks.proxy.internal, true);
    const dev = config(['compose.local.yaml', 'compose.desktop.yaml', 'compose.dev.yaml']);
    assert.equal(dev.services.scanner.build.dockerfile, 'Dockerfile.dev');
    assert.equal(Boolean(dev.services.scanner.read_only), false);
    assert.equal(dev.services.scanner.environment.DOCKER_HOST, 'http://socket-proxy:2375');
    assert.equal(dev.services.scanner.environment.VITE_USE_POLLING, 'true');
    assert.equal(dev.services.scanner.ports[0].host_ip, '127.0.0.1');
    assert.ok(dev.services.scanner.volumes.some((v: { target: string; source: string }) => v.target === '/data' && v.source === 'scanner-data'));
    assert.ok(dev.services.scanner.volumes.some((v: { target: string; type: string }) => v.target === '/repo/src' && v.type === 'bind'));
    assert.ok(!dev.services.scanner.volumes.some((v: { target: string }) => v.target === '/host'));
    assert.deepEqual(dev.services['socket-proxy'], desktop.services['socket-proxy']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
