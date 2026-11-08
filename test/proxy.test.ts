import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Optional local check against the same HAProxy engine used by the socket-proxy container.
test('socket proxy permits only discovery/image reads and rejects writes, archives and traversal', { skip: !process.env.HAPROXY_TEST_BIN, timeout: 20_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kopes-proxy-'));
  const socket = join(directory, 'docker.sock');
  const engine = createServer((req, res) => {
    if (req.url === '/events?disconnect-test') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.flushHeaders(); // A quiet event stream stays open until its client leaves.
    } else res.end('engine');
  });
  engine.listen(socket); await once(engine, 'listening');
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>(done => probe.close(() => done()));
  let child: ReturnType<typeof spawn> | undefined;
  const status = (path: string, method = 'GET') => new Promise<number>((resolve, reject) => {
    // Raw path intentionally avoids fetch's normalization of traversal attempts.
    const req = httpRequest({ host: '127.0.0.1', port, path, method }, res => { res.resume(); resolve(res.statusCode!); });
    req.on('error', reject); req.end();
  });
  try {
    const config = (await readFile('socket-proxy.cfg', 'utf8')).replace('bind :2375', `bind 127.0.0.1:${port}`).replace('/var/run/docker.sock', socket);
    const file = join(directory, 'haproxy.cfg'); await writeFile(file, config);
    child = spawn(process.env.HAPROXY_TEST_BIN!, ['-db', '-f', file], { stdio: 'ignore' });
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try { ready = await status('/_ping') === 200; if (ready) break; } catch { /* Startup. */ }
      await delay(50);
    }
    assert.ok(ready);
    const id = 'a'.repeat(64);
    for (const path of ['/_ping', '/version', '/v1.47/containers/json', '/events?filters=%7B%7D', '/images/get?names=example', `/images/sha256:${id}/json`, `/v1.47/images/sha256%3A${id}/history`]) assert.equal(await status(path), 200, path);
    assert.equal(await status('/_ping', 'HEAD'), 200);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(await status('/containers/json', method), 403, method);
    for (const path of ['/containers/create', '/containers/abc/json', '/containers/abc/archive?path=/etc', '/containers/abc/logs', '/info', '/secrets', '/images/../../containers/abc/json', '/images/%2e%2e/%2e%2e/containers/abc/json']) assert.equal(await status(path), 403, path);
    // More abandoned streams than maxconn must not lock out inventory requests.
    // Send FIN (not RST) to reproduce clients disappearing during dev reloads.
    for (let batch = 0; batch < 5; batch++) {
      await Promise.all(Array.from({ length: 8 }, () => new Promise<void>((resolve, reject) => {
        const client = connect({ host: '127.0.0.1', port });
        const timeout = setTimeout(() => { client.destroy(); reject(new Error('Abandoned event stream was not reclaimed')); }, 2500);
        client.on('error', reject);
        client.on('close', () => { clearTimeout(timeout); resolve(); });
        client.once('connect', () => client.write('GET /events?disconnect-test HTTP/1.1\r\nHost: localhost\r\n\r\n'));
        client.once('data', () => client.end());
      })));
    }
    assert.equal(await status('/containers/json'), 200);
  } finally {
    if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
    engine.closeAllConnections(); await new Promise<void>(done => engine.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
});
