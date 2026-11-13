import { sourcePackageType } from '../../lib/source-inputs';
import type { Store } from '../store';
import { ProjectStore, type ProjectPrincipal } from '../project-store';
import { introductionPaths, type Analysis, type SourceFinding } from './analysis';
import { editableDependencies } from '../../lib/source-guidance';
import { matchesSource, type SourceEvidence } from '../../lib/finding-evidence';
import { severities, type Finding, type Report } from '../../lib/model';
import { pulseChanges } from '../../lib/pulse';

export function sourceFinding(f: SourceFinding): Finding {
  return { ...(f.cvss && { cvss: f.cvss }), id: [f.advisory, ...f.aliases].find(id => /^CVE-\d{4}-\d+$/i.test(id)) ?? f.advisory, package: f.package, installed: f.version, fixed: f.fixed,
    severity: severities.find(s => s === f.severity) ?? 'UNKNOWN', title: f.title, type: sourcePackageType(f.file), path: f.file };
}
export function sourceBindings(store: Store, principal: ProjectPrincipal) {
  const projects = new ProjectStore(store.db, principal);
  return store.db.prepare(`SELECT b.*, r.name AS repository FROM source_bindings b JOIN source_repositories r ON r.id=b.repository_id
    LEFT JOIN projects p ON p.id=b.project_id WHERE b.enabled=1 AND (b.project_id IS NULL OR p.archived=0)`).all()
    .filter(b => b.project_id === null ? principal.administrator : projects.canRead(String(b.project_id)));
}
export function findingEvidence(store: Store, principal: ProjectPrincipal, issue?: string): SourceEvidence[] {
  const projects = new ProjectStore(store.db, principal);
  const result: SourceEvidence[] = [];
  for (const b of sourceBindings(store, principal)) {
    // A deployment scan must not replace the tracked branch's latest observation.
    const scan = store.db.prepare(`SELECT s.*, n.commit_sha FROM source_scans s JOIN source_snapshots n ON n.id=s.snapshot_id JOIN source_jobs j ON j.id=s.job_id
      WHERE s.binding_id=? AND j.kind NOT LIKE 'deployed:%' ORDER BY s.observed_at DESC,s.id DESC LIMIT 1`).get(b.id);
    if (!scan) continue;
    const a = JSON.parse(String(scan.result_json)) as Analysis;
    for (const f of a.findings) {
      const aliases = [...new Set([f.advisory, ...f.aliases])];
      if (issue && !aliases.includes(issue)) continue;
      const paths = introductionPaths(a, f.node);
      const s: SourceEvidence = { bindingId: String(b.id), scanId: String(scan.id), repository: String(b.repository), branch: String(b.branch), commit: String(scan.commit_sha),
        scannedAt: Number(scan.observed_at), projectId: b.project_id === null ? null : String(b.project_id), finding: sourceFinding(f), aliases, file: f.file,
        scopes: [...new Set(paths.paths.flatMap(path => path.slice(1).flatMap((to, i) => a.edges.filter(e => e.from === path[i] && e.to === to).map(e => e.scope))))],
        coverage: a.coverage, warnings: a.warnings, paths: paths.paths.map(p => p.map(id => a.nodes.find(n => n.id === id)?.name ?? a.roots.find(r => r.id === id)?.manifest ?? id)),
        truncated: paths.truncated, edits: editableDependencies(a, paths.paths), manager: a.manager, runtime: [], linkage: 'unknown' };
      result.push(s);
    }
  }
  return result;
}
export function annotateReport(report: Report, target: string, evidence: SourceEvidence[]): Report {
  return { ...report, findings: report.findings.map(f => ({ ...f, detection: report.coverage ? 'unknown' : target === 'host' ? 'host' : evidence.some(s => matchesSource(f, s) && s.runtime.some(r => r.targetId === target && r.matched)) ? 'both' : 'container' })) };
}
/** Persist each new source observation once so dismissal/bookmark sequences remain stable. */
export function syncSourcePulse(store: Store, principal: ProjectPrincipal) {
  const bindings = sourceBindings(store, principal);
  store.transaction(() => {
    for (const b of bindings) {
      const scan = store.db.prepare(`SELECT s.* FROM source_scans s JOIN source_jobs j ON j.id=s.job_id WHERE s.binding_id=? AND j.kind NOT LIKE 'deployed:%' ORDER BY s.observed_at DESC,s.id DESC LIMIT 1`).get(b.id);
      if (!scan) continue;
      const key = 'pulse.source.' + b.id;
      const previous = JSON.parse(store.getMeta(key) ?? 'null') as { id: string; report: Report } | null;
      if (previous?.id === scan.id) continue;
      const analysis = JSON.parse(String(scan.result_json)) as Analysis;
      const report: Report = { findings: analysis.findings.map(sourceFinding), packages: [], os: '', eol: false };
      const complete = analysis.coverage.inputs === 'complete' && analysis.coverage.inventory === 'complete' && analysis.coverage.graph === 'complete';
      for (const change of pulseChanges(previous?.report ?? null, report)) {
        if (change.kind === 'resolved' && !complete) continue;
        store.db.prepare('INSERT INTO pulse_events(target,name,time,payload) VALUES (?,?,?,?)').run('source:' + b.id, b.repository, scan.observed_at,
          JSON.stringify({ ...change, sourceBinding: b.id, resource: 'source:' + b.id, resourceName: b.repository, project: b.project_id }));
      }
      // Retain missing findings through partial scans; absence is not remediation evidence.
      const retained = complete ? report : { ...report, findings: [...report.findings, ...(previous?.report.findings ?? []).filter(f => !report.findings.some(n => n.id === f.id && n.package === f.package))] };
      store.setMeta(key, JSON.stringify({ id: scan.id, report: retained }));
    }
  });
  return new Set(bindings.map(b => String(b.id)));
}
