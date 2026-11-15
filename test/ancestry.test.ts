import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/server/store';
import { normalizeAncestry, preserveAncestry } from '../src/lib/ancestry';
import { dockerfileCandidates } from '../src/server/dockerfile-evidence';
import { discoveryFailure } from '../src/server/base-images';
import type { Report } from '../src/lib/model';
const digest = 'sha256:' + 'a'.repeat(64);
const empty = (): Report => ({ findings: [], packages: [], os: '', eol: false });

test('legacy reports never invent ancestry or clean coverage', () => {
  assert.deepEqual(normalizeAncestry(empty()).ancestry?.reasons, ['old-scan']);
  assert.deepEqual(normalizeAncestry({ ...empty(), coverage: 'release-source' }).ancestry?.reasons, ['source-only']);
  assert.equal(normalizeAncestry(empty()).baseImages, undefined);
});

test('registry failures retain proven layers and date historical assessments', () => {
  const previous = { ...empty(), baseImages: [{ digest, verified: true, layers: ['layer'], report: empty(), assessedAt: 12, discoveredAt: 10 }] };
  const current = { ...empty(), baseImages: [{ digest, verified: false, scanStatus: 'failed' as const, error: 'Unavailable' }] };
  const base = preserveAncestry(previous, current).baseImages![0];
  assert.equal(base.verified, true);
  assert.equal(base.historical, true);
  assert.equal(base.assessedAt, 12);
  assert.equal(base.scanStatus, 'failed');
  assert.deepEqual(base.layers, ['layer']);
  assert.ok(base.report);
  assert.deepEqual(previous.baseImages[0].layers, ['layer']);
});

test('fresh assessment replaces historical assessment without removing ancestry', () => {
  const old = { ...empty(), baseImages: [{ digest, verified: true, report: empty(), assessedAt: 1 }] };
  const fresh = { ...empty(), baseImages: [{ digest, verified: true, report: empty(), assessedAt: 2, scanStatus: 'scanned' as const }] };
  assert.equal(preserveAncestry(old, fresh).baseImages![0].assessedAt, 2);
  assert.equal(preserveAncestry(old, empty()).baseImages![0].historical, true);
});

test('Dockerfile stages separate build-only evidence and never resolve overridden ARGs', () => {
  const result = dockerfileCandidates(`FROM golang@${digest} AS build
FROM alpine@${digest} AS runtime
COPY --from=build /app /app
FROM runtime AS final`);
  assert.deepEqual(result.map(r => r.role), ['build-only', 'runtime']);
  assert.deepEqual(dockerfileCandidates('ARG BASE=alpine\nFROM ${BASE}\nFROM alpine:latest'), []);
});

test('errors expose controlled reason codes, never credential-bearing messages', () => {
  assert.equal(discoveryFailure(Error('HTTP 401 secret')), 'authentication-required');
  assert.equal(discoveryFailure(Error('HTTP 404')), 'deleted-manifest');
  assert.equal(discoveryFailure(Error('secret@host refused')), 'registry-failure');
});

test('v13 migration backs up exact reports and is idempotent on reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ancestry-migration-'));
  let store = new Store(dir);
  try {
    const raw = JSON.stringify(empty());
    store.db.prepare("INSERT INTO targets(id,kind,name,image_id,report_json) VALUES ('image:test','image','test','test',?)").run(raw);
    store.db.exec('PRAGMA user_version=13');
    store.db.close(); store = new Store(dir);
    assert.equal(store.db.prepare('SELECT report_json FROM ancestry_migration_backup WHERE target=?').get('image:test')?.report_json, raw);
    assert.deepEqual(store.report('image:test')?.ancestry?.reasons, ['old-scan']);
    store.cacheImage('ref', 'linux/amd64', '{}');
    assert.equal(store.cachedImage('ref', 'linux/arm64'), null);
    assert.equal(store.cachedImage('ref', 'linux/amd64'), '{}');
    store.db.close(); store = new Store(dir);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM ancestry_migration_backup').get()?.n, 1);
    assert.deepEqual(store.db.prepare('PRAGMA integrity_check').get(), Object.assign(Object.create(null), { integrity_check: 'ok' }));
  } finally { store.db.close(); rmSync(dir, { recursive: true, force: true }); }
});
