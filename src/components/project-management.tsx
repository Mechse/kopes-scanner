import { LayoutGrid, List, Box } from 'lucide-react';
import { useEffect } from 'react';
import { useWorkspace } from './app-shell';
import { ProjectHistory } from '../components/project-history';
import { RepositoryMenu } from './repositories';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { api, useResource } from '../lib/use-resource';
import { Button } from '../components/ui/button';
import type { Report } from '../lib/model';
import { defaultSettings, cadenceLabels, type ScanSettings } from '../lib/settings';

type Project = { id: string; name: string; archived: number; settings_json?: string };
type Resource = { id: string; name: string; environment: string | null; identity_warning?: number; legacyGroups?: string[] };
type Preview = { resourceId: string; from: string | null; to: string; preserved: ScanSettings; reset: ScanSettings; revision: string };
const field = 'rounded border border-border bg-background px-3 py-2 text-sm';
export function ProjectManagement({ id, resource, overviewOnly = false }: { id?: string; resource?: string; overviewOnly?: boolean }) {
  const [view, setView] = useState<'grid' | 'line'>('grid');
  useEffect(() => { if (localStorage.getItem('kopes.projects-view') === 'line') setView('line'); }, []);
  const { refresh: refreshWorkspace, revision: workspaceRevision } = useWorkspace();
  const [revision, refresh] = useState(0), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const overview = useResource<{ projects: Project[]; administrator: boolean }>('projects?view=overview', revision);
  const detail = useResource<{ project: Project; resources: Resource[] }>(id ? `projects?id=${encodeURIComponent(id)}` : '', revision + workspaceRevision);
  const admin = overview?.data?.administrator;
  const unassigned = useResource<Resource[]>(admin ? 'projects?view=unassigned' : '', revision);
  const members = useResource<{ id: string; name: string; email: string; member: number }[]>(admin && id ? `projects?view=members&id=${encodeURIComponent(id)}` : '', revision);
  const observations = useResource<{ id: string; scanned_at: number; current_image: number; imported: number }[]>(id && resource ? `projects?view=observations&id=${encodeURIComponent(id)}&resourceId=${encodeURIComponent(resource)}` : '', revision);
  const [selected, select] = useState('');
  const evidencePath = id && resource && selected ? `projects?view=observation&id=${encodeURIComponent(id)}&resourceId=${encodeURIComponent(resource)}&observationId=${encodeURIComponent(selected)}` : '';
  const evidence = useResource<{ report: Report }>(evidencePath, revision);
  const [preview, setPreview] = useState<Preview | null>(null), [destination, setDestination] = useState('');
  async function mutate(body: unknown) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/data/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(await response.text());
      refresh(n => n + 1); refreshWorkspace(); setPreview(null);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function assignment(resourceId: string) {
    setError('');
    try { setPreview(await api<Preview>(`projects?view=move-preview&id=${encodeURIComponent(destination)}&resourceId=${encodeURIComponent(resourceId)}`)); }
    catch (e) { setError((e as Error).message); }
  }
  const projects = overview?.data?.projects ?? [];
  const resources = id ? detail?.data?.resources ?? [] : unassigned?.data ?? [];
  return <div className="min-w-0 rounded-lg border border-border bg-raised p-5 space-y-6">
    {id && <><Link to="/" search={{ view: 'apps', managedId: id }}>Back to container</Link><h1>{detail?.data?.project.name ?? 'Container'}</h1></>}
    <p className="text-sm text-muted-foreground">Organize resources, manage container access and configure scans.</p>
    {(error || overview?.error || detail?.error || members?.error || observations?.error || evidence?.error) && <p role="alert">{error || overview?.error || detail?.error || members?.error || observations?.error || evidence?.error}</p>}
    {!overview?.data && !overview?.error && <p role="status">Loading containers…</p>}
    {!id && <><div className="grid gap-3 sm:grid-cols-2">{!overviewOnly && projects.map(p => <Link key={p.id} to="/" search={{ view: 'apps', managedId: p.id }} className="rounded border border-border p-4">{p.name}{p.archived ? ' · Archived' : ''}</Link>)}</div>
      {!projects.length && overview?.data && <p>No containers available. An administrator can create one and grant access.</p>}
      {admin && <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void mutate({ action: 'create', name: f.get('name') }); }}><input className={field} name="name" aria-label="New container name" placeholder="New container name" required maxLength={120}/><Button busy={busy}>Create container</Button></form>}</>}
    {id && admin && detail?.data && <section className="space-y-3"><h2>Container settings</h2><form key={id + revision} className="flex flex-wrap items-center gap-3" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void mutate({ action: 'update', id, name: f.get('name'), archived: f.has('archived') }); }}><input className={field} name="name" aria-label="Container name" defaultValue={detail.data.project.name} required maxLength={120}/><label><input type="checkbox" name="archived" defaultChecked={!!detail.data.project.archived}/> Archived</label><Button busy={busy}>Save container</Button></form>
      <form key={'defaults'+id+revision} className="flex flex-wrap gap-3 items-center" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void mutate({action:'defaults',id,settings:{rescanHours:Number(f.get('hours')),notifyNewCve:f.has('new'),notifyFix:f.has('fix')}});}}><label>Default scan interval<select className={field} name="hours" defaultValue={JSON.parse(detail.data.project.settings_json??'{}').rescanHours??168}>{Object.entries(cadenceLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label><input name="new" type="checkbox" defaultChecked={JSON.parse(detail.data.project.settings_json??'{}').notifyNewCve??true}/> New findings</label><label><input name="fix" type="checkbox" defaultChecked={JSON.parse(detail.data.project.settings_json??'{}').notifyFix??true}/> Fix available</label><Button busy={busy}>Save scan defaults</Button></form>
      <h2>Container members</h2><p className="text-sm text-muted-foreground">Only people who have signed in appear here. Instance administrators always have access.</p>
      {members?.data?.map(m => <label key={m.id} className="block"><input type="checkbox" disabled={busy} checked={!!m.member} onChange={e => void mutate({ action: 'membership', id, userId: m.id, enabled: e.target.checked })}/> {m.name} · {m.email}</label>)}
    </section>}
    <div className="flex justify-end gap-1" role="group" aria-label="View">{(['grid','line'] as const).map(v => <button type="button" key={v} aria-pressed={view === v} onClick={() => {setView(v); localStorage.setItem('kopes.projects-view', v);}} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground aria-pressed:bg-brand-tint aria-pressed:text-brand-ink">{v === 'grid' ? <LayoutGrid size={14}/> : <List size={14}/>}{v === 'grid' ? 'Grid' : 'Line'}</button>)}</div>
    {(id || admin) && <section className="space-y-3"><h2>{id ? 'Resources' : 'Unassigned resources'}</h2>
      {admin && <label className="flex flex-wrap gap-2 items-center">Move destination<select className={field} value={destination} onChange={e => { setDestination(e.target.value); setPreview(null); }}><option value="">Select a container</option>{projects.filter(p => !p.archived).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
      {!resources.length && <p>No resources assigned.</p>}
      <div className={view === 'grid' ? 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-4' : '@container min-w-0'}>{resources.map(r => <article key={r.id} className={view === 'grid' ? 'rounded-xl border border-border bg-raised p-5 space-y-3' : 'border-b border-border/60 px-3 py-2.5 space-y-3 last:border-b-0'}>
        <div className="flex items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-lg bg-background text-muted-foreground"><Box size={20}/></span><span className="min-w-0 flex-1 truncate text-sm font-medium">{r.name}</span><RepositoryMenu label={r.name} resourceId={r.id}/></div>
        {id ? <Link to="/" search={{ view: 'apps', managedId: id, resource: r.id }}>{r.name} · {r.environment || 'Environment unknown'}</Link> : <p>{r.name} · {r.environment || 'Environment unknown'}</p>}
        {r.identity_warning ? <p role="status">Conflicting discovery identity. Kept separate; review assignment before linking source.</p> : null}
        {r.legacyGroups && <p className="text-sm text-muted-foreground">Discovered groups: {r.legacyGroups.join(", ")}</p>}
        {admin && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!destination || busy} onClick={() => void assignment(r.id)}>Preview assignment</Button>
          {id && <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void mutate({ action: 'resource', id, resourceId: r.id, name: f.get('name'), environment: f.get('environment') }); }}><input className={field} name="name" aria-label="Resource name" required maxLength={120} defaultValue={r.name}/><input className={field} name="environment" aria-label="Environment" maxLength={120} defaultValue={r.environment ?? ''}/><Button size="sm" busy={busy}>Save resource</Button><Button type="button" size="sm" variant="outline" busy={busy} onClick={()=>void mutate({action:"inherit",id,resourceId:r.id})}>Reset scan settings to container defaults</Button></form>}
        </div>}
      </article>)}</div>
    </section>}
    {preview && <section className="rounded border border-brand-ink p-4 space-y-3" aria-label="Assignment preview"><h2>Review assignment</h2><p>Current scan interval: {preview.preserved.rescanHours} hours. New container default: {preview.reset.rescanHours} hours.</p><p>Existing inventory access stays unchanged. Container members will gain access to this resource’s container-scoped history.</p><div className="flex flex-wrap gap-2"><Button busy={busy} onClick={() => void mutate({ action: 'move', resourceId: preview.resourceId, projectId: preview.to, revision: preview.revision, reset: false })}>Assign and preserve settings</Button><Button variant="outline" busy={busy} onClick={() => void mutate({ action: 'move', resourceId: preview.resourceId, projectId: preview.to, revision: preview.revision, reset: true })}>Assign and reset settings</Button><Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button></div></section>}
    {id && detail?.data && <ProjectHistory projectId={id} administrator={!!admin} resources={detail.data.resources}/>}
    {id && resource && <section className="space-y-3"><h2>Running resource scan history</h2><Button busy={busy} onClick={() => void mutate({ action: 'rescan', id, resourceId: resource })}>Request scan of current images</Button>
      {!observations?.data?.length && <p>No retained scan observations.</p>}
      {observations?.data?.map(o => <button className="block text-left underline" key={o.id} onClick={() => select(o.id)}>{new Date(o.scanned_at).toLocaleString()} · {o.current_image ? 'Image currently observed' : 'Historical image'}{o.imported ? ' · Imported' : ''}</button>)}
      {evidence?.data && <><a className="underline" href={`/api/data/${evidencePath.replace('view=observation&', 'view=export&')}`}>Export retained SBOM</a><p>{evidence.data.report.findings.length} finding occurrences · {evidence.data.report.packages.length} identified packages. Absence of findings alone does not establish coverage.</p><ul className="space-y-2">{evidence.data.report.findings.map((f, n) => <li key={n}>{f.id} · {f.package}@{f.installed} · {f.fixed ? `Fix available: ${f.fixed}` : 'No fixed version reported'}</li>)}</ul></>}
    </section>}
  </div>;
}
