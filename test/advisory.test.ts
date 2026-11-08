import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { createAdvisoryLookup, parseAdvisory } from '../src/server/advisory';
import { safeUrl, explainVector } from '../src/lib/advisory';
import { remediation } from '../src/lib/remediation';
import { parseReport } from '../src/server/trivy';
import { FindingOverview } from '../src/components/finding-overview';
import type { Finding, Target, Container } from '../src/lib/model';

const id = 'CVE-2024-12345';
const record = { cveMetadata: { cveId: id, state: 'PUBLISHED', datePublished: '2024-01-01' }, containers: { cna: {
  providerMetadata: { shortName: 'vendor' }, descriptions: [{ lang: 'en', value: 'Description' }, { lang: 'fr', value: 'French' }],
  solutions: [{ lang: 'en', value: 'Install a supported release.' }], workarounds: [{ lang: 'en', value: 'Disable the affected feature.' }],
  references: [{ url: 'javascript:alert(1)' }, { url: 'https://vendor.example/advisory' }, { url: 'https://vendor.example/advisory' }],
  problemTypes: [{ descriptions: [{ lang: 'en', cweId: 'CWE-79', description: 'XSS' }] }],
  metrics: [{ cvssV3_1: { vectorString: 'CVSS:3.1/AV:N/PR:N/UI:R/C:L/I:L/A:N' } }],
} } };
const finding: Finding = { id, package: 'libssl3', installed: '3.0.1', fixed: '3.0.2', severity: 'HIGH', title: 'Example', type: 'debian', path: '/usr/lib' };
const target: Target = { id: 'host', kind: 'host', name: 'Host', image_id: null, platform: null, status: 'ready', scanned_at: 1, attempted_at: 1, error: null, summary: null, suggestions: [], recommendation_note: null };
const container: Container = { id: 'test', name: 'web', image: 'example:1', target_id: 'image', project: 'website', service: 'web', manager: 'Compose' };

test('CVE records preserve attributable English guidance and safe unique references', () => {
  const result = parseAdvisory(record, id, 123);
  assert.equal(result.description, 'Description');
  assert.equal(result.publisher, 'vendor');
  assert.equal(result.fetchedAt, 123);
  assert.deepEqual(result.workarounds, ['Disable the affected feature.']);
  assert.deepEqual(result.references, ['https://vendor.example/advisory']);
  assert.deepEqual(result.weaknesses, ['CWE-79 · XSS']);
  assert.equal(explainVector(result.vector).length, 5);
  assert.deepEqual(explainVector('CVSS:4.0/AV:N'), []);
  assert.throws(() => parseAdvisory(record, 'CVE-2024-9999'));
  assert.equal(parseAdvisory({ ...record, cveMetadata: { cveId: id, state: 'REJECTED' } }, id).solutions.length, 0);
});

test('lookup deduplicates requests, caches successes and expires failed lookups', async () => {
  let calls = 0, clock = 0, fail = false;
  const lookup = createAdvisoryLookup((async (url, options) => {
    calls++;
    assert.equal(url, `https://cveawg.mitre.org/api/cve/${id}`);
    assert.equal(options?.redirect, 'error');
    return fail ? new Response('', { status: 503 }) : Response.json(record);
  }) as typeof fetch, () => clock);
  await Promise.all([lookup(id), lookup(id)]);
  assert.equal(calls, 1);
  await lookup(id); assert.equal(calls, 1);
  clock = 3_600_001; fail = true;
  assert.equal((await lookup(id)).status, 'unavailable');
  assert.equal(calls, 2);
  await lookup(id); assert.equal(calls, 2);
  clock += 60_001; fail = false;
  assert.equal((await lookup(id)).status, 'available');
  assert.equal(calls, 3);
  await assert.rejects(lookup('../../etc/passwd'));
});

test('external source failures and malformed or oversized responses remain non-fatal', async () => {
  for (const response of [new Response('invalid'), Response.json({}), new Response('x'.repeat(2 * 1024 * 1024 + 1))]) {
    const lookup = createAdvisoryLookup((async () => response) as typeof fetch);
    assert.equal((await lookup(id)).status, 'unavailable');
  }
  assert.equal((await createAdvisoryLookup((async () => new Response('', { status: 404 })) as typeof fetch)(id)).status, 'not-found');
});

test('scanner retains description, dates, CWE and vectors without executable URLs', () => {
  const report = parseReport(JSON.stringify({ SchemaVersion: 2, Results: [{ Type: 'debian', Vulnerabilities: [{
    VulnerabilityID: id, PkgName: 'libssl3', Description: 'Details', PrimaryURL: 'https://vendor.example', References: ['javascript:alert(1)', null],
    PublishedDate: '2024-01-01', CweIDs: ['CWE-79', 42], CVSS: { nvd: { V3Score: 8.1, V3Vector: 'CVSS:3.1/AV:N' } },
  }] }] }));
  assert.equal(report.findings[0].description, 'Details');
  assert.equal(report.findings[0].cvss?.vector, 'CVSS:3.1/AV:N');
  assert.deepEqual(report.findings[0].references, ['https://vendor.example']);
  assert.deepEqual(report.findings[0].cwes, ['CWE-79']);
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'https://user:pass@example.com']) assert.equal(safeUrl(url), false);
});

test('remediation separates host upgrades, container deployment, dependency inspection and no fix', () => {
  assert.match(remediation(finding, 'host')[0].command!, /apt-get install --only-upgrade/);
  const image = remediation(finding, 'image', container);
  assert.ok(image.some(s => s.command?.includes("docker compose up -d --no-deps 'web'")));
  assert.ok(image.every(s => !s.command?.includes('apt-get')));
  assert.ok(remediation({ ...finding, fixed: '' }, 'image', container).every(s => !s.command));
  assert.ok(remediation({ ...finding, package: '$(touch /tmp/unsafe)' }, 'host').every(s => !s.command));
  assert.ok(remediation(finding, 'image', { ...container, service: '-f /bad' }).every(s => !s.command));
  assert.ok(remediation(finding, 'image', { ...container, manager: 'Coolify' }).every(s => !s.command));
  assert.ok(remediation({ ...finding, type: 'gobinary', package: 'stdlib' }, 'image').some(s => s.command === 'go version'));
  assert.ok(remediation({ ...finding, type: 'npm', package: '@scope/lib' }, 'image').some(s => s.command === "npm explain '@scope/lib'"));
});

test('old reports render useful details and no-fix states without enrichment', () => {
  const html = renderToStaticMarkup(createElement(FindingOverview, { finding, target, locked: false }));
  assert.match(html, /How to fix it/);
  assert.match(html, /Technical details/);
  assert.match(html, /Copy command/);
  assert.match(html, /Loading the CVE record/);
  const noFix = renderToStaticMarkup(createElement(FindingOverview, { finding: { ...finding, fixed: '', title: '<script>bad()</script>' }, target, locked: false }));
  assert.match(noFix, /What to do while no fix is reported/);
  assert.ok(!noFix.includes('<script>bad()'));
  assert.ok(!noFix.includes('apt-get'));
});
