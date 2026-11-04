import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  IconArrowRight,
  IconDownload,
  IconRefresh,
  IconBox,
  IconServer,
  IconActivity,
} from "@tabler/icons-react";
import { FindingsTable } from "../components/findings-table";
import { Overview } from "../components/overview";
import { useWorkspace, WorkspaceBar } from "../components/app-shell";
import { api, useResource } from "../lib/use-resource";
import { Select, Checkbox } from "../components/ui/filters";
import { Button } from "../components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import {
  garageRelease,
  severities,
  type Report,
  type Target,
} from "../lib/model";

type Location = { view?: "apps" | "activity"; target?: string; match?: string };
export const Route = createFileRoute("/")({
  validateSearch: (input: Record<string, unknown>): Location => ({
    view:
      input.view === "apps" || input.view === "activity"
        ? input.view
        : undefined,
    target: typeof input.target === "string" ? input.target : undefined,
    match: typeof input.match === "string" ? input.match : undefined,
  }),
  component: Workspace,
});
const date = (value: number | null) =>
  value ? new Date(value).toLocaleString() : "Not scanned yet";
function Row({
  target,
  match,
  children,
}: {
  target: Target;
  match?: string;
  children: ReactNode;
}) {
  return (
    <Link
      className="flex min-w-0 items-center gap-3 border-b border-border p-3 hover:bg-background aria-[current=page]:bg-background [&_small]:block [&_small]:text-xs [&_small]:text-muted-foreground [&_strong]:font-[550] [&_svg]:flex-none [&_svg]:text-muted-foreground [&>div]:min-w-0 [&>div]:flex-1 [&>div]:wrap-anywhere"
      to="/"
      search={{ view: "apps", target: target.id, match }}
    >
      {target.kind === "host" ? (
        <IconServer size={16} />
      ) : (
        <IconBox size={16} />
      )}
      <div>{children}</div>
      <IconArrowRight size={17} aria-hidden="true" />
    </Link>
  );
}
const indexHeadingClass =
  "mt-6 mb-0 border-y border-border bg-background px-3 py-2 text-[13px]";
const noticeClass =
  "mt-3 mb-5 rounded-sm border border-border bg-sunken px-4 py-3 text-[13px] wrap-anywhere";

function Workspace() {
  const { view, target: id, match } = Route.useSearch();
  const { inventory, revision, refresh, input, setInput } = useWorkspace();
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), 220);
    return () => clearTimeout(timer);
  }, [input]);
  const data = inventory?.data;
  const target = data?.targets.find((t) => t.id === id);
  const search = useResource<{ id: string; matches: number }[]>(
    query ? "search?q=" + encodeURIComponent(query) : "",
    revision,
    10000,
  );
  const activity = useResource<
    {
      seq: number;
      target: string;
      name: string;
      time: number;
      message: string;
    }[]
  >(view === "activity" ? "activity" : "", revision, 2500);
  const looking = !!input.trim();
  const targetName = (t: Target) =>
    data?.containers
      .filter((c) => c.target_id === t.id)
      .map((c) => c.name)
      .join(", ") || t.name;
  const apps =
    data?.containers.filter((c) =>
      c.name.toLowerCase().includes(input.trim().toLowerCase()),
    ) ?? [];
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
  const heading = looking
    ? "Search results"
    : view === "activity"
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
        report={!looking && view === "apps" && !!id}
      />
      <header className="my-5 desktop:mt-8 desktop:mb-6 [&_h1]:mb-[5px] [&_h1]:text-[clamp(24px,2.2vw,32px)] [&_p]:text-muted-foreground">
        <h1>{heading}</h1>
        <p>
          {looking
            ? "Across this installation"
            : view === "activity"
              ? "Running scans and recent changes in findings."
              : view === "apps"
                ? "Host packages and the container images running on this server."
                : "Latest assessments across your host and running containers."}
        </p>
      </header>
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
      ) : looking ? (
        <section
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) setInput("");
          }}
        >
          <h2>Containers</h2>
          {apps.map((c) => (
            <Row
              key={c.id}
              target={data.targets.find((t) => t.id === c.target_id)!}
            >
              <strong>{c.name}</strong>
              <small>
                {c.project} · {c.image}
              </small>
            </Row>
          ))}
          {!apps.length && <p>No matching containers.</p>}
          <h2>Findings</h2>
          {search?.error && <p role="alert">{search.error}</p>}
          {query !== input.trim() || !search ? (
            <p role="status">Searching reports…</p>
          ) : search.data?.length ? (
            search.data.map((hit) => {
              const t = data.targets.find((t) => t.id === hit.id);
              return (
                t && (
                  <Row key={t.id} target={t} match={query}>
                    <strong>{targetName(t)}</strong>
                    <small>
                      {hit.matches} matching{" "}
                      {hit.matches === 1 ? "finding" : "findings"}
                      {t.summary?.coverage &&
                        " · Release-source Rust dependencies"}
                    </small>
                  </Row>
                )
              );
            })
          ) : (
            !search.error && <p>No matching findings in completed reports.</p>
          )}
        </section>
      ) : view === "apps" ? (
        <div
          className={
            id
              ? "min-[1200px]:grid min-[1200px]:grid-cols-[clamp(180px,18vw,268px)_minmax(0,1fr)] min-[1200px]:gap-6"
              : undefined
          }
        >
          <div
            className={
              id
                ? "hidden min-[1200px]:sticky min-[1200px]:top-3 min-[1200px]:block min-[1200px]:max-h-[80dvh] min-[1200px]:self-start min-[1200px]:overflow-auto min-[1200px]:border-r min-[1200px]:border-border min-[1200px]:pr-3.5 [&>h2:first-child]:mt-0"
                : undefined
            }
            aria-label="Scan targets"
          >
            <h2 className={indexHeadingClass}>Host</h2>
            {data.targets
              .filter((t) => t.kind === "host")
              .map((t) => (
                <Row key={t.id} target={t}>
                  <strong>Host OS packages</strong>
                  <small>{t.status}</small>
                </Row>
              ))}
            {[...new Set(data.containers.map((c) => c.project))].map(
              (group) => (
                <section key={group}>
                  <h2 className={indexHeadingClass}>{group}</h2>
                  {data.containers
                    .filter((c) => c.project === group)
                    .map((c) => (
                      <Row
                        key={c.id}
                        target={data.targets.find((t) => t.id === c.target_id)!}
                      >
                        <strong>{c.name}</strong>
                        <small>{c.image}</small>
                      </Row>
                    ))}
                </section>
              ),
            )}
            {!data.containers.length && (
              <p>No running containers discovered.</p>
            )}
          </div>
          {id && (
            <section className="min-w-0 bg-raised">
              <Link
                className="text-xs text-muted-foreground hover:underline min-[1200px]:hidden"
                to="/"
                search={{ view: "apps" }}
              >
                ← All apps &amp; host
              </Link>
              {target ? (
                <TargetDetail
                  key={target.id + (match ?? "")}
                  target={target}
                  initialQuery={match ?? ""}
                  refresh={refresh}
                />
              ) : (
                <p>This target is no longer in the inventory.</p>
              )}
            </section>
          )}
        </div>
      ) : view === "activity" ? (
        <>
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
                  <IconActivity
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
        </>
      ) : (
        <Overview data={data} priorities={priorities} targetName={targetName} />
      )}
    </main>
  );
}
function TargetDetail({
  target,
  initialQuery,
  refresh,
}: {
  target: Target;
  initialQuery: string;
  refresh: () => void;
}) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [action, setAction] = useState("");
  const [query, setQuery] = useState(initialQuery);
  const [submitting, setSubmitting] = useState(false);
  const [acceptedAt, setAcceptedAt] = useState<number | null>();
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const waiting =
    acceptedAt !== undefined &&
    target.attempted_at === acceptedAt &&
    target.status !== "queued";
  const [retry, setRetry] = useState(0);
  const [severity, setSeverity] = useState("ALL");
  const [fixable, setFixable] = useState(false);
  const [packagePage, setPackagePage] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    if (target.scanned_at)
      void api<Report>(
        `report?id=${encodeURIComponent(target.id)}`,
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
      .filter(
        (f) =>
          (severity === "ALL" || f.severity === severity) &&
          (!fixable || f.fixed) &&
          `${f.id} ${f.package} ${f.title}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      )
      .sort((a, b) => Number(Boolean(b.fixed)) - Number(Boolean(a.fixed))) ??
    [];
  const packages =
    report?.packages.filter((p) =>
      `${p.name} ${p.version}`.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  const reset = () => {
    setPackagePage(0);
  };
  return (
    <>
      <div className="mt-3.5 mb-5 flex flex-col items-start justify-between gap-2 min-[1200px]:mt-0 desktop:flex-row desktop:gap-5 [&_p]:text-xs [&>div:first-child]:min-w-0">
        <div>
          <span
            data-status={target.status}
            className="inline-flex items-center gap-[5px] rounded border border-border px-[7px] py-[3px] text-[11px] text-muted-foreground capitalize before:size-1.5 before:rounded-full before:bg-current data-[status=error]:text-critical data-[status=ready]:border-transparent data-[status=ready]:bg-brand-tint data-[status=ready]:text-brand-ink"
          >
            {target.status}
          </span>
          <h2 className="my-[7px] text-xl">
            {target.kind === "host" ? "Host OS packages" : target.name}
          </h2>
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
            disabled={
              submitting ||
              waiting ||
              target.status === "scanning" ||
              target.status === "queued"
            }
            onClick={async () => {
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
            }}
          >
            <IconRefresh
              className={target.status === "scanning" ? "animate-spin" : ""}
            />
            {submitting
              ? "Requesting…"
              : waiting || target.status === "queued"
                ? "Queued"
                : target.status === "scanning"
                  ? "Scanning…"
                  : "Scan now"}
          </Button>
          {target.scanned_at && (
            <Button asChild variant="ghost" size="sm">
              <a href={`/api/data/sbom?id=${encodeURIComponent(target.id)}`}>
                <IconDownload />
                {target.summary?.coverage ? "Source SBOM" : "SBOM"}
              </a>
            </Button>
          )}
        </div>
      </div>
      {target.summary?.coverage === "release-source" && (
        <section className={noticeClass} aria-label="Coverage">
          <strong>Release-source coverage · Rust dependencies</strong>
          <p>
            The executable in this ARM64 image matches the official Garage
            v2.4.1 binary byte for byte. Kopes checks {target.summary.packages}{" "}
            external crate versions from the locked release build graph. A match
            flags a dependency for review. Linked code and exploitability have
            not been verified.
          </p>
          <details>
            <summary>Evidence and exclusions</summary>
            <p>
              Cargo 1.95.0 · aarch64-unknown-linux-musl. The 11 release features
              match the installed executable’s feature list. Excludes build-only
              and development dependencies, procedural macros, workspace crates
              and bundled native code.
            </p>
            <p>
              Executable SHA-256 <code>{garageRelease.binarySha256}</code>
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
          This OS is end-of-life. Vulnerability coverage and fixed versions may
          be incomplete.
        </p>
      )}
      {(target.status === "queued" || waiting) && (
        <p className={noticeClass} role="status">
          Queued. The scanner will start when the current job finishes.
        </p>
      )}
      {target.status === "scanning" && (
        <p className={noticeClass} role="status">
          Scanning locally. Image downloads and upgrade checks can take several
          minutes.
        </p>
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
                  {s.removed} advisory/package pairs no longer detected
                </span>
              </div>
              <p>
                {s.introduced} newly detected · {s.remaining} remaining ·
                checked {date(s.checkedAt)}
              </p>
              <details>
                <summary>Scanned digest and upgrade caveats</summary>
                <code className="mt-2 block bg-sunken p-3">{s.reference}</code>
                <p>
                  Platform: {s.platform}. Update your Compose image reference
                  yourself after testing. A missing finding can also mean a
                  package was removed or coverage changed; this is not proof of
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
      {(target.status !== "unassessed" || target.scanned_at !== null) && (
        <Tabs defaultValue="findings" onValueChange={reset}>
          <TabsList aria-label="Scan results">
            <TabsTrigger value="findings">
              Findings {report ? `(${report.findings.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="packages">
              Packages {report ? `(${report.packages.length})` : ""}
            </TabsTrigger>
          </TabsList>
          <div className="mt-3.5 flex">
            <label className="w-full">
              <span className="sr-only">Search packages or advisories</span>
              <input
                className="w-full rounded-sm border border-border bg-background px-3 py-2.5 text-foreground"
                placeholder="Search packages or advisories…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  reset();
                }}
              />
            </label>
          </div>
          <TabsContent value="findings">
            <div className="mb-3 flex flex-wrap items-center gap-3.5 text-xs text-muted-foreground">
              <Select
                label="Severity"
                value={severity}
                options={["ALL", ...severities]}
                display={(value) =>
                  value === "ALL" ? "All severities" : value.toLowerCase()
                }
                onValueChange={(value) => {
                  setSeverity(value);
                  reset();
                }}
              />
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={fixable}
                  onCheckedChange={(value) => {
                    setFixable(value === true);
                    reset();
                  }}
                />
                Fixed version available
              </label>
            </div>
            {report ? (
              findings.length ? (
                <FindingsTable
                  key={JSON.stringify([loadedAt, severity, fixable, query])}
                  findings={findings}
                  locked={Boolean(report.coverage)}
                />
              ) : (
                <div className="max-w-[580px] px-4 py-12 text-left text-muted-foreground [&_h3]:mt-4 [&_h3]:mb-3 [&_h3]:text-foreground">
                  <h3>
                    {report.findings.length
                      ? "No findings match these filters."
                      : "No known vulnerabilities detected."}
                  </h3>
                  <p>
                    Results reflect the current vulnerability database and
                    supported package coverage—not a guarantee that this target
                    is secure.
                  </p>
                </div>
              )
            ) : (
              <div className="max-w-[580px] px-4 py-12 text-left text-muted-foreground [&_h3]:mt-4 [&_h3]:mb-3 [&_h3]:text-foreground">
                <h3 role="status">
                  {target.scanned_at
                    ? error
                      ? "Report unavailable"
                      : "Loading report…"
                    : "No completed scan yet."}
                </h3>
                <p>
                  {target.status === "error"
                    ? "This scan could not establish vulnerability coverage. Review the error above before retrying."
                    : "Results appear here when the scan finishes."}
                </p>
              </div>
            )}
          </TabsContent>
          <TabsContent value="packages">
            {report ? (
              <>
                <div className="overflow-x-auto rounded-sm border border-border mobile:[&_table]:min-w-[460px]">
                  <table>
                    <caption className="sr-only">Detected packages</caption>
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
                            <td className="font-mono tabular-nums">{p.name}</td>
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
                Package inventory is available after the first successful scan.
              </p>
            )}
          </TabsContent>
        </Tabs>
      )}
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
          Previous
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={(page + 1) * 50 >= count}
          onClick={() => setPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
