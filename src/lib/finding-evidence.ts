import type { Finding } from './model';
import type { Analysis } from '../server/source/analysis';
export type Detection = 'codebase' | 'container' | 'both' | 'host' | 'unknown';
export type SourceEvidence = {
  bindingId: string; scanId: string; repository: string; branch: string; commit: string; scannedAt: number;
  projectId: string | null; finding: Finding; aliases: string[]; file: string;
  scopes: string[]; coverage: Analysis['coverage']; warnings: string[]; paths: string[][]; truncated: boolean;
  edits: { manifest: string; dependency: string; direct: boolean }[]; manager: string;
  runtime: { targetId: string; name: string; scannedAt: number | null; matched: boolean; available: boolean }[];
  linkage: 'unknown';
};
export const detectionLabels: Record<Detection, string> = { codebase: 'Detected in codebase', container: 'Detected in container', both: 'Matched in both', host: 'Detected on host', unknown: 'Coverage unknown' };
export function matchesSource(f: Finding, s: SourceEvidence) {
  return ['npm', 'node-pkg', 'pnpm', 'yarn'].includes(f.type) && f.package === s.finding.package && f.installed === s.finding.installed && s.aliases.includes(f.id);
}
export function sourceDetection(s: SourceEvidence): Detection { return s.runtime.some(r => r.matched) ? 'both' : 'codebase'; }

/** Codebase and container filters include exact matches observed in both. */
export function matchesDetection(filter: string, detection: Detection) {
  return filter === 'all' || filter === detection || detection === 'both' && (filter === 'codebase' || filter === 'container');
}
