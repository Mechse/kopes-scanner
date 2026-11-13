import type { Analysis } from '../server/source/analysis';
/** Scope follows the declaring workspace, not a transitive package's own dependencies. */
export function dependencyScopes(a: Analysis, paths: { paths: string[][]; truncated: boolean } | undefined): string[] {
  const scopes = new Set<string>();
  for (const path of paths?.paths ?? []) {
    const root = path.findIndex(id => a.roots.some(r => r.id === id));
    if (root < 0 || !path[root + 1]) continue;
    for (const edge of a.edges.filter(e => e.from === path[root] && e.to === path[root + 1])) {
      scopes.add(edge.scope === 'runtime' ? 'Production' : edge.scope === 'development' ? 'Development' : edge.scope === 'optional' ? 'Optional' : edge.scope === 'peer' ? 'Peer' : 'Unknown');
    }
  }
  if (!scopes.size || paths?.truncated) scopes.add('Unknown');
  return [...scopes].sort();
}
