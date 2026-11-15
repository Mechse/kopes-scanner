import assert from 'node:assert/strict';
import test from 'node:test';
import { containerImages } from '../src/lib/container-images';
import { attributeReport } from '../src/server/image-evidence';
import type { Finding, Report, Target } from '../src/lib/model';

const digest = `sha256:${'a'.repeat(64)}`;
const target: Target = { id: 'image-1', name: 'app:latest', kind: 'image', image_id: `sha256:${'b'.repeat(64)}`, platform: 'linux/amd64', status: 'ready', scanned_at: 100, attempted_at: 100, error: null, summary: null, suggestions: [], recommendation_note: null };
const finding: Finding = { id: 'CVE-1', package: 'lib', installed: '1', fixed: '2', severity: 'HIGH', title: 'Issue', type: 'debian', path: '/base/lib', layer: 'base', origin: { category: 'Base image', explanation: 'Verified', baseName: 'base:1', baseDigest: digest } };
const report = (findings: Finding[] = []): Report => ({ findings, packages: [], os: 'Linux', eol: false });

test('image findings deduplicate occurrences and preserve base occurrence links', () => {
  const images = containerImages(target, report([{ ...finding, path: '/app/lib', origin: undefined }, finding, { ...finding, path: '/base/other' }]), 'alias:1');
  assert.equal(images[0].name, 'alias:1');
  assert.equal(images[0].findings.length, 1);
  assert.equal(images[1].findings.length, 1);
  assert.equal(images[1].findings[0].index, 1);
  assert.deepEqual(images[1].findings[0].runtimeIndices, [1, 2]);
});

test('unloaded reports are not clean scans and hosts have no images', () => {
  assert.equal(containerImages(target, null)[0].assessed, false);
  assert.equal(containerImages(target, report())[0].assessed, true);
  assert.deepEqual(containerImages({ ...target, kind: 'host' }, report()), []);
});

test('verified bases without findings persist; declared but unverified bases are not assessed', () => {
  const raw = JSON.stringify({ Metadata: { ImageConfig: { rootfs: { diff_ids: ['base', 'app'] }, config: { Labels: { 'org.opencontainers.image.base.name': 'base:1', 'org.opencontainers.image.base.digest': digest } } } } });
  const base = JSON.stringify({ Metadata: { ImageConfig: { rootfs: { diff_ids: ['base'] } } } });
  const r = report();
  attributeReport(r, raw, base);
  assert.equal(containerImages(target, r)[1].assessed, true);
  assert.equal(containerImages(target, r)[1].findings.length, 0);
  attributeReport(r, raw);
  assert.equal(containerImages(target, r)[1].assessed, false);
  const mismatch = JSON.stringify({ Metadata: { ImageConfig: { rootfs: { diff_ids: ['other'] } } } });
  attributeReport(r, raw, mismatch);
  assert.equal(containerImages(target, r)[1].assessed, false);
});
