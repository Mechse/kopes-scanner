import { resourceName, projectName as displayProjectName } from '../lib/display-name';
import { ContentSkeleton } from "../components/ui/loading";
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useWorkspace } from '../components/app-shell';
import { FindingOverview } from '../components/finding-overview';
import { useResource } from '../lib/use-resource';
import { currentPulseItem, pulseFindingEvent, type PulseItem } from '../lib/pulse';
import { type Report } from '../lib/model';
import { Button } from '../components/ui/button';
import { resourceKey } from '../lib/settings';

export const Route = createFileRoute('/issues/$issue')({
  component: IssuePage,
});

function IssuePage() {
  const { issue } = Route.useParams();
  const { inventory, revision } = useWorkspace();
  const feed = useResource<PulseItem[]>('pulse-feed', revision);
  const data = inventory?.data;
  const item = feed?.data?.find(entry => entry.id === issue);
  const currentItem = item && data ? currentPulseItem(item, new Set(data.targets.map(target => target.id))) : null;
  // Prefer an active finding. Resolved messages still retain their CVE details.
  const event = currentItem ? pulseFindingEvent(currentItem) : undefined;
  const target = data?.targets.find(entry => entry.id === event?.target);
  const container = data?.containers.find(entry => entry.target_id === target?.id && resourceKey(entry) === event?.resource);
  const report = useResource<Report>(target?.scanned_at ? `report?id=${encodeURIComponent(target.id)}&scan=${target.scanned_at}` : '', revision);
  const liveFinding = report?.data?.findings.find(entry => entry.id === issue && entry.package === event?.finding?.package && entry.type === event.finding.type)
    ?? report?.data?.findings.find(entry => entry.id === issue);
  const finding = liveFinding ?? event?.finding;
  const historical = !liveFinding;
  const loading = !data || !feed?.data || (!!target?.scanned_at && !report);
  const error = inventory?.error || feed?.error;

  return <main id="main" className="min-w-0 bg-raised px-4 pb-8 desktop:rounded-[10px] desktop:border desktop:border-border desktop:pb-12 desktop:shadow-sm desktop:dark:shadow-black/30">
    <nav aria-label="Breadcrumb" className="-mx-4 flex min-h-[55px] flex-wrap items-center gap-2 border-b border-border px-4 py-3 text-xs">
      <Link to="/" search={{}} className="text-muted-foreground hover:text-brand-ink">Pulse</Link>
      <span aria-hidden="true" className="text-muted-foreground">/</span>
      <span aria-current="page" className="wrap-anywhere">{issue}</span>
    </nav>
    <nav aria-label="Issue navigation" className="-mx-4 flex items-center border-b border-border px-4 py-2">
      <Button asChild size="sm" variant="ghost"><Link to="/" search={{}}><ArrowLeft aria-hidden="true" />Back to Pulse</Link></Button>
    </nav>
    {error ? <p role="alert" className="my-6 rounded-lg border border-critical/20 bg-critical/5 p-4 text-sm text-critical">{error}</p> : loading ? <ContentSkeleton label="Loading vulnerability details…" layout="detail" /> : finding && target && event ? <FindingOverview finding={finding} locked={Boolean(report?.data?.coverage ?? target.summary?.coverage)} target={target} container={container} recordedAt={historical ? event.time : undefined} historical={historical} resources={
      <section aria-label="Resources" className="my-8 border-t border-border pt-6 text-sm">
        <h2 className="mb-3 text-lg">Resources</h2>
        <ul className="divide-y divide-border">
          {currentItem?.events.map(entry => {
            const resource = data?.containers.find(candidate => candidate.target_id === entry.target && resourceKey(candidate) === entry.resource);
            const name = (resource ? resourceName(resource) : undefined) ?? entry.resourceName ?? entry.name;
            const project = resource?.project ?? entry.project;
            const resolved = entry.kind === 'resolved';
            const status = resolved ? 'Not detected' : entry.finding?.fixed ? 'Fix available' : 'Detected';
            return <li key={entry.resource ?? entry.target} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <div className="min-w-0 flex-1 basis-40">
                <p className="font-medium wrap-anywhere">{name}</p>
                {project && <p className="mt-0.5 text-xs text-muted-foreground wrap-anywhere">{displayProjectName(project, data)}</p>}
              </div>
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
