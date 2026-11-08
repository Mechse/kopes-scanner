import { severities, type Target } from "../lib/model";
import { severityColors } from "./severity-colors";
import { pillClass } from "./ui/pill";

export function Assessment({ targets }: { targets: Target[] }) {
  const highest = severities.find(level => targets.some(target => target.summary?.counts[level]));
  const assessed = targets.filter(target => target.summary).length;
  return <span className={`${pillClass} w-fit`}>
    <span aria-hidden="true" className={`size-1 shrink-0 rounded-full bg-current ${highest ? severityColors[highest] : ""}`} />
    {highest ? `${highest[0]}${highest.slice(1).toLowerCase()}` : assessed ? "No findings" : "Not assessed"}
    {assessed > 0 && assessed < targets.length && <span className="sr-only">; some resources not assessed</span>}
  </span>;
}

