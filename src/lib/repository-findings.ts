import { parseBaseImage } from './base-image-filter';
import { sourcePackageType } from './source-inputs';
import { dependencyScopes } from './dependency-scope';
import { severities, type Finding, type Severity } from './model';
import type { Analysis } from '../server/source/analysis';

export type RepositoryFilters = { match?: string; severity?: Severity; fixable?: boolean; scope?: string; baseImage?: string };
export function repositoryFilters(input: Record<string, unknown>): RepositoryFilters {
  return {
    baseImage: parseBaseImage(input.baseImage),
    match: typeof input.match === 'string' ? input.match : undefined,
    severity: severities.find(value => value === input.severity),
    fixable: input.fixable === true || undefined,
    scope: ['Production', 'Development', 'Optional', 'Peer', 'Unknown'].find(value => value === input.scope),
  };
}

/** Keep detail navigation in the same severity-grouped order as the findings table. */
export function repositoryFindings(analysis: Analysis & { paths: Record<string, { paths: string[][]; truncated: boolean }> }, filters: RepositoryFilters) {
  if (filters.baseImage) return []; // Source dependency scans cannot establish base-image origin.
  return analysis.findings.map((f, index) => ({
    index, sourceOnly: true, sourceNode: f.node, aliases: f.aliases,
    finding: { ...(f.cvss && { cvss: f.cvss }), id: f.advisory, package: f.package, installed: f.version, fixed: f.fixed,
      severity: severities.find(value => value === f.severity) ?? 'UNKNOWN', title: f.title,
      type: sourcePackageType(f.file), path: f.file, detection: 'codebase' } satisfies Finding,
  })).filter(({ finding: f, index }) => {
    const raw = analysis.findings[index];
    return (!filters.severity || f.severity === filters.severity) && (!filters.fixable || !!f.fixed)
      && (!filters.scope || dependencyScopes(analysis, analysis.paths[raw.node]).includes(filters.scope))
      && [f.id, f.package, f.title, f.path, ...raw.aliases].some(value => value.toLowerCase().includes((filters.match ?? '').toLowerCase()));
  }).sort((a, b) => severities.indexOf(a.finding.severity) - severities.indexOf(b.finding.severity));
}
