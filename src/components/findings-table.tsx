import { severityColors } from "./severity-colors";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { severities, type Finding, type Severity } from "../lib/model";
import { Link } from "@tanstack/react-router";

type TableProps = {
  findings: { finding: Finding; index: number }[];
  findingSearch: (index: number) => { finding: number; scan?: number };
};

function ScoreIndicator({ cvss }: Pick<Finding, "cvss">) {
  const label = cvss
    ? `CVSS v${cvss.version} score ${cvss.score.toFixed(1)} of 10 (${cvss.source})`
    : "CVSS score unavailable";
  return (
    <span
      className="finding-score relative z-10"
      role="img"
      title={label}
      aria-label={label}
    >
      {cvss?.score.toFixed(1) ?? "–"}
    </span>
  );
}

function FixIndicator({
  fixed,
  severity,
}: Pick<Finding, "fixed" | "severity">) {
  const description = fixed ? `Fixed in ${fixed}` : "No fix available";
  return (
    <i
      role="img"
      title={description}
      aria-label={description}
      className={`finding-ring ${fixed ? "filled" : ""} ${severityColors[severity]} relative z-10`}
    />
  );
}

function SeverityGroup({
  severity,
  findings,
  findingSearch,
}: TableProps & { severity: Severity }) {
  const [expanded, setExpanded] = useState(true);
  const [limit, setLimit] = useState(50);
  const label = severity[0] + severity.slice(1).toLowerCase();
  return (
    <tbody>
      <tr>
        <th colSpan={2} scope="rowgroup" className="finding-section">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            <ChevronDown size={10} aria-hidden="true" />
            <i
              aria-hidden="true"
              className={`finding-ring filled ${severityColors[severity]}`}
            />
            {label}{" "}
            <span className="font-normal text-muted-foreground">
              {findings.length}
            </span>
          </button>
        </th>
      </tr>
      {expanded &&
        findings.slice(0, limit).map(({ finding: f, index }) => (
          <tr className="finding-row" key={index}>
            <td>
              <Link
                to="/"
                search={findingSearch(index)}
                state={{ fromFindings: true }}
                className="finding-summary"
              >
                <ScoreIndicator cvss={f.cvss} />
                <span className="finding-id" title={f.id}>
                  {f.id}
                </span>
                <FixIndicator fixed={f.fixed} severity={severity} />
                <strong title={f.title}>
                  {f.title || "Untitled advisory"}
                </strong>
              </Link>
            </td>
            <td>
              <span className="finding-chip" title={f.package}>
                {f.package}
              </span>
            </td>
          </tr>
        ))}
      {expanded && findings.length > limit && (
        <tr>
          <td colSpan={2}>
            <button
              className="cursor-pointer py-1.5 text-brand-ink"
              type="button"
              onClick={() => setLimit(limit + 50)}
            >
              Show {Math.min(50, findings.length - limit)} more{" "}
              {label.toLowerCase()} findings
            </button>
          </td>
        </tr>
      )}
    </tbody>
  );
}

export function FindingsTable({ findings, findingSearch }: TableProps) {
  return (
    <div className="findings-list">
      <table>
        <caption className="sr-only">Findings grouped by severity</caption>
        <thead className="sr-only">
          <tr>
            <th>Advisory</th>
            <th>Package</th>
          </tr>
        </thead>
        {severities.map((severity) => {
          const group = findings.filter((f) => f.finding.severity === severity);
          return group.length ? (
            <SeverityGroup
              key={severity}
              severity={severity}
              findings={group}
              findingSearch={findingSearch}
            />
          ) : null;
        })}
      </table>
    </div>
  );
}
