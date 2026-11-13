import { Box, Code2, Server, CircleHelp } from 'lucide-react';
import { Tooltip } from './ui/tooltip';
import { isCve, safeUrl, type Advisory } from '../lib/advisory';
import { useState } from 'react';
import { detectionLabels, matchesDetection, matchesSource, sourceDetection, type Detection, type SourceEvidence } from '../lib/finding-evidence';
import type { Finding } from '../lib/model';
import { useResource } from '../lib/use-resource';
import { remediationGuidance } from '../lib/source-guidance';
import { pillClass } from './ui/pill';
/** One compact pill combines package identity with its detection sources. */
export function DetectionBadge({ detection, packageName }: { detection: Detection; packageName?: string }) {
  const labels: Record<Detection, string> = { container: 'Container', codebase: 'Codebase', both: 'Both', host: 'Host', unknown: 'Unknown' };
  const label = `${packageName ? packageName + ' · ' : ''}${detectionLabels[detection]}`;
  const explanation = detection === 'both' ? `${label}. Same advisory, package and version; commit linkage is unverified.` : label;
  return <Tooltip label={explanation}><span role="img" aria-label={label} tabIndex={0}
    className={`${pillClass} relative z-10 max-w-full min-w-0 whitespace-nowrap align-middle focus-visible:outline-2 focus-visible:outline-brand-ink`}>
    <span aria-hidden="true" className="inline-flex shrink-0 items-center gap-0.5">
      {(detection === 'container' || detection === 'both') && <Box size={12} />}
      {(detection === 'codebase' || detection === 'both') && <Code2 size={12} />}
      {detection === 'host' && <Server size={12} />}
      {detection === 'unknown' && <CircleHelp size={12} />}
    </span>
    <span aria-hidden="true" className="truncate">{packageName ?? labels[detection]}</span>
  </span></Tooltip>;
}
export function DetectionFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <select aria-label="Filter by detection source" value={value} onChange={e => onChange(e.target.value)} className="rounded-md border border-border bg-raised px-3 py-2 text-xs"><option value="all">All detection sources</option>{Object.entries(detectionLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>;
}
export function EmptyDetection() {
  return <p role="status" className="my-5 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No findings match this detection source.</p>;
}
export function EvidenceDetails({ evidence, showRemediation = true }: { evidence: SourceEvidence; showRemediation?: boolean }) {
  const s = evidence;
  return <section className="my-5 space-y-3 rounded-lg border border-border p-4 text-sm">
    <div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{s.repository}</h3><DetectionBadge detection={sourceDetection(s)} /></div>
    <p>Branch: {s.branch} · Commit: <code className="break-all">{s.commit}</code></p>
    <p>Source scan: {new Date(s.scannedAt).toLocaleString()} · {s.finding.package}@{s.finding.installed}</p>
    <p>Dependency file: <code>{s.file}</code></p>
    <p>Dependency contexts: {s.scopes.map(scope => scope === 'runtime' ? 'Production' : scope === 'development' ? 'Development' : scope).join(', ') || 'unknown'}</p>
    <h4 className="font-medium">Why this dependency is included</h4>
    {s.paths.map((path, i) => <p key={i} className="break-words">{path.join(' → ')}</p>)}
    {(!s.paths.length || s.truncated) && <p>Dependency paths are incomplete or unavailable.</p>}
    <p>Coverage: inputs {s.coverage.inputs}, inventory {s.coverage.inventory}, dependency graph {s.coverage.graph}.</p>
    {s.warnings.length > 0 && <details><summary>Scan limitations</summary>{s.warnings.map((warning, i) => <p key={i}>{warning}</p>)}</details>}
    {showRemediation && <><h4 className="font-medium">What to update</h4>
    {(s.edits.length ? s.edits : [{ manifest: 'Unknown manifest', dependency: undefined, direct: false }]).map((edit, i) => {
      const guidance = remediationGuidance(s.manager, edit.dependency, s.finding.package, s.finding.fixed, edit.direct);
      return <div key={i} className="space-y-2"><p>{edit.manifest} · {edit.dependency ?? 'Unknown dependency'} · {edit.direct ? 'Direct dependency' : 'Introducing dependency'}</p><p>Fixed version: {guidance.fixed}</p><p>{guidance.summary}</p><pre className="overflow-auto rounded bg-sunken p-3">{guidance.commands.join('\n')}</pre><p className="text-xs text-muted-foreground">{guidance.note}</p></div>;
    })}
    <p>Regenerate the lockfile, test, commit, and rescan the repository to check the fix.</p></>}
  </section>;
}
export function FindingEvidence({ finding, targetId }: { finding: Finding; targetId: string }) {
  const data = useResource<SourceEvidence[]>(`finding-evidence?issue=${encodeURIComponent(finding.id)}`, 0, 30000);
  const [filter, setFilter] = useState('all');
  const sources = (data?.data ?? []).filter(s => matchesSource(finding, s) && s.runtime.some(r => r.targetId === targetId));
  const visibleSources = sources.filter(s => matchesDetection(filter, sourceDetection(s)));
  const detection = finding.detection ?? (targetId === 'host' ? 'host' : 'container');
  const showBadge = matchesDetection(filter, detection);
  return <section className="my-8 border-t border-border pt-6" aria-label="Detection evidence"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg">Detection evidence</h2><DetectionFilter value={filter} onChange={setFilter} /></div>
    <div className="my-3">{showBadge && <DetectionBadge detection={detection} />}</div>
    {data?.data && !showBadge && !visibleSources.length && <EmptyDetection />}
    {!data ? <p>Loading codebase evidence…</p> : data.error ? <p role="status">Codebase evidence unavailable: {data.error}</p> : !sources.length ? <p className="text-sm text-muted-foreground">No matching codebase observation is available for this resource. Codebase coverage is unknown; this does not mean the dependency is absent from the source.</p> : visibleSources.map((s, i) => <EvidenceDetails key={s.scanId + ':' + i} evidence={s} />)}
  </section>;
}

export function SourceAdvisory({ issue }: { issue: string }) {
  const advisory = useResource<Advisory>(isCve(issue) ? `advisory?id=${encodeURIComponent(issue)}` : '', 0);
  const record = advisory?.data;
  return <section className="my-6 space-y-3 text-sm" aria-label="Advisory context">
    <p>The codebase scan matched a locked dependency version to this advisory. Exploitability depends on how the application uses that dependency.</p>
    {record?.status === 'available' && <p className="whitespace-pre-line">{record.description}</p>}
    {record?.status === 'rejected' && <p role="status">This CVE has been rejected. Review the published record before acting.</p>}
    {advisory?.error && <p role="status">The external advisory is unavailable. Source scan evidence is still shown below.</p>}
    {isCve(issue) && <a className="underline" href={`https://www.cve.org/CVERecord?id=${encodeURIComponent(issue)}`} target="_blank" rel="noreferrer">Read the CVE record</a>}
    {record?.status === 'available' && record.references.filter(safeUrl).slice(0, 5).map(url => <p key={url}><a className="break-all underline" href={url} target="_blank" rel="noreferrer">{url}</a></p>)}
  </section>;
}
