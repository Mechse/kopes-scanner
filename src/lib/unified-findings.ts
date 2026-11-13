import { matchesSource, type SourceEvidence } from './finding-evidence';
import { severities, type Finding, type Report } from './model';
export type UnifiedFinding = { finding: Finding; index: number; sourceOnly: boolean; runtimeIndices: number[]; sources: SourceEvidence[] };
const ecosystem = (type: string) => ['npm', 'node-pkg', 'pnpm', 'yarn'].includes(type) ? 'npm' : type;
/** Merge advisory/package/version observations, retaining every dependency path and runtime occurrence. */
export function unifiedFindings(report: Report | null, sources: SourceEvidence[], targetId: string, include: (finding: Finding) => boolean = () => true): UnifiedFinding[] {
  const rows = new Map<string, UnifiedFinding>();
  const key = (f: Finding, id = f.id) => JSON.stringify([id, ecosystem(f.type), f.package, f.installed]);
  for (const [index, f] of (report?.findings ?? []).entries()) {
    if (!include(f)) continue;
    const matched = !report?.coverage ? sources.filter(s => matchesSource(f, s) && s.runtime.some(r => r.targetId === targetId && r.matched)) : [];
    const id = key(f, matched[0]?.finding.id);
    const detection = report?.coverage ? 'unknown' : targetId === 'host' ? 'host' : matched.length ? 'both' : 'container';
    const existing = rows.get(id);
    if (existing) existing.runtimeIndices.push(index);
    else rows.set(id, { finding: { ...f, detection }, index, sourceOnly: false, runtimeIndices: [index], sources: matched });
  }
  for (const s of sources) {
    const matched = [...rows.values()].find(row => !row.sourceOnly && row.sources.includes(s));
    if (matched) continue;
    const id = 'source:' + key(s.finding);
    const existing = rows.get(id);
    if (existing) {
      existing.sources.push(s);
      if (severities.indexOf(s.finding.severity) < severities.indexOf(existing.finding.severity)) existing.finding.severity = s.finding.severity;
    } else rows.set(id, { finding: { ...s.finding, detection: 'codebase' }, index: -rows.size - 1, sourceOnly: true, runtimeIndices: [], sources: [s] });
  }
  return [...rows.values()];
}
