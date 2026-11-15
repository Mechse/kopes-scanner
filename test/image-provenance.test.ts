import test from 'node:test';
import assert from 'node:assert/strict';
import { provenanceBases } from '../src/server/image-provenance';
import { discoverBaseImages } from '../src/server/base-images';
const digest = `sha256:${'a'.repeat(64)}`;
const subject = `sha256:${'b'.repeat(64)}`;
const material = { uri: 'pkg:docker/python@3.14-slim?platform=linux%2Famd64', digest: { sha256: digest.slice(7) } };

test('reads SLSA v1 and v0.2 Docker dependencies bound to the matching subject', () => {
  for (const predicate of [{ materials: [material] }, { buildDefinition: { resolvedDependencies: [material] } }]) {
    assert.deepEqual(provenanceBases({ predicateType: 'https://slsa.dev/provenance/v1', subject: [{ digest: { sha256: subject.slice(7) } }], predicate }, subject), [{ name: 'python:3.14-slim', digest }]);
    assert.deepEqual(provenanceBases({ predicateType: 'https://slsa.dev/provenance/v0.2', subject: [], predicate }, subject), []);
  }
});

test('ignores non-Docker, private registry, malformed, and non-SLSA materials', () => {
  const statement = { predicateType: 'https://slsa.dev/provenance/v1', subject: [{ digest: { sha256: subject.slice(7) } }], predicate: { materials: ['git+https://example.com', 'pkg:docker/localhost:5000/private@1', 'pkg:docker/%ZZ'].map(uri => ({ ...material, uri })) } };
  assert.deepEqual(provenanceBases(statement, subject), []);
  assert.deepEqual(provenanceBases({ ...statement, predicateType: 'https://spdx.dev/Document' }, subject), []);
});

test('build provenance candidates require matching layers; build-stage-only images are omitted', async () => {
  const raw = (layers: string[]) => JSON.stringify({ SchemaVersion: 2, Metadata: { ImageConfig: { rootfs: { diff_ids: layers } } }, Results: [{ Type: 'debian', Packages: [{ Name: 'lib', Version: '1' }] }] });
  for (const layers of [['base'], ['builder']]) {
    const result = await discoverBaseImages(raw(['base', 'app']), [], async () => raw(layers), new AbortController().signal, async () => [{ name: 'python:3.14-slim', digest }]);
    assert.equal(result.bases.length, layers[0] === 'base' ? 1 : 0);
    if (result.bases.length) { assert.equal(result.bases[0].source, 'provenance'); assert.equal(result.bases[0].verified, true); }
  }
});

test('registry blob redirects drop authorization and reject untrusted hosts', async t => {
  const { boundedFetch } = await import('../src/server/registry');
  const requests: { url: string; headers?: HeadersInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL, options?: RequestInit) => {
    requests.push({ url: String(url), headers: options?.headers });
    return requests.length === 1 ? new Response(null, { status: 307, headers: { location: 'https://pkg-containers.githubusercontent.com/blob?sig=test' } }) : new Response('{}');
  });
  await boundedFetch('https://ghcr.io/v2/example/blobs/test', { Authorization: 'Bearer test' }, undefined, true);
  assert.equal(requests[1].headers, undefined);
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 307, headers: { location: 'http://127.0.0.1/private' } }));
  await assert.rejects(boundedFetch('https://ghcr.io/v2/example/blobs/test', {}, undefined, true), /Unsupported registry blob redirect/);
});

test('OCI referrers support single-platform manifests and unannotated in-toto layers', async t => {
  const { createHash } = await import('node:crypto');
  const { imageProvenance } = await import('../src/server/image-provenance');
  const encode = (data: unknown) => {
    const body = JSON.stringify(data);
    return { body, digest: 'sha256:' + createHash('sha256').update(body).digest('hex') };
  };
  const root = encode({ schemaVersion: 2, layers: [] });
  const statement = encode({ predicateType: 'https://slsa.dev/provenance/v1', subject: [{ digest: { sha256: root.digest.slice(7) } }], predicate: { materials: [material] } });
  const attestation = encode({ subject: { digest: root.digest }, layers: [{ digest: statement.digest, mediaType: 'application/vnd.in-toto+json' }] });
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    const url = String(input); calls.push(url);
    if (url.includes('/token?')) return new Response('{"token":"test"}');
    if (url.includes('/referrers/')) return new Response(JSON.stringify({ manifests: [{ digest: attestation.digest }] }));
    for (const value of [root, statement, attestation]) if (url.endsWith(value.digest)) return new Response(value.body);
    throw new Error('Unexpected request');
  });
  assert.deepEqual(await imageProvenance('docker.io/library/test@' + root.digest, 'linux/amd64', new AbortController().signal), [{ name: 'python:3.14-slim', digest }]);
  assert.ok(calls.length <= 5);
});

test('deleted immutable manifests do not use provenance from a moved tag', async t => {
  const { imageProvenance } = await import('../src/server/image-provenance');
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    calls.push(String(input));
    return String(input).includes('/token?') ? new Response('{"token":"test"}') : new Response('', { status: 404 });
  });
  await assert.rejects(imageProvenance('alpine@' + digest, 'linux/amd64', new AbortController().signal, 'alpine:latest'), /404/);
  assert.equal(calls.length, 2);
});
