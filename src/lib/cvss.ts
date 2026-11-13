import type { Finding } from './model';

function text(value: unknown) { return typeof value === 'string' ? value : ''; }

export function readCvss(vulnerability: Record<string, unknown>): Finding['cvss'] {
  const ratings = vulnerability.CVSS;
  if (!ratings || typeof ratings !== 'object' || Array.isArray(ratings)) return;
  const entries = Object.entries(ratings);
  const priority = (source: string) => source === vulnerability.SeveritySource ? 0 : source === 'nvd' ? 1 : 2;
  entries.sort(([a], [b]) => priority(a) - priority(b) || a.localeCompare(b));
  for (const [source, rating] of entries) {
    if (!rating || typeof rating !== 'object') continue;
    for (const [version, prefix] of [[4, 'V40'], [3, 'V3'], [2, 'V2']] as const) {
      const score = rating[`${prefix}Score`];
      if (typeof score === 'number' && score >= 0 && score <= 10) return { score, version, source, ...(text(rating[`${prefix}Vector`]) && { vector: text(rating[`${prefix}Vector`]) }) };
    }
  }
}
