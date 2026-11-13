import { Info } from 'lucide-react';
import { CoverageChart } from './coverage-chart';
import { Tooltip } from './ui/tooltip';
import type { CoverageArea } from '../lib/assessment-coverage';
import { severities } from '../lib/model';

const colors = ['var(--sev-critical)', 'var(--sev-high)', 'var(--sev-medium)', 'var(--sev-low)', 'var(--sev-info)'];

/** Scan-wide findings and assessment coverage. */
export function FindingsSummary({ findings, coverageAreas, footer, scannedAt }: {
  findings?: { severity: string }[];
  coverageAreas: CoverageArea[];
  footer: string;
  scannedAt?: number;
}) {
  const counts = severities.map(severity => findings?.filter(f => (severities.includes(f.severity as typeof severities[number]) ? f.severity : 'UNKNOWN') === severity).length ?? 0);
  return <section aria-label="Scan coverage explained" className="@container my-4 rounded border border-border bg-sunken text-sm">
    <div className="grid gap-5 p-5 @3xl:grid-cols-[1.1fr_1fr] @3xl:gap-6">
      <div className="min-w-0" aria-label="Findings by severity">
        <p className="mb-4 flex items-baseline gap-2"><span className="text-2xl font-medium tabular-nums tracking-tight">{findings ? findings.length.toLocaleString() : '—'}</span><span className="text-muted-foreground">findings</span></p>
        <div aria-hidden="true" className="mb-3 flex h-2 overflow-hidden rounded-sm bg-border">
          {counts.map((count, i) => count > 0 && <span key={severities[i]} style={{ width: `${count / (findings?.length || 1) * 100}%`, background: colors[i] }}/>) }
        </div>
        <dl className="grid grid-cols-3 gap-x-3 gap-y-3 @sm:grid-cols-5">
          {counts.map((count, i) => <div key={severities[i]} className="min-w-0">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ background: colors[i] }}/>{severities[i][0] + severities[i].slice(1).toLowerCase()}</dt>
            <dd className="mt-1 text-lg font-medium tabular-nums wrap-anywhere">{findings ? count.toLocaleString() : '—'}</dd>
          </div>)}
        </dl>
        <Tooltip label={footer}>
          <button type="button" aria-label={`Scan details: ${footer}`} className="mt-4 inline-flex max-w-full items-center gap-1.5 text-left text-xs text-muted-foreground hover:text-foreground">
            <span>{scannedAt ? <>Scanned <time dateTime={new Date(scannedAt).toISOString()}>{new Date(scannedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></> : 'No completed scan'}</span>
            <Info aria-hidden="true" className="size-3.5 shrink-0"/>
          </button>
        </Tooltip>
      </div>
      <div className="min-w-0 border-t border-border pt-5 @3xl:border-t-0 @3xl:border-l @3xl:pt-0 @3xl:pl-6">
        <CoverageChart areas={coverageAreas}/>
      </div>
    </div>
  </section>;
}
