import { SelectField } from './ui/select-field';
import { SelectItem } from './ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuItem } from './ui/dropdown-menu';
import { RepositoryConnectionSelector } from './repository-connection-selector';
import { Link } from '@tanstack/react-router';
import { sourceAssessment } from '../lib/source-assessment';
import { createContext, useContext, useState, useRef, type ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { GitBranch, Plus, X, Ellipsis, Settings } from 'lucide-react';
import { Button } from './ui/button';
import { api, useResource } from '../lib/use-resource';
import { useWorkspace } from './app-shell';
import { useFavourites } from './favourites';
import { ResourceCard, resourceCardActionClass } from './resource-card';
import { type Scan } from './project-sources';

export type Binding = { first_run_finished?: number; id: string; connection_id?: string; connection_label?: string; connection_owner?: string; connection_health?: string; auth_kind?: string; project_id: string | null; repository: string; branch: string; error: string | null; resources: { id: string; name: string }[]; scans: Scan[]; jobs: { state: string; error: string | null }[] };
export type RepositoryInventory = { administrator: boolean; flags: { connections: boolean; scanning: boolean }; storageError: string | null; projects: { id: string; name: string; archived: number }[]; resources: { id: string; name: string; project_id: string | null; containerIds: string[] }[]; bindings: Binding[] };
type Context = { projectId?: string; group?: string; containerId?: string; resourceId?: string };
const RepositoryContext = createContext<{
  data?: RepositoryInventory; error?: string; favourites: ReturnType<typeof useFavourites>;
  edit: (binding: Binding) => void; assign: (context: Context) => void; restoreFocus: () => void;
} | null>(null);
export function useRepositories() { const value = useContext(RepositoryContext); if (!value) throw new Error('Repository workspace unavailable'); return value; }
export async function post(endpoint: string, body: unknown) {
  const response = await fetch(`/api/data/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await response.text(); let result; try { result = JSON.parse(text); } catch { result = { error: text }; }
  if (!response.ok) throw new Error(result.error ?? result.reason ?? 'Request failed.'); return result;
}
function Modal({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const repos = useRepositories();
  return <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-40 bg-black/55"/><Dialog.Content onCloseAutoFocus={e => { e.preventDefault(); repos.restoreFocus(); }} className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[min(1100px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-raised p-5 shadow-xl">
    <div className="flex items-center justify-between gap-3"><Dialog.Title className="text-base font-medium">{title}</Dialog.Title><Dialog.Close asChild><Button type="button" size="icon" variant="ghost" aria-label="Close"><X size={18}/></Button></Dialog.Close></div>
    <Dialog.Description className="mt-1 text-sm text-muted-foreground">{description}</Dialog.Description>{children}
  </Dialog.Content></Dialog.Portal>;
}
export function RepositoryWorkspace({ children }: { children: ReactNode }) {
  const { revision, refresh } = useWorkspace();
  const inventory = useResource<RepositoryInventory>('repositories', revision, 10000), data = inventory?.data;
  const favourites = useFavourites();
  const returnFocus = useRef<HTMLElement | null>(null);
  const [mode, setMode] = useState<'edit' | 'assignment' | 'remove' | null>(null);
  const [context, setContext] = useState<Context>({}), [binding, setBinding] = useState<Binding | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const resourceId = context.resourceId ?? data?.resources.find(r => r.containerIds.includes(context.containerId ?? ''))?.id;
  const selectedBinding = binding;
  function open(next: typeof mode, ctx: Context = {}, b: Binding | null = null) { if (!mode) returnFocus.current = document.activeElement as HTMLElement; setContext(ctx); setBinding(b); setMode(next); setError(''); }
  const value = { restoreFocus: () => returnFocus.current?.focus(), data, error: inventory?.error, favourites, edit: (b: Binding) => open('edit', {}, b), assign: (ctx: Context) => open('assignment', ctx) };
  async function save(form: HTMLFormElement) {
    setBusy(true); setError('');
    try {
      const f = new FormData(form);
      if (mode === 'assignment') {
        if (!resourceId) throw new Error('Resource is no longer available.');
        const projectId = String(f.get('projectId') ?? '');
        const preview = await api<{revision:string}>(`projects?view=move-preview&id=${encodeURIComponent(projectId)}&resourceId=${encodeURIComponent(resourceId)}`);
        await post('projects', { action: 'move', projectId, resourceId, revision: preview.revision, reset: false });
      } else {
        let projectId = f.get('projectId') === 'administrators' ? null : f.get('projectId');
        const connectionId = f.get('connectionId') === 'anonymous' ? null : f.get('connectionId');
        if (projectId === '__discovered' && context.group !== undefined) projectId = (await post('projects', { action: 'adopt', group: context.group })).id;
        const resources: string[] = [];
        if (!selectedBinding) throw new Error('Select a repository.');
        if (connectionId && connectionId !== selectedBinding.connection_id) await post('repositories',{action:'switch',bindingId:selectedBinding.id,connectionId});
        await post('repositories', { action: 'settings', bindingId: selectedBinding.id, projectId, resources });
      }
      refresh(); setMode(null);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function removeRepository() {
    if (!binding || busy) return;
    setBusy(true); setError('');
    try {
      await post('repositories', { action: 'remove', bindingId: binding.id });
      refresh(); setMode(null); setBinding(null);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <RepositoryContext.Provider value={value}>{children}
    <Dialog.Root open={mode !== null} onOpenChange={open => { if (!open && !busy) setMode(null); }}>
      {mode === 'remove' && binding ? <Modal title={`Remove ${binding.repository}?`} description="This permanently removes the repository everywhere in Kopes. This cannot be undone.">
        <div className="mt-5 space-y-4 text-sm">
          <ul className="list-disc space-y-2 pl-5"><li>Remove this repository from all containers, across all branches and folders.</li><li>Delete all source scan history, findings, evidence, saved inventories and jobs, including running scans.</li><li>Remove repository favourites for all users.</li></ul>
          <p>Containers and shared provider credentials will be kept. The repository on GitHub or GitLab will not be deleted.</p>
          <p>You can add it again later.</p>
          {error && <p role="alert" className="text-critical">{error}</p>}
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={() => { setError(''); setMode('edit'); }}>Cancel</Button><Button type="button" variant="outline" className="border-critical text-critical" busy={busy} onClick={() => void removeRepository()}>Remove everywhere</Button></div>
        </div>
      </Modal> : mode === 'assignment' ? <Modal title="Move resource" description="Choose a container. Existing scan settings are preserved."><form className="mt-5 space-y-4" onSubmit={e => { e.preventDefault(); void save(e.currentTarget); }}><label className="block text-sm">Container<SelectField aria-label="Container" className="mt-1 w-full" name="projectId" required placeholder="Select a container">{data?.projects.filter(p => !p.archived).map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectField></label><p className="text-sm text-muted-foreground">Members of the destination container will gain access to this resource’s scan history.</p>{error && <p role="alert">{error}</p>}<Button busy={busy}>Move resource</Button></form></Modal> : mode === 'edit' && <Modal title="Repository settings" description="Scan the default branch using public access or an explicitly selected GitHub connection.">
        <form className="mt-5 space-y-4" onSubmit={e => { e.preventDefault(); void save(e.currentTarget); }}>
          <RepositoryConnectionSelector/>
          <label className="block text-sm">Container access<SelectField aria-label="Container access" className="mt-1 w-full" name="projectId" defaultValue={selectedBinding?.project_id ?? 'administrators'}><SelectItem value="administrators">Administrators only</SelectItem>{data?.projects.filter(p => !p.archived || p.id === selectedBinding?.project_id).map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectField></label>
          <p className="text-sm text-muted-foreground">{data?.flags.connections && data.flags.scanning ? 'New repositories use their default branch and start a source scan.' : 'You can add repositories now. Source scanning is currently unavailable.'}</p>
          {mode === 'edit' && <p className="text-xs text-muted-foreground">Changing the container changes who can access this repository’s scan history.</p>}
          {error && <p role="alert" className="text-sm text-critical">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">{mode === 'edit' && binding && <Button type="button" variant="ghost" className="mr-auto text-critical" disabled={busy} onClick={() => open('remove', {}, binding)}>Remove repo</Button>}<Dialog.Close asChild><Button type="button" variant="ghost" disabled={busy}>Cancel</Button></Dialog.Close><Button busy={busy}>Save settings</Button></div>
        </form>
      </Modal>}
    </Dialog.Root>
  </RepositoryContext.Provider>;
}
export function RepositoryActions() {
  const repos = useRepositories();
  if (!repos.data?.administrator) return null;
  return <Button size="sm" asChild><Link to="/repositories/new"><Plus size={14}/>Add repository</Link></Button>;
}
export function RepositoryMenu({ label, onSettings, ...context }: Context & { label: string; onSettings?: () => void }) {
  const repos = useRepositories();
  if (!repos.data?.administrator) return null;
  return <DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label={`Actions for ${label}`} className="relative z-10 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sunken hover:text-foreground"><Ellipsis size={17}/></button></DropdownMenuTrigger><DropdownMenuContent align="end">{(context.containerId || context.resourceId) && <DropdownMenuItem onSelect={() => repos.assign(context)}>Move to container</DropdownMenuItem>}{onSettings && <DropdownMenuItem onSelect={onSettings}>Container settings</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>;
}
export function RepositoryCard({ binding: b, view = 'grid' }: { binding: Binding; view?: 'grid' | 'line' }) {
  const repos = useRepositories(), item = { scope: 'resource' as const, key: `repo:${b.id}` };
  const repositoryName = b.repository.split('/').pop() || b.repository;
  const scan = b.scans[0];
  return <ResourceCard view={view} icon={<GitBranch size={20}/>}
    title={<Link to="/repositories/$repository" params={{ repository: b.id }} aria-label={b.repository} title={b.repository} className="block truncate after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-brand-ink">{repositoryName}</Link>}
    subtitle={b.branch} vulnerabilities={scan && (sourceAssessment(scan) === 'Scanned' || scan.occurrences > 0) ? scan.occurrences : undefined}
    favourite={{ name: b.repository, active: repos.favourites.has(item), disabled: repos.favourites.disabled, onClick: () => void repos.favourites.toggle(item) }}
    settings={repos.data?.administrator && <button type="button" aria-label={`Settings for ${b.repository}`} title="Settings" onClick={() => repos.edit(b)} className={resourceCardActionClass}><Settings size={17}/></button>}/>;
}
