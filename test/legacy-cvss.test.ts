import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichLegacyCvss } from '../src/server/source/legacy-cvss';
import type { SourceFinding } from '../src/server/source/analysis';
const finding = (): SourceFinding => ({ advisory: 'NSWG-ECO-338', aliases: [], node: 'n', package: 'brace-expansion', version: '1.0.0', fixed: '', severity: 'MEDIUM', title: '', file: '' });
const record = { id: 338, module_name: 'brace-expansion', cvss_score: 6.2, cvss_vector: 'CVSS:3.0/AV:L/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H' };
test('archival enrichment verifies identity, deduplicates lookups and preserves existing scores', async () => {
  const existing = { ...finding(), cvss: { score: 7, version: 3, source: 'vendor' } };
  const findings = [finding(), finding(), existing, { ...finding(), package: 'different' }, { ...finding(), advisory: 'GHSA-example' }];
  let requests = 0;
  await enrichLegacyCvss(findings, (async (url) => {
    requests++; assert.equal(url, 'https://raw.githubusercontent.com/nodejs/security-wg/main/vuln/npm/338.json');
    return Response.json(record);
  }) as typeof fetch);
  assert.equal(requests, 1);
  assert.equal(findings[0].cvss?.score, 6.2);
  assert.deepEqual(findings[0].cvss, findings[1].cvss);
  assert.equal(findings[0].cvss?.source, 'https://github.com/nodejs/security-wg/blob/main/vuln/npm/338.json');
  assert.equal(existing.cvss.score, 7);
  assert.equal(findings[3].cvss, undefined); assert.equal(findings[4].cvss, undefined);
});
test('missing, malformed, mismatched and oversized archives never fabricate scores or fail scans', async () => {
  const responses = [new Response('', {status:404}), Response.json({...record,id:339}), Response.json({...record,cvss_score:11}), Response.json({...record,cvss_score:'6.2'}), Response.json({...record,cvss_vector:null}), new Response('x'.repeat(128*1024+1)), new Response('invalid')];
  for (const response of responses) {
    const f = finding(); await enrichLegacyCvss([f], (async () => response) as typeof fetch); assert.equal(f.cvss, undefined);
  }
  const f = finding(); await enrichLegacyCvss([f], (async () => { throw new Error('Offline'); }) as typeof fetch); assert.equal(f.cvss, undefined);
});
