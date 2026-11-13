/** Completion alone does not establish dependency coverage. */
export function sourceAssessment(scan: { inventoryCoverage?: string | null; packageCount?: number | null; occurrences: number }) {
  if (scan.inventoryCoverage === 'complete') return 'Scanned';
  if ((scan.packageCount ?? 0) > 0 || scan.occurrences > 0) return 'Partially assessed';
  return 'Not assessed';
}

export function sourceEmptyMessage(analysis: {
  nodes: unknown[]; warnings: string[]; coverage: { inventory: string };
}) {
  if (analysis.coverage.inventory === 'complete') return {
    title: 'No known vulnerabilities found',
    description: 'The latest completed scan found no known vulnerabilities in the scanned dependencies.',
  };
  if (!analysis.nodes.length) return {
    title: 'Repository not assessed: no supported, resolved dependencies found.',
    description: 'The ecosystem or dependency format may be unsupported, or dependency versions could not be read. Supported inputs include npm/pnpm lockfiles and Python requirements.txt, Pipfile.lock, poetry.lock, uv.lock, and pylock.toml. This is not a clean scan. Review scan details for the specific limitations.',
  };
  return {
    title: 'No vulnerabilities found in the assessed packages; coverage is incomplete.',
    description: 'Some dependencies could not be assessed. Review scan details for limitations; this result does not establish that the repository is vulnerability-free.',
  };
}

export function sourceCoverageDetail(analysis: { warnings?: string[]; coverage: { inventory: string; inputs: string; graph: string } }) {
  if (analysis.coverage.inventory !== 'complete') return 'Partial coverage; some dependencies could not be assessed. Review scan details for limitations.';
  const unverified = new Set(analysis.warnings?.filter(w => w.startsWith('Dependency declaration not verified:')) ?? []).size;
  const otherWarnings = analysis.warnings?.some(w => !w.startsWith('Dependency declaration not verified:'));
  if (unverified && !otherWarnings && analysis.coverage.graph === 'complete') return `All resolved dependencies assessed; ${unverified} dependency ${unverified === 1 ? 'declaration could' : 'declarations could'} not be verified.`;
  if (analysis.coverage.inputs !== 'complete' || analysis.coverage.graph !== 'complete') return 'All resolved dependencies assessed; dependency declarations or paths could not be fully verified. Review scan details for limitations.';
  return 'All resolved dependencies assessed.';
}
