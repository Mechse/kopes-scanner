import { Link } from '@tanstack/react-router';
import { FindingsTable } from './findings-table';
import { LoadingStatus } from './ui/loading';
import { repositoryBaseFindings } from '../lib/base-image-filter';
import type { Report, Target } from '../lib/model';
import type { RepositoryFilters } from '../lib/repository-findings';

export function RepositoryBaseFindings({ reports, loading, error, filters }: {
  reports: { target: Target; report: Report }[]; loading: boolean; error?: string; filters: RepositoryFilters;
}) {
  if (loading) return <LoadingStatus label="Loading linked container findings…" className="py-12"/>;
  const groups = reports.map(({ target, report }) => ({ target, rows: repositoryBaseFindings(report, target.id, filters) })).filter(group => group.rows.length);
  return <section aria-label="Repository base-image findings" className="py-4">
    <p className="mb-4 text-sm text-muted-foreground">Base-image findings from explicitly linked containers. These are container scan results; they do not establish the repository’s deployed commit.</p>
    {error && <p role="alert" className="mb-4 text-sm text-critical">{error}</p>}
    {groups.map(({ target, rows }) => <section key={target.id} className="mb-6">
      <h2 className="text-sm font-medium"><Link to="/" search={{ view: 'apps', target: target.id, baseImage: filters.baseImage }} className="underline">{target.displayName ?? target.name}</Link></h2>
      <p className="mt-1 text-xs text-muted-foreground">Scanned {new Date(target.scanned_at!).toLocaleString()}</p>
      <div className="-mx-4"><FindingsTable showOrigins findings={rows} key={JSON.stringify([target.scanned_at, filters])}
        findingSearch={index => ({ view: 'apps', target: target.id, scan: target.scanned_at ?? undefined, finding: index,
          baseImage: filters.baseImage, severity: filters.severity, fixable: filters.fixable, match: filters.match })}/></div>
    </section>)}
    {!groups.length && <div role="status" className="py-8"><h2>No verified base-image findings match these filters.</h2><p className="mt-2 text-sm text-muted-foreground">Adjust the filters or scan linked containers with base-image metadata.</p></div>}
  </section>;
}
