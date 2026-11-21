import { SelectField } from './ui/select-field';
import { SelectItem } from './ui/select';
import { sourceEmptyMessage } from '../lib/source-assessment';
import { useState } from 'react';
import { useResource } from '../lib/use-resource';
import { Button } from './ui/button';
import { ScoreIndicator } from './findings-table';
import { sourceAssessment } from '../lib/source-assessment';
import { dependencyScopes } from '../lib/dependency-scope';
import { editableDependencies, remediationGuidance } from '../lib/source-guidance';
import type { Analysis } from '../server/source/analysis';
export type Scan = { id: string; binding_id: string; observed_at: number; commit_sha: string; analyzer: string; occurrences: number; inventoryCoverage?: string | null; packageCount?: number | null; result: Analysis & { paths: Record<string, { paths: string[][]; truncated: boolean }> } };
const field = 'rounded border border-border bg-background px-3 py-2 text-sm';
export function SourceScan({ scan, projectId = '', endpoint = 'repositories', defaultOpen = false }: { scan: Scan; projectId?: string; endpoint?: string; defaultOpen?: boolean; sourceFilter?: string }) {
  const [open, setOpen] = useState(defaultOpen), [limit, setLimit] = useState(50);
  const [query, setQuery] = useState(''), [scope, setScope] = useState('All'), [severity, setSeverity] = useState('All');
  const full = useResource<{ result: Scan['result'] }>(open ? `${endpoint}?view=scan&projectId=${encodeURIComponent(projectId)}&scanId=${encodeURIComponent(scan.id)}` : '', 0);
  const a = full?.data?.result;
  const rows = a?.findings.map(f => ({ f, scopes: dependencyScopes(a, a.paths[f.node]) })).filter(({ f, scopes }) =>
    (scope === 'All' || scopes.includes(scope)) && (severity === 'All' || f.severity === severity) &&
    [f.advisory, ...f.aliases, f.package, f.title, f.file].some(v => v.toLowerCase().includes(query.toLowerCase()))) ?? [];
  return <details open={open} className="border-t border-border pt-4 text-sm" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary className="cursor-pointer">{new Date(scan.observed_at).toLocaleString()} · Commit {scan.commit_sha.slice(0, 12)} · {sourceAssessment(scan)}</summary>
    {!a && <p role="status" className="py-4">{full?.error ?? 'Loading vulnerabilities…'}</p>}
    {a && <div className="space-y-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2>Vulnerabilities <span className="text-muted-foreground">({a.findings.length})</span></h2><a className="underline" href={`/api/data/${endpoint}?view=export&projectId=${encodeURIComponent(projectId)}&scanId=${encodeURIComponent(scan.id)}`}>Export SBOM</a></div>
      <p className="text-muted-foreground">{new Set(a.findings.map(f => f.advisory)).size} unique advisories · {a.nodes.length} dependency instances · Production and development dependencies included.</p>
      {(a.coverage.inputs !== 'complete' || a.coverage.inventory !== 'complete' || a.coverage.graph !== 'complete') && <p role="status">Coverage is incomplete. Missing findings do not establish that the repository is vulnerability-free.</p>}
      {!!a.warnings.length && <details><summary>Scan limitations ({a.warnings.length})</summary>{a.warnings.map((w, i) => <p key={i} className="py-1 text-muted-foreground">{w}</p>)}</details>}
      <div className="flex flex-wrap gap-3"><input aria-label="Search vulnerabilities" placeholder="Search advisories or packages" className={`${field} min-w-0 basis-full sm:basis-auto sm:flex-1`} value={query} onChange={e => { setQuery(e.target.value); setLimit(50); }}/>
        <SelectField aria-label="Dependency scope" value={scope} onValueChange={value => { setScope(value); setLimit(50); }}>{['All', 'Production', 'Development', 'Optional', 'Peer', 'Unknown'].map(s => <SelectItem key={s} value={s}>{s === 'All' ? 'All scopes' : s}</SelectItem>)}</SelectField>
        <SelectField aria-label="Severity" value={severity} onValueChange={value => { setSeverity(value); setLimit(50); }}>{['All', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'].map(s => <SelectItem key={s} value={s}>{s === 'All' ? 'All severities' : s}</SelectItem>)}</SelectField>
      </div>
      {!rows.length ? <p role="status">{a.findings.length ? 'No vulnerabilities match these filters.' : sourceEmptyMessage(a).title}{!a.findings.length && <span className="mt-2 block text-muted-foreground">{sourceEmptyMessage(a).description}</span>}</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border">{['Severity', 'CVSS', 'Advisory / package', 'Installed', 'Fixed', 'Scope'].map(h => <th className="p-3 font-medium" key={h}>{h}</th>)}</tr></thead><tbody>{rows.slice(0, limit).map(({ f, scopes }, i) => <tr key={i} className="border-b border-border align-top"><td className="p-3">{f.severity}</td><td className="p-3"><ScoreIndicator cvss={f.cvss} /></td><td className="p-3"><details><summary className="cursor-pointer font-medium">{f.advisory}<span className="block text-muted-foreground">{f.package}</span></summary><div className="mt-3 space-y-2 max-w-xl wrap-anywhere"><p>{f.title}</p><p>{f.file}</p>{f.aliases.length > 0 && <p>Aliases: {f.aliases.join(', ')}</p>}{(a.paths[f.node]?.paths ?? []).map((path, n) => <p key={n}>{path.map(id => a.nodes.find(x => x.id === id)?.name ?? a.roots.find(x => x.id === id)?.manifest ?? id).join(' → ')}</p>)}{(!a.paths[f.node]?.paths.length || a.paths[f.node]?.truncated) && <p>Dependency paths are incomplete or unavailable.</p>}{editableDependencies(a, a.paths[f.node]?.paths ?? []).map((target, n) => <p key={n}>{target.manifest}: {remediationGuidance(a.manager, target.dependency, f.package, f.fixed, target.direct).summary}</p>)}</div></details></td><td className="p-3 font-mono">{f.version}</td><td className="p-3">{f.fixed || 'Not available'}</td><td className="p-3">{scopes.join(', ')}</td></tr>)}</tbody></table></div>}
      {rows.length > limit && <Button variant="outline" onClick={() => setLimit(n => n + 50)}>Show more ({rows.length - limit} remaining)</Button>}
    </div>}
  </details>;
}
