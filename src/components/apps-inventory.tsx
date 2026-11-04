import { Link } from '@tanstack/react-router';
import { ArrowUpRight } from 'lucide-react';
import { useState } from 'react';
import { severities, type Container, type Dashboard, type Target } from '../lib/model';
import { FindingsSearch } from './findings-search';
import { ResourceIcon } from './resource-icon';
import { severityColors } from './severity-colors';

function InventoryRow({ target, container }: { target: Target; container?: Container }) {
  const summary = target.summary;
  const highest = severities.find(level => summary?.counts[level]);
  const color = highest ? severityColors[highest] : 'text-muted-foreground';
  const scanned = target.scanned_at ? new Date(target.scanned_at) : null;

  return (
    <div className="inventory-row">
      {container && <span aria-hidden="true" className={`inventory-lane ${color}`}><i /></span>}
      <ResourceIcon container={container} />
      <Link to="/" search={{ view: 'apps', target: target.id, app: container?.id }} className="inventory-report-link">
      <span className="inventory-row-body">
        <span className="grid min-w-0 gap-1">
          <strong className="text-sm font-[550] wrap-anywhere">{container?.name ?? 'Host OS packages'}</strong>
          <span className="text-xs text-muted-foreground wrap-anywhere">{container?.image ?? (summary?.os || 'Operating system packages')}</span>
        </span>
        <span className="grid gap-1 text-xs sm:text-right">
          <span className="flex flex-wrap gap-x-3 sm:justify-end">
            {target.status !== 'ready' && (
              <span className={target.status === 'error' ? 'text-critical capitalize' : 'text-muted-foreground capitalize'}>{target.status}</span>
            )}
            <span className={color}>
              {highest && summary ? `${summary.counts[highest]} ${highest.toLowerCase()}` : summary ? 'No findings' : 'No report yet'}
            </span>
          </span>
          {scanned && <time dateTime={scanned.toISOString()} className="text-muted-foreground">Scanned {scanned.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>}
        </span>
      </span>
      <ArrowUpRight size={14} aria-hidden="true" className="text-muted-foreground" />
      </Link>
    </div>
  );
}

export function AppsInventory({ data }: { data: Dashboard }) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const targets = new Map(data.targets.map(target => [target.id, target]));
  const hosts = data.targets.filter(target => target.kind === 'host');
  const projects = new Map<string, Container[]>();
  for (const container of data.containers) {
    if (!targets.has(container.target_id)) continue;
    const group = projects.get(container.project);
    if (group) group.push(container);
    else projects.set(container.project, [container]);
  }

  const visibleProjects = Array.from(projects, ([project, members]) => {
    const highest = severities.find(level =>
      members.some(member => targets.get(member.target_id)?.summary?.counts[level]),
    );
    const containers = members.filter(member =>
      [member.name, project, member.image].some(value => value.toLowerCase().includes(needle)),
    );
    return { project, highest, containers };
  }).filter(group => group.containers.length);

  return <>
    <div className="-mx-4 flex items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground">
      <FindingsSearch label="Search containers" value={query} onChange={setQuery} />
    </div>
    <div className="max-w-[1160px]">
    <section aria-label="Host">
      <h2>Host</h2>
      <div>
        {hosts.map(target => <InventoryRow key={target.id} target={target} />)}
        {!hosts.length && <p className="p-3 text-muted-foreground">No host discovered.</p>}
      </div>
    </section>
    <section aria-label="Running containers" className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 flex items-center gap-2">Running containers <span className="rounded bg-sunken px-2 py-0.5 text-xs text-muted-foreground tabular-nums">{data.containers.length}</span></h2>

      </div>
      <div className="grid gap-7">
        {visibleProjects.map(({ project, highest, containers }) => (
          <section key={project} className="min-w-0">
            <h3 className="inventory-project text-sm font-[550] wrap-anywhere">
              <span className={`inventory-root ${highest ? severityColors[highest] : 'text-muted-foreground'}`} aria-hidden="true">
                <svg viewBox="0 0 28 42"><path d="M12 0 C12 17 24 25 24 42" /></svg>
                <i />
              </span>
              {project || 'Ungrouped'}
              {highest && <span className="sr-only"> (highest severity: {highest.toLowerCase()})</span>}
            </h3>
            <div className="inventory-project-rows">{containers.map(container => {
              const target = targets.get(container.target_id);
              return target && <InventoryRow key={container.id} target={target} container={container} />;
            })}</div>
          </section>
        ))}
        {!visibleProjects.length && <p role="status" className="border-y border-border/60 py-5 text-sm text-muted-foreground">{data.containers.length ? 'No containers match your search.' : 'No running containers discovered.'}</p>}
      </div>
    </section>
    </div>
  </>;
}
