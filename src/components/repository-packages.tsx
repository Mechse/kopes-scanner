import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import type { RepositoryPackage } from '../lib/repository-packages';
import { CoverageChart } from './coverage-chart';
import { repositoryCoverageAreas } from '../lib/assessment-coverage';
import type { Scan } from './project-sources';

export function PackagesSummary({ packages, analysis, scannedAt }: { packages?: RepositoryPackage[]; analysis?: Scan['result']; scannedAt?: number }) {
  const vulnerable = packages?.filter(p => p.findings.length).length ?? 0;
  return <section aria-label="Package summary" className="@container my-4 rounded border border-border bg-sunken text-sm">
    <div className="grid gap-5 p-5 @3xl:grid-cols-[1.1fr_1fr] @3xl:gap-6">
      <div>
        <dl className="grid grid-cols-3 gap-4">
          {([['Total packages', packages?.length], ['Vulnerable packages', packages ? vulnerable : undefined], ['No findings', packages ? packages.length - vulnerable : undefined]] as const).map(([label, count]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-2 text-2xl font-medium tabular-nums">{count?.toLocaleString() ?? '—'}</dd></div>)}
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">Unique package versions across scanned files.</p>
        <p className="mt-2 text-xs text-muted-foreground">{scannedAt ? <>Scanned <time dateTime={new Date(scannedAt).toISOString()}>{new Date(scannedAt).toLocaleString()}</time></> : 'No completed scan'}</p>
      </div>
      <div className="border-t border-border pt-5 @3xl:border-t-0 @3xl:border-l @3xl:pt-0 @3xl:pl-6"><CoverageChart areas={repositoryCoverageAreas(analysis)}/></div>
    </div>
  </section>;
}

function PackageSection({ label, packages, repository, vulnerable }: {
  label: string; packages: RepositoryPackage[]; repository: string; vulnerable: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [limit, setLimit] = useState(50);
  return <tbody>
    <tr><th colSpan={2} scope="rowgroup" className="finding-section">
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        <ChevronDown size={10} aria-hidden="true"/>
        <i aria-hidden="true" className={`finding-ring ${packages.some(p => p.findings.some(f => !!f.fixed.trim())) ? 'filled' : ''} ${vulnerable ? 'text-high' : 'text-muted-foreground'}`}/>
        {label} <span className="font-normal text-muted-foreground">{packages.length}</span>
      </button>
    </th></tr>
    {expanded && packages.slice(0, limit).map(p => {
      const hasFix = p.findings.some(f => !!f.fixed.trim());
      const fixLabel = hasFix ? 'Fix available for at least one finding' : p.findings.length ? 'No known fix available' : 'No findings';
      return <tr key={p.id} className="finding-row">
      <td><Link to="/repositories/$repository/packages/$package" params={{ repository, package: p.id }} className="finding-summary package-summary">
        <span className="finding-mobile-package">{p.name}</span>
        <span className="finding-mobile-status">{p.scopes.join(', ')} · {p.findings.length ? `${p.findings.length} findings` : 'No findings'}{p.findings.length > 0 && ` · ${fixLabel}`}</span>
        <span className="finding-score" title={`${p.findings.length} unique advisories`} aria-label={`${p.findings.length} findings`}>{p.findings.length}</span>
        <span className="finding-id" title={p.version}>{p.version}</span>
        <i role="img" title={fixLabel} aria-label={fixLabel} className={`finding-ring relative z-10 ${hasFix ? 'filled' : ''} ${vulnerable ? 'text-high' : 'text-muted-foreground'}`}/>
        <strong title={p.name}>{p.name}</strong>
      </Link></td>
      <td><span className="finding-chip" title={p.scopes.join(', ')}>{p.ecosystem} · {p.scopes.join(', ')}</span></td>
    </tr>; })}
    {expanded && packages.length > limit && <tr><td colSpan={2}><button className="cursor-pointer py-1.5 text-brand-ink mobile:min-h-11" type="button" onClick={() => setLimit(limit + 50)}>Show {Math.min(50, packages.length - limit)} more packages</button></td></tr>}
  </tbody>;
}

export function RepositoryPackages({ packages, query, repository }: { packages: RepositoryPackage[]; query: string; repository: string }) {
  const filtered = packages.filter(p => [p.name, p.version, p.ecosystem, ...p.scopes, ...p.occurrences.map(n => n.file)].some(value => value.toLowerCase().includes(query.trim().toLowerCase())));
  return <div className="-mx-4 findings-list">
    {!filtered.length && <p role="status" className="px-4 py-12 text-sm text-muted-foreground">{packages.length ? 'No packages match your search.' : 'No packages detected in this scan.'}</p>}
    <table>
      <caption className="sr-only">Scanned packages grouped by findings</caption>
      <thead className="sr-only"><tr><th>Finding count, version and package</th><th>Ecosystem and scope</th></tr></thead>
      <PackageSection label="Vulnerable Packages" packages={filtered.filter(p => p.findings.length > 0)} repository={repository} vulnerable/>
      <PackageSection label="No Findings" packages={filtered.filter(p => !p.findings.length)} repository={repository} vulnerable={false}/>
    </table>
  </div>;
}
