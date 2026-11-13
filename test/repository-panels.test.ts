import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RepositoryDetailsPanel, RepositoryScanPanel } from '../src/components/repository-details-panel';
import type { Binding } from '../src/components/repositories';

const binding: Binding = { id: 'repo', project_id: null, repository: 'owner/repository', branch: 'main', error: null, resources: [], jobs: [], scans: [] };
function scanPanel(value: Binding, available = true) {
  return renderToStaticMarkup(createElement(RepositoryScanPanel, { binding: value, submitting: false, scanningAvailable: available, onScan() {} }));
}

test('an unscanned repository has no invented findings or export', () => {
  const details = renderToStaticMarkup(createElement(RepositoryDetailsPanel, { binding, submitting: false }));
  assert.ok(details.includes('Not assessed'));
  assert.ok(details.includes('No completed scans yet'));
  assert.ok(!details.includes('No findings'));
  const scan = scanPanel(binding);
  assert.ok(scan.includes('Scan now'));
  assert.ok(!scan.includes('Source SBOM'));
  assert.ok(!scan.includes('disabled=""'));
});

test('queued and running repository scans disable scan actions and retain distinct statuses', () => {
  for (const [state, label] of [['queued', 'Queued'], ['running', 'Scanning']]) {
    const scan = scanPanel({ ...binding, jobs: [{ state, error: null }] });
    assert.ok(scan.includes(label));
    assert.ok(scan.includes('disabled=""'));
    assert.ok(scan.includes('aria-busy="true"'));
  }
});

test('failed and unavailable scans keep the correct action state', () => {
  const failed = scanPanel({ ...binding, jobs: [{ state: 'failed', error: 'Scan failed' }] });
  assert.ok(failed.includes('data-status="error"'));
  assert.ok(failed.includes('Scan now'));
  assert.ok(!failed.includes('disabled=""'));
  const unavailable = scanPanel(binding, false);
  assert.ok(unavailable.includes('disabled=""'));
  assert.ok(unavailable.includes('Repository scanning is currently unavailable'));
});
