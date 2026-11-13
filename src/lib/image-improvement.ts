import type { Report, Suggestion } from './model';
/** A changed index digest alone is not evidence that this platform's image changed. */
export function comparisonLimitation(current: Report, candidate: Report, action: Suggestion['action'], beforeId?: string | null, afterId?: string | null) {
  if (current.eol || candidate.eol) return 'End-of-life package coverage; no verified recommendation.';
  if (!current.packages.length || !candidate.packages.length || current.os && !candidate.os || current.coverage || candidate.coverage) return 'Insufficient comparable package coverage; no verified recommendation.';
  if (action === 'Rebuild' && (!beforeId || !afterId || beforeId === afterId)) return 'No verified change to this platform’s image; no rebuild reduction claimed.';
  return null;
}
