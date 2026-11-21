import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { LayoutGrid, List } from 'lucide-react';
import { WorkspaceBar } from '../components/app-shell';
import { FindingsSearch } from '../components/findings-search';
import { SearchToolbar } from '../components/search-toolbar';
import { RepositoryWorkspace, RepositoryActions, RepositoryCard, useRepositories } from '../components/repositories';
export const Route = createFileRoute('/repositories')({ component: Page });
function Page() { return <RepositoryWorkspace><RepositoriesPage/></RepositoryWorkspace>; }
function RepositoriesPage() {
  const { data, error, favourites } = useRepositories();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'grid' | 'line'>('grid');
  useEffect(() => {
    try { if (localStorage.getItem('kopes.repositories-view') === 'line') setView('line'); }
    catch { /* Use Grid when storage is unavailable. */ }
  }, []);
  function changeView(next: 'grid' | 'line') {
    setView(next);
    try { localStorage.setItem('kopes.repositories-view', next); }
    catch { /* The view still works without storage. */ }
  }
  const bindings = data?.bindings.filter(b => `${b.repository} ${b.branch}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  const favouriteBindings = bindings.filter(b => favourites.has({ scope: 'resource', key: `repo:${b.id}` }));
  // Match the project inventory: small collections do not repeat favourites.
  const omitFavourites = (data?.bindings.length ?? 0) <= 10;
  const regularBindings = omitFavourites ? bindings.filter(b => !favouriteBindings.includes(b)) : bindings;
  const hasFavourites = favouriteBindings.length > 0;
  const collectionClass = view === 'grid' ? 'resource-card-grid' : '@container min-w-0';
  return <main id="main" className="min-w-0 bg-raised px-4 pb-8 desktop:rounded-[10px] desktop:border desktop:border-border desktop:pb-12 desktop:shadow-sm desktop:dark:shadow-black/30">
    <WorkspaceBar section="Repositories" actions={<RepositoryActions/>}/>
    <SearchToolbar>
      <FindingsSearch label="Search repositories" value={query} onChange={setQuery}/>
      <div data-toolbar-control className="flex shrink-0 rounded border border-border p-0.5" role="group" aria-label="View">
        {([['grid', LayoutGrid, 'Grid'], ['line', List, 'Line']] as const).map(([mode, Icon, label]) => <button key={mode} type="button" aria-pressed={view === mode} onClick={() => changeView(mode)} className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs text-muted-foreground aria-pressed:bg-brand-tint aria-pressed:text-brand-ink"><Icon size={14}/>{label}</button>)}
      </div>
    </SearchToolbar>
    {error && <p role="alert">{error}</p>}{data?.storageError && <p role="status">{data.storageError}</p>}
    {data && (!data.flags.connections || !data.flags.scanning) && <p role="status" className="mb-4">Repository scanning is currently unavailable. Enable the source scanner to run automatic and manual scans.</p>}
    {favourites.error && <p role="alert" className="mb-4 text-sm text-critical">{favourites.error}</p>}
    {!data && !error ? <p role="status">Loading repositories…</p> : !bindings.length ? <p role="status" className="rounded-lg border border-dashed border-border px-4 py-7 text-sm text-muted-foreground">{query ? 'No repositories match your search.' : 'No repositories yet. Add a repository to start dependency analysis.'}</p> : <>
      {hasFavourites && <section aria-label="Favourites" className="mb-9">
        <h2 className="mb-4">Favourites</h2>
        <div className={collectionClass}>{favouriteBindings.map(b => <RepositoryCard key={b.id} binding={b} view={view}/>)}</div>
      </section>}
      {regularBindings.length > 0 && <section aria-label="Repositories">
        {hasFavourites && <h2 className="mb-4">{omitFavourites ? 'Repositories' : 'All repositories'}</h2>}
        <div className={collectionClass}>{regularBindings.map(b => <RepositoryCard key={b.id} binding={b} view={view}/>)}</div>
      </section>}
    </>}
  </main>;
}
