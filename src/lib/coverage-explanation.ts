import { sourceCoverageDetail } from './source-assessment';
import type { Dashboard } from './model';
// Only exact producer source URLs establish a repository association. They do not prove a commit/build relationship.
export function repositoryIdentity(value?: string) {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'github.com' && /^\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/.test(url.pathname) ? url.pathname.replace(/\/$/, '').replace(/\.git$/, '').toLowerCase() : null; } catch { return null; }
}
export function relatedContainers(repository: string, data: Dashboard) {
  const identity = repositoryIdentity(`https://github.com/${repository}`);
  return identity ? data.containers.filter(c => repositoryIdentity(c.sourceRepository) === identity).map(container => ({ container, target: data.targets.find(t => t.id === container.target_id) })) : [];
}
export function freshness(time: number | null, intervalHours: number, now = Date.now()) {
  return !time ? 'Not assessed' : now - time > intervalHours * 3600000 ? 'Outdated result; rescan recommended' : 'Latest completed scan';
}
export function repositoryCoverage(analysis?: { warnings?: string[]; nodes: unknown[]; findings: unknown[]; coverage: { inputs: string; inventory: string; graph: string } }) {
  if (!analysis) return 'Repository dependencies have not been assessed yet.';
  const partial = [analysis.coverage.inputs, analysis.coverage.inventory, analysis.coverage.graph].some(v => v !== 'complete');
  if (!analysis.nodes.length && partial) return 'Not assessed: no resolved repository dependencies were available.';
  return `${analysis.findings.length ? `${analysis.findings.length} findings` : 'No known vulnerabilities found'} in ${analysis.nodes.length} repository dependency instances. ${sourceCoverageDetail(analysis)}`;
}
