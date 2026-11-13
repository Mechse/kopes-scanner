import { sourceAssessment } from '../lib/source-assessment';
import { useRepositories } from './repositories';
import { SourceScan } from './project-sources';
import { useWorkspace } from './app-shell';
import { BusyIndicator, LoadingStatus } from './ui/loading';
import { pillClass } from './ui/pill';

export function CodebaseFindings({ targetId, containerId, source }: { targetId: string; containerId?: string; source?: string }) {
  const repos = useRepositories();
  const { inventory } = useWorkspace();
  const containers = inventory?.data?.containers.filter(c => c.target_id === targetId && (!containerId || c.id === containerId)) ?? [];
  const resourceIds = new Set(repos.data?.resources.filter(r => r.containerIds.some(id => containers.some(c => c.id === id))).map(r => r.id));
  const bindings = repos.data?.bindings.filter(b => b.resources.some(r => resourceIds.has(r.id))) ?? [];

  if (!repos.data) return repos.error
    ? <p role="alert" className="mt-6 text-sm">Codebase scan status unavailable. {repos.error}</p>
    : <LoadingStatus label="Loading codebase scan status…" className="mt-6" />;
  if (!bindings.length) return null;

  const available = repos.data.flags.connections && repos.data.flags.scanning;
  return <section aria-label="Codebase findings" className="mt-8 space-y-5 border-t border-border pt-6">
    <div>
      <h2>Codebase findings</h2>
      <p className="mt-1 text-sm text-muted-foreground">Results from the connected repository’s tracked branch. The deployed image may use a different commit.</p>
    </div>
    {repos.error && <p role="alert" className="text-sm">Codebase status could not refresh. {repos.error}</p>}
    {!available && <p role="status" className="text-sm text-muted-foreground">Source scanning is currently unavailable. Previous results are shown below when available.</p>}
    {repos.data.storageError && <p role="status" className="text-sm text-muted-foreground">{repos.data.storageError}</p>}
    {bindings.map(binding => {
      const job = binding.jobs[0];
      const scan = binding.scans[0];
      const busy = job?.state === 'running' || job?.state === 'queued';
      const error = job?.error || binding.error;
      const status = job?.state === 'running' ? 'Scanning' : job?.state === 'queued' ? 'Queued'
        : job?.state === 'failed' || binding.error ? 'Scan failed'
        : job?.state === 'cancelled' ? 'Cancelled' : scan ? sourceAssessment(scan) : 'Not scanned';
      return <article key={binding.id} className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="break-all text-sm font-medium">{binding.repository}</h3>
          <span className="text-xs text-muted-foreground">{binding.branch}</span>
          <span role="status" className={pillClass}>{busy && <BusyIndicator className="mr-1" />}{status}</span>
        </div>
        {error && <p role="status" className="text-sm text-critical">{error}</p>}
        {scan ? <>
          {(busy || error || job?.state === 'failed' || job?.state === 'cancelled') && <p className="text-sm text-muted-foreground">Showing findings from the last completed codebase scan.</p>}
          <SourceScan key={scan.id} scan={scan} endpoint="repositories" defaultOpen sourceFilter={source} />
        </> : <p className="text-sm text-muted-foreground">{busy ? 'Codebase findings will appear here when the scan completes.' : 'No completed codebase scan yet.'}</p>}
      </article>;
    })}
  </section>;
}
