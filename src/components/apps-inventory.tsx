import { Link } from '@tanstack/react-router';
import { ArrowLeft, ArrowUpRight, Folder, LayoutGrid, List, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { severities, type Container, type Dashboard, type Target } from '../lib/model';
import { resourceKey } from '../lib/settings';
import { ResourceIcon } from './resource-icon';
import { ScanSettingsButton } from './scan-settings';
import { severityColors } from './severity-colors';

type View = 'grid' | 'line';
const preferenceKey = 'kopes.projects-view';

function Assessment({ targets }: { targets: Target[] }) {
  const highest = severities.find(level => targets.some(target => target.summary?.counts[level]));
  const assessed = targets.filter(target => target.summary).length;
  return <span className={`projects-assessment ${highest ? severityColors[highest] : 'text-muted-foreground'}`}>
    <i aria-hidden="true" />{highest ? `${highest[0]}${highest.slice(1).toLowerCase()}` : assessed ? 'No findings' : 'Not assessed'}
    {assessed > 0 && assessed < targets.length && <span className="sr-only">; some resources not assessed</span>}
  </span>;
}

function Resource({ target, container }: { target: Target; container?: Container }) {
  const name = container?.name ?? target.name;
  return <article className="projects-item projects-resource">
    <div className="projects-identity">
      <ResourceIcon container={container} />
      <div className="min-w-0">
        <Link to="/" search={{ view: 'apps', target: target.id, app: container?.id, project: container?.project }} className="projects-name">{name}</Link>
        <span className="projects-muted">{container ? container.manager : 'Host OS packages'}</span>
      </div>
    </div>
    <div className="projects-detail"><span className="projects-mobile-label">{container ? 'Image' : 'Operating system'}</span><span className="wrap-anywhere">{container?.image ?? target.summary?.os ?? 'Operating system packages'}</span></div>
    <div className="projects-health"><Assessment targets={[target]} /><span className="projects-muted">{target.summary ? `${Object.values(target.summary.counts).reduce((sum, count) => sum + count, 0)} findings` : 'No report yet'}</span></div>
    <div className="projects-scan"><span className={target.status === 'error' ? 'text-critical' : 'text-muted-foreground'}>{target.status === 'ready' ? 'Assessed' : target.status === 'unassessed' ? 'Not assessed' : target.status === 'error' ? 'Scan failed' : target.status === 'scanning' ? 'Scanning' : 'Queued'}</span>
      {target.scanned_at && <time className="projects-muted" dateTime={new Date(target.scanned_at).toISOString()}>{new Date(target.scanned_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>}
    </div>
    <div className="projects-actions"><ScanSettingsButton scope="resource" settingsKey={resourceKey(container)} name={name} /><Link to="/" search={{ view: 'apps', target: target.id, app: container?.id, project: container?.project }} aria-label={`Open report for ${name}`} className="projects-open"><ArrowUpRight size={16} /></Link></div>
  </article>;
}

export function ProjectsInventory({ data, project }: { data: Dashboard; project?: string }) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>('grid');
  const [sort, setSort] = useState('name');
  useEffect(() => {
    try { const saved = localStorage.getItem(preferenceKey); if (saved === 'grid' || saved === 'line') setView(saved); } catch { /* Use Grid when storage is unavailable. */ }
  }, []);
  function changeView(next: View) {
    setView(next);
    try { localStorage.setItem(preferenceKey, next); } catch { /* The view still works without storage. */ }
  }
  const targets = new Map(data.targets.map(target => [target.id, target]));
  const groups = new Map<string, Container[]>();
  for (const container of data.containers) {
    const group = groups.get(container.project) ?? [];
    group.push(container);
    groups.set(container.project, group);
  }
  const needle = query.trim().toLowerCase();
  const matches = (...values: string[]) => values.some(value => value.toLowerCase().includes(needle));
  const compare = (a: string, b: string) => (sort === 'descending' ? -1 : 1) * a.localeCompare(b, undefined, { numeric: true });
  const projects = [...groups].filter(([name, members]) => matches(name || 'Ungrouped', ...members.flatMap(member => [member.name, member.image]))).sort(([a], [b]) => compare(a, b));
  const members = project !== undefined ? groups.get(project) ?? [] : [];
  const resources = members.filter(member => matches(member.name, member.image, member.manager)).sort((a, b) => compare(a.name, b.name));
  const hosts = data.targets.filter(target => target.kind === 'host' && matches(target.name, target.summary?.os ?? '', 'Host OS')).sort((a, b) => compare(a.name, b.name));
  const drilling = project !== undefined;
  return <div className="projects-page" data-view={view}>
    {drilling && <Link to="/" search={{ view: 'apps' }} className="projects-back"><ArrowLeft size={14} />All projects</Link>}
    <header className="projects-heading"><div><h1>{drilling ? project || 'Ungrouped' : 'Projects'}</h1><p className="projects-muted">{drilling ? `${members.length} ${members.length === 1 ? 'resource' : 'resources'} in this project` : `${groups.size} ${groups.size === 1 ? 'project' : 'projects'} discovered from your running containers`}</p></div>
      {drilling && groups.has(project) && <ScanSettingsButton scope="project" settingsKey={project} name={project || 'Ungrouped'} />}
    </header>
    <div className="projects-toolbar">
      <label className="projects-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label={drilling ? 'Search resources' : 'Search projects and hosts'} placeholder={drilling ? 'Search resources…' : 'Search projects and hosts…'} value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="projects-controls"><select aria-label="Sort by name" value={sort} onChange={event => setSort(event.target.value)}><option value="name">Name A–Z</option><option value="descending">Name Z–A</option></select>
        <div className="projects-view" role="group" aria-label="View"><button type="button" aria-pressed={view === 'grid'} onClick={() => changeView('grid')}><LayoutGrid size={16} />Grid</button><button type="button" aria-pressed={view === 'line'} onClick={() => changeView('line')}><List size={16} />Line</button></div>
      </div>
    </div>
    {drilling ? <section aria-label="Resources"><div className="projects-collection projects-resources">
      {view === 'line' && resources.length > 0 && <div className="projects-columns projects-resource-columns" aria-hidden="true"><span>Resource</span><span>Image</span><span>Findings</span><span>Last scan</span><span>Actions</span></div>}
      {resources.map(container => { const target = targets.get(container.target_id); return target ? <Resource key={container.id} container={container} target={target} /> : <article className="projects-item" key={container.id}><strong>{container.name}</strong><p className="projects-muted">Waiting for scan target.</p></article>; })}
    </div>{!resources.length && <p role="status" className="projects-empty">{!groups.has(project) ? 'This project is no longer in the inventory.' : needle ? 'No resources match your search.' : 'No running resources discovered.'}</p>}</section>
    : <>
      <section aria-label="Projects"><div className="projects-collection projects-groups">
        {view === 'line' && projects.length > 0 && <div className="projects-columns projects-group-columns" aria-hidden="true"><span>Project</span><span>Contents</span><span>Highest severity</span><span>Actions</span></div>}
        {projects.map(([name, containers]) => {
          const projectTargets = [...new Set(containers.map(container => container.target_id))].flatMap(id => targets.get(id) ? [targets.get(id)!] : []);
          return <article key={name} className="projects-item projects-group">
            <Link to="/" search={{ view: 'apps', project: name }} className="projects-identity projects-name"><span className="projects-folder"><Folder size={20} /></span><span className="wrap-anywhere">{name || 'Ungrouped'}</span></Link>
            <span className="projects-count">{containers.length} {containers.length === 1 ? 'resource' : 'resources'}</span>
            <Assessment targets={projectTargets} />
            <div className="projects-actions"><ScanSettingsButton scope="project" settingsKey={name} name={name || 'Ungrouped'} /><Link to="/" search={{ view: 'apps', project: name }} className="projects-open" aria-label={`Open project ${name || 'Ungrouped'}`}><ArrowUpRight size={16} /></Link></div>
          </article>;
        })}
      </div>{!projects.length && <p role="status" className="projects-empty">{needle ? 'No projects match your search.' : 'No projects discovered. Projects appear when running containers are detected.'}</p>}</section>
      <section aria-label="Hosts" className="projects-hosts"><h2>Hosts</h2><div className="projects-collection projects-resources">
        {view === 'line' && hosts.length > 0 && <div className="projects-columns projects-resource-columns" aria-hidden="true"><span>Host</span><span>Operating system</span><span>Findings</span><span>Last scan</span><span>Actions</span></div>}
        {hosts.map(target => <Resource key={target.id} target={target} />)}
      </div>{!hosts.length && <p role="status" className="projects-empty">{needle ? 'No hosts match your search.' : 'No host discovered.'}</p>}</section>
    </>}
  </div>;
}
