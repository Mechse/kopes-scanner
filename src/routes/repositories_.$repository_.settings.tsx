import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { RepositoryWorkspace, useRepositories, post } from '../components/repositories';
import { RepositoryConnectionSelector } from '../components/repository-connection-selector';
import { SelectField } from '../components/ui/select-field';
import { SelectItem } from '../components/ui/select';
import { Button } from '../components/ui/button';
import { ContentSkeleton } from '../components/ui/loading';
import { useWorkspace } from '../components/app-shell';
import { useSettingsNav } from '../components/settings-nav';

export const Route = createFileRoute('/repositories_/$repository_/settings')({
  head: () => ({ meta: [{ title: 'Repository settings · kopes.dev' }] }),
  component: () => <RepositoryWorkspace><RepositorySettingsPage/></RepositoryWorkspace>,
});

function RepositorySettingsPage() {
  const { repository } = Route.useParams();
  const repos = useRepositories(), data = repos.data;
  const { refresh } = useWorkspace();
  const binding = data?.bindings.find(b => b.id === repository);
  const sections = [{ tab: 'general', label: 'General' }, { tab: 'danger', label: 'Danger zone' }];
  useSettingsNav({ back: { to: '/repositories/$repository', params: { repository }, label: binding?.repository.split('/').at(-1) ?? 'repository' }, sections, scroll: true });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  async function save(form: HTMLFormElement) {
    if (!binding) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const f = new FormData(form);
      const projectId = f.get('projectId') === 'administrators' ? null : f.get('projectId');
      const connectionId = f.get('connectionId') === 'anonymous' ? null : f.get('connectionId');
      if (connectionId && connectionId !== binding.connection_id) await post('repositories', { action: 'switch', bindingId: binding.id, connectionId });
      await post('repositories', { action: 'settings', bindingId: binding.id, projectId, resources: [] });
      setMessage('Settings saved.'); refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <main id="main" className="min-w-0 bg-raised px-4 pb-8 desktop:rounded-[10px] desktop:border desktop:border-border desktop:pb-12 desktop:shadow-sm desktop:dark:shadow-black/30">
    <nav aria-label="Breadcrumb" className="-mx-4 flex min-h-[55px] flex-wrap items-center gap-2 border-b border-border px-4 py-3 text-xs">
      <Link to="/repositories" className="text-muted-foreground hover:text-brand-ink">Repositories</Link><span aria-hidden="true">/</span>
      {binding && <><Link to="/repositories/$repository" params={{ repository }} className="max-w-56 truncate text-muted-foreground hover:text-brand-ink">{binding.repository}</Link><span aria-hidden="true">/</span></>}
      <span aria-current="page">Settings</span>
    </nav>
    {repos.error ? <p role="alert" className="mt-4 rounded-lg border border-critical/20 bg-critical/5 p-4 text-sm text-critical">{repos.error}</p>
      : !data ? <ContentSkeleton label="Loading settings…" layout="settings"/>
      : !data.administrator ? <p role="status" className="py-6 text-sm">Administrator access is required to manage repository settings.</p>
      : !binding ? <p role="status" className="mt-6 max-w-3xl rounded-xl border border-dashed border-border p-5 text-sm leading-6 text-muted-foreground">This repository is no longer in the inventory. Return to Repositories to select another.</p>
      : <div className="max-w-3xl py-6">
        <header className="mb-6"><h1 className="mb-1 text-xl font-medium tracking-tight">Repository settings</h1><p className="text-sm text-muted-foreground">Scan the default branch using public access or an explicitly selected GitHub connection.</p></header>
        <form id="general" className="scroll-mt-4 space-y-4" onSubmit={e => { e.preventDefault(); void save(e.currentTarget); }} onChange={() => setMessage('')}>
          <RepositoryConnectionSelector/>
          <label className="block text-sm">Container access<SelectField aria-label="Container access" className="mt-1 w-full" name="projectId" defaultValue={binding.project_id ?? 'administrators'}><SelectItem value="administrators">Administrators only</SelectItem>{data.projects.filter(p => !p.archived || p.id === binding.project_id).map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectField></label>
          <p className="text-xs text-muted-foreground">Changing the container changes who can access this repository’s scan history.</p>
          {!(data.flags.connections && data.flags.scanning) && <p className="text-sm text-muted-foreground">Source scanning is currently unavailable.</p>}
          {error && <p role="alert" className="text-sm text-critical">{error}</p>}
          {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
          <div className="sticky bottom-0 z-10 flex justify-end border-t border-border bg-raised py-3"><Button busy={busy}>Save settings</Button></div>
        </form>
        <section id="danger" className="scroll-mt-4 border-t border-border py-6">
          <h2 className="m-0! text-sm! font-medium">Remove repository</h2>
          <p className="mt-1 mb-3 text-xs leading-5 text-muted-foreground">Permanently remove this repository and its scan history from Kopes.</p>
          <Button type="button" variant="outline" size="sm" className="border-critical text-critical" onClick={() => repos.remove(binding)}>Remove repository</Button>
        </section>
      </div>}
  </main>;
}
