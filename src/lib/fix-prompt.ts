import type { Finding } from './model';

export function fixPrompt({ id, package: name, type, installed, fixed }: Finding) {
  const facts = `Advisory: ${id}\nPackage: ${name}\nEcosystem: ${type || 'Not reported'}\nDetected version: ${installed || 'Not reported'}`;
  if (!fixed.trim()) return `${facts}\n\nNo fixed version was reported by the scanner. Report that fact and stop. Do not change files, guess a version, or suggest alternatives.`;
  return `${facts}\nScanner-reported fixed version(s): ${fixed}\n\nConfirm this package and version are affected in the current project. If confirmed, make the smallest compatible change that resolves this finding using a reported fix for the applicable release branch. If applicability is unclear, stop rather than guess. Run the relevant tests and verify the resolved package version. Rescan if available; report what changed and what you could not verify.`;
}
