import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuItem } from '../components/ui/dropdown-menu';
import { repositoryCoverageAreas } from '../lib/assessment-coverage';
import { FindingsSummary } from '../components/findings-summary';
import { baseImageOptions } from '../lib/base-image-filter';
import { BaseImageFilter } from '../components/base-image-filter';
import { RepositoryBaseFindings } from '../components/repository-base-findings';
import { useRepositoryImageReports } from '../lib/use-repository-image-reports';
import { freshness } from '../lib/coverage-explanation';
import { sourceEmptyMessage } from '../lib/source-assessment';
import { PackagesSummary, RepositoryPackages } from '../components/repository-packages';
import { repositoryPackages } from '../lib/repository-packages';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Check, Ellipsis, Info, RefreshCw, Scan as ScanIcon, Search, SlidersHorizontal } from 'lucide-react';
import { WorkspaceBar, useWorkspace } from '../components/app-shell';
import { RepositoryWorkspace, useRepositories } from '../components/repositories';
import type { Scan } from '../components/project-sources';
import { FindingsSearch } from '../components/findings-search';
import { FindingsTable } from '../components/findings-table';
import { SearchToolbar } from '../components/search-toolbar';
import { Button } from '../components/ui/button';
import { Checkbox, Select } from '../components/ui/filters';
import { Sheet, SheetContent, SheetTrigger } from '../components/ui/sheet';
import { LoadingStatus } from '../components/ui/loading';
import { severities } from '../lib/model';
import { useResource } from '../lib/use-resource';
import { repositoryFilters, repositoryFindings, type RepositoryFilters } from '../lib/repository-findings';
import { RepositoryDetailsPanel, RepositoryScanPanel } from '../components/repository-details-panel';

export const Route = createFileRoute('/repositories_/$repository')({
  validateSearch: (input: Record<string, unknown>): RepositoryFilters & { view?: 'packages' } => ({ ...repositoryFilters(input), view: input.view === 'packages' ? 'packages' as const : undefined }),
  component: () => <RepositoryWorkspace><RepositoryPage/></RepositoryWorkspace>,
});

function RepositoryPage() {
  const { repository } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const repos = useRepositories();
  const { refresh, inventory } = useWorkspace();
  const binding = repos.data?.bindings.find(b => b.id === repository);
  const scan = binding?.scans[0];
  const imageScans = useRepositoryImageReports(binding?.repository, inventory?.data);
  const baseOptions = baseImageOptions(imageScans.reports.flatMap(({ report }) => report.findings));
  const full = useResource<{ result: Scan['result'] }>(scan ? `repositories?view=scan&scanId=${encodeURIComponent(scan.id)}` : '', 0);
  const analysis = full?.data?.result;
  const [panel, setPanel] = useState<'details' | 'scan' | null>(null);
  const packages = useMemo(() => analysis ? repositoryPackages(analysis) : undefined, [analysis]);
  const packagesView = search.view === 'packages';
  const [packageQuery, setPackageQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const job = binding?.jobs[0];
  const busy = submitting || job?.state === 'running' || job?.state === 'queued';
  const activeFilters = Number(!!search.severity) + Number(!!search.fixable) + Number(!!search.scope) + Number(!!search.baseImage);
  const update = (patch: Partial<typeof search>) => void navigate({ search: { ...search, ...patch }, replace: true });
  const rows = analysis ? repositoryFindings(analysis, search) : [];
  async function rescan() {
    if (!binding || busy) return;
    setSubmitting(true); setError('');
    try {
      const response = await fetch('/api/data/source', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'scan', bindingId: binding.id }) });
      if (!response.ok) throw new Error((await response.json()).error ?? 'Could not start the scan.');
      refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setSubmitting(false); }
  }
  return <main id="main" className="min-w-0 bg-raised px-4 pb-8 desktop:rounded-[10px] desktop:border desktop:border-border desktop:pb-12 desktop:shadow-sm desktop:dark:shadow-black/30">
    <WorkspaceBar section="Repositories" repository={binding?.repository ?? 'Repository'}/>
    <h1 className="sr-only">{binding?.repository ?? 'Repository'} findings</h1>
    {repos.error && <p role="alert" className="py-4">{repos.error}</p>}
    {!repos.data ? !repos.error && <LoadingStatus label="Loading repository…" className="py-8"/> : !binding ? <div className="py-12"><h2>Repository unavailable</h2><p className="mt-2 text-muted-foreground">This repository was removed or you no longer have access.</p><Link to="/repositories" className="mt-4 inline-block text-brand-ink">Back to repositories</Link></div> : <>
      <nav aria-label="Repository views" className="-mx-4 flex gap-5 border-b border-border px-4">{(['Findings', 'Packages'] as const).map(label => {
        const active = packagesView === (label === 'Packages');
        return <Link key={label} to="/repositories/$repository" params={{ repository }} search={{ ...search, view: label === 'Packages' ? 'packages' : undefined }} aria-current={active ? 'page' : undefined} className={`border-b-2 py-3 text-sm font-medium ${active ? 'border-current' : 'border-transparent text-muted-foreground'}`}>{label}</Link>;
      })}</nav>
      {packagesView ? <PackagesSummary packages={packages} analysis={analysis} scannedAt={scan?.observed_at}/> : <FindingsSummary
        findings={analysis?.findings}
        coverageAreas={repositoryCoverageAreas(analysis)}
        scannedAt={scan?.observed_at}
        footer={scan ? `Repository scan: ${new Date(scan.observed_at).toLocaleString()} · ${freshness(scan.observed_at, inventory?.data?.intervalHours ?? 24)} · Deployment unknown` : 'No completed repository scan'}
      />}
      <SearchToolbar className="mb-0">
        {packagesView ? <FindingsSearch label="Search packages" value={packageQuery} onChange={setPackageQuery}/> : <FindingsSearch value={search.match ?? ''} onChange={match => update({ match: match || undefined })}/>}
        {!packagesView && <Sheet><SheetTrigger asChild><Button variant="ghost" size="sm"><SlidersHorizontal aria-hidden="true"/>Filters{activeFilters > 0 && <span className="rounded-full bg-brand-tint px-1.5 text-xs text-brand-ink" aria-label={`${activeFilters} active filters`}>{activeFilters}</span>}</Button></SheetTrigger>
          <SheetContent side="right" title="Filters"><div className="space-y-6 p-5 pt-12">
            <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-medium">Filters</h2><Button variant="ghost" size="sm" disabled={!activeFilters} onClick={() => update({ severity: undefined, fixable: undefined, scope: undefined, baseImage: undefined })}>Reset filters</Button></div>
            <div className="space-y-2"><p className="text-sm font-medium">Severity</p><Select label="Severity" value={search.severity ?? 'ALL'} options={['ALL', ...severities]} display={value => value === 'ALL' ? 'All severities' : value.toLowerCase()} onValueChange={value => update({ severity: severities.find(s => s === value) })}/></div>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={!!search.fixable} onCheckedChange={value => update({ fixable: value === true || undefined })}/>Fix available</label>
            {!search.baseImage && <div className="space-y-2"><p className="text-sm font-medium">Dependency scope</p><Select label="Dependency scope" value={search.scope ?? 'All'} options={['All', 'Production', 'Development', 'Optional', 'Peer', 'Unknown']} display={value => value === 'All' ? 'All scopes' : value} onValueChange={value => update({ scope: value === 'All' ? undefined : value })}/></div>}
            <BaseImageFilter value={search.baseImage} options={baseOptions} onChange={baseImage => update({ baseImage, scope: undefined })}/>
            {imageScans.loading && <p role="status" className="text-xs text-muted-foreground">Loading linked container scans…</p>}
            {imageScans.error && <p role="alert" className="text-xs text-critical">{imageScans.error}</p>}
            <p className="text-xs text-muted-foreground">Filters apply immediately.</p>
          </div></SheetContent>
        </Sheet>}
        <Button variant="ghost" size="sm" disabled={busy || !repos.data.flags.connections || !repos.data.flags.scanning} aria-busy={busy || undefined} onClick={() => void rescan()}><RefreshCw aria-hidden="true" className={busy ? 'scan-action-icon' : ''}/>{busy ? job?.state === 'queued' ? 'Queued' : 'Scanning' : 'Rescan'}</Button>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="sm" aria-label="More resource options"><Ellipsis aria-hidden="true"/>More</Button></DropdownMenuTrigger><DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setPanel('details')}>Resource details</DropdownMenuItem>
          {repos.data.administrator && <DropdownMenuItem onSelect={() => repos.edit(binding)}>Repository settings</DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => setPanel('scan')}>Scan details and actions</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => update({ view: 'packages' })}>Package inventory</DropdownMenuItem>
        </DropdownMenuContent></DropdownMenu>
      </SearchToolbar>
      {[...new Set([error, binding.error, job?.error, repos.data.storageError, full?.error].filter(Boolean))].map((message, i) => <p key={i} role="alert" className="my-4 text-sm text-critical">{message}</p>)}
      {(!repos.data.flags.connections || !repos.data.flags.scanning) && <p role="status" className="my-4 text-sm text-muted-foreground">Repository scanning is currently unavailable. Saved results are shown below.</p>}
      {busy && <p role="status" className="my-4 text-sm text-muted-foreground">{job?.state === 'queued' ? 'Scan queued.' : 'Scanning dependencies…'} {scan && 'Showing the last completed scan.'}</p>}
      {packagesView ? !scan ? <p role="status" className="py-12 text-muted-foreground">Packages will appear here when the first scan completes.</p> : !packages ? !full?.error && <LoadingStatus label="Loading packages…" className="py-12"/> : <RepositoryPackages key={`${scan.id}:${packageQuery}`} packages={packages} query={packageQuery} repository={repository}/> : search.baseImage ? <RepositoryBaseFindings {...imageScans} filters={search}/> : !scan ? <div role="status" className="py-12"><h2>No completed source scan yet.</h2><p className="mt-2 text-muted-foreground">Findings will appear here when a scan completes.</p></div> : !analysis ? !full?.error && <LoadingStatus label="Loading vulnerabilities…" className="py-12"/> : rows.length ? <div className="-mx-4"><FindingsTable repositoryId={repository} repositoryFilters={search} key={JSON.stringify([scan.id, search])} findings={rows} findingSearch={index => ({ finding: index })}/></div> : <div role="status" className="flex flex-col items-center px-5 py-16 text-center">
        <span aria-hidden="true" className={`mb-4 grid size-12 place-items-center rounded-full [&>svg]:col-start-1 [&>svg]:row-start-1 ${!analysis.findings.length && analysis.coverage.inventory === 'complete' ? 'bg-brand-tint text-brand-ink' : 'bg-sunken text-muted-foreground'}`}>
          {analysis.findings.length ? <Search size={24} strokeWidth={1.5}/> : analysis.coverage.inventory === 'complete' ? <><ScanIcon size={28} strokeWidth={1.5}/><Check size={15} strokeWidth={2.5}/></> : <Info size={24} strokeWidth={1.5}/>}
        </span>
        <h2 className="!mt-0 !mb-0 max-w-[40ch] text-balance">{analysis.findings.length ? 'No findings match these filters' : sourceEmptyMessage(analysis).title}</h2>
        <p className="mt-2 max-w-[52ch] text-sm leading-relaxed text-pretty text-muted-foreground">{analysis.findings.length ? 'Adjust your search or filters to see more findings.' : sourceEmptyMessage(analysis).description}</p>
        {!analysis.findings.length && <Button variant="ghost" size="sm" className="mt-4" onClick={() => analysis.coverage.inventory === 'complete' ? update({ view: 'packages' }) : setPanel('scan')}>{analysis.coverage.inventory === 'complete' ? 'View scanned packages' : 'View scan details'}</Button>}
      </div>}
      <Sheet open={panel !== null} onOpenChange={open => { if (!open) setPanel(null); }}><SheetContent side="right" title={panel === 'details' ? 'Resource details' : 'Scan details and actions'}><div className="p-5 pt-12">
        {panel === 'details' && <RepositoryDetailsPanel binding={binding} analysis={analysis} submitting={submitting}/>}
        {panel === 'scan' && <RepositoryScanPanel binding={binding} analysis={analysis} submitting={submitting} scanningAvailable={repos.data.flags.connections && repos.data.flags.scanning} onScan={() => void rescan()} error={error || binding.error || job?.error || repos.data.storageError || full?.error}/>}

      </div></SheetContent></Sheet>
    </>}
  </main>;
}
