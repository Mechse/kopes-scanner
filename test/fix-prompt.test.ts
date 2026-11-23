import assert from 'node:assert/strict';
import test from 'node:test';
import { fixPrompt } from '../src/lib/fix-prompt';
import type { Finding } from '../src/lib/model';

const finding: Finding = { id: 'CVE-2025-1234', package: 'example', type: 'npm', installed: '1.0.0', fixed: '1.0.1, 2.0.3', path: '/private/repository', title: 'internal title', severity: 'HIGH' };

test('prompt includes only selected fix facts and asks for verification', () => {
  const prompt = fixPrompt(finding);
  for (const fact of [finding.id, finding.package, finding.type, finding.installed, finding.fixed]) assert.ok(prompt.includes(fact));
  assert.match(prompt, /verify the resolved package version/);
  assert.ok(!prompt.includes(finding.path) && !prompt.includes(finding.title));
});

test('missing fixed version results in a stop instruction, not an upgrade', () => {
  const prompt = fixPrompt({ ...finding, fixed: ' ' });
  assert.match(prompt, /No fixed version was reported/);
  assert.match(prompt, /Do not change files, guess a version, or suggest alternatives/);
  assert.doesNotMatch(prompt, /make the smallest compatible change/);
});
