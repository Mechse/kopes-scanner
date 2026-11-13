import test from 'node:test';
import assert from 'node:assert/strict';
import { baseImageOptions, matchesBaseImage, parseBaseImage, repositoryBaseFindings } from '../src/lib/base-image-filter';
import { repositoryFilters } from '../src/lib/repository-findings';
import { attributeReport } from '../src/server/image-evidence';
import { unifiedFindings } from '../src/lib/unified-findings';
import type { Finding, Report } from '../src/lib/model';
const digest = `sha256:${'a'.repeat(64)}`;
const other = `sha256:${'b'.repeat(64)}`;
const finding: Finding = { id: 'CVE-1', package: 'openssl', installed: '1', fixed: '2', severity: 'HIGH', title: 'Example', type: 'alpine', path: '/lib', layer: 'base', origin: { category: 'Base image', baseDigest: digest, baseName: 'alpine:3.22', explanation: 'Verified' } };
const report = (findings: Finding[]): Report => ({ findings, os: 'alpine', packages: [], eol: false });

test('base filter matches immutable version and verified attribution only', () => {
  assert.equal(matchesBaseImage(finding, digest), true);
  assert.equal(matchesBaseImage(finding, other), false);
  assert.equal(matchesBaseImage({ ...finding, origin: undefined }, digest), false);
  assert.equal(matchesBaseImage({ ...finding, origin: { ...finding.origin!, category: 'Added tooling' } }, digest), false);
  assert.equal(parseBaseImage('alpine'), undefined);
  assert.equal(repositoryFilters({ baseImage: digest }).baseImage, digest);
  assert.equal(repositoryFilters({ baseImage: [] }).baseImage, undefined);
});
test('options distinguish rebuilt versions with the same tag and deduplicate shared bases', () => {
  const options = baseImageOptions([finding, finding, { ...finding, origin: { ...finding.origin!, baseDigest: other } }, { ...finding, origin: undefined }]);
  assert.equal(options.length, 2);
  assert.ok(options.every(option => option.label.startsWith('alpine:3.22@sha256:')));
  assert.deepEqual(baseImageOptions([{ ...finding, origin: { ...finding.origin!, baseName: undefined } }]), [{ value: digest, label: digest }]);
});
test('filtering preserves the original occurrence index when application and base copies coexist', () => {
  const r = report([{ ...finding, path: '/app/lib', origin: { category: 'Application dependencies', explanation: 'App' } }, finding]);
  const rows = unifiedFindings(r, [], 'target', f => matchesBaseImage(f, digest));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].finding.path, '/lib');
  assert.equal(rows[0].index, 1);
  assert.deepEqual(rows[0].runtimeIndices, [1]);
  assert.equal(repositoryBaseFindings(r, 'target', { baseImage: digest, severity: 'HIGH', fixable: true, match: 'openssl' }).length, 1);
  for (const filter of [{ severity: 'LOW' as const }, { match: 'missing' }, { scope: 'Production' }, { baseImage: other }]) {
    assert.equal(repositoryBaseFindings(r, 'target', { baseImage: digest, ...filter }).length, 0);
  }
});
test('image scans persist exact base reference only on verified base findings', () => {
  const raw = JSON.stringify({ Metadata: { ImageConfig: { rootfs: { diff_ids: ['base', 'app'] }, config: { Labels: { 'org.opencontainers.image.base.name': 'alpine:3.22', 'org.opencontainers.image.base.digest': digest } } } } });
  const base = JSON.stringify({ Metadata: { ImageConfig: { rootfs: { diff_ids: ['base'] } } } });
  const r = report([{ ...finding, origin: undefined }, { ...finding, layer: 'app', origin: undefined }]);
  attributeReport(r, raw, base);
  assert.equal(r.findings[0].origin?.baseName, 'alpine:3.22');
  assert.equal(r.findings[0].origin?.baseDigest, digest);
  assert.equal(matchesBaseImage(r.findings[1], digest), false);
  attributeReport(r, raw);
  assert.equal(matchesBaseImage(r.findings[0], digest), false);
});
