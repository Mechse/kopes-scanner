import {
  createFileRoute,
  Link,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Ellipsis,
  Download,
  RefreshCw,
  Scan,
  ScanLine,
  Check,
  Package,
  Server,
  Activity,
} from "lucide-react";
import { FindingsSearch } from "../components/findings-search";
import { FindingOverview } from "../components/finding-overview";
import { FindingsTable } from "../components/findings-table";
import { AppsInventory } from "../components/apps-inventory";
import { IssueTimeline } from "../components/issue-timeline";
import { Overview } from "../components/overview";
import { useWorkspace, WorkspaceBar } from "../components/app-shell";
import { api, useResource } from "../lib/use-resource";
import { Select, Checkbox } from "../components/ui/filters";
import { Button } from "../components/ui/button";
import { DropdownMenu } from "radix-ui";
import { Sheet, SheetContent } from "../components/ui/sheet";
import {
  garageRelease,
  severities,
  type Report,
  type Target,
} from "../lib/model";
import { ChevronsLeft, ChevronsRight } from "lucide-react";

type Location = {
  view?: "apps" | "activity";
  log?: boolean;
  target?: string;
  app?: string;
  match?: string;
  severity?: string;
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
    view:
      input.view === "apps" || input.view === "activity"
        ? input.view
        : undefined,
    log: input.log === true || undefined,
    target: typeof input.target === "string" ? input.target : undefined,
    app: typeof input.app === "string" ? input.app : undefined,
    severity: severities.find((level) => level === input.severity),
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
function Row({
  target,
  app,
  match,
  children,
}: {
  target: Target;
  app?: string;
  match?: string;
  children: ReactNode;
}) {
  return (
    <Link
      className="flex min-w-0 items-center gap-3 border-b border-border p-3 hover:bg-background aria-[current=page]:bg-background [&_small]:block [&_small]:text-xs [&_small]:text-muted-foreground [&_strong]:font-[550] [&_svg]:flex-none [&_svg]:text-muted-foreground [&>div]:min-w-0 [&>div]:flex-1 [&>div]:wrap-anywhere"
      to="/"
      search={{ view: "apps", target: target.id, app, match }}
    >
      {target.kind === "host" ? <Server size={16} /> : <Package size={16} />}
      <div>{children}</div>
      <ArrowRight size={17} aria-hidden="true" />
    </Link>
  );
}
const noticeClass =
  "mt-3 mb-5 rounded-sm border border-border bg-sunken px-4 py-3 text-[13px] wrap-anywhere";

function Workspace() {
  const { view, target: id, app, log } = Route.useSearch();
  const { inventory, revision, refresh } = useWorkspace();
  const data = inventory?.data;
  const target = data?.targets.find((t) => t.id === id);
  const activity = useResource<
    {
      seq: number;
      target: string;
      name: string;
      time: number;
      message: string;
    }[]
  >(view === "activity" && log ? "activity" : "", revision, 2500);
  const targetName = (t: Target) =>
    data?.containers
      .filter((c) => c.target_id === t.id)
      .map((c) => c.name)
      .join(", ") || t.name;
  const priorities =
    data?.targets
      .filter((t) => t.summary && severities.some((s) => t.summary!.counts[s]))
      .sort((a, b) => {
        const hasFix =
          Number(b.summary!.fixable > 0) - Number(a.summary!.fixable > 0);
        if (hasFix) return hasFix;
        for (const severity of severities) {
          const delta =
            b.summary!.counts[severity] - a.summary!.counts[severity];
          if (delta) return delta;
        }
        return 0;
      }) ?? [];
  const outstanding = data?.targets.filter((t) => t.status !== "ready") ?? [];
  const isReport = view === "apps" && !!id;
  const selectedApp = data?.containers.find(
    (c) => c.id === app && c.target_id === id,
  );
  const heading =
    view === "activity"
      ? "Activity"
      : view === "apps"
        ? id
          ? "Scan report"
          : "Apps & host"
        : "Overview";
  return (
    <main
      id="main"
      className="min-w-0 bg-raised px-4 pb-8 desktop:rounded-[10px] desktop:border desktop:border-border desktop:pb-12 desktop:shadow-sm desktop:dark:shadow-black/30"
    >
      <WorkspaceBar
        section={heading}
        report={
          isReport
            ? (selectedApp?.name ??
              (target ? targetName(target) : "Scan target"))
            : undefined
        }
      />
      {inventory?.error && (
        <p role="alert" className={`${noticeClass} text-critical`}>
          {inventory.error}
        </p>
      )}
      {data?.inventoryError && (
        <p role="alert" className={`${noticeClass} text-critical`}>
          {data.inventoryError}
        </p>
      )}
      {!data ? (
        <p role="status">Loading inventory…</p>
      ) : view === "apps" ? (
        <>
          {!id && <AppsInventory data={data} />}
          {id && (
            <section className="min-w-0 bg-raised">
              {target ? (
                <TargetDetail
                  key={target.id}
                  target={target}
                  refresh={refresh}
                />
              ) : (
                <p>This target is no longer in the inventory.</p>
              )}
            </section>
          )}
        </>
      ) : view === "activity" ? (
        <>
          <nav aria-label="Activity views" className="-mx-4 mb-5 flex gap-5 border-b border-border px-4">
            {[{ label: "Timeline", log: undefined }, { label: "Scan log", log: true }].map(tab => (
              <Link key={tab.label} to="/" search={{ view: "activity", log: tab.log }}
                aria-current={log === tab.log ? "page" : undefined}
                className={`border-b-2 py-2 text-sm ${log === tab.log ? "border-current font-medium" : "border-transparent text-muted-foreground"}`}>
                {tab.label}
              </Link>
            ))}
          </nav>
          {!log ? <IssueTimeline revision={revision} /> : <>
          <h2>Scan status</h2>
          {outstanding.map((t) => (
            <Row key={t.id} target={t}>
              <strong>{targetName(t)}</strong>
              <small>
                {t.status} {t.error}
              </small>
            </Row>
          ))}
          {!outstanding.length && <p>All targets have current assessments.</p>}
          <h2>Recent scans</h2>
          {activity?.error && <p role="alert">{activity.error}</p>}
          {activity?.data ? (
            activity.data.length ? (
              activity.data.map((event) => (
                <article
                  className="grid grid-cols-[16px_1fr_auto] items-baseline gap-x-3 border-b border-border p-3 hover:bg-background [&_a:hover]:underline"
                  key={event.seq}
                >
                  <Activity
                    className="text-muted-foreground"
                    size={16}
                    aria-hidden="true"
                  />
                  <strong className="col-start-2 font-[550] wrap-anywhere">
                    {data.targets.some((t) => t.id === event.target) ? (
                      <Link
                        to="/"
                        search={{ view: "apps", target: event.target }}
                      >
                        {event.name}
                      </Link>
                    ) : (
                      event.name
                    )}
                  </strong>
                  <p className="col-start-2 row-start-2 mt-0.5 text-[13px] text-muted-foreground">
                    {event.message}
                  </p>
                  <small className="col-start-2 row-start-3 text-muted-foreground desktop:col-start-3 desktop:row-start-1">
                    {date(event.time)}
                  </small>
                </article>
              ))
            ) : (
              <p>New scan completions will appear here.</p>
            )
          ) : (
            <p role="status">Loading activity…</p>
          )}
          </>}
        </>
      ) : (
        <Overview data={data} priorities={priorities} targetName={targetName} />
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
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [action, setAction] = useState("");
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const fromFindings = useLocation({
    select: (location) => location.state.fromFindings,
  });
  const { match: query = "", severity = "ALL", fixable = false } = search;
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
        `/api/data/rescan?id=${encodeURIComponent(target.id)}`,
        {
          method: "POST",
        },
      );
      setAction(response.ok ? "" : await response.text());
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
  const [packageQuery, setPackageQuery] = useState("");
  const [packagePage, setPackagePage] = useState(0);
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
          setPackagePage(0);
          setError("");
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError((e as Error).message);
        });
    return () => controller.abort();
  }, [target.id, target.scanned_at, retry]);
  const findings =
    report?.findings
      .map((finding, index) => ({ finding, index }))
      .filter(
        ({ finding: f }) =>
          (severity === "ALL" || f.severity === severity) &&
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
  const packages =
    report?.packages.filter((p) =>
      `${p.name} ${p.version}`
        .toLowerCase()
        .includes(packageQuery.toLowerCase()),
    ) ?? [];
  const showingFinding = search.finding !== undefined;
  const position = findings.findIndex(
    (entry) => entry.index === search.finding,
  );
  const current =
    search.scan === loadedAt && search.scan === target.scanned_at
      ? report?.findings[search.finding ?? -1]
      : undefined;
  function findingSearch(index: number) {
    return { ...search, scan: loadedAt ?? undefined, finding: index };
  }
  return (
    <>
      {showingFinding && (
        <section>
          <nav
            aria-label="Finding navigation"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2"
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
                    <>
                      {label === "Previous" && (
                        <ChevronsLeft aria-hidden="true" />
                      )}
                      {label}
                      {label === "Next" && <ChevronsRight aria-hidden="true" />}
                    </>
                  );
                  return entry ? (
                    <Button key={label} asChild size="sm" variant="ghost">
                      <Link
                        to="/"
                        search={findingSearch(entry.index)}
                        replace
                        state={{ fromFindings }}
                      >
                        {content}
                      </Link>
                    </Button>
                  ) : (
                    <Button key={label} size="sm" variant="ghost" disabled>
                      {content}
                    </Button>
                  );
                })}
              </div>
            )}
          </nav>
          {current ? (
            <FindingOverview
              finding={current}
              locked={Boolean(report?.coverage)}
            />
          ) : (
            <p role="status" className="my-8 text-muted-foreground">
              {error ||
                (search.scan === target.scanned_at &&
                !report &&
                target.scanned_at
                  ? "Loading finding…"
                  : "This finding is unavailable for this scan.")}
            </p>
          )}
        </section>
      )}
      <div hidden={showingFinding}>
        <div className="-mx-4 flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground">
          <FindingsSearch
            value={query}
            onChange={(match) => updateFilters({ match: match || undefined })}
          />
          <Select
            label="Severity"
            value={severity}
            options={["ALL", ...severities]}
            display={(value) =>
              value === "ALL" ? "All severities" : value.toLowerCase()
            }
            onValueChange={(value) =>
              updateFilters({ severity: value === "ALL" ? undefined : value })
            }
          />
          <label className="flex items-center gap-2">
            <Checkbox
              checked={fixable}
              onCheckedChange={(value) =>
                updateFilters({ fixable: value === true || undefined })
              }
            />
            Fix available
          </label>

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button variant="ghost" size="icon" aria-label="Report options">
                <Ellipsis />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                className="z-30 rounded-md border border-border bg-raised p-1 text-sm shadow-md [&>[data-highlighted]]:bg-sunken [&>[data-highlighted]]:outline-none [&>[role=menuitem]]:rounded [&>[role=menuitem]]:px-3 [&>[role=menuitem]]:py-2"
              >
                <DropdownMenu.Item onSelect={() => setPanel("scan")}>
                  Scan details and actions
                </DropdownMenu.Item>
                <DropdownMenu.Item onSelect={() => setPanel("packages")}>
                  Package inventory
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
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
                  <div className="mt-3.5 mb-5 flex flex-col items-start justify-between gap-2 min-[1200px]:mt-0 desktop:flex-row desktop:gap-5 [&_p]:text-xs [&>div:first-child]:min-w-0">
                    <div>
                      <span
                        data-status={target.status}
                        className="inline-flex items-center gap-[5px] rounded border border-border px-[7px] py-[3px] text-[11px] text-muted-foreground capitalize before:size-1.5 before:rounded-full before:bg-current data-[status=error]:text-critical data-[status=ready]:border-transparent data-[status=ready]:bg-brand-tint data-[status=ready]:text-brand-ink"
                      >
                        {target.status}
                      </span>
                      <p className="text-muted-foreground">
                        {target.summary?.os || "OS unidentified"}
                        {target.platform ? ` · ${target.platform}` : ""}
                        <br />
                        {target.status === "unassessed"
                          ? "Last scan attempt: "
                          : "Last successful scan: "}
                        {date(
                          target.status === "unassessed"
                            ? target.attempted_at
                            : target.scanned_at,
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={scanBusy}
                        onClick={requestScan}
                      >
                        <RefreshCw
                          className={
                            target.status === "scanning" ? "animate-spin" : ""
                          }
                        />
                        {scanProgress || "Scan now"}
                      </Button>
                      {target.scanned_at && (
                        <Button asChild variant="ghost" size="sm">
                          <a
                            href={`/api/data/sbom?id=${encodeURIComponent(target.id)}`}
                          >
                            <Download />
                            {target.summary?.coverage ? "Source SBOM" : "SBOM"}
                          </a>
                        </Button>
                      )}
                    </div>
                  </div>
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
                          <div className="flex flex-wrap items-baseline gap-4 [&_code]:text-base [&_span]:text-[13px]">
                            <code>{s.tag}</code>
                            <span>
                              {s.removed} advisory/package pairs no longer
                              detected
                            </span>
                          </div>
                          <p>
                            {s.introduced} newly detected · {s.remaining}{" "}
                            remaining · checked {date(s.checkedAt)}
                          </p>
                          <details>
                            <summary>
                              Scanned digest and upgrade caveats
                            </summary>
                            <code className="mt-2 block bg-sunken p-3">
                              {s.reference}
                            </code>
                            <p>
                              Platform: {s.platform}. Update your Compose image
                              reference yourself after testing. A missing
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
                <>
                  <h2>Package inventory</h2>
                  <input
                    type="search"
                    aria-label="Search packages"
                    placeholder="Search packages…"
                    className="my-3 w-full rounded border border-border px-2 py-1"
                    value={packageQuery}
                    onChange={(e) => {
                      setPackageQuery(e.target.value);
                      setPackagePage(0);
                    }}
                  />
                  {report ? (
                    <>
                      <div className="overflow-x-auto rounded-sm border border-border mobile:[&_table]:min-w-[460px]">
                        <table>
                          <caption className="sr-only">
                            Detected packages
                          </caption>
                          <thead>
                            <tr>
                              <th>Package</th>
                              <th>Version</th>
                              <th>Ecosystem</th>
                            </tr>
                          </thead>
                          <tbody>
                            {packages
                              .slice(packagePage * 50, (packagePage + 1) * 50)
                              .map((p, i) => (
                                <tr key={`${p.name}-${i}`}>
                                  <td className="font-mono tabular-nums">
                                    {p.name}
                                  </td>
                                  <td>
                                    <code>{p.version}</code>
                                  </td>
                                  <td>{p.type}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                      <Pagination
                        count={packages.length}
                        page={packagePage}
                        setPage={setPackagePage}
                      />
                    </>
                  ) : (
                    <p className="max-w-[580px] px-4 py-12 text-left text-muted-foreground [&_h3]:mt-4 [&_h3]:mb-3 [&_h3]:text-foreground">
                      Package inventory is available after the first successful
                      scan.
                    </p>
                  )}
                </>
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
        {target.status === "error" && !waiting && target.error && (
          <p className={`${noticeClass} text-critical`} role="alert">
            Scan failed: {target.error}{" "}
            {target.scanned_at &&
              "Results below are from the last successful scan."}
          </p>
        )}
        {target.summary?.eol && (
          <p className={`${noticeClass} text-critical`}>
            This OS is end-of-life. Vulnerability coverage and fixed versions
            may be incomplete.
          </p>
        )}
        {(target.status === "queued" || waiting) && (
          <p className={noticeClass} role="status">
            Queued. The scanner will start when the current job finishes.
          </p>
        )}
        {target.status === "scanning" && (
          <p className={noticeClass} role="status">
            Scanning locally. Image downloads and upgrade checks can take
            several minutes.
          </p>
        )}
        {(target.status !== "unassessed" || target.scanned_at !== null) && (
          <div className="-mx-4">
            {report ? (
              findings.length ? (
                <FindingsTable
                  key={JSON.stringify([loadedAt, severity, fixable, query])}
                  findings={findings}
                  findingSearch={findingSearch}
                />
              ) : report.findings.length ? (
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
                    No known vulnerabilities detected.
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
                  disabled={scanBusy}
                  onClick={requestScan}
                >
                  <RefreshCw
                    aria-hidden="true"
                    className={
                      target.status === "scanning" ? "animate-spin" : ""
                    }
                  />
                  {scanProgress ||
                    (target.status === "error"
                      ? "Retry scan"
                      : "Start first scan")}
                </Button>
              </div>
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
function Pagination({
  count,
  page,
  setPage,
}: {
  count: number;
  page: number;
  setPage: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-between pt-4 text-xs text-muted-foreground">
      <span>
        {count
          ? `${page * 50 + 1}–${Math.min((page + 1) * 50, count)} of ${count}`
          : "No packages match"}
      </span>
      <div>
        <Button
          variant="ghost"
          size="sm"
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
        >
          <ChevronsLeft />
          Previous
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={(page + 1) * 50 >= count}
          onClick={() => setPage(page + 1)}
        >
          Next
          <ChevronsRight />
        </Button>
      </div>
    </div>
  );
}
