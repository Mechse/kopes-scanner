import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createGithubHttp, GithubError, githubErrorMessage } from '../src/server/source/github-http';

function fixture(statuses: number[], methodError?: string) {
  let calls = 0;
  const waits: number[] = [], authorizations: string[] = [];
  const http = createGithubHttp({
    lookup: (async () => [{ address: '140.82.112.5', family: 4 }]) as any,
    wait: async ms => { waits.push(ms); },
    request: ((_url: unknown, options: any, callback: any) => {
      const status = statuses[Math.min(calls++, statuses.length-1)];
      authorizations.push(options.headers.Authorization);
      const request = new EventEmitter() as any;
      request.destroy = () => {};
      request.end = () => queueMicrotask(() => {
        if (methodError) { request.emit('error', Object.assign(new Error('secret-network-error'), { code: methodError })); return; }
        const response = new EventEmitter() as any;
        response.statusCode = status; response.headers = {}; response.resume = () => {};
        callback(response);
        response.emit('data', Buffer.from(status === 200 ? '{"ok":true}' : 'secret-provider-body'));
        response.emit('end');
      });
      return request;
    }) as any,
  });
  return { http, waits, authorizations, calls: () => calls };
}

test('transient GitHub GETs retry with bounded backoff and the same authentication', async () => {
  const f = fixture([502,503,200]);
  assert.deepEqual(await f.http({ path: '/repos/owner/repo/contents/package.json', token: 'scoped-token' }), { ok: true });
  assert.equal(f.calls(), 3); assert.deepEqual(f.waits, [250,500]);
  assert.deepEqual(f.authorizations, Array(3).fill('Bearer scoped-token'));
});

test('failed GETs stop after three attempts and preserve safe HTTP diagnostics', async () => {
  const f = fixture([502]);
  await assert.rejects(f.http({ path: '/app' }), e => e instanceof GithubError && e.status === 502 && githubErrorMessage(e).includes('[HTTP 502]') && !githubErrorMessage(e).includes('secret'));
  assert.equal(f.calls(), 3);
});

test('POST exchanges, access failures, rate limits, redirects and invalid responses are not retried', async () => {
  for (const status of [401,403,404,422,429,302]) {
    const f = fixture([status]);
    await assert.rejects(f.http({ path: '/app' }), e => e instanceof GithubError && !githubErrorMessage(e).includes('secret'));
    assert.equal(f.calls(), 1); assert.deepEqual(f.waits, []);
  }
  const f = fixture([503]);
  await assert.rejects(f.http({ method: 'POST', path: '/app/installations/123/access_tokens', body: { permissions: { contents: 'read' } } }));
  assert.equal(f.calls(), 1); assert.deepEqual(f.waits, []);
});

test('DNS, timeout and connection failures are distinguished without leaking exception text', async () => {
  let lookups = 0;
  const http = createGithubHttp({ lookup: (async () => { lookups++; throw new Error('secret-dns-data'); }) as any, wait: async () => {} });
  await assert.rejects(http({ path: '/app' }), e => e instanceof GithubError && e.diagnostic === 'dns' && githubErrorMessage(e).includes('DNS') && !githubErrorMessage(e).includes('secret'));
  assert.equal(lookups, 3);
  for (const [code, diagnostic] of [['ABORT_ERR','timeout'],['ETIMEDOUT','timeout'],['ECONNRESET','connection']]) {
    const f = fixture([200], code);
    await assert.rejects(f.http({ path: '/app' }), e => e instanceof GithubError && e.diagnostic === diagnostic && !githubErrorMessage(e).includes('secret'));
    assert.equal(f.calls(), 3);
  }
});
