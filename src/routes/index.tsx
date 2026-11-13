import { containerCoverageAreas } from '../lib/assessment-coverage';
import { FindingsSummary } from '../components/findings-summary';
import { freshness } from '../lib/coverage-explanation';
import { baseImageOptions, matchesBaseImage, parseBaseImage } from '../lib/base-image-filter';
import { BaseImageFilter } from '../components/base-image-filter';
import { origins, originOf, type Origin } from '../lib/finding-origin';
import { PackageInventoryPanel } from '../components/package-inventory-panel';
import { ScanPanelSummary } from '../components/resource-panel-layout';
import { detectionLabels, matchesDetection, type Detection } from '../lib/finding-evidence';
import { unifiedFindings } from '../lib/unified-findings';
import type { SourceEvidence } from '../lib/finding-evidence';
import { RepositoryWorkspace, useRepositories } from '../components/repositories';
import { ProjectManagement } from '../components/project-management';
import { resourceName } from '../lib/display-name';
import { ContentSkeleton, BusyIndicator, LoadingStatus } from "../components/ui/loading";
import { SearchToolbar } from "../components/search-toolbar";
import {
  createFileRoute,
  Link,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  TriangleAlert,
  Ellipsis,
  SlidersHorizontal,
  Download,
  RefreshCw,
  Scan,
  ScanLine,
  Check,
  Package,
} from "lucide-react";
import { FindingsSearch } from "../components/findings-search";
import { FindingOverview } from "../components/finding-overview";
import { FindingsTable } from "../components/findings-table";
import { ScanSettingsLink } from "../components/scan-settings";
import { ResourceDetailsHeader } from "../components/resource-details-header";
import { ProjectsInventory } from "../components/apps-inventory";
import { ScopedActivity } from "../components/scoped-activity";
import { Pulse } from "../components/pulse";
import { useWorkspace, WorkspaceBar } from "../components/app-shell";
import { api, useResource } from "../lib/use-resource";
import { Select, Checkbox } from "../components/ui/filters";
import { Button } from "../components/ui/button";
import { Tooltip } from "../components/ui/tooltip";
import { DropdownMenu, Popover } from "radix-ui";
import { Sheet, SheetContent, SheetTrigger } from "../components/ui/sheet";
import {
  garageRelease,
  severities,
  type Report,
  type Target,
} from "../lib/model";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Location = {
  managedId?: string;
  projectSettings?: boolean;
  resource?: string;
  view?: "apps";
  tab?: "activity";
  events?: "all" | "findings" | "scans";
  activityResource?: string;
  target?: string;
  app?: string;
  project?: string;
  match?: string;
  severity?: string;
  source?: Detection;
  origin?: Origin;
  baseImage?: string;
  fixable?: boolean;
  finding?: number;
  scan?: number;
};

declare module "@tanstack/react-router" {
  interface HistoryState {
    fromFindings?: boolean;
  }
}
export const Route = createFileRoute("/")({
  validateSearch: (input: Record<string, unknown>): Location => ({
    projectSettings: input.projectSettings === true || undefined,
    managedId: typeof input.managedId === 'string' ? input.managedId : undefined,
    resource: typeof input.resource === 'string' ? input.resource : undefined,
    view:
      input.view === "apps" || input.view === "activity"
        ? "apps"
        : undefined,
    project: typeof input.project === "string" ? input.project : undefined,
    tab: input.tab === "activity" || (input.view === "activity" && (typeof input.project === "string" || typeof input.target === "string")) ? "activity" : undefined,
    events: input.events === "findings" || input.events === "scans" || input.events === "all" ? input.events : input.log === true ? "scans" : undefined,
    activityResource: typeof input.activityResource === "string" ? input.activityResource : undefined,
    target: typeof input.target === "string" ? input.target : undefined,
    app: typeof input.app === "string" ? input.app : undefined,
    severity: severities.find((level) => level === input.severity),
    source: typeof input.source === 'string' && Object.hasOwn(detectionLabels, input.source) ? input.source as Detection : undefined,
    baseImage: parseBaseImage(input.baseImage),
    origin: origins.find(origin => origin === input.origin),
    fixable: input.fixable === true || undefined,
    finding:
      typeof input.finding === "number" && Number.isSafeInteger(input.finding)
        ? input.finding
        : undefined,
    scan: typeof input.scan === "number" ? input.scan : undefined,
    match: typeof input.match === "string" ? input.match : undefined,
  }),
  component: Workspace,
});
const date = (value: number | null) =>
  value ? new Date(value).toLocaleString() : "Not scanned yet";
const noticeClass =
  "mt-3 mb-5 rounded-sm border border-border bg-sunken px-4 py-3 text-[13px] wrap-anywhere";

function Workspace() { return <RepositoryWorkspace><WorkspaceContent/></RepositoryWorkspace>; }
function WorkspaceContent() {
  const search = Route.useSearch();
  const { view, target: id, app, tab, project, managedId, resource, projectSettings } = search;
  const repos = useRepositories();
  const managedProject = repos.data?.projects.find(p => p.id === managedId);
  const managedContainerIds = repos.data?.resources.filter(r => r.project_id === managedId).flatMap(r => r.containerIds) ?? [];
  const { inventory, revision, refresh } = useWorkspace();
  const data = inventory?.data;
  const target = data?.targets.find((t) => t.id === id);
  const targetName = (t: Target) =>
    data?.containers.filter(c => c.target_id === t.id).map(c => resourceName(c)).join(', ') || resourceName(t);
  const isReport = view === "apps" && !!id;
  const selectedApp = data?.containers.find(
    (c) => c.id === app && c.target_id === id,
  );
  const heading =
    view === "apps"
        ? id
          ? "Scan report"
          : "Containers"
        : "Pulse";
  return (
    <main
      id="main"
      className="min-w-0 bg-raised px-4 pb-8 desktop:rounded-[10px] desktop:border desktop:border-border desktop:pb-12 desktop:shadow-sm desktop:dark:shadow-black/30"
    >
      <WorkspaceBar
        section={heading}
        actions={view === "apps" || inventory?.error || data?.inventoryError ? (
          <div className="flex shrink-0 items-center gap-2">
            {(inventory?.error || data?.inventoryError) && (
              <Popover.Root>
                <Popover.Trigger asChild>
                  <Button variant="ghost" size="sm" className={`size-8 p-0 ${inventory?.error ? 'text-critical' : 'text-medium'}`} aria-label="Inventory warning" title="Inventory warning">
                    <TriangleAlert aria-hidden="true" />
                  </Button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content align="end" sideOffset={8} collisionPadding={16} className="z-50 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-raised p-4 text-sm shadow-lg" aria-label="Inventory status">
                    <p className="mb-2 font-medium">{inventory?.error ? "Inventory could not refresh" : "Docker inventory unavailable"}</p>
                    <p className="wrap-anywhere text-[13px] leading-5 text-muted-foreground">{inventory?.error || data?.inventoryError}</p>
                    <Popover.Close asChild><Button variant="ghost" size="sm" className="mt-3">Close</Button></Popover.Close>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            )}
          </div>
        ) : undefined}
        managedProject={view === "apps" && managedProject ? managedProject : undefined}
        project={view === "apps" ? selectedApp?.project ?? project : undefined}
        report={isReport ? ((selectedApp ? resourceName(selectedApp) : undefined) ?? (target ? targetName(target) : "Scan target")) : undefined}
      />
      {data && view === "apps" && !projectSettings && (id || project !== undefined || managedId) && <nav aria-label={id ? "Resource views" : "Container views"} className="-mx-4 flex gap-5 border-b border-border px-4">
        {[{ label: id ? "Findings" : "Resources", tab: undefined }, { label: "Activity", tab: "activity" as const }].map(item => <Link key={item.label} to="/" search={{ ...search, tab: item.tab, finding: undefined }} aria-current={tab === item.tab ? 'page' : undefined} className={`border-b-2 py-3 text-sm ${tab === item.tab ? 'border-current font-medium' : 'border-transparent text-muted-foreground'}`}>{item.label}</Link>)}
      </nav>}
      {!data && inventory?.error && <p role="alert" className={`${noticeClass} text-critical`}>{inventory.error}</p>}
      {!data ? (
        <>{!inventory?.error && <ContentSkeleton label={`Loading ${heading.toLowerCase()}…`} layout={isReport ? "detail" : view === "apps" ? "projects" : "feed"} />}</>
      ) : view === "apps" && data ? (
        <>
          {!projectSettings && tab === 'activity' && (id || project !== undefined || managedId) ? <ScopedActivity key={JSON.stringify([managedId, project, id, app])} data={data} scope={{ project, target: id, app, containerIds: managedId ? managedContainerIds : undefined }} revision={revision} /> : <>
          {managedId && projectSettings ? <ProjectManagement key={managedId} id={managedId} resource={resource}/> : !id && <>
            <ProjectsInventory key={managedId ?? project ?? "__overview"} data={data} project={project} managedId={managedId} />

          </>}
          {id && (
            <section className="min-w-0 bg-raised">
              {target ? (
                <TargetDetail
                  key={target.id}
                  target={target}
                  refresh={refresh}
                />
              ) : (
                <div className="py-6">
                  <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">This target is no longer in the inventory.</p>
                </div>
              )}
            </section>
          )}
          </>}
        </>
      ) : (
        data && <Pulse data={data} revision={revision} targetName={targetName} />
      )}
    </main>
  );
}
function TargetDetail({
  target,
  refresh,
}: {
  target: Target;
  refresh: () => void;
}) {
  const { inventory, revision } = useWorkspace();
  const repos = useRepositories();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [action, setAction] = useState("");
  const search = Route.useSearch();
  const selectedApp = inventory?.data?.containers.find(
    container => container.id === search.app && container.target_id === target.id,
  );
  const settingsLink = (selectedApp || target.kind === "host") ? (
    <ScanSettingsLink target={target.id} app={selectedApp?.id} project={selectedApp?.project} iconOnly />
  ) : null;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const activeFilterCount = Number(search.severity !== undefined) + Number(Boolean(search.fixable)) + Number(search.source !== undefined) + Number(target.kind === 'image' && search.origin !== undefined) + Number(target.kind === 'image' && !!search.baseImage);
  const navigate = Route.useNavigate();
  const router = useRouter();
  const fromFindings = useLocation({
    select: (location) => location.state.fromFindings,
  });
  const { match: query = "", severity = "ALL", source: requestedSource = "all", fixable = false } = search;
  const baseImage = target.kind === 'image' ? search.baseImage : undefined;
  const origin = target.kind === 'image' ? search.origin : undefined;
  const source = requestedSource === 'codebase' || requestedSource === 'both' ? 'all' : requestedSource;
  function updateFilters(patch: Partial<Location>) {
    void navigate({
      search: (previous) => ({ ...previous, ...patch }),
      replace: true,
      resetScroll: false,
    });
  }
  const [submitting, setSubmitting] = useState(false);
  const [acceptedAt, setAcceptedAt] = useState<number | null>();
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const waiting =
    acceptedAt !== undefined &&
    target.attempted_at === acceptedAt &&
    target.status !== "queued";
  const scanProgress = submitting
    ? "Requesting…"
    : target.status === "scanning"
      ? "Scanning…"
      : waiting || target.status === "queued"
        ? "Queued"
        : "";
  const scanBusy = Boolean(scanProgress);
  async function requestScan() {
    setAcceptedAt(undefined);
    setSubmitting(true);
    setAction("Requesting scan…");
    try {
      const response = await fetch(
        `/api/data/rescan?id=${encodeURIComponent(target.id)}${selectedApp ? `&app=${encodeURIComponent(selectedApp.id)}` : ''}`,
        {
          method: "POST",
        },
      );
      setAction(response.ok ? (await response.json()).message ?? "" : await response.text());
      if (response.ok) {
        setAcceptedAt(target.attempted_at);
        refresh();
      }
    } catch {
      setAction("Could not queue the scan. Try again.");
    } finally {
      setSubmitting(false);
    }
  }
  const [retry, setRetry] = useState(0);
  const [panel, setPanel] = useState<"scan" | "packages" | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    if (target.scanned_at)
      void api<Report>(
        `report?id=${encodeURIComponent(target.id)}&scan=${target.scanned_at}`,
        controller.signal,
      )
        .then((r) => {
          if (controller.signal.aborted) return;
          setReport(r);
          setLoadedAt(target.scanned_at);
          setError("");
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError((e as Error).message);
        });
    return () => controller.abort();
  }, [target.id, target.scanned_at, retry]);
  const allFindings = unifiedFindings(report, [], target.id);
  const baseOptions = baseImageOptions(report?.findings ?? []);
  const baseFindings = unifiedFindings(report, [], target.id, f => matchesBaseImage(f, baseImage));
  const filteredFindings = baseFindings
      .filter(
        ({ finding: f }) =>
          (severity === "ALL" || f.severity === severity) &&
          matchesDetection(source, f.detection ?? 'unknown') &&
          (!fixable || f.fixed) &&
          `${f.id} ${f.package} ${f.title}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      )
      .sort(
        ({ finding: a }, { finding: b }) =>
          severities.indexOf(a.severity) - severities.indexOf(b.severity) ||
          (b.cvss?.score ?? -1) - (a.cvss?.score ?? -1) ||
          Number(Boolean(b.fixed)) - Number(Boolean(a.fixed)),
      ) ?? [];
  const availableOrigins = origins.filter(category => filteredFindings.some(row => !row.sourceOnly && originOf(row.finding).category === category));
  const findings = filteredFindings.filter(row => !origin || !row.sourceOnly && originOf(row.finding).category === origin);
  const showingFinding = search.finding !== undefined;
  const position = findings.findIndex(
    (entry) => entry.runtimeIndices.includes(search.finding ?? -1),
  );
  const current =
    search.scan === loadedAt && search.scan === target.scanned_at
      ? baseFindings.find(row => row.runtimeIndices.includes(search.finding ?? -1))?.finding
      : undefined;
  const currentRow = baseFindings.find(row => row.runtimeIndices.includes(search.finding ?? -1));
  function findingSearch(index: number) {
    return { ...search, scan: loadedAt ?? undefined, finding: index };
  }
  return (
    <>
      {showingFinding && (
        <section>
          <nav
            aria-label="Finding navigation"
            className="-mx-4 flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2"
          >
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (fromFindings) router.history.back();
                else
                  void navigate({
                    search: { ...search, finding: undefined, scan: undefined },
                    replace: true,
                  });
              }}
            >
              <ArrowLeft aria-hidden="true" />
              Back to findings
            </Button>
            <div className="ml-auto flex items-center gap-3">
            {settingsLink}
            {current && (
              <div className="flex items-center gap-1">
                {position >= 0 && (
                  <span className="mr-2 text-xs text-muted-foreground">
                    {position + 1} of {findings.length}
                  </span>
                )}
                {(["Previous", "Next"] as const).map((label) => {
                  const entry =
                    position < 0
                      ? undefined
                      : findings[position + (label === "Next" ? 1 : -1)];
                  const content = (
                    label === "Previous" ? <ChevronLeft aria-hidden="true" /> : <ChevronRight aria-hidden="true" />
                  );
                  return entry ? (
                    <Tooltip key={label} label={`${label} finding`}>
                    <Button asChild size="sm" variant="ghost" className="size-8 p-0">
                      <Link
                        aria-label={`${label} finding`}
                        {...(entry.sourceOnly ? { to: '/issues/$issue' as const, params: { issue: entry.finding.id } } : { to: '/' as const, search: findingSearch(entry.index) })}
                        replace
                        state={{ fromFindings }}
                      >
                        {content}
                      </Link>
                    </Button>
                    </Tooltip>
                  ) : (
                    <Tooltip key={label} label={`${label} finding`}>
                    <span className="inline-flex">
                    <Button size="sm" variant="ghost" className="size-8 p-0" aria-label={`${label} finding`} disabled>
                      {content}
                    </Button>
                    </span>
                    </Tooltip>
                  );
                })}
              </div>
            )}
            </div>
          </nav>
          {current ? (
            <FindingOverview
              key={`${current.id}:${current.package}:${current.path}`}
              finding={current}
              target={target}
              container={selectedApp}
              locked={Boolean(report?.coverage)}
              resources={currentRow && currentRow.runtimeIndices.length > 1 ? <section className="my-8 text-sm"><h2 className="mb-3 text-lg">Container occurrences</h2><ul className="space-y-2">{currentRow.runtimeIndices.map(index => <li key={index}><code className="break-all">{report?.findings[index].path || 'Path not reported'}</code></li>)}</ul></section> : undefined}
            />
          ) : (
            !error && search.scan === target.scanned_at && !report && target.scanned_at
              ? <ContentSkeleton label="Loading finding…" layout="detail" />
              : <p role="status" className="my-8 text-muted-foreground">{error || "This finding is unavailable for this scan."}</p>
          )}
        </section>
      )}
      <div hidden={showingFinding}>
        {target.kind === 'image' && <FindingsSummary
          findings={report?.findings}
          coverageAreas={containerCoverageAreas(report)}
          scannedAt={loadedAt ?? undefined}
          footer={loadedAt ? `Container scan: ${new Date(loadedAt).toLocaleString()} · ${loadedAt === target.scanned_at ? freshness(loadedAt, inventory?.data?.intervalHours ?? 24) : 'Previous scan; updating report'}` : 'No completed container scan loaded'}
        />}
        <SearchToolbar className="mb-0">
          <h2 className="sr-only">Findings</h2>
          <FindingsSearch
            value={query}
            onChange={(match) => updateFilters({ match: match || undefined })}
          />
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="sm">
                <SlidersHorizontal aria-hidden="true" />
                Filters
                {activeFilterCount > 0 && (
                  <span className="rounded-full bg-brand-tint px-1.5 text-xs text-brand-ink" aria-label={`${activeFilterCount} active filters`}>
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            </SheetTrigger>
            <SheetContent side="right" title="Filters">
              <div className="space-y-6 p-5 pt-12">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-medium">Filters</h2>
                  <Button variant="ghost" size="sm" disabled={activeFilterCount === 0}
                    onClick={() => updateFilters({ severity: undefined, fixable: undefined, source: undefined, origin: undefined, baseImage: undefined })}>
                    Reset filters
                  </Button>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Severity</p>
                  <Select
                    label="Severity"
                    value={severity}
                    options={["ALL", ...severities]}
                    display={(value) => value === "ALL" ? "All severities" : value.toLowerCase()}
                    onValueChange={(value) => updateFilters({ severity: value === "ALL" ? undefined : value })}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={fixable}
                    onCheckedChange={(value) => updateFilters({ fixable: value === true || undefined })} />
                  Fix available
                </label>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Detection source</p>
                  <Select label="Detection source" value={source}
                    options={['all', 'container', 'host', 'unknown']}
                    display={value => value === 'all' ? 'All sources' : detectionLabels[value as Detection]}
                    onValueChange={value => updateFilters({ source: value === 'all' ? undefined : value as Detection })} />
                </div>
                {target.kind === 'image' && <div className="space-y-2">
                  <p className="text-sm font-medium">Origin</p>
                  <Select label="Origin" value={origin ?? 'all'}
                    options={['all', ...origins.filter(category => availableOrigins.includes(category) || category === origin)]}
                    display={value => value === 'all' ? 'All origins' : value}
                    onValueChange={value => updateFilters({ origin: value === 'all' ? undefined : value as Origin })} />
                </div>}
                {target.kind === 'image' && <BaseImageFilter value={baseImage} options={baseOptions} onChange={baseImage => updateFilters({ baseImage })} />}
                <p className="text-xs text-muted-foreground">Filters apply immediately.</p>
              </div>
            </SheetContent>
          </Sheet>
          <Button variant="ghost" size="sm" disabled={scanBusy} aria-busy={scanBusy || undefined} onClick={requestScan}>
            <RefreshCw aria-hidden="true" className={scanBusy ? "scan-action-icon" : ""} />
            {scanProgress || "Rescan"}
          </Button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button variant="ghost" size="sm" aria-label="More resource options">
                <Ellipsis aria-hidden="true" />More
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                className="dropdown-content"
              >
                <DropdownMenu.Item className="dropdown-item" onSelect={() => setDetailsOpen(true)}>
                  Resource details
                </DropdownMenu.Item>
                {(selectedApp || target.kind === "host") && (
                  <DropdownMenu.Item className="dropdown-item" asChild>
                    <Link to="/settings" search={{ target: target.id, app: selectedApp?.id, project: selectedApp?.project }}>
                      Scan settings
                    </Link>
                  </DropdownMenu.Item>
                )}
                <DropdownMenu.Item className="dropdown-item" onSelect={() => setPanel("scan")}>
                  Scan details and actions
                </DropdownMenu.Item>
                <DropdownMenu.Item className="dropdown-item" onSelect={() => setPanel("packages")}>
                  Package inventory
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </SearchToolbar>
        <ResourceDetailsHeader target={target} container={selectedApp} project={search.project}
          open={detailsOpen} onOpenChange={setDetailsOpen} />
        <Sheet
          open={panel !== null}
          onOpenChange={(open) => {
            if (!open) setPanel(null);
          }}
        >
          <SheetContent
            side="right"
            title={
              panel === "packages"
                ? "Package inventory"
                : "Scan details and actions"
            }
          >
            <div className="p-5 pt-12">
              {panel === "scan" ? (
                <>
                  <ScanPanelSummary status={target.status}
                    description={<>{target.summary?.os || 'OS unidentified'}{target.platform ? ` · ${target.platform}` : ''}<br/>{target.status === 'unassessed' ? 'Last scan attempt: ' : 'Last successful scan: '}{date(target.status === 'unassessed' ? target.attempted_at : target.scanned_at)}</>}
                    actions={<>
                      <Button variant="outline" size="sm" disabled={scanBusy} aria-busy={scanBusy || undefined} onClick={requestScan}>
                        <RefreshCw className={scanBusy ? 'scan-action-icon' : ''}/>{scanProgress || 'Scan now'}
                      </Button>
                      {target.scanned_at && <Button asChild variant="ghost" size="sm"><a href={`/api/data/sbom?id=${encodeURIComponent(target.id)}`}><Download/>{target.summary?.coverage ? 'Source SBOM' : 'SBOM'}</a></Button>}
                    </>}/>
                  {target.summary?.coverage === "release-source" && (
                    <section className={noticeClass} aria-label="Coverage">
                      <strong>
                        Release-source coverage · Rust dependencies
                      </strong>
                      <p>
                        The executable in this ARM64 image matches the official
                        Garage v2.4.1 binary byte for byte. Kopes checks{" "}
                        {target.summary.packages} external crate versions from
                        the locked release build graph. A match flags a
                        dependency for review. Linked code and exploitability
                        have not been verified.
                      </p>
                      <details>
                        <summary>Evidence and exclusions</summary>
                        <p>
                          Cargo 1.95.0 · aarch64-unknown-linux-musl. The 11
                          release features match the installed executable’s
                          feature list. Excludes build-only and development
                          dependencies, procedural macros, workspace crates and
                          bundled native code.
                        </p>
                        <p>
                          Executable SHA-256{" "}
                          <code>{garageRelease.binarySha256}</code>
                        </p>
                        <a
                          href={`https://git.deuxfleurs.fr/Deuxfleurs/garage/src/commit/${garageRelease.commit}/nix/compile.nix`}
                        >
                          Release build configuration
                        </a>{" "}
                        ·{" "}
                        <a
                          href={`https://git.deuxfleurs.fr/Deuxfleurs/garage/src/commit/${garageRelease.commit}/Cargo.lock`}
                        >
                          Cargo.lock
                        </a>
                      </details>
                    </section>
                  )}
                  {target.suggestions.length > 0 && (
                    <section
                      className="my-4 rounded-sm border border-l-[3px] border-border border-l-brand-ink px-5 py-4 [&_article+article]:mt-4 [&_article+article]:border-t [&_article+article]:border-border [&_article+article]:pt-4 [&_p]:my-2 [&_p]:text-xs [&_p]:text-muted-foreground [&_summary]:text-xs [&_summary]:text-muted-foreground"
                      aria-label="Verified image comparisons"
                    >
                      <div className="mb-2.5 text-[13px] font-[550] text-brand-ink">
                        Image comparisons
                      </div>
                      {target.suggestions.map((s) => (
                        <article key={s.digest}>
                          <p>{s.scope === 'base-image' ? 'Verified base-image comparison only. Rebuild and scan your application to measure its actual improvement.' : s.scope === 'image' ? 'Scanned image comparison. Compatibility still requires application testing.' : 'Historical comparison; scope and package coverage were not recorded.'}</p>
                          {s.currentPackages !== undefined && <p>Package coverage: {s.currentPackages} → {s.candidatePackages} detected packages · {s.currentOs || 'OS unidentified'} → {s.candidateOs || 'OS unidentified'}. Counts are advisory/package pairs, not individual occurrences.</p>}
                          <div className="flex flex-wrap items-baseline gap-4 [&_code]:text-base [&_span]:text-[13px]">
                            <code>{s.action ?? 'Upgrade'}: {s.tag}</code>
                            <span>
                              {s.removed} advisory/package pairs no longer
                              detected
                            </span>
                          </div>
                          <p>
                            {s.introduced} newly detected · {s.remaining}{" "}
                            remaining in total (including introduced) · checked {date(s.checkedAt)}
                          </p>
                          <details>
                            <summary>
                              Scanned digest and upgrade caveats
                            </summary>
                            <code className="mt-2 block bg-sunken p-3">
                              {s.reference}
                            </code>
                            <p>
                              Platform: {s.platform}. {s.scope === 'base-image' ? 'Update the base reference in your build configuration, rebuild, test, and scan the resulting application image.' : 'Test the compared image before updating your deployment reference yourself.'} A missing
                              finding can also mean a package was removed or
                              coverage changed; this is not proof of
                              compatibility or complete remediation.
                            </p>
                          </details>
                        </article>
                      ))}
                    </section>
                  )}
                  {target.recommendation_note && (
                    <p className="mt-4 mb-6 text-xs text-muted-foreground">
                      {target.recommendation_note}
                    </p>
                  )}
                </>
              ) : (
                <PackageInventoryPanel key={`${target.id}:${loadedAt}`} packages={report?.packages} loading={!!target.scanned_at && !report && !error} error={error}/>

              )}
            </div>
          </SheetContent>
        </Sheet>
        {action && (
          <p className={noticeClass} role="status">
            {action}
          </p>
        )}
        {acceptedAt !== undefined &&
          acceptedAt !== target.attempted_at &&
          target.status === "ready" &&
          loadedAt === target.scanned_at &&
          report && (
            <p className={noticeClass} role="status">
              Scan complete. Report updated at {date(loadedAt)} ·{" "}
              {report.findings.length} findings.
            </p>
          )}
        {error && (
          <p className={`${noticeClass} text-critical`} role="alert">
            {error}{" "}
            <button onClick={() => setRetry((n) => n + 1)}>Retry report</button>
          </p>
        )}
        {target.status === "unassessed" && (
          <section className={noticeClass} role="status">
            <strong>Inspection complete · No identifiable packages</strong>
            <p>{target.error}</p>
            {target.scanned_at && (
              <p>
                Results below are from the last successful scan on{" "}
                {date(target.scanned_at)}.
              </p>
            )}
          </section>
        )}
        {report && target.scanned_at !== loadedAt && !error && <LoadingStatus label="Updating report…" className="my-3" />}
        {target.status === "error" && !waiting && target.error && (
          <p className={`${noticeClass} text-critical`} role="alert">
            Scan failed: {target.error}{" "}
            {target.scanned_at &&
              "Results below are from the last successful scan."}{" "}
            <Link to="/" search={{ ...search, tab: 'activity', events: 'scans', finding: undefined }} hash={`scan-status-${target.id}`} className="underline">View activity</Link>
          </p>
        )}
        {report?.imageContext && <p className={noticeClass}>{report.imageContext}</p>}
        {target.summary?.eol && (
          <p className={`${noticeClass} text-critical`}>
            This OS is end-of-life. Vulnerability coverage and fixed versions
            may be incomplete.
          </p>
        )}
        {(target.status === "queued" || waiting) && (
          <p className={noticeClass} role="status">
            <BusyIndicator className="mr-2" />Queued. The scanner will start when the current job finishes.
          </p>
        )}
        {target.status === "scanning" && (
          <p className={noticeClass} role="status">
            <BusyIndicator className="mr-2" />Scanning locally. Image downloads and upgrade checks can take
            several minutes.
          </p>
        )}
        {(target.status !== "unassessed" || target.scanned_at !== null || allFindings.length > 0) && (
          <div className="-mx-4">
            {report || allFindings.length ? (
              findings.length ? (
                <FindingsTable
                  showOrigins={target.kind === 'image'}
                  key={JSON.stringify([loadedAt, severity, source, origin, baseImage, fixable, query])}
                  findings={findings}
                  findingSearch={findingSearch}
                />
              ) : allFindings.length ? (
                <div className="px-4 py-12">
                  <h3>No findings match these filters.</h3>
                  <p className="mt-2 text-muted-foreground">
                    Adjust your search or filters to see more findings.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center px-5 py-12 text-center">
                  <span
                    aria-hidden="true"
                    className="mb-4 grid size-14 place-items-center rounded-full bg-brand-tint text-brand-ink [&>svg]:col-start-1 [&>svg]:row-start-1"
                  >
                    <Scan size={32} strokeWidth={1.5} />
                    <Check size={17} strokeWidth={2.5} />
                  </span>
                  <h3 className="text-xl leading-tight tracking-tight text-balance">
                    No known vulnerabilities detected in completed scans.
                  </h3>
                  <p className="mt-2 max-w-[52ch] leading-relaxed text-pretty text-muted-foreground">
                    Results reflect the current vulnerability database and
                    supported package coverage—not a guarantee that this target
                    is secure.
                  </p>
                </div>
              )
            ) : target.scanned_at === null ? (
              <div className="flex flex-col items-center px-5 py-12 text-center">
                <span
                  aria-hidden="true"
                  className="mb-4 grid size-14 place-items-center rounded-full border border-dashed border-border bg-sunken text-muted-foreground"
                >
                  <ScanLine size={30} strokeWidth={1.5} />
                </span>
                <h3 className="text-xl leading-tight tracking-tight text-balance">
                  No completed scans yet
                </h3>
                <p className="mt-2 max-w-[44ch] leading-relaxed text-pretty text-muted-foreground">
                  {scanBusy
                    ? "Your report will appear here when the scan finishes."
                    : target.status === "error"
                      ? "Review the scan error above, then try again."
                      : "Scan this target to see its packages and check them for known vulnerabilities."}
                </p>
                <Button
                  className="mt-5"
                  disabled={scanBusy} aria-busy={scanBusy || undefined}
                  onClick={requestScan}
                >
                  <RefreshCw
                    aria-hidden="true"
                    className={
                      scanBusy ? "scan-action-icon" : ""
                    }
                  />
                  {scanProgress ||
                    (target.status === "error"
                      ? "Retry scan"
                      : "Start first scan")}
                </Button>
              </div>
            ) : !error ? (
              <ContentSkeleton label="Loading report…" className="px-4" />
            ) : (
              <div className="max-w-[580px] px-4 py-12 text-left text-muted-foreground [&_h3]:mt-4 [&_h3]:mb-3 [&_h3]:text-foreground">
                <h3 role="status">
                  {error ? "Report unavailable" : "Loading report…"}
                </h3>
                <p>
                  {target.status === "error"
                    ? "This scan could not establish vulnerability coverage. Review the error above before retrying."
                    : "Results appear here when the scan finishes."}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
