import test from 'node:test';
import assert from 'node:assert/strict';
import { timelineMatcher } from '../src/lib/timeline-search';

test('timeline matches fragments across fields and tolerates word typos while preserving CVE digits', () => {
  const fields = ['Café-worker', 'CVE-2026-1234', 'openssl', 'debian'];
  for (const query of ['', '1234 cafe', 'CVE20261234', 'cafework', 'opnessl', 'opensl', 'opensssl', 'opanssl']) {
    assert.equal(timelineMatcher(query)(fields), true, query);
  }
  for (const query of ['CVE20261235', '1235', 'worker nginx']) {
    assert.equal(timelineMatcher(query)(fields), false, query);
  }
});
