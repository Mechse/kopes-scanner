import { Link } from '@tanstack/react-router';
import { LayoutGrid, List, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { resourceName } from '../lib/display-name';
import type { Container, Dashboard } from '../lib/model';
import { resourceKey } from '../lib/settings';
import { FindingsSearch } from './findings-search';
import { useRepositories } from './repositories';
import { ResourceCard, resourceCardActionClass } from './resource-card';
import { ResourceIcon } from './resource-icon';
import { SearchToolbar } from './search-toolbar';

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
    return <ResourceCard key={c.id} view={view} icon={<ResourceIcon container={c}/>}
      title={target ? <Link to="/" search={search} title={name} aria-label={`Open report for ${name}`} className="block truncate after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-brand-ink">{name}</Link> : <span className="block truncate" title={name}>{name}</span>}
      subtitle={<span title={c.image}>{c.image}</span>} vulnerabilities={findings ?? undefined}
      favourite={{ name, active: favourites.has(favourite(c)), disabled: favourites.disabled, onClick: () => void favourites.toggle(favourite(c)) }}
      settings={target && <Link to="/settings" search={{ target: target.id, app: c.id, project: c.project }} aria-label={`Settings for ${name}`} title="Settings" className={resourceCardActionClass}><Settings size={17}/></Link>}/>;
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
    {!containers.length && <p role="status" className="rounded-lg border border-dashed border-border px-4 py-7 text-sm text-muted-foreground">{needle ? 'No containers match your search.' : data.selectedContainerCount ? 'Your tracked containers are not in the running inventory. If a container was redeployed and its replacement could not be identified, use Add container to select it.' : 'No containers added yet. An administrator can add a running container.'}</p>}
  </div>;
}
