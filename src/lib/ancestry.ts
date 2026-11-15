import type { AncestryReason, Report } from './model';

export const ancestryReasons: Record<AncestryReason, string> = {
  'old-scan': 'This older scan did not record ancestry coverage. Rescan to discover underlying images.',
  'missing-metadata': 'Metadata does not establish the complete ancestry. Publish base labels or build provenance, then rescan.',
  'deleted-manifest': 'A referenced manifest was not found. Restore it or make an archived image available locally, then rescan.',
  'authentication-required': 'Registry authentication is required. Configure registry access, then rescan.',
  'registry-failure': 'Registry discovery failed. Check connectivity and registry availability, then rescan.',
  'discovery-limit': 'Discovery reached its work limit. Ancestry may extend beyond the images shown.',
  'source-only': 'Only release-source dependencies were assessed. Runtime image ancestry is unknown.',
};

/** Legacy data remains evidence of exactly what was recorded, never proof of completeness. */
export function normalizeAncestry(report: Report): Report {
  return { ...report, ancestry: report.ancestry ?? { state: 'incomplete', reasons: [report.coverage === 'release-source' ? 'source-only' : 'old-scan'] },
    baseImages: report.baseImages?.map(base => ({ ...base, scanStatus: base.scanStatus ?? (base.report ? 'scanned' : 'unknown'),
      historical: base.historical ?? !base.assessedAt })) };
}

export function preserveAncestry(previous: Report | null, current: Report): Report {
  const next = normalizeAncestry(current);
  const bases = new Map((next.baseImages ?? []).map(base => [base.digest, base]));
  for (const old of previous?.baseImages ?? []) {
    const fresh = bases.get(old.digest);
    if (!old.verified) continue;
    if (fresh?.verified && fresh.report) {
      bases.set(old.digest, { ...fresh, discoveredAt: old.discoveredAt ?? fresh.discoveredAt,
        evidence: [...(old.evidence ?? []), ...(fresh.evidence ?? [])].filter((item, index, all) => all.findIndex(other => other.kind === item.kind) === index) });
      continue;
    }
    if (!fresh?.verified || !fresh.report) bases.set(old.digest, { ...old, ...fresh,
      verified: true, layers: old.layers, identity: old.identity ?? fresh?.identity,
      report: fresh?.report ?? old.report, assessedAt: fresh?.assessedAt ?? old.assessedAt,
      discoveredAt: old.discoveredAt, historical: !fresh?.report,
      scanStatus: fresh?.scanStatus ?? 'unavailable',
      error: fresh?.error ?? 'Previously established ancestry retained; not reassessed in this scan.' });
  }
  return { ...next, baseImages: [...bases.values()] };
}
