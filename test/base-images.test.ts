import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverBaseImages, localImage } from '../src/server/base-images';
import { containerImages } from '../src/lib/container-images';
import type { Target } from '../src/lib/model';
const digest = (c: string) => `sha256:${c.repeat(64)}`;
const raw = (id: string, layers: string[], base?: string, findings = false) => JSON.stringify({ SchemaVersion: 2, Metadata: { ImageID: digest(id), ImageConfig: { rootfs: { diff_ids: layers }, config: { Labels: base ? { 'org.opencontainers.image.base.name': 'alpine:3', 'org.opencontainers.image.base.digest': digest(base) } : {} } } }, Results: [{ Type: 'alpine', Packages: [{ Name: 'lib', Version: '1' }], Vulnerabilities: findings ? [{ VulnerabilityID: 'CVE-test', PkgName: 'lib', InstalledVersion: '1', Severity: 'HIGH' }] : [] }] });
const signal = () => new AbortController().signal;

test('unlabelled images discover strict local layer prefixes and scan immutable IDs', async () => {
  const calls: string[] = [];
  const result = await discoverBaseImages(raw('a', ['one', 'two']), [
    { id: digest('b'), name: 'alpine:3', layers: ['one'] },
    { id: digest('c'), layers: ['other'] }, { id: digest('d'), layers: ['one', 'two'] },
  ], async (reference, source) => { calls.push(reference); assert.equal(source, 'docker'); return raw('b', ['one'], undefined, true); }, signal());
  assert.deepEqual(calls, [digest('b')]);
  assert.equal(result.bases[0].verified, true);
  assert.equal(result.bases[0].report?.findings.length, 1);
  assert.equal(result.direct, undefined); // layer matches cannot establish a tracked FROM tag
  const images = containerImages({ kind: 'image', id: 'test', name: 'app', image_id: digest('a') } as Target, { findings: [], packages: [], os: '', eol: false, baseImages: result.bases });
  assert.equal(images[1].findings.length, 1); // base-only issue is visible even when absent in final image
  assert.equal(images[1].standalone, true);
});

test('declared ancestry recurses and deduplicates local identities', async () => {
  const calls: string[] = [];
  const result = await discoverBaseImages(raw('a', ['one', 'two', 'three'], 'b'), [{ id: digest('b'), layers: ['one', 'two'] }], async reference => {
    calls.push(reference);
    return reference.endsWith(digest('b')) ? raw('b', ['one', 'two'], 'c') : raw('c', ['one']);
  }, signal());
  assert.equal(calls.length, 2);
  assert.deepEqual(result.bases.map(base => base.depth), [0, 1]);
  assert.equal(result.direct?.digest, digest('b'));
});

test('unavailable and mismatched bases stay visible without clean assessments', async () => {
  for (const scan of [async () => { throw Error('offline'); }, async () => raw('b', ['wrong'])]) {
    const result = await discoverBaseImages(raw('a', ['one', 'two'], 'b'), [], scan, signal());
    assert.equal(result.bases.length, 1);
    assert.equal(result.bases[0].verified, false);
    assert.ok(result.bases[0].error);
    assert.equal(result.bases[0].report, undefined);
    assert.equal(result.direct, undefined);
  }
});

test('cycles terminate, cancellation propagates, missing package coverage is not clean', async () => {
  const result = await discoverBaseImages(raw('a', ['one'], 'b'), [], async () => raw('b', ['one'], 'a'), signal());
  assert.equal(result.bases.length, 1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(discoverBaseImages(raw('a', ['one'], 'b'), [], async () => '', controller.signal));
  const empty = JSON.parse(raw('b', ['one'])); empty.Results = [];
  const unknown = await discoverBaseImages(raw('a', ['one'], 'b'), [], async () => JSON.stringify(empty), signal());
  assert.equal(unknown.bases[0].report, undefined);
  assert.match(unknown.bases[0].error!, /coverage is unknown/);
});

test('metadata validation rejects invalid local identifiers and layers', () => {
  assert.equal(localImage({ Id: 'latest', RootFS: { Layers: [] } }), undefined);
  assert.equal(localImage({ Id: digest('a'), RootFS: { Layers: [42] } }), undefined);
  assert.deepEqual(localImage({ Id: digest('a'), RepoTags: ['<none>:<none>', 'alpine:3'], RootFS: { Layers: [digest('b')] } }), { id: digest('a'), name: 'alpine:3', layers: [digest('b')] });
});
