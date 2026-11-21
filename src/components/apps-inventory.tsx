import { Link } from '@tanstack/react-router';
import { ArrowUpRight, LayoutGrid, List } from 'lucide-react';
import { useEffect, useState } from 'react';
import { resourceName } from '../lib/display-name';
import type { Container, Dashboard } from '../lib/model';
import { resourceKey } from '../lib/settings';
import { Assessment } from './assessment';
import { FavouriteButton } from './favourites';
import { FindingsSearch } from './findings-search';
import { useRepositories } from './repositories';
import { ResourceIcon } from './resource-icon';
import { SearchToolbar } from './search-toolbar';
import { BusyIndicator } from './ui/loading';
import { pillClass } from './ui/pill';

type View = 'grid' | 'line';
const preferenceKey = 'kopes.projects-view';

export function ContainersInventory({ data }: { data: Dashboard }) {
  const { favourites } = useRepositories();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>('grid');
  useEffect(() => {
    try { if (localStorage.getItem(preferenceKey) === 'line') setView('line'); } catch { /* Storage is optional. */ }
  }, []);
  function changeView(next: View) {
    setView(next);
    try { localStorage.setItem(preferenceKey, next); } catch { /* Storage is optional. */ }
  }
  const needle = query.trim().toLowerCase();
  const containers = data.containers.filter(c => [resourceName(c), c.name, c.service, c.image, c.manager].some(value => value.toLowerCase().includes(needle)))
    .sort((a, b) => resourceName(a).localeCompare(resourceName(b), undefined, { numeric: true }));
  const targets = new Map(data.targets.map(t => [t.id, t]));
  const favourite = (c: Container) => ({ scope: 'resource' as const, key: resourceKey(c) });
  const starred = containers.filter(c => favourites.has(favourite(c)));
  const repeat = data.containers.length > 10;
  const regular = repeat ? containers : containers.filter(c => !favourites.has(favourite(c)));
  const grid = view === 'grid';
  const collectionClass = grid ? 'resource-card-grid' : '@container min-w-0';

  function renderContainer(c: Container) {
    const name = resourceName(c), target = targets.get(c.target_id);
    const search = { view: 'apps' as const, app: c.id, target: c.target_id };
    const findings = target?.summary && Object.values(target.summary.counts).reduce((sum, count) => sum + count, 0);
    return <article key={c.id} className={`group relative isolate flex min-w-0 gap-3 ${grid ? 'flex-col justify-between rounded-xl border border-border bg-raised p-5 hover:border-brand-ink' : 'flex-wrap items-center border-b border-border/60 px-3 py-2.5 hover:bg-sunken/50'}`}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <ResourceIcon container={c}/>
        <div className="min-w-0 flex-1 text-sm font-medium">
          {target ? <Link to="/" search={search} title={name} aria-label={`Open report for ${name}`} className="block truncate after:absolute after:inset-0 focus-visible:after:outline-2">{name}</Link> : <span className="block truncate" title={name}>{name}</span>}
          <span className="block truncate text-xs font-normal text-muted-foreground" title={c.image}>{c.image}</span>
        </div>
        <FavouriteButton name={name} active={favourites.has(favourite(c))} disabled={favourites.disabled} onClick={() => void favourites.toggle(favourite(c))}/>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {target ? <Assessment targets={[target]}/> : 'Awaiting scan target'}
        {findings !== undefined && <span className={pillClass}>{findings} {findings === 1 ? 'finding' : 'findings'}</span>}
        {target?.status === 'error' && <Link to="/" search={{ ...search, tab: 'activity', events: 'scans' }} hash={`scan-status-${target.id}`} className="relative z-10 text-critical hover:underline">Scan failed</Link>}
        {target?.status === 'scanning' && <span className={pillClass}><BusyIndicator/>Scanning</span>}
        {target?.status === 'queued' && <span className={pillClass}>Queued</span>}
        {grid && target && <ArrowUpRight size={16} className="ml-auto text-muted-foreground" aria-hidden="true"/>}
      </div>
    </article>;
  }
  return <div>
    <SearchToolbar>
      <FindingsSearch label="Search containers" value={query} onChange={setQuery}/>
      <div data-toolbar-control role="group" aria-label="View" className="flex shrink-0 rounded border border-border p-0.5">
        {([['grid', LayoutGrid, 'Grid'], ['line', List, 'Line']] as const).map(([mode, Icon, label]) => <button key={mode} type="button" aria-pressed={view === mode} onClick={() => changeView(mode)} className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs text-muted-foreground aria-pressed:bg-brand-tint aria-pressed:text-brand-ink"><Icon size={14}/>{label}</button>)}
      </div>
    </SearchToolbar>
    {favourites.error && <p role="alert">{favourites.error}</p>}
    {starred.length > 0 && <section aria-label="Favourites" className="mb-9"><h2 className="mb-4">Favourites</h2><div className={collectionClass}>{starred.map(renderContainer)}</div></section>}
    {regular.length > 0 && <section aria-label="Containers">{starred.length > 0 && <h2 className="mb-4">{repeat ? 'All containers' : 'Containers'}</h2>}<div className={collectionClass}>{regular.map(renderContainer)}</div></section>}
    {!containers.length && <p role="status" className="rounded-lg border border-dashed border-border px-4 py-7 text-sm text-muted-foreground">{needle ? 'No containers match your search.' : 'No containers added yet. An administrator can add a running container.'}</p>}
  </div>;
}
