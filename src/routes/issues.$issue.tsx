import { repositoryFilters, type RepositoryFilters } from '../lib/repository-findings';
import { RepositoryFindingNavigation } from '../components/repository-finding-navigation';
import { EvidenceDetails, DetectionFilter, DetectionBadge, EmptyDetection } from '../components/finding-evidence';
import { sourceDetection, matchesDetection, matchesSource, type SourceEvidence } from '../lib/finding-evidence';
import { useState } from 'react';
import { resourceName, projectName as displayProjectName } from '../lib/display-name';
import { ContentSkeleton } from "../components/ui/loading";
import { createFileRoute, Link, useLocation, useRouter } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useWorkspace } from '../components/app-shell';
import { FindingOverview } from '../components/finding-overview';
import { useResource } from '../lib/use-resource';
import { currentPulseItem, pulseFindingEvent, type PulseItem, type PulseEvent } from '../lib/pulse';
import { type Report } from '../lib/model';
import { Button } from '../components/ui/button';
import { resourceKey } from '../lib/settings';

export const Route = createFileRoute('/issues/$issue')({
  validateSearch: (input: Record<string, unknown>): RepositoryFilters & { repository?: string; package?: string; version?: string; node?: string } => ({
    ...repositoryFilters(input),
    node: typeof input.node === 'string' ? input.node : undefined,
    repository: typeof input.repository === 'string' ? input.repository : undefined,
    package: typeof input.package === 'string' ? input.package : undefined,
    version: typeof input.version === 'string' ? input.version : undefined,
  }),
  component: IssuePage,
});

function IssuePage() {
  const { issue } = Route.useParams();
  const search = Route.useSearch();
  const filters = repositoryFilters(search);
  const router = useRouter();
  const fromFindings = useLocation({ select: location => location.state.fromFindings });
  const [source, setSource] = useState('all');
  const { inventory, revision } = useWorkspace();
  const evidence = useResource<SourceEvidence[]>(`finding-evidence?issue=${encodeURIComponent(issue)}`, revision, 30000);
  const feed = useResource<PulseItem[]>('pulse-feed', revision);
  const data = inventory?.data;
  const item = feed?.data?.find(entry => entry.id === issue);
  const currentItem = item && data ? currentPulseItem(item, new Set(data.targets.map(target => target.id))) : null;
  // Prefer an active finding. Resolved messages still retain their CVE details.
  const runtimeEvents = currentItem?.events.filter(e => !e.sourceBinding && e.kind !== 'resolved' && e.finding) ?? [];
  const event = currentItem ? pulseFindingEvent(runtimeEvents.length ? { ...currentItem, events: runtimeEvents } : currentItem) : undefined;
  const target = data?.targets.find(entry => entry.id === event?.target);
  const container = data?.containers.find(entry => entry.target_id === target?.id && resourceKey(entry) === event?.resource);
  const report = useResource<Report>(target?.scanned_at ? `report?id=${encodeURIComponent(target.id)}&scan=${target.scanned_at}` : '', revision);
  const liveFinding = report?.data?.findings.find(entry => entry.id === issue && entry.package === event?.finding?.package && entry.type === event.finding.type)
    ?? report?.data?.findings.find(entry => entry.id === issue);
  const finding = liveFinding ?? event?.finding;
  const historical = !liveFinding;
  const loading = search.repository ? !evidence : !evidence || !data || !feed?.data || (!!target?.scanned_at && !report);
  const error = search.repository ? evidence?.error : inventory?.error || feed?.error;
  const scopedSources = (evidence?.data ?? []).filter(s => (!search.repository || s.bindingId === search.repository) && (!search.package || s.finding.package === search.package) && (!search.version || s.finding.installed === search.version));
  const primarySource = scopedSources[0];
  const visibleSources = scopedSources.filter(s => matchesDetection(source, sourceDetection(s)));
  function eventDetection(entry: PulseEvent) {
    if (entry.target === 'host') return 'host' as const;
    if (data?.targets.find(t => t.id === entry.target)?.summary?.coverage) return 'unknown' as const;
    return entry.kind !== 'resolved' && entry.finding && evidence?.data?.some(s => matchesSource(entry.finding!, s) && s.runtime.some(r => r.targetId === entry.target && r.matched)) ? 'both' as const : 'container' as const;
  }
  const visibleResources = (currentItem?.events ?? []).filter(entry => !entry.sourceBinding && matchesDetection(source, eventDetection(entry)));


  return <main id="main" className="min-w-0 bg-raised px-4 pb-8 desktop:rounded-[10px] desktop:border desktop:border-border desktop:pb-12 desktop:shadow-sm desktop:dark:shadow-black/30">
    <nav aria-label="Breadcrumb" className="-mx-4 flex min-h-[55px] flex-wrap items-center gap-2 border-b border-border px-4 py-3 text-xs">
      {search.repository ? <><Link to="/repositories" className="text-muted-foreground hover:text-brand-ink">Repositories</Link><span aria-hidden="true">/</span><Link to="/repositories/$repository" params={{ repository: search.repository }} search={filters} className="text-muted-foreground hover:text-brand-ink">{primarySource?.repository ?? 'Repository'}</Link></> : <Link to="/" search={{}} className="text-muted-foreground hover:text-brand-ink">Pulse</Link>}
      <span aria-hidden="true" className="text-muted-foreground">/</span>
      <span aria-current="page" className="wrap-anywhere">{issue}</span>
    </nav>
    <nav aria-label="Issue navigation" className="-mx-4 flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
      {fromFindings ? <Button size="sm" variant="ghost" onClick={() => router.history.back()}><ArrowLeft aria-hidden="true" />Back to findings</Button> : search.repository ? <Button asChild size="sm" variant="ghost"><Link to="/repositories/$repository" params={{ repository: search.repository }} search={filters}><ArrowLeft aria-hidden="true"/>Back to findings</Link></Button> : <Button asChild size="sm" variant="ghost"><Link to="/" search={{}}><ArrowLeft aria-hidden="true" />Back to Pulse</Link></Button>}
      {search.repository && primarySource && <RepositoryFindingNavigation repository={search.repository} issue={issue} search={search} scanId={primarySource.scanId} fromFindings={!!fromFindings}/>}
    </nav>
    {error ? <p role="alert" className="my-6 rounded-lg border border-critical/20 bg-critical/5 p-4 text-sm text-critical">{error}</p> : loading ? <ContentSkeleton label="Loading vulnerability details…" layout="detail" /> : primarySource && (search.repository || !target || !!event?.sourceBinding) ? <FindingOverview
      key={`${issue}:${primarySource.bindingId}:${primarySource.finding.package}:${primarySource.finding.installed}`}
      finding={primarySource.finding} locked sourceEvidence={primarySource}
      resources={<section aria-label="Repository evidence" className="my-8 border-t border-border pt-6 text-sm">
        <div className="mb-3 flex flex-wrap justify-between gap-3"><h2 className="text-lg">Detection evidence</h2>{!search.repository && <DetectionFilter value={source} onChange={setSource}/>}</div>
        {!visibleSources.length && <EmptyDetection/>}
        {visibleSources.map((s, i) => <EvidenceDetails key={s.scanId + ':' + i} evidence={s} showRemediation={s !== primarySource}/>) }
      </section>}
    /> : search.repository ? <p role="status" className="my-6 rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">This vulnerability is not available in this repository’s latest scan. Return to findings to view current results.</p> : finding && event?.sourceBinding ? <article className="mx-auto max-w-[860px] py-10"><p>{issue}</p><h1 className="my-4 text-3xl">{finding.title || issue}</h1><p>{finding.package}@{finding.installed} · {event.resourceName}</p><p className="mt-4">Recorded source update: {new Date(event.time).toLocaleString()}. {event.kind === 'resolved' ? 'Not detected in the latest comparable source scan. This does not establish that deployed containers are fixed.' : 'No current matching source observation is available. Coverage may be incomplete.'}</p>{evidence?.error && <p role="status">{evidence.error}</p>}</article> : finding && target && event ? <FindingOverview showEvidence={false} finding={finding} locked={Boolean(report?.data?.coverage ?? target.summary?.coverage)} target={target} container={container} recordedAt={historical ? event.time : undefined} historical={historical} resources={
      <section aria-label="Resources" className="my-8 border-t border-border pt-6 text-sm">
        <div className="mb-3 flex flex-wrap justify-between gap-3"><h2 className="text-lg">Detection evidence</h2><DetectionFilter value={source} onChange={setSource} /></div>
        {!visibleSources.length && !visibleResources.length && !evidence?.error && <EmptyDetection />}
        {visibleResources.length > 0 && <h2 className="mb-3 text-lg">Resources</h2>}
        <ul className="divide-y divide-border">
          {visibleResources.map(entry => {
            const resource = data?.containers.find(candidate => candidate.target_id === entry.target && resourceKey(candidate) === entry.resource);
            const name = (resource ? resourceName(resource) : undefined) ?? entry.resourceName ?? entry.name;
            const project = resource?.project ?? entry.project;
            const resolved = entry.kind === 'resolved';
            const detection = eventDetection(entry);
            const status = resolved ? 'Not detected' : entry.finding?.fixed ? 'Fix available' : 'Detected';
            return <li key={entry.resource ?? entry.target} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <div className="min-w-0 flex-1 basis-40">
                <p className="font-medium wrap-anywhere">{name}</p>
                {project && <p className="mt-0.5 text-xs text-muted-foreground wrap-anywhere">{displayProjectName(project, data)}</p>}
              </div>
              <DetectionBadge detection={detection} />
              <span title={`Pulse update: ${new Date(entry.time).toLocaleString()}`} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${resolved ? 'bg-muted-foreground' : 'bg-brand-ink'}`} />
                {status}
              </span>
              <Button asChild size="sm" variant="ghost" className="shrink-0 text-brand-ink">
                <Link to="/" search={{ view: 'apps', target: entry.target, app: resource?.id, project: project ?? undefined, match: issue }} aria-label={`View findings for ${name}`}>
                  View findings<ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </li>;
          })}
        </ul>
        {historical && <p role="status" className="mt-3 text-xs leading-5 text-muted-foreground">
          {report?.error || !target.scanned_at ? 'The current report is unavailable. Showing the recorded Pulse update.' : 'This vulnerability is no longer in this resource’s current report. Showing its recorded Pulse details.'}
          {' '}Recorded {new Date(event.time).toLocaleString()}. These details may no longer describe the resource’s current state.
        </p>}
      </section>
    } /> : <p role="status" className="my-6 rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">This vulnerability update is no longer available. Return to Pulse to view current updates.</p>}
  </main>;
}
