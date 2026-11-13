import { Link } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { repositoryFindings, type RepositoryFilters } from '../lib/repository-findings';
import { useResource } from '../lib/use-resource';
import type { Scan } from './project-sources';
import { Button } from './ui/button';
import { Tooltip } from './ui/tooltip';

export function RepositoryFindingNavigation({ repository, issue, search, scanId, fromFindings }: {
  repository: string; issue: string; scanId: string; fromFindings: boolean;
  search: RepositoryFilters & { package?: string; version?: string; node?: string };
}) {
  const scan = useResource<{ result: Scan['result'] }>(`repositories?view=scan&scanId=${encodeURIComponent(scanId)}`, 0);
  const findings = scan?.data ? repositoryFindings(scan.data.result, search) : [];
  const position = findings.findIndex(row => (row.finding.id === issue || row.aliases.includes(issue))
    && (!search.package || row.finding.package === search.package)
    && (!search.version || row.finding.installed === search.version)
    && (!search.node || row.sourceNode === search.node));
  return <div className="ml-auto flex items-center gap-1">
    {scan?.error ? <span role="status" className="mr-2 text-xs text-muted-foreground">Finding navigation unavailable</span> : position >= 0 && <span className="mr-2 text-xs text-muted-foreground">{position + 1} of {findings.length}</span>}
    {(['Previous', 'Next'] as const).map(label => {
      const entry = position < 0 ? undefined : findings[position + (label === 'Next' ? 1 : -1)];
      const icon = label === 'Previous' ? <ChevronLeft aria-hidden="true"/> : <ChevronRight aria-hidden="true"/>;
      return <Tooltip key={label} label={`${label} finding`}>{entry ? <Button asChild size="sm" variant="ghost" className="size-8 p-0">
        <Link to="/issues/$issue" params={{ issue: entry.finding.id }}
          search={{ ...search, repository, package: entry.finding.package, version: entry.finding.installed, node: entry.sourceNode }}
          replace state={{ fromFindings }} aria-label={`${label} finding`}>{icon}</Link>
      </Button> : <span className="inline-flex"><Button size="sm" variant="ghost" className="size-8 p-0" aria-label={`${label} finding`} disabled>{icon}</Button></span>}</Tooltip>;
    })}
  </div>;
}
