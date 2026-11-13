import { useMemo } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { RepositoryWorkspace, useRepositories } from '../components/repositories';
import { repositoryPackages } from '../lib/repository-packages';
import { repositoryFindings } from '../lib/repository-findings';
import { useResource } from '../lib/use-resource';
import { sourceCoverageDetail } from '../lib/source-assessment';
import type { Scan } from '../components/project-sources';
import { Button } from '../components/ui/button';
import { LoadingStatus } from '../components/ui/loading';
import { FindingsTable } from '../components/findings-table';

export const Route = createFileRoute('/repositories_/$repository_/packages/$package')({
  component: () => <RepositoryWorkspace><PackagePage/></RepositoryWorkspace>,
});

function PackagePage() {
  const { repository, package: packageId } = Route.useParams();
  const repos = useRepositories();
  const binding = repos.data?.bindings.find(b => b.id === repository);
  const scan = binding?.scans[0];
  const full = useResource<{ result: Scan['result'] }>(scan ? `repositories?view=scan&scanId=${encodeURIComponent(scan.id)}` : '', 0);
  const analysis = full?.data?.result;
  const pkg = useMemo(() => analysis ? repositoryPackages(analysis).find(p => p.id === packageId) : undefined, [analysis, packageId]);
  const error = repos.error || full?.error;
  const loading = !error && (!repos.data || (!!scan && !analysis));
  const findings = analysis && pkg ? repositoryFindings(analysis, {}).filter(row => pkg.findings.some(f => f.node === row.sourceNode && f.advisory === row.finding.id)) : [];
  return <main id="main" className="min-w-0 bg-raised px-4 pb-8 desktop:rounded-[10px] desktop:border desktop:border-border desktop:pb-12 desktop:shadow-sm desktop:dark:shadow-black/30">
    <nav aria-label="Breadcrumb" className="-mx-4 flex min-h-[55px] flex-wrap items-center gap-2 border-b border-border px-4 py-3 text-xs">
      <Link to="/repositories" className="text-muted-foreground hover:text-brand-ink">Repositories</Link><span aria-hidden="true">/</span>
      <Link to="/repositories/$repository" params={{ repository }} search={{ view: 'packages' }} className="text-muted-foreground hover:text-brand-ink">{binding?.repository ?? 'Repository'}</Link><span aria-hidden="true">/</span>
      <Link to="/repositories/$repository" params={{ repository }} search={{ view: 'packages' }} className="text-muted-foreground hover:text-brand-ink">Packages</Link><span aria-hidden="true">/</span>
      <span aria-current="page" className="wrap-anywhere">{pkg?.name ?? 'Package'}</span>
    </nav>
    <nav aria-label="Package navigation" className="-mx-4 border-b border-border px-4 py-2"><Button asChild size="sm" variant="ghost"><Link to="/repositories/$repository" params={{ repository }} search={{ view: 'packages' }}><ArrowLeft aria-hidden="true"/>Back to packages</Link></Button></nav>
    {error ? <p role="alert" className="py-8 text-critical">{error}</p> : loading ? <LoadingStatus label="Loading package details…" className="py-12"/> : !pkg ? <div role="status" className="py-12"><h1>Package unavailable</h1><p className="mt-2 text-muted-foreground">This package is not available in this repository’s latest scan. Return to packages to view current results.</p></div> : <>
      <header className="py-6"><p className="mb-2 text-xs text-muted-foreground">{pkg.ecosystem}</p><h1 className="text-2xl font-medium wrap-anywhere">{pkg.name}</h1><p className="mt-2 font-mono text-muted-foreground wrap-anywhere">{pkg.version}</p></header>
      <dl className="grid grid-cols-2 gap-5 rounded border border-border bg-sunken p-5 text-sm desktop:grid-cols-4">
        {([['Findings', pkg.findings.length], ['Dependency scope', pkg.scopes.join(', ')], ['Occurrences', pkg.occurrences.length], ['Scanned', scan ? new Date(scan.observed_at).toLocaleString() : '—']] as const).map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 wrap-anywhere">{value}</dd></div>)}
      </dl>
      {analysis && (analysis.coverage.inputs !== 'complete' || analysis.coverage.inventory !== 'complete' || analysis.coverage.graph !== 'complete') && <p role="status" className="my-4 text-sm text-muted-foreground">{sourceCoverageDetail(analysis)}</p>}
      <section aria-labelledby="package-locations" className="py-6"><h2 id="package-locations" className="mb-3 font-medium">Scanned locations</h2><ul className="divide-y divide-border text-sm">{pkg.occurrences.map(n => <li key={n.id} className="py-3 wrap-anywhere"><code>{n.file}</code>{n.location && <p className="mt-1 text-xs text-muted-foreground">{n.location}</p>}</li>)}</ul></section>
      <section aria-labelledby="package-findings"><h2 id="package-findings" className="mb-3 font-medium">Findings <span className="text-muted-foreground">{pkg.findings.length}</span></h2>
        {findings.length ? <div className="-mx-4"><FindingsTable repositoryId={repository} findings={findings} findingSearch={index => ({ finding: index })}/></div> : <p role="status" className="py-8 text-sm text-muted-foreground">No findings were reported for this package in the latest scan.</p>}
      </section>
    </>}
  </main>;
}
