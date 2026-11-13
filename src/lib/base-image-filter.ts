import { originOf } from './finding-origin';
import { severities, type Finding } from './model';
import { unifiedFindings } from './unified-findings';

export const parseBaseImage = (value: unknown) => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value) ? value : undefined;
export function matchesBaseImage(finding: Finding, digest?: string) {
  if (!digest) return true;
  const origin = originOf(finding);
  return origin.category === 'Base image' && origin.baseDigest === digest;
}
export function baseImageOptions(findings: Finding[]) {
  const options = new Map<string, string>();
  for (const finding of findings) {
    const origin = originOf(finding);
    const digest = parseBaseImage(origin.baseDigest);
    if (origin.category !== 'Base image' || !digest) continue;
    const name = origin.baseName?.split('@')[0];
    options.set(digest, name ? `${name}@${digest}` : digest);
  }
  return [...options].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

/** Filter occurrences before grouping so an application copy cannot mask a base copy. */
export function repositoryBaseFindings(report: import('./model').Report, targetId: string, filters: import('./repository-findings').RepositoryFilters) {
  if (!filters.baseImage) return [];
  return unifiedFindings(report, [], targetId, finding => matchesBaseImage(finding, filters.baseImage))
    .filter(({ finding }) => (!filters.severity || finding.severity === filters.severity)
      && (!filters.fixable || !!finding.fixed)
      && (!filters.scope)
      && `${finding.id} ${finding.package} ${finding.title} ${finding.path}`.toLowerCase().includes((filters.match ?? '').toLowerCase()))
    .sort((a, b) => severities.indexOf(a.finding.severity) - severities.indexOf(b.finding.severity));
}
