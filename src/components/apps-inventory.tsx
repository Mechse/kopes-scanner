import { BusyIndicator } from "./ui/loading";
import { SearchToolbar } from "./search-toolbar";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Folder, LayoutGrid, List } from "lucide-react";
import { useEffect, useState } from "react";
import { type Container, type Dashboard, type Target } from "../lib/model";
import { FindingsSearch } from "./findings-search";
import { Select } from "./ui/filters";
import { ResourceIcon } from "./resource-icon";
import { ScanSettingsLink } from "./scan-settings";
import { Assessment } from "./assessment";
import { pillClass } from "./ui/pill";

type View = "grid" | "line";
const preferenceKey = "kopes.projects-view";


const resourceRowClass = "mobile-resource-row group relative isolate grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-border/60 px-3 py-2.5 last:border-b-0 hover:bg-sunken/50 @min-[720px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_148px_100px]";

function ResourceLine({ target, container }: { target?: Target; container?: Container }) {
  const name = container?.name ?? target?.name ?? "Resource";
  const image = container?.image ?? target?.summary?.os ?? "Operating system packages";
  const findings = target?.summary
    ? Object.values(target.summary.counts).reduce((sum, count) => sum + count, 0)
    : undefined;

  return <article className={resourceRowClass}>
    <div className="flex min-w-0 items-center gap-2">
      <ResourceIcon container={container} />
      {target ? <Link
        to="/"
        search={{ view: "apps", target: target.id, app: container?.id, project: container?.project }}
        title={name}
        aria-label={`Open report for ${name}`}
        className="min-w-0 truncate text-sm font-medium after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-brand-ink"
      >{name}</Link> : <span title={name} className="truncate text-sm font-medium">{name}</span>}
    </div>
    <span title={image} className="col-start-1 row-start-2 min-w-0 truncate pl-10 text-xs text-muted-foreground @min-[720px]:col-start-auto @min-[720px]:row-start-auto @min-[720px]:pl-0">{image}</span>
    <div className="col-start-2 row-start-1 justify-self-end @min-[720px]:col-start-auto @min-[720px]:row-start-auto @min-[720px]:justify-self-start">
      {target ? <Assessment targets={[target]} /> : <span className="text-xs text-muted-foreground">Awaiting scan target</span>}
    </div>
    <span className="col-start-2 row-start-2 text-right text-xs tabular-nums text-muted-foreground @min-[720px]:col-start-auto @min-[720px]:row-start-auto">
      {findings !== undefined ? <>{findings} {findings === 1 ? "finding" : "findings"}</> : <span aria-label="Findings unavailable">—</span>}
    </span>
  </article>;
}

function Resource({ target, container, view }: { target: Target; container?: Container; view: View }) {
  if (view === "line") return <ResourceLine target={target} container={container} />;
  const name = container?.name ?? target.name;
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
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Assessment targets={[target]} />
        {findings !== undefined && <span className={pillClass}>
          {findings} {findings === 1 ? "finding" : "findings"}
        </span>}
        {(target.status === "error" || target.status === "scanning" || target.status === "queued") && (
          <span className={pillClass}>
            {target.status === "error" && <span aria-hidden="true" className="size-1 shrink-0 rounded-full bg-critical" />}
            {target.status === "scanning" && <BusyIndicator />}
            {target.status === "error" ? "Scan failed" : target.status === "scanning" ? "Scanning" : "Queued"}
          </span>
        )}
        <ArrowUpRight size={16} className="ml-auto shrink-0 text-muted-foreground" aria-hidden="true" />
      </div>
    </article>
  );
}

export function ProjectsInventory({ data, project }: { data: Dashboard; project?: string }) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("grid");
  const [sort, setSort] = useState("name");
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
  const groups = new Map<string, Container[]>();
  for (const container of data.containers) {
    const group = groups.get(container.project) ?? [];
    group.push(container);
    groups.set(container.project, group);
  }
  const needle = query.trim().toLowerCase();
  const matches = (...values: string[]) =>
    values.some((value) => value.toLowerCase().includes(needle));
  const compare = (a: string, b: string) =>
    (sort === "descending" ? -1 : 1) *
    a.localeCompare(b, undefined, { numeric: true });
  const projects = [...groups]
    .filter(([name, members]) =>
      matches(
        name || "Ungrouped",
        ...members.flatMap((member) => [member.name, member.image]),
      ),
    )
    .sort(([a], [b]) => compare(a, b));
  const members = project !== undefined ? (groups.get(project) ?? []) : [];
  const resources = members
    .filter((member) => matches(member.name, member.image, member.manager))
    .sort((a, b) => compare(a.name, b.name));
  const hosts = data.targets
    .filter(
      (target) =>
        target.kind === "host" &&
        matches(target.name, target.summary?.os ?? "", "Host OS"),
    )
    .sort((a, b) => compare(a.name, b.name));
  const drilling = project !== undefined;
  const collectionClass = view === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-4" : "@container min-w-0";
  return <div>
    <SearchToolbar>
      <FindingsSearch
        label={drilling ? "Search resources" : "Search projects and hosts"}
        value={query}
        onChange={setQuery}
      />
        <Select label="Sort by name" value={sort} options={["name", "descending"]} display={value => value === "name" ? "Name A–Z" : "Name Z–A"} onValueChange={setSort} />
        <div data-toolbar-control className="flex shrink-0 rounded border border-border p-0.5" role="group" aria-label="View">
          {([['grid', LayoutGrid, 'Grid'], ['line', List, 'Line']] as const).map(([mode, Icon, label]) => <button key={mode} type="button" aria-pressed={view === mode} onClick={() => changeView(mode)} className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs text-muted-foreground aria-pressed:bg-brand-tint aria-pressed:text-brand-ink"><Icon size={14} />{label}</button>)}
        </div>
        {drilling && groups.has(project) && <ScanSettingsLink project={project} />}
    </SearchToolbar>
    {drilling ? <section aria-label="Resources">
      <div className={resources.length ? collectionClass : undefined}>
        {resources.map(container => {
          const target = targets.get(container.target_id);
          if (view === "line") return <ResourceLine key={container.id} container={container} target={target} />;
          return target ? <Resource key={container.id} container={container} target={target} view={view} /> : (
            <article key={container.id} className="flex min-w-0 flex-col gap-5 rounded-xl border border-border bg-raised p-5">
              <div className="flex min-w-0 items-start gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-background"><ResourceIcon container={container} /></div>
                <div className="min-w-0 flex-1">
                  <strong title={container.name} className="block truncate text-sm leading-5 font-medium">{container.name}</strong>
                  <span title={`${container.manager} · ${container.image}`} className="block truncate text-xs leading-5 text-muted-foreground">{container.image}</span>
                </div>
              </div>
              <span className={`${pillClass} w-fit`}>Waiting for scan target</span>
            </article>
          );
        })}
      </div>
      {!resources.length && <p role="status" className="rounded-lg border border-dashed border-border px-4 py-7 text-sm text-muted-foreground">{!groups.has(project) ? "This project is no longer in the inventory." : needle ? "No resources match your search." : "No running resources discovered."}</p>}
    </section> : <>
      <section aria-label="Projects">
        <div className={projects.length ? collectionClass : undefined}>
          {projects.map(([name, containers]) => {
            const projectTargets = [...new Set(containers.map(container => container.target_id))].flatMap(id => targets.get(id) ? [targets.get(id)!] : []);
            return <Link key={name} to="/" search={{ view: "apps", project: name }} className={view === "grid" ? "group flex min-w-0 flex-col gap-5 rounded-xl border border-border bg-raised p-5 hover:border-brand-ink focus-visible:outline-2 focus-visible:outline-brand-ink" : "mobile-project-row group flex min-w-0 items-center gap-4 border-b border-border/60 px-3 py-2.5 last:border-b-0 hover:bg-sunken/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-ink"}>
              <div className={view === "grid" ? "flex min-w-0 flex-1 items-start gap-3" : "flex min-w-0 flex-1 items-center gap-2"}>
                <span className={view === "grid" ? "grid size-10 shrink-0 place-items-center rounded-lg bg-background text-muted-foreground group-hover:text-brand-ink" : "grid size-8 shrink-0 place-items-center text-muted-foreground group-hover:text-brand-ink"}><Folder size={view === "grid" ? 20 : 17} aria-hidden="true" /></span>
                <span title={name || "Ungrouped"} className={view === "grid" ? "line-clamp-2 min-h-10 min-w-0 text-sm leading-5 font-medium wrap-anywhere" : "min-w-0 truncate text-sm font-medium"}>{name || "Ungrouped"}</span>
              </div>
              <div className={view === "grid" ? "flex min-w-0 flex-wrap items-center gap-2" : "flex shrink-0 flex-col items-end gap-1 @min-[480px]:grid @min-[480px]:grid-cols-[100px_148px] @min-[480px]:items-center @min-[480px]:gap-4"}>
                <span className={view === "grid" ? `${pillClass} w-fit` : "text-xs tabular-nums text-muted-foreground"}>{containers.length} {containers.length === 1 ? "resource" : "resources"}</span>
                <Assessment targets={projectTargets} />
                {view === "grid" && <ArrowUpRight size={16} className="ml-auto shrink-0 text-muted-foreground" aria-hidden="true" />}
              </div>
            </Link>;
          })}
        </div>
        {!projects.length && <p role="status" className="rounded-lg border border-dashed border-border px-4 py-7 text-sm text-muted-foreground">{needle ? "No projects match your search." : "No projects discovered. Projects appear when running containers are detected."}</p>}
      </section>
      <section aria-label="Hosts" className="mt-9">
        <h2 className="mb-4">Hosts</h2>
        <div className={hosts.length ? collectionClass : undefined}>{hosts.map(target => <Resource key={target.id} target={target} view={view} />)}</div>
        {!hosts.length && <p role="status" className="rounded-lg border border-dashed border-border px-4 py-7 text-sm text-muted-foreground">{needle ? "No hosts match your search." : "No host discovered."}</p>}
      </section>
    </>}
  </div>;
}
