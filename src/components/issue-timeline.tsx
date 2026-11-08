import { ContentSkeleton } from "./ui/loading";
import { SearchToolbar } from "./search-toolbar";
import { useMemo, useState } from "react";
import { FindingsSearch } from "./findings-search";
import { Tooltip } from "radix-ui";
import { Diamond } from "lucide-react";
import { useResource } from "../lib/use-resource";

import { timelineMatcher } from "../lib/timeline-search";

type IssueEvent = {
  seq: number;
  app: string;
  name: string;
  issue: string;
  package: string;
  ecosystem: string;
  kind: "discovered";
  time: number;
};

const labels = { discovered: "Discovered" };
const day = 86_400_000;
const columns = "grid grid-cols-[minmax(10rem,28%)_1fr]";
const gridLines =
  "relative grid grid-cols-4 divide-x divide-dashed divide-border";
const shortDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

const eventTime = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
});

function groupEvents(events: IssueEvent[], needle: string) {
  const apps = new Map<
    string,
    { name: string; issues: Map<string, IssueEvent[]> }
  >();
  const matches = timelineMatcher(needle);
  let first = Infinity;
  let last = -Infinity;
  for (const event of events) {
    first = Math.min(first, event.time);
    last = Math.max(last, event.time);
    if (!matches([event.name, event.issue, event.package, event.ecosystem])) continue;
    let app = apps.get(event.app);
    if (!app) {
      app = { name: event.name, issues: new Map() };
      apps.set(event.app, app);
    }
    const key = JSON.stringify([event.issue, event.package, event.ecosystem]);
    const milestones = app.issues.get(key);
    if (milestones) milestones.push(event);
    else app.issues.set(key, [event]);
  }
  const start = new Date(first);
  start.setHours(0, 0, 0, 0);
  const stepDays = Math.max(
    1,
    Math.ceil((last - start.getTime() + 1) / (4 * day)),
  );
  const ticks = Array.from({ length: 5 }, (_, i) => {
    const tick = new Date(start);
    tick.setDate(tick.getDate() + i * stepDays);
    return tick.getTime();
  });
  return { apps, ticks };
}

export function IssueTimeline({ revision }: { revision: number }) {
  const resource = useResource<IssueEvent[]>("timeline", revision, 30000);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const { apps, ticks } = useMemo(
    () => groupEvents(resource?.data ?? [], needle),
    [resource?.data, needle],
  );
  return (
    <section aria-label="Issue timeline">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <Diamond size={11} className="text-medium" fill="currentColor" />{" "}
          Discovered
        </span>
      </header>
      <SearchToolbar className="mb-0 border-t">
        <FindingsSearch
          label="Search timeline"
          value={query}
          onChange={setQuery}
        />
      </SearchToolbar>
      {resource?.error && <p role="alert">{resource.error}</p>}
      {!resource && <ContentSkeleton label="Loading timeline…" layout="timeline" />}
      {resource?.data && !apps.size && (
        <p
          role="status"
          className="rounded border border-border p-5 text-sm text-muted-foreground"
        >
          {resource.data.length
            ? "No issues match your search."
            : "Issue discoveries will appear here after a scan finds a vulnerability."}
        </p>
      )}
      {!!apps.size && (
        <Tooltip.Provider delayDuration={100}>
          <div className="-mx-4 overflow-x-auto">
            <div className="min-w-[38rem]">
              <div
                className={
                  columns +
                  " border-b border-border bg-sunken text-xs text-muted-foreground"
                }
              >
                <div className="px-4 py-2">Issue</div>
                <div className={gridLines}>
                  {ticks.slice(0, 4).map((time) => (
                    <time
                      key={time}
                      dateTime={new Date(time).toISOString()}
                      className="px-2 py-2"
                    >
                      {shortDate.format(time)}
                    </time>
                  ))}
                </div>
              </div>
              {Array.from(apps, ([app, { name, issues }]) => (
                <details open key={app}>
                  <summary className="cursor-pointer border-b border-border bg-sunken/60 px-4 py-2 text-sm font-medium">
                    {name}{" "}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {issues.size} {issues.size === 1 ? "issue" : "issues"}
                    </span>
                  </summary>
                  {Array.from(issues, ([key, milestones]) => {
                    const issue = milestones[0];
                    return (
                      <div
                        key={key}
                        className={columns + " border-b border-border/60"}
                      >
                        <div className="min-w-0 border-r border-border px-4 py-2">
                          <div className="font-mono text-xs wrap-anywhere">
                            {issue.issue}
                          </div>
                          <div className="text-xs wrap-anywhere text-muted-foreground">
                            {issue.package} · {issue.ecosystem}
                          </div>
                        </div>
                        <div className={gridLines}>
                          {ticks.slice(0, 4).map((tick) => (
                            <span key={tick} aria-hidden="true" />
                          ))}
                          {milestones.map((event) => {
                            const left =
                              (100 * (event.time - ticks[0])) /
                              (ticks[4] - ticks[0]);
                            const label =
                              labels[event.kind] +
                              " · " +
                              eventTime.format(event.time);
                            return (
                              <Tooltip.Root key={event.seq}>
                                <Tooltip.Trigger asChild>
                                  <time
                                    dateTime={new Date(
                                      event.time,
                                    ).toISOString()}
                                    tabIndex={0}
                                    className="absolute top-1/2 grid size-6 -translate-x-1/2 -translate-y-1/2 cursor-help place-items-center rounded text-medium"
                                    style={{
                                      left: `clamp(12px, ${left}%, calc(100% - 12px))`,
                                    }}
                                  >
                                    <Diamond
                                      size={13}
                                      fill="currentColor"
                                      aria-hidden="true"
                                    />
                                    <span className="sr-only">{label}</span>
                                  </time>
                                </Tooltip.Trigger>
                                <Tooltip.Portal>
                                  <Tooltip.Content
                                    sideOffset={4}
                                    collisionPadding={8}
                                    className="z-50 rounded border border-border bg-raised px-2 py-1 text-xs text-foreground shadow-sm"
                                  >
                                    {label}
                                  </Tooltip.Content>
                                </Tooltip.Portal>
                              </Tooltip.Root>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </details>
              ))}
            </div>
          </div>
        </Tooltip.Provider>
      )}
    </section>
  );
}
