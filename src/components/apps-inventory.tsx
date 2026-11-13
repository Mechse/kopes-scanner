import { RepositoryMenu, useRepositories } from './repositories';
import { Button } from './ui/button';
import { useNavigate } from '@tanstack/react-router';
import { useWorkspace } from './app-shell';
import { useResource } from '../lib/use-resource';
import { FavouriteButton, useFavourites } from './favourites';
import { resourceKey } from '../lib/settings';
import type { Favourite } from '../lib/favourites';
import { resourceName, projectName as displayProjectName } from '../lib/display-name';
import { BusyIndicator } from "./ui/loading";
import { SearchToolbar } from "./search-toolbar";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Folder, FolderGit2, LayoutGrid, List } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { type Container, type Dashboard, type Target } from "../lib/model";
import { FindingsSearch } from "./findings-search";
import { ResourceIcon } from "./resource-icon";
import { Assessment } from "./assessment";
import { pillClass } from "./ui/pill";
import { projectLabel } from "../lib/project-label";

type View = "grid" | "line";
const preferenceKey = "kopes.projects-view";


const resourceRowClass = "mobile-resource-row group relative isolate grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-border/60 px-3 py-2.5 last:border-b-0 hover:bg-sunken/50 @min-[720px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_148px_100px]";

function ResourceLine({ target, container, star, actions }: { target?: Target; container?: Container; star?: ReactNode; actions?: ReactNode }) {
  const name = resourceName(container ?? target);
  const image = container?.image ?? target?.summary?.os ?? "Operating system packages";
  const findings = target?.summary
    ? Object.values(target.summary.counts).reduce((sum, count) => sum + count, 0)
    : undefined;

  return <article className={resourceRowClass}>
    <div className="flex min-w-0 items-center gap-2">
      {star}{actions}
      <ResourceIcon container={container} />
      {target ? <Link
        to="/"
        search={{ view: "apps", target: target.id, app: container?.id, project: container?.project }}
        title={name}
        aria-label={`Open report for ${name}`}
        className="min-w-0 truncate text-sm font-medium after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-brand-ink"
      >{name}</Link> : <span title={name} className="truncate text-sm font-medium">{name}</span>}
    </div>
    <span title={image} className="col-start-1 row-start-2 min-w-0 truncate pl-20 text-xs text-muted-foreground @min-[720px]:col-start-auto @min-[720px]:row-start-auto @min-[720px]:pl-0">{image}</span>
    <div className="col-start-2 row-start-1 justify-self-end @min-[720px]:col-start-auto @min-[720px]:row-start-auto @min-[720px]:justify-self-start">
      {target ? <div className="flex flex-wrap items-center gap-2"><Assessment targets={[target]} />{target.status === 'error' && <Link to="/" search={{ view: 'apps', target: target.id, app: container?.id, project: container?.project, tab: 'activity', events: 'scans' }} hash={`scan-status-${target.id}`} className="relative z-10 text-xs text-critical hover:underline">Scan failed</Link>}</div> : <span className="text-xs text-muted-foreground">Awaiting scan target</span>}
    </div>
    <span className="col-start-2 row-start-2 text-right text-xs tabular-nums text-muted-foreground @min-[720px]:col-start-auto @min-[720px]:row-start-auto">
      {findings !== undefined ? <>{findings} {findings === 1 ? "finding" : "findings"}</> : <span aria-label="Findings unavailable">—</span>}
    </span>
  </article>;
}

function Resource({ target, container, view, star, actions }: { target: Target; container?: Container; view: View; star?: ReactNode; actions?: ReactNode }) {
  if (view === "line") return <ResourceLine target={target} container={container} star={star} actions={actions} />;
  const name = resourceName(container ?? target);
  const image = container?.image ?? target.summary?.os ?? "Operating system packages";
  const search = { view: "apps" as const, target: target.id, app: container?.id, project: container?.project };
  const findings = target.summary
    ? Object.values(target.summary.counts).reduce((sum, count) => sum + count, 0)
    : undefined;

  return (
    <article className="group relative isolate flex min-w-0 flex-col gap-5 rounded-xl border border-border bg-raised p-5 hover:border-brand-ink">
      <div className="flex min-w-0 items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-background">
          <ResourceIcon container={container} />
        </div>
        <div className="min-w-0 flex-1">
          <Link
            to="/"
            search={search}
            title={name}
            aria-label={`Open report for ${name}`}
            className="block truncate text-sm leading-5 font-medium after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-brand-ink"
          >
            {name}
          </Link>
          <span title={`${container?.manager ?? "Host"} · ${image}`} className="block truncate text-xs leading-5 text-muted-foreground">{image}</span>
        </div>
        {star}{actions}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Assessment targets={[target]} />
        {findings !== undefined && <span className={pillClass}>
          {findings} {findings === 1 ? "finding" : "findings"}
        </span>}
        {(target.status === "error" || target.status === "scanning" || target.status === "queued") && (
          target.status === "error" ? <Link to="/" search={{ ...search, tab: 'activity', events: 'scans' }} hash={`scan-status-${target.id}`} className={`${pillClass} relative z-10 text-critical hover:underline`}><span aria-hidden="true" className="size-1 shrink-0 rounded-full bg-critical" />Scan failed</Link> : <span className={pillClass}>
            {target.status === "scanning" && <BusyIndicator />}
            {target.status === "scanning" ? "Scanning" : "Queued"}
          </span>
        )}
        <ArrowUpRight size={16} className="ml-auto shrink-0 text-muted-foreground" aria-hidden="true" />
      </div>
    </article>
  );
}

export function ProjectsInventory({ data, project, managedId }: { data: Dashboard; project?: string; managedId?: string }) {
  const { revision, refresh } = useWorkspace();
  const navigate = useNavigate();
  const [managementError, setManagementError] = useState('');
  const [adopting, setAdopting] = useState(false);
  const saved = useResource<{ projects: { id: string; name: string; archived: number; discoveredGroups: string[] }[]; administrator: boolean }>('projects?view=overview', revision);
  const repos = useRepositories();
  const favourites = repos.favourites;
  const star = (item: Favourite, name: string) => <FavouriteButton name={name} active={favourites.has(item)} disabled={favourites.disabled} onClick={() => void favourites.toggle(item)} />;
  const resourceStar = (container?: Container) => star({ scope: 'resource', key: resourceKey(container) }, resourceName(container) || 'Host');
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("grid");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(preferenceKey);
      if (saved === "grid" || saved === "line") setView(saved);
    } catch {
      /* Use Grid when storage is unavailable. */
    }
  }, []);
  function changeView(next: View) {
    setView(next);
    try {
      localStorage.setItem(preferenceKey, next);
    } catch {
      /* The view still works without storage. */
    }
  }
  const targets = new Map(data.targets.map((target) => [target.id, target]));
  const assignedContainers = new Set(repos.data?.resources.filter(r => r.project_id !== null).flatMap(r => r.containerIds) ?? []);
  const groups = new Map<string, Container[]>();
  for (const container of data.containers) {
    if (assignedContainers.has(container.id)) continue;
    const group = groups.get(container.project) ?? [];
    group.push(container);
    groups.set(container.project, group);
  }
  const needle = query.trim().toLowerCase();
  const matches = (...values: string[]) =>
    values.some((value) => value.toLowerCase().includes(needle));
  const compare = (a: string, b: string) =>
    a.localeCompare(b, undefined, { numeric: true });
  const assignedGroups = new Set(saved?.data?.projects.flatMap(p => p.discoveredGroups) ?? []);
  const projects = [...groups]
    .filter(([name]) => !assignedGroups.has(name))
    .filter(([name, members]) =>
      matches(
        displayProjectName(name, data), name || "Ungrouped",
        ...members.flatMap((member) => [resourceName(member), member.name, member.image, member.service]),
      ),
    )
    .sort(([a, aMembers], [b, bMembers]) => compare(projectLabel(a, aMembers, data.projectNames).title, projectLabel(b, bMembers, data.projectNames).title));
  const managedProject = saved?.data?.projects.find(p => p.id === managedId);
  const projectContainers = (id: string) => {
    const ids = new Set(repos.data?.resources.filter(r => r.project_id === id).flatMap(r => r.containerIds) ?? []);
    return data.containers.filter(c => ids.has(c.id));
  };
  const members = managedId ? projectContainers(managedId) : project !== undefined ? (groups.get(project) ?? []) : [];
  const resources = members
    .filter((member) => matches(resourceName(member), member.name, member.image, member.manager))
    .sort((a, b) => compare(resourceName(a), resourceName(b)));
  const hosts = data.targets
    .filter(
      (target) =>
        target.kind === "host" &&
        matches(resourceName(target), target.name, target.summary?.os ?? "", "Host OS"),
    )
    .sort((a, b) => compare(resourceName(a), resourceName(b)));
  const drilling = !!managedId || project !== undefined;
  const collectionClass = view === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-4" : "@container min-w-0";
  const resourceActions = (container: Container) => <RepositoryMenu label={resourceName(container)} containerId={container.id}/>;
  const renderResource = (container: Container) => {
    const target = targets.get(container.target_id);
    if (view === "line") return <ResourceLine key={container.id} container={container} target={target} star={resourceStar(container)} actions={resourceActions(container)} />;
    return target ? <Resource key={container.id} container={container} target={target} view={view} star={resourceStar(container)} actions={resourceActions(container)} /> : (
      <article key={container.id} className="flex min-w-0 flex-col gap-5 rounded-xl border border-border bg-raised p-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-background"><ResourceIcon container={container} /></div>
          <div className="min-w-0 flex-1">
            <strong title={resourceName(container)} className="block truncate text-sm leading-5 font-medium">{resourceName(container)}</strong>
            <span title={`${container.manager} · ${container.image}`} className="block truncate text-xs leading-5 text-muted-foreground">{container.image}</span>
          </div>
          {resourceStar(container)}{resourceActions(container)}
        </div>
        <span className={`${pillClass} w-fit`}>Waiting for scan target</span>
      </article>
    );
        };
  const renderProject = ([name, containers]: [string, Container[]], savedProject?: {id:string;name:string;archived:number}) => {
      const ProjectIcon = Folder;
      const resourceCount = containers.length;
      const label = savedProject ? { title: savedProject.name, detail: containers.map(resourceName).join(' + ') || 'No resources yet' } : projectLabel(name, containers, data.projectNames);
      const projectSearch = savedProject ? { view: 'apps' as const, managedId: savedProject.id } : { view: 'apps' as const, project: name };
      const projectTargets = [...new Set(containers.map(container => container.target_id))].flatMap(id => targets.get(id) ? [targets.get(id)!] : []);
      return <article key={name} className={view === "grid" ? "group relative isolate flex min-w-0 flex-col gap-5 rounded-xl border border-border bg-raised p-5 hover:border-brand-ink focus-visible:outline-2 focus-visible:outline-brand-ink" : "mobile-project-row group relative isolate flex min-w-0 items-center gap-4 border-b border-border/60 px-3 py-2.5 last:border-b-0 hover:bg-sunken/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-ink"}>
        <div className={view === "grid" ? "flex min-w-0 flex-1 items-start gap-3" : "flex min-w-0 flex-1 items-center gap-2"}>
          <span className={view === "grid" ? "grid size-10 shrink-0 place-items-center rounded-lg bg-background text-muted-foreground group-hover:text-brand-ink" : "grid size-8 shrink-0 place-items-center text-muted-foreground group-hover:text-brand-ink"}><ProjectIcon size={view === "grid" ? 20 : 17} aria-hidden="true" /></span>
          <span className="min-w-0 flex-1">
            <Link to="/" search={projectSearch} title={label.title} className={view === "grid" ? "block line-clamp-2 text-sm leading-5 font-medium wrap-anywhere after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-brand-ink" : "block truncate text-sm font-medium after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-brand-ink"}>{label.title}</Link>
            {label.detail && <span title={label.detail} className="mt-1 block truncate text-xs text-muted-foreground">{label.detail}</span>}
          </span>
          {star({ scope: 'project', key: savedProject ? `managed:${savedProject.id}` : name }, label.title)}
          <RepositoryMenu label={label.title} projectId={savedProject?.id} group={savedProject ? undefined : name} onSettings={() => { if (savedProject) void navigate({ to: '/', search: { ...projectSearch, projectSettings: true } }); else void manageGroup(name); }}/>
        </div>
        <div className={view === "grid" ? "flex min-w-0 flex-wrap items-center gap-2" : "flex shrink-0 flex-col items-end gap-1 @min-[480px]:grid @min-[480px]:grid-cols-[100px_148px] @min-[480px]:items-center @min-[480px]:gap-4"}>
          <span className={view === "grid" ? `${pillClass} w-fit` : "text-xs tabular-nums text-muted-foreground"}>{resourceCount} {resourceCount === 1 ? "resource" : "resources"}</span>
          <Assessment targets={projectTargets} />
          {view === "grid" && <ArrowUpRight size={16} className="ml-auto shrink-0 text-muted-foreground" aria-hidden="true" />}
        </div>
      </article>;
    };
  async function manageGroup(group: string) {
    setAdopting(true); setManagementError('');
    try {
      const response = await fetch('/api/data/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'adopt', group }) });
      if (!response.ok) throw new Error('Could not open container settings. Check resource assignments.');
      const result = await response.json(); refresh(); await navigate({ to: '/', search: { view: 'apps', managedId: result.id, projectSettings: true } });
    } catch (e) { setManagementError((e as Error).message); } finally { setAdopting(false); }
  }
  const savedProjects = (saved?.data?.projects ?? []).filter(p => matches(p.name)).sort((a,b) => compare(a.name,b.name));
  const savedCard = (p: typeof savedProjects[number]) => renderProject([`managed:${p.id}`, projectContainers(p.id)], p);
  const favouriteSaved = savedProjects.filter(p => favourites.has({ scope: 'project', key: `managed:${p.id}` }));
  const favouriteResources = resources.filter(container => favourites.has({ scope: 'resource', key: resourceKey(container) }));
  const favouriteProjects = projects.filter(([name]) => favourites.has({ scope: 'project', key: name }));
  const favouriteHosts = hosts.filter(() => favourites.has({ scope: 'resource', key: 'host' }));
  const hasFavourites = drilling ? favouriteResources.length > 0 : favouriteProjects.length + favouriteHosts.length + favouriteSaved.length > 0;
  // Use the full inventory so searching never changes whether favourites repeat.
  const fullListSize = drilling ? members.length : groups.size + savedProjects.length + data.targets.filter(target => target.kind === 'host').length;
  const omitFavourites = fullListSize <= 10;
  const regularResources = omitFavourites ? resources.filter(container => !favouriteResources.includes(container)) : resources;
  const regularProjects = omitFavourites ? projects.filter(project => !favouriteProjects.includes(project)) : projects;
  const regularHosts = omitFavourites ? hosts.filter(target => !favouriteHosts.includes(target)) : hosts;
  const hideEmptySections = omitFavourites && hasFavourites;
  return <div>
    {managedId && !managedProject && !saved?.error && <p role="status">{saved?.data ? 'Container not found.' : 'Loading container…'}</p>}
    {(saved?.error || repos.error) && <p role="alert">{saved?.error || repos.error}</p>}
    {managementError && <p role="alert">{managementError}</p>}
    <SearchToolbar>
      <FindingsSearch
        label={drilling ? "Search resources" : "Search containers and resources"}
        value={query}
        onChange={setQuery}
      />
        <div data-toolbar-control className="flex shrink-0 rounded border border-border p-0.5" role="group" aria-label="View">
          {([['grid', LayoutGrid, 'Grid'], ['line', List, 'Line']] as const).map(([mode, Icon, label]) => <button key={mode} type="button" aria-pressed={view === mode} onClick={() => changeView(mode)} className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs text-muted-foreground aria-pressed:bg-brand-tint aria-pressed:text-brand-ink"><Icon size={14} />{label}</button>)}
        </div>
        {drilling && saved?.data?.administrator && <Button variant="outline" size="sm" busy={adopting} onClick={() => {
          if (managedId) void navigate({ to: '/', search: { view: 'apps', managedId, projectSettings: true } });
          else if (project !== undefined) void manageGroup(project);
        }}>Container settings</Button>}
    </SearchToolbar>
    {favourites.error && <p role="alert" className="mb-4 text-sm text-critical">{favourites.error}</p>}
    {hasFavourites && <section aria-label="Favourites" className="mb-9">
      <h2 className="mb-4">Favourites</h2>
      <div className={collectionClass}>
        {drilling ? <>{favouriteResources.map(renderResource)}</> : <>
          {favouriteSaved.map(savedCard)}
          {favouriteProjects.map(p => renderProject(p))}
          {favouriteHosts.map(target => <Resource key={target.id} target={target} view={view} star={resourceStar()} />)}
        </>}
      </div>
    </section>}
    {drilling ? (!hideEmptySections || regularResources.length > 0) && <section aria-label="Resources">
      {hasFavourites && <h2 className="mb-4">{omitFavourites ? "Resources" : "All resources"}</h2>}
      <div className={regularResources.length ? collectionClass : undefined}>
        {regularResources.map(renderResource)}
      </div>
      {!resources.length && <p role="status" className="rounded-lg border border-dashed border-border px-4 py-7 text-sm text-muted-foreground">{!managedId && project !== undefined && !groups.has(project) ? "This container is no longer in the inventory." : needle ? "No resources match your search." : "No running resources discovered."}</p>}
    </section> : <>
      {(!hideEmptySections || (regularProjects.length > 0 || !!saved?.data?.projects.length)) && <section aria-label="Containers">
        {hasFavourites && <h2 className="mb-4">{omitFavourites ? "Containers" : "All containers"}</h2>}
        <div className={collectionClass}>
          {savedProjects.filter(p => !omitFavourites || !favouriteSaved.includes(p)).map(savedCard)}
          {regularProjects.map(p => renderProject(p))}
        </div>
        {!projects.length && !saved?.data?.projects.length && <p role="status" className="rounded-lg border border-dashed border-border px-4 py-7 text-sm text-muted-foreground">{needle ? "No containers match your search." : "No containers discovered. Running containers appear here when detected."}</p>}
      </section>}
      {(!hideEmptySections || regularHosts.length > 0) && <section aria-label="Hosts" className="mt-9">
        <h2 className="mb-4">Hosts</h2>
        <div className={regularHosts.length ? collectionClass : undefined}>{regularHosts.map(target => <Resource key={target.id} target={target} view={view} star={resourceStar()} />)}</div>
        {!hosts.length && <p role="status" className="rounded-lg border border-dashed border-border px-4 py-7 text-sm text-muted-foreground">{needle ? "No hosts match your search." : "No host discovered."}</p>}
      </section>}
    </>}
  </div>;
}
