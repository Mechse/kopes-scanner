import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Box, Search } from 'lucide-react';
import { WorkspaceBar, useWorkspace } from '../components/app-shell';
import { post, type Candidate } from '../components/add-resource';
import { Button } from '../components/ui/button';
import { useResource } from '../lib/use-resource';

export const Route = createFileRoute('/containers/new')({
  head: () => ({ meta: [{ title: 'Add container · kopes.dev' }] }),
  component: AddContainerPage,
});

function AddContainerPage() {
  const { inventory } = useWorkspace();
  return <main id="main" className="min-w-0 bg-raised px-4 pb-12 desktop:rounded-[10px] desktop:border desktop:border-border">
    <WorkspaceBar section="Containers" repository="Add container"/>
    <div className="mx-auto max-w-3xl py-10 sm:px-6 sm:py-16">
      {inventory?.error ? <p role="alert">{inventory.error}</p> : !inventory?.data ? <p role="status">Loading…</p> :
        inventory.data.isAdmin ? <ContainerImport/> : <p>Administrator access is required to add a container.</p>}
    </div>
  </main>;
}

function ContainerImport() {
  const navigate = useNavigate();
  const { revision, refresh } = useWorkspace();
  const rows = useResource<Candidate[]>('machine-containers', revision);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const q = query.trim().toLowerCase();
  const shown = rows?.data?.filter(c => (c.name + ' ' + c.image).toLowerCase().includes(q)) ?? [];
  async function add(id: string) {
    setBusy(true); setError('');
    try { await post(id, 'add'); refresh(); await navigate({ to: '/', search: { view: 'apps' } }); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not add container.'); }
    finally { setBusy(false); }
  }
  return <>
    <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Add container</h1>
    <p className="mt-2 text-sm text-muted-foreground">Choose a running container to scan.</p>
    <label className="mt-7 flex items-center gap-3 rounded-lg border border-border bg-background px-3 focus-within:border-brand-ink"><Search size={16} aria-hidden="true"/>
      <input className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none" type="search" aria-label="Search running containers" placeholder="Search containers" value={query} maxLength={300} onChange={e => setQuery(e.target.value)}/>
    </label>
    {error && <p className="mt-3 text-sm text-critical" role="alert">{error}</p>}
    <div className="mt-3 overflow-hidden rounded-lg border border-border">
      {rows?.error ? <p className="p-4" role="alert">{rows.error}</p> : !rows?.data ? <p className="p-4" role="status">Loading containers…</p> : !shown.length ? <p className="p-4 text-sm" role="status">{q ? 'No containers match your search.' : 'No running containers available to add.'}</p> :
        <ul className="divide-y divide-border">{shown.map(c => <li key={c.id} className="flex items-center gap-3 px-4 py-3">
          <Box size={17} className="shrink-0 text-muted-foreground" aria-hidden="true"/>
          <div className="min-w-0 flex-1"><p className="break-all text-sm font-medium">{c.name}</p><p className="break-all text-xs text-muted-foreground">{c.image}</p></div>
          <Button size="sm" variant="outline" disabled={busy} aria-label={`Add ${c.name}`} onClick={() => void add(c.id)}>Add</Button>
        </li>)}</ul>}
    </div>
  </>;
}
