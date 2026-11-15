import { baseImageOptions, matchesBaseImage } from './base-image-filter';
import { severities, type Report, type Target } from './model';
import { unifiedFindings, type UnifiedFinding } from './unified-findings';

export type ContainerImage = {
  id: string; name: string; digest: string | null; kind: 'Container image' | 'Base image' | 'Unverified candidate';
  identity?: import('./model').ImageIdentity; discoveredAt?: number; historical?: boolean; assessedAt?: number; scanStatus?: string; affectedFindings?: UnifiedFinding[]; assessed: boolean; findings: UnifiedFinding[]; standalone?: boolean; error?: string; source?: 'declared' | 'local' | 'provenance' | 'dockerfile'; depth?: number; inherited?: number;
};

/** Prefer standalone base scans; retain inherited findings for older saved reports. */
export function containerImages(target: Target, report: Report | null, reference = target.name): ContainerImage[] {
  if (target.kind !== 'image') return [];
  const sort = (rows: UnifiedFinding[]) => rows.sort((a, b) => severities.indexOf(a.finding.severity) - severities.indexOf(b.finding.severity));
  const images: ContainerImage[] = [{ id: 'container', name: reference, digest: target.image_id, kind: 'Container image', assessed: !!report, findings: sort(unifiedFindings(report, [], target.id)) }];
  const bases = new Map((report?.baseImages ?? []).map(base => [base.digest, base]));
  for (const option of baseImageOptions(report?.findings ?? [])) {
    if (!bases.has(option.value)) bases.set(option.value, { digest: option.value, name: option.label.split('@')[0], verified: true });
  }
  for (const base of bases.values()) images.push({
    id: base.digest, name: base.name || base.digest, digest: base.digest, kind: base.verified ? 'Base image' : 'Unverified candidate', assessed: base.report ? true : base.source ? false : base.verified,
    identity: base.identity, discoveredAt: base.discoveredAt,
    historical: base.historical || !base.assessedAt, assessedAt: base.assessedAt, scanStatus: base.scanStatus,
    affectedFindings: base.layers ? sort(unifiedFindings(report, [], target.id, finding => !!finding.layer && base.layers!.includes(finding.layer))) : [],
    standalone: !!base.report, error: base.error, source: base.source, depth: base.depth,
    inherited: base.layers ? unifiedFindings(report, [], target.id, finding => !!finding.layer && base.layers!.includes(finding.layer)).length : undefined,
    findings: base.report ? sort(unifiedFindings(base.report, [], target.id)) : !base.source && base.verified ? sort(unifiedFindings(report, [], target.id, finding => matchesBaseImage(finding, base.digest))) : [],
  });
  return images;
}
