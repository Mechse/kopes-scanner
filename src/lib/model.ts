export const severities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
export type Severity = typeof severities[number];
export type Finding = {
  id: string; package: string; installed: string; fixed: string;
  severity: Severity; title: string; type: string; path: string;
};
export type Package = { name: string; version: string; type: string; path: string };
export const garageRelease = {
  commit: '268334bd2530fa99f8b06c7383b2e9f776691edd',
  binarySha256: '004b6081c6e3cccbb80317c69e3c5749fbb3fc889e217cc9b89c215bf0dd7ded',
};
export type Report = { coverage?: 'release-source'; findings: Finding[]; packages: Package[]; os: string; eol: boolean };
export type Summary = { newCves?: string[]; coverage?: Report['coverage']; counts: Record<Severity, number>; packages: number; fixable: number; os: string; eol: boolean };
export type Suggestion = {
  tag: string; reference: string; digest: string; platform: string;
  removed: number; introduced: number; remaining: number; checkedAt: number;
};
export type Target = {
  id: string; kind: 'host' | 'image'; name: string; image_id: string | null;
  platform: string | null; status: 'queued' | 'scanning' | 'ready' | 'error' | 'unassessed';
  scanned_at: number | null; attempted_at: number | null; error: string | null;
  summary: Summary | null; suggestions: Suggestion[]; recommendation_note: string | null;
};
export type Container = { id: string; name: string; image: string; target_id: string; project: string; service: string; manager: string };
export type Dashboard = { targets: Target[]; containers: Container[]; inventoryAt: number | null; inventoryError: string | null; intervalHours: number };

export function summarize(report: Report): Summary {
  const counts = Object.fromEntries(severities.map(s => [s, 0])) as Record<Severity, number>;
  for (const finding of report.findings) counts[finding.severity]++;
  return { ...(report.coverage && { coverage: report.coverage }), counts, packages: report.packages.length, fixable: report.findings.filter(f => f.fixed).length, os: report.os, eol: report.eol };
}
