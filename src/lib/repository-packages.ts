import type { Analysis, Node, SourceFinding, Scope } from '../server/source/analysis';
import { sourcePackageType } from './source-inputs';

export type RepositoryPackage = {
  id: string; name: string; version: string; ecosystem: string;
  occurrences: Node[]; scopes: string[]; findings: SourceFinding[];
};

/** Propagate declaring scopes through the graph, including packages without findings. */
export function repositoryPackages(analysis: Analysis): RepositoryPackage[] {
  const labels: Record<Scope, string> = { runtime: 'Production', development: 'Development', optional: 'Optional', peer: 'Peer', unknown: 'Unknown' };
  const roots = new Set(analysis.roots.map(root => root.id));
  const children = new Map<string, string[]>();
  const scopes = new Map<string, Set<string>>();
  const queue: [string, string][] = [];
  for (const edge of analysis.edges) {
    const next = children.get(edge.from) ?? [];
    next.push(edge.to); children.set(edge.from, next);
    if (roots.has(edge.from)) queue.push([edge.to, labels[edge.scope]]);
  }
  for (let i = 0; i < queue.length; i++) {
    const [id, scope] = queue[i];
    const known = scopes.get(id) ?? new Set<string>();
    if (known.has(scope)) continue;
    known.add(scope); scopes.set(id, known);
    for (const child of children.get(id) ?? []) if (!roots.has(child)) queue.push([child, scope]);
  }
  const findings = new Map<string, SourceFinding[]>();
  for (const finding of analysis.findings) {
    const list = findings.get(finding.node) ?? [];
    list.push(finding); findings.set(finding.node, list);
  }
  const groups = new Map<string, RepositoryPackage>();
  for (const node of analysis.nodes) {
    const ecosystem = sourcePackageType(node.file);
    const id = JSON.stringify([ecosystem, node.name, node.version]);
    const row = groups.get(id) ?? { id, name: node.name, version: node.version, ecosystem, occurrences: [], scopes: [], findings: [] };
    row.occurrences.push(node);
    row.scopes = [...new Set([...row.scopes, ...(scopes.get(node.id) ?? ['Unknown'])])].sort();
    // A repeated advisory across lockfiles is one finding on the combined package.
    for (const finding of findings.get(node.id) ?? []) if (!row.findings.some(f => f.advisory === finding.advisory)) row.findings.push(finding);
    groups.set(id, row);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version) || a.ecosystem.localeCompare(b.ecosystem));
}
