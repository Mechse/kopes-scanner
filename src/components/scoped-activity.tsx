import { Link } from '@tanstack/react-router';
import { Activity, Diamond } from 'lucide-react';
import { useState } from 'react';
import { Route } from '../routes/index';
import type { Dashboard } from '../lib/model';
import { activityEvents, activityResources, type ActivityScope, type FindingEvent, type ScanEvent } from '../lib/activity';
import { useResource } from '../lib/use-resource';
import { Select } from './ui/filters';
import { ContentSkeleton } from './ui/loading';
import { SearchToolbar } from './search-toolbar';
import { FindingsSearch } from './findings-search';

export function ScopedActivity({ data, scope, revision }: { data: Dashboard; scope: ActivityScope; revision: number }) {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [query, setQuery] = useState('');
  const findings = useResource<FindingEvent[]>('timeline', revision, 30000);
  const scans = useResource<ScanEvent[]>('activity', revision, 2500);
  const resources = activityResources(data, scope);
  const selected = search.activityResource;
  const scoped = selected ? resources.filter(r => r.key === selected) : resources;
  const filter = search.events ?? 'all';
  const needle = query.trim().toLowerCase();
  const events = activityEvents(scoped, findings?.data ?? [], scans?.data ?? [])
    .filter(e => (filter === 'all' || filter === e.kind) && [e.title, e.detail, ...e.resources.map(r => r.name)].some(v => v?.toLowerCase().includes(needle)));
  const pending = data.targets.filter(t => scoped.some(r => r.target === t.id) && t.status !== 'ready');
  const loading = (filter !== 'scans' && !findings?.data && !findings?.error) || (filter !== 'findings' && !scans?.data && !scans?.error);
  return <section aria-label="Activity">
    <SearchToolbar>
      <FindingsSearch label="Search activity" value={query} onChange={setQuery} />
      <Select label="Event type" value={filter} options={['all', 'findings', 'scans']} display={v => v === 'all' ? 'All events' : v === 'findings' ? 'Finding changes' : 'Scans'} onValueChange={v => void navigate({ search: previous => ({ ...previous, events: v as 'all' | 'findings' | 'scans' }), resetScroll: false })} />
      {!scope.target && <Select label="Resource" value={selected ?? 'all'} options={['all', ...new Set(resources.map(r => r.key))]} display={v => v !== 'all' ? resources.find(r => r.key === v)?.name ?? 'Unavailable resource' : 'All resources'} onValueChange={v => void navigate({ search: previous => ({ ...previous, activityResource: v === 'all' ? undefined : v }), resetScroll: false })} />}
    </SearchToolbar>
    {filter !== 'findings' && pending.length > 0 && <section aria-label="Current scan status" className="mb-5 space-y-2">
      <h2>Current scan status</h2>
      {pending.map(t => <article id={`scan-status-${t.id}`} key={t.id} className="rounded-lg border border-border p-3 text-sm">
        <p className="font-medium">{scoped.filter(r => r.target === t.id).map(r => r.name).join(', ')}</p>
        <p className={t.status === 'error' ? 'text-critical' : 'text-muted-foreground'}>{t.status === 'error' ? 'Scan failed' : t.status === 'unassessed' ? 'Not assessed' : t.status === 'scanning' ? 'Scanning…' : 'Queued'}{t.error ? ` · ${t.error}` : ''}</p>
      </article>)}
    </section>}
    {filter !== 'scans' && findings?.error && <p role="alert">Finding history: {findings.error}</p>}
    {filter !== 'findings' && scans?.error && <p role="alert">Scan history: {scans.error}</p>}
    {loading && <ContentSkeleton label="Loading activity…" layout="scan-log" />}
    {!loading && !events.length && !findings?.error && !scans?.error && <p role="status" className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">{needle || selected || filter !== 'all' ? 'No activity matches these filters.' : 'Scan events and finding discoveries will appear here as scans complete.'}</p>}
    <ol className="divide-y divide-border">
      {events.map(event => <li id={event.id} key={event.id} className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-3 gap-y-1 py-4">
        {event.kind === 'scans' ? <Activity size={16} aria-hidden="true" className="mt-0.5 text-muted-foreground" /> : <Diamond size={16} aria-hidden="true" className="mt-0.5 text-medium" />}
        <div className="min-w-0"><p className="text-sm font-medium wrap-anywhere">{event.title}</p>
          {event.detail && <p className="text-xs text-muted-foreground wrap-anywhere">{event.detail}</p>}
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">{event.resources.map(r => <Link key={r.app ?? r.key} to="/" search={{ view: 'apps', target: r.target, app: r.app, project: r.project, tab: 'activity', events: event.kind }} hash={event.id} className="hover:underline">{r.name}</Link>)}</div>
          <time className="mt-1 block text-xs text-muted-foreground" dateTime={new Date(event.time).toISOString()}>{new Date(event.time).toLocaleString()}</time>
        </div>
      </li>)}
    </ol>
  </section>;
}
