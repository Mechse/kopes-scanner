import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('Compose preserves the Linux read-only root bind and removes it for Desktop', { skip: !process.env.DOCKER_TEST }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kopes-compose-test-'));
  try {
    for (const file of ['compose.yaml', 'compose.desktop.yaml']) await cp(file, join(directory, file));
    await cp('.env.example', join(directory, '.env'));
    const config = (desktop: boolean) => JSON.parse(execFileSync('docker', [
      'compose', '-f', 'compose.yaml', ...(desktop ? ['-f', 'compose.desktop.yaml'] : []), 'config', '--format', 'json',
    ], { cwd: directory, encoding: 'utf8', timeout: 10_000 }));
    const linux = config(false), desktop = config(true);
    assert.equal(linux.services.scanner.build.context, await realpath(directory));
    assert.equal(linux.services.scanner.build.dockerfile, 'Dockerfile');
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
  } finally { await rm(directory, { recursive: true, force: true }); }
});
