import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookMarked, Link2, Search } from 'lucide-react';
import { WorkspaceBar, useWorkspace } from '../components/app-shell';
import { post, type RepositoryInventory } from '../components/repositories';
import { Button } from '../components/ui/button';
import { SelectField } from '../components/ui/select-field';
import { SelectItem } from '../components/ui/select';
import type { GithubSettingsData } from '../lib/github';
import type { RepositoryPickerData } from '../lib/repository-picker';
import { useResource } from '../lib/use-resource';

export const Route = createFileRoute('/repositories_/new')({
  head: () => ({ meta: [{ title: 'Add repository · kopes.dev' }] }),
  component: AddRepositoryPage,
});

function AddRepositoryPage() {
  const { revision } = useWorkspace();
  const inventory = useResource<RepositoryInventory>('repositories', revision);
  return <main id="main" className="min-w-0 bg-raised px-4 pb-12 desktop:rounded-[10px] desktop:border desktop:border-border">
    <WorkspaceBar section="Repositories" repository="Add repository"/>
    <div className="mx-auto max-w-3xl py-10 sm:px-6 sm:py-16">
      {inventory?.error ? <p role="alert">{inventory.error}</p> : !inventory?.data ? <p role="status">Loading repositories…</p> :
        inventory.data.administrator ? <RepositoryImport inventory={inventory.data}/> : <p>Administrator access is required to add a repository.</p>}
    </div>
  </main>;
}

function RepositoryImport({ inventory }: { inventory: RepositoryInventory }) {
  const navigate = useNavigate();
  const { refresh } = useWorkspace();
  const settings = useResource<GithubSettingsData>('github', 0);
  const connections = settings?.data?.connections.filter(item => !item.disconnected) ?? [];
  const apps = connections.filter(item => item.auth_kind === 'github_app');
  const [account, setAccount] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ view: 'picker', q: query.trim(), connectionId: account, page: String(page) });
  const picker = useResource<RepositoryPickerData>(apps.length ? 'github-repositories?' + params : '', 0);
  const [url, setUrl] = useState('');
  const [choice, setChoice] = useState<{ name: string; fromList: boolean } | null>(null);
  const [connection, setConnection] = useState('');
  const [project, setProject] = useState('administrators');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (choice) heading.current?.focus();
    else trigger.current?.focus();
  }, [choice]);

  function review(name: string, connectionId = '') {
    trigger.current = document.activeElement as HTMLElement;
    setChoice({ name, fromList: !!connectionId });
    setConnection(connectionId);
    setError('');
  }
  async function add() {
    if (!choice || busy) return;
    setError('');
    setBusy(true);
    try {
      await post('repositories', { action: 'add', repository: choice.name, connectionId: connection || null, projectId: project === 'administrators' ? null : project, resources: [] });
      refresh();
      await navigate({ to: '/repositories' });
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  const title = 'text-3xl font-semibold tracking-tight sm:text-4xl';
  const input = 'min-w-0 flex-1 bg-transparent py-3 text-sm outline-none';
  const field = 'flex items-center gap-3 rounded-lg border border-border bg-background px-3 focus-within:border-brand-ink';
  return <>
    <div hidden={!!choice}>
      <h1 className={title}>Add repository</h1>
      <form className="mt-7" onSubmit={event => { event.preventDefault(); if (url.trim()) review(url.trim()); }}>
        <label htmlFor="repository-url" className="mb-2 block text-sm font-medium">Repository URL</label>
        <div className={field}><Link2 size={17} aria-hidden="true"/>
          <input id="repository-url" className={input} placeholder="https://github.com/owner/repository" value={url} onChange={e => setUrl(e.target.value)} maxLength={300} required/>
          <Button size="sm" disabled={!url.trim()}>Continue</Button>
        </div>
      </form>
      <section className="mt-12" aria-labelledby="github-import">
        <h2 id="github-import" className="text-xl font-semibold tracking-tight">Import from GitHub</h2>
        {settings?.error ? <p role="alert">{settings.error}</p> : !settings?.data ? <p role="status">Loading connections…</p> : !apps.length ?
          <div className="mt-4 rounded-lg border border-border p-5 text-sm"><p className="mb-3">Connect a GitHub App to browse its repositories.</p><Button variant="outline" size="sm" asChild><Link to="/settings" search={{ tab: 'integrations', section: 'github' }}>Manage connections</Link></Button></div> : <>
          <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(10rem,1fr)_2fr]">
            <SelectField aria-label="GitHub connection" className="h-full min-h-10 w-full" value={account || 'all'} onValueChange={value => { setAccount(value === 'all' ? '' : value); setPage(1); }}>
              <SelectItem value="all">All connections</SelectItem>{apps.map(c => <SelectItem key={c.id} value={c.id}>{c.label || c.owner_login || 'GitHub App'}</SelectItem>)}
            </SelectField>
            <label className={field}><Search size={16} aria-hidden="true"/><input className={input} type="search" aria-label="Search connected repositories" placeholder="Search repositories" value={query} maxLength={300} onChange={e => { setQuery(e.target.value); setPage(1); }}/></label>
          </div>
          <div className="mt-3 overflow-hidden rounded-lg border border-border">
            {picker?.error ? <p className="p-4" role="alert">{picker.error}</p> : !picker?.data ? <p className="p-4" role="status">Loading repositories…</p> : !picker.data.total ? <p className="p-4 text-sm" role="status">{query ? 'No repositories match your search.' : 'No repositories available on this connection.'}</p> :
              <ul className="divide-y divide-border">{picker.data.repositories.map(r => <li key={r.repository_id} className="flex items-center gap-3 px-4 py-3">
                <BookMarked size={17} className="shrink-0 text-muted-foreground" aria-hidden="true"/>
                <div className="min-w-0 flex-1"><p className="break-all text-sm font-medium">{r.name}</p><p className="text-xs text-muted-foreground">{r.private ? 'Private' : 'Public'}</p></div>
                {r.binding_id ? <Link className="text-xs underline" to="/repositories/$repository" params={{ repository: r.binding_id }}>View repository</Link> : <Button size="sm" variant="outline" aria-label={'Import ' + r.name} onClick={() => review(r.name, r.connection_id)}>Import</Button>}
              </li>)}</ul>}
          </div>
          {(page > 1 || picker?.data?.hasMore) && <div className="mt-3 flex items-center justify-between text-sm"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>Page {page}<Button size="sm" variant="outline" disabled={!picker?.data?.hasMore} onClick={() => setPage(page + 1)}>Next</Button></div>}
        </>}
      </section>
    </div>
    {choice && <form className="max-w-xl" onSubmit={event => { event.preventDefault(); void add(); }}>
      <Button className="mb-6" type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setChoice(null)}><ArrowLeft/>Choose another repository</Button>
      <h1 ref={heading} tabIndex={-1} className={title}>Review access</h1>
      <p className="my-5 break-all rounded-lg border border-border px-4 py-3 text-sm font-medium">{choice.name}</p>
      <label className="block text-sm">Repository connection<SelectField aria-label="Repository connection" className="mt-1 w-full" disabled={busy || choice.fromList} value={connection || 'anonymous'} onValueChange={v => setConnection(v === 'anonymous' ? '' : v)}>
        <SelectItem value="anonymous">Public access</SelectItem>{connections.map(c => <SelectItem key={c.id} value={c.id}>{c.label || c.owner_login || 'Legacy connection'}</SelectItem>)}
      </SelectField></label>
      <label className="mt-5 block text-sm">Container access<SelectField aria-label="Container access" className="mt-1 w-full" disabled={busy} value={project} onValueChange={setProject}>
        <SelectItem value="administrators">Administrators only</SelectItem>{inventory.projects.filter(p => !p.archived).map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
      </SelectField></label>
      <p className="mt-2 text-xs text-muted-foreground">{project === 'administrators' ? 'Only administrators can view this repository and its scan history.' : 'Members of this container can view the repository and its scan history.'}</p>
      <p className="mt-6 text-sm">{inventory.flags.connections && inventory.flags.scanning ? 'Adding this repository starts a scan of its default branch.' : 'Source scanning is currently unavailable. You can still add the repository.'}</p>
      {error && <p className="mt-3 text-sm text-critical" role="alert">{error}</p>}
      <Button className="mt-5" busy={busy}>Add repository</Button>
    </form>}
  </>;
}
