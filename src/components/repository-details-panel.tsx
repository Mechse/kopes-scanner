import { Download, GitBranch, RefreshCw } from 'lucide-react';
import type { Binding } from './repositories';
import type { Scan } from './project-sources';
import { ResourcePanelHeader, ScanPanelSummary } from './resource-panel-layout';
import { Button } from './ui/button';
import { pillClass } from './ui/pill';
import { severities } from '../lib/model';
import { sourceAssessment, sourceCoverageDetail } from '../lib/source-assessment';
import { severityColors } from './severity-colors';

const noticeClass = 'mt-3 mb-5 rounded-sm border border-border bg-sunken px-4 py-3 text-[13px] wrap-anywhere';
type Props = { binding: Binding; analysis?: Scan['result']; submitting: boolean };
function scanStatus({ binding, submitting }: Props) {
  const job = binding.jobs[0], scan = binding.scans[0];
  if (job?.state === 'queued') return { state: 'queued', label: 'Queued' };
  if (submitting || job?.state === 'running') return { state: 'scanning', label: 'Scanning' };
  if (binding.error || job?.state === 'failed') return { state: 'error', label: 'Scan failed' };
  if (job?.state === 'cancelled') return { state: 'unassessed', label: 'Cancelled' };
  if (!scan) return { state: 'unassessed', label: 'Not assessed' };
  return sourceAssessment(scan) === 'Scanned' ? { state: 'ready', label: 'Scan complete' } : { state: 'unassessed', label: sourceAssessment(scan) };
}

export function RepositoryDetailsPanel(props: Props) {
  const { binding, analysis } = props;
  const scan = binding.scans[0], status = scanStatus(props);
  const highest = severities.find(level => analysis?.findings.some(f => (severities.find(s => s === f.severity) ?? 'UNKNOWN') === level));
  const count = analysis?.findings.length ?? scan?.occurrences;
  const packages = analysis?.nodes.length ?? scan?.packageCount;
  const fields = [
    ['Repository', binding.repository], ['Default branch', binding.branch],
    ['Package manager', analysis?.manager === 'unknown' || !analysis ? 'Not identified yet' : analysis.manager],
  ];
  return <>
    <ResourcePanelHeader name={binding.repository} icon={<GitBranch size={20} aria-hidden="true"/>} badges={<>
      <span className={pillClass}>Repository</span><span className={pillClass}><span aria-hidden="true" className={`size-1 shrink-0 rounded-full bg-current ${status.state === 'error' ? 'text-critical' : ''}`}/>{status.label}</span>
    </>}/>
    <section aria-label="Resource summary" className="mt-5 rounded-xl border border-border p-4 sm:p-5">
      <dl className="grid min-w-0 gap-4">
        {fields.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-sm leading-6 wrap-anywhere">{value}</dd></div>)}
        <div className="min-w-0"><dt className="text-xs text-muted-foreground">Last successful scan</dt><dd className="mt-1 text-sm leading-6">{scan ? <time dateTime={new Date(scan.observed_at).toISOString()}>{new Date(scan.observed_at).toLocaleString()}</time> : 'No completed scans yet'}</dd></div>
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <span className={`${pillClass} w-fit`}><span aria-hidden="true" className={`size-1 shrink-0 rounded-full bg-current ${highest ? severityColors[highest] : ''}`}/>{highest ? highest[0] + highest.slice(1).toLowerCase() : !analysis && count ? 'Findings detected' : scan && sourceAssessment(scan) === 'Scanned' ? 'No findings' : 'Not assessed'}</span>
        {count !== undefined && <span className={pillClass}>{count} {count === 1 ? 'finding' : 'findings'}</span>}
        {analysis && <span className={pillClass}>{analysis.findings.filter(f => f.fixed).length} with fixes</span>}
        {packages != null && <span className={pillClass}>{packages} dependency {packages === 1 ? 'instance' : 'instances'}</span>}
        {scan && sourceAssessment(scan) !== 'Scanned' && <span className={pillClass}>{sourceAssessment(scan)}</span>}
      </div>
    </section>
  </>;
}

export function RepositoryScanPanel(props: Props & { scanningAvailable: boolean; onScan: () => void; error?: string }) {
  const { binding, analysis, scanningAvailable, onScan, error } = props;
  const scan = binding.scans[0], status = scanStatus(props);
  const busy = status.state === 'queued' || status.state === 'scanning';
  return <>
    <ScanPanelSummary status={status.state} label={status.label} description={<>
      {analysis && analysis.manager !== 'unknown' ? analysis.manager : 'Package manager unidentified'} · {binding.branch}<br/>
      Last successful scan: {scan ? new Date(scan.observed_at).toLocaleString() : 'Not scanned yet'}
    </>} actions={<>
      <Button variant="outline" size="sm" disabled={busy || !scanningAvailable} aria-busy={busy || undefined} onClick={onScan}><RefreshCw className={busy ? 'scan-action-icon' : ''}/>{busy ? status.label : 'Scan now'}</Button>
      {scan && <Button asChild variant="ghost" size="sm"><a href={`/api/data/repositories?view=export&scanId=${encodeURIComponent(scan.id)}`}><Download/>Source SBOM</a></Button>}
    </>}/>
    {error && <p role="alert" className={`${noticeClass} text-critical`}>{error}</p>}
    {!scanningAvailable && <p role="status" className={noticeClass}>Repository scanning is currently unavailable. Saved results are still available.</p>}
    {(busy || status.state === 'error' || status.label === 'Cancelled') && scan && <p role="status" className={noticeClass}>Showing the last completed scan.</p>}
    {!scan ? <p role="status" className="my-6 text-sm text-muted-foreground">No completed source scan yet. Scan details will appear here when a scan completes.</p> : <>
      <section aria-label="Scan snapshot" className={noticeClass}>
        <h2 className="text-[13px] font-medium">Scan snapshot</h2>
        <dl className="mt-3 grid gap-3">
          <div><dt className="text-xs text-muted-foreground">Commit</dt><dd className="mt-1 font-mono text-xs leading-6 wrap-anywhere">{scan.commit_sha}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Analyzer</dt><dd className="mt-1 text-sm wrap-anywhere">{scan.analyzer}</dd></div>
        </dl>
      </section>
      {analysis ? <section aria-label="Coverage" className={noticeClass}>
        <h2 className="text-[13px] font-medium">Repository dependency coverage</h2>
        <p className="mt-2">{analysis.nodes.length} dependency instances. Production and development dependencies are included. Repository results do not establish which versions are deployed.</p>
        <p className="mt-2">Inputs: {analysis.coverage.inputs} · Inventory: {analysis.coverage.inventory} · Dependency graph: {analysis.coverage.graph}</p>
        {(analysis.coverage.inputs !== 'complete' || analysis.coverage.inventory !== 'complete' || analysis.coverage.graph !== 'complete') && <p role="status" className="mt-2">{sourceCoverageDetail(analysis)}</p>}
        {!!analysis.warnings.length && <details className="mt-3"><summary className="cursor-pointer font-medium">Scan limitations ({analysis.warnings.length})</summary>{analysis.warnings.map((warning, i) => <p key={i} className="mt-2">{warning}</p>)}</details>}
      </section> : !error && <p role="status" className="my-6 text-sm text-muted-foreground">Loading scan coverage…</p>}
    </>}
  </>;
}
