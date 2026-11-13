import { createHash } from 'node:crypto';
import type { Store } from '../store';
import type { Analysis, SourceFinding } from './analysis';
export type RuntimeEvidence = { resourceId: string; currentImages: string[]; scannedImage: string; scannedAt: number; observedAt: number;
  coverage: 'complete' | 'unknown'; findings: { advisory: string; aliases: string[]; package: string; version: string }[];
  packages: { name: string; version: string }[]; linkedCommit?: string; linkage: 'confirmed' | 'producer-label' | 'unknown' };
export function verification(finding: Pick<SourceFinding,'advisory'|'aliases'|'package'|'version'>, evidence: RuntimeEvidence) {
  if (!evidence.currentImages.length || !evidence.currentImages.includes(evidence.scannedImage)) return { state: 'unavailable', reason: 'Scan is not of a currently observed image.' };
  const aliases = new Set([finding.advisory, ...finding.aliases]);
  if (evidence.findings.some(f => f.package === finding.package && [f.advisory,...f.aliases].some(a=>aliases.has(a)))) return { state: 'affected', reason: 'Matching package occurrence remains affected.' };
  if (evidence.coverage !== 'complete' || evidence.linkage !== 'confirmed') return { state: 'unavailable', reason: 'Relevant coverage or immutable source/image linkage is unconfirmed.' };
  if (evidence.currentImages.some(image => image !== evidence.scannedImage)) return { state: 'unavailable', reason: 'Other running replicas still require verification.' };
  if (!evidence.packages.some(p=>p.name===finding.package)) return { state: 'not-detected', reason: 'Package is no longer detected; this does not prove a patched package.' };
  // This is a scan observation, never a fixing actor or exact remediation timestamp.
  return { state: 'verified', reason: 'Current immutable image scanned with relevant package coverage and confirmed linkage.' };
}
export function sourceComparison(previous: Analysis, current: Analysis) {
  const comparable = [previous,current].every(a=>a.coverage.inputs==='complete' && a.coverage.inventory==='complete' && a.coverage.graph==='complete')
    && previous.folder===current.folder && previous.manager===current.manager
    && JSON.stringify(previous.roots.map(r=>r.manifest).sort())===JSON.stringify(current.roots.map(r=>r.manifest).sort());
  if (!comparable) return { comparable: false, observations: [] };
  const observations = previous.findings.flatMap(old => {
    if (current.findings.some(f=>f.file===old.file && f.package===old.package && [f.advisory,...f.aliases].some(a=>[old.advisory,...old.aliases].includes(a)))) return [];
    const packages = current.nodes.filter(n=>n.file===old.file && n.name===old.package);
    return [{ advisory: old.advisory, node: old.node, state: 'source-no-longer-vulnerable', reason: !packages.length ? 'package-removed' : packages.some(n=>n.version===old.version) ? 'advisory-or-analysis-changed' : 'package-version-changed' }];
  });
  return { comparable: true, observations };
}
export type DeploymentObservation = { providerId: string; resourceId: string; environment: string | null; commit: string | null; status: string;
  sourceTime: number | null; observedAt: number; actor: null; strength: 'provider-reported'; image: null };
export async function deploymentHistory(origin: string, token: string, applicationUuid: string, resourceId: string, environment: string | null, fetcher: typeof fetch = fetch): Promise<DeploymentObservation[]> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(applicationUuid)) throw new Error('Invalid application identifier.');
  const observations: DeploymentObservation[] = [];
  for (let page = 0; page < 10; page++) {
    const response = await fetcher(`${origin}/api/v1/deployments/applications/${encodeURIComponent(applicationUuid)}?skip=${page*50}&take=50`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error('Deployment history unavailable.');
    const raw = await response.text(); if (raw.length > 2*1024*1024) throw new Error('Deployment history too large.');
    const body = JSON.parse(raw), rows = Array.isArray(body) ? body : body.deployments;
    if (!Array.isArray(rows)) throw new Error('Unrecognized deployment response.');
    for (const row of rows) {
      const id = row.deployment_uuid ?? row.uuid; if (typeof id !== 'string' || id.length > 200) continue;
      const commit = typeof row.commit === 'string' && /^[a-f0-9]{40,64}$/.test(row.commit) ? row.commit : null;
      const time = typeof row.created_at === 'string' ? Date.parse(row.created_at) : NaN;
      observations.push({ providerId: id, resourceId, environment, commit, status: ['finished','failed','cancelled','in_progress','queued'].includes(row.status) ? row.status : 'unknown', sourceTime: Number.isFinite(time)?time:null, observedAt: Date.now(), actor: null, strength:'provider-reported',image:null });
    }
    if (rows.length < 50) return observations;
  }
  throw new Error('Deployment history pagination limit reached; coverage incomplete.');
}
export function appendEvidence(store: Store, projectId: string | null, kind: string, evidence: unknown, sourceTime: number | null = null, bindingId: string | null = null, actor: unknown = null) {
  const encoded = JSON.stringify(evidence);
  const id = createHash('sha256').update(JSON.stringify([projectId,bindingId,kind,sourceTime,evidence,actor])).digest('hex');
  store.db.prepare('INSERT OR IGNORE INTO source_events VALUES (?,?,?,?,?,?,?,?)').run(id,projectId,bindingId,kind,sourceTime,Date.now(),actor?JSON.stringify(actor):null,encoded);
  return id;
}

export function runtimeTransition(previous: { state: string; observedAt: number } | undefined, finding: Parameters<typeof verification>[0], evidence: RuntimeEvidence) {
  if (previous && evidence.observedAt < previous.observedAt) return { ...previous, event: 'late-observation-ignored' };
  const next = verification(finding,evidence);
  return { ...next, observedAt: evidence.observedAt, event: previous?.state==='verified'&&next.state==='affected'?'reopened':next.state==='verified'?'runtime-verified':next.state==='affected'?'runtime-affected':'verification-unavailable' };
}

/** Matching runtime occurrences are evidence of exposure, not proof of which commit produced an image. */
export function correlateRuntime(source: SourceFinding[], report: import('../../lib/model').Report) {
  if (report.coverage === 'release-source') return { relationship: 'unknown', occurrences: [] as { node: string; advisory: string; path: string }[] };
  const index = new Map<string, typeof report.findings>();
  for (const f of report.findings) if (['npm','node-pkg','pnpm','yarn'].includes(f.type)) {
    const key = JSON.stringify([f.package,f.installed,f.id]); index.set(key,[...(index.get(key)??[]),f]);
  }
  const occurrences: {node:string;advisory:string;path:string}[] = []; let truncated = false;
  outer: for (const s of source) for (const alias of [s.advisory,...s.aliases]) for (const f of index.get(JSON.stringify([s.package,s.version,alias]))??[]) {
    if (occurrences.length>=1000) { truncated=true; break outer; }
    occurrences.push({node:s.node,advisory:f.id,path:f.path});
  }
  return { relationship: occurrences.length ? 'matching-runtime-occurrences; source-image-link-unconfirmed' : 'unknown', occurrences, truncated };
}
