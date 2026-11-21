import { GithubError, githubErrorMessage, githubHttp, type GithubHttp } from './github-http';
import { SourceError, sourceErrorMessage } from './errors';
import { readAuthConfig } from '../auth-settings';
import { isAdministrator } from '../auth';
import { gitlabApp, pause } from './gitlab';
import { credentialProvider, connectionRevision } from './github-app';
import { sourceAnalyzerVersion } from './version';
import { enrichLegacyCvss } from './legacy-cvss';
import { cleanSourceSpool, requireSourceStorage, recordStorageError, SourceStoragePressure } from './storage';
import { appendEvidence, sourceComparison } from './provenance';
import type { Analysis } from './analysis';
import { randomUUID } from 'node:crypto';
import { open, writeFile, mkdir, stat, rename, rm, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { Store } from '../store';
import type { Config } from '../config';
import { enqueueSource, sourceFlags, sourcePolicy } from './service';
import { GitProvider, ProviderError, providerReader, type ReadJson } from './provider';
const text = z.string().max(4096);
const scope = z.enum(['runtime','development','optional','peer','unknown']);
export const resultSchema = z.object({ ok: z.literal(true), bundleHash: z.string().regex(/^[a-f0-9]{64}$/), sbom: z.string().max(8*1024*1024), analyzer: text,
  database: z.object({ Version: z.number(), UpdatedAt: text, NextUpdate: text.optional(), DownloadedAt: text.optional() }).passthrough(),
  analysis: z.object({
    nodes: z.array(z.object({ id: text, name: text, version: text, file: text, location: text, dev: z.boolean(), raw: z.unknown().optional() })).max(50_000),
    edges: z.array(z.object({ from: text, to: text, scope, requestedName: text.optional(), specifier: text.optional() })).max(200_000),
    roots: z.array(z.object({ id: text, workspace: text, manifest: text, name: text, declarations: z.record(text,z.unknown()).optional() })).max(1000),
    findings: z.array(z.object({ cvss: z.object({ score: z.number().min(0).max(10), version: z.union([z.literal(2), z.literal(3), z.literal(4)]), source: text, vector: text.optional() }).optional(), advisory: text, aliases: z.array(text).max(100), node: text, package: text, version: text, fixed: text, severity: text, title: text, file: text })).max(100_000),
    warnings: z.array(text).max(5000), manager: z.enum(['npm','pnpm','bun','python','mixed','unknown']), folder: text, analyzerPackages: z.array(z.unknown()).max(100_000),
    coverage: z.object({ inputs: z.enum(['complete','partial']), inventory: z.enum(['complete','unknown']), graph: z.enum(['complete','partial']), runtime: z.literal('unknown') }),
  }), paths: z.record(text, z.object({ paths: z.array(z.array(text).max(80)).max(100), truncated: z.boolean(), relationship: z.enum(['known','unknown']) })),
});
/** Worker claims also cover cancelled/interrupted jobs until the isolated process has stopped. */
export async function sourceWorkerBusy() {
  const spool=process.env.KOPES_SOURCE_SPOOL;if(!spool)return false;
  try{return (await readdir(join(spool,'out'))).some(name=>/^[a-f0-9-]{36}\.active$/.test(name));}catch{return false;}
}
export function recoverSourceJobs(store: Store) {
  store.db.prepare("UPDATE source_jobs SET state='queued',available_at=? WHERE state='running'").run(Date.now());
}
export function needsSourceAnalysis(kind: string, head: string | null, commit: string, lastObserved?: number, now = Date.now(), previous?: { error?: unknown; analyzer?: string }) {
  if (previous?.error || previous && previous.analyzer !== sourceAnalyzerVersion) return true;
  return kind !== 'poll' || head !== commit || lastObserved === undefined || lastObserved <= now - 86400_000;
}
export function queueDueSources(store: Store) {
  if (!sourceFlags().scanning) return;
  const due = store.db.prepare(`SELECT b.id FROM source_bindings b LEFT JOIN projects p ON p.id=b.project_id JOIN source_connections c ON c.id=b.connection_id
    WHERE b.enabled=1 AND b.access_status='active' AND (b.project_id IS NULL OR p.archived=0) AND c.disconnected=0 AND b.next_poll<=? ORDER BY b.next_poll LIMIT 20`).all(Date.now());
  for (const row of due) {
    enqueueSource(store, String(row.id), 'poll');
    store.db.prepare('UPDATE source_bindings SET next_poll=? WHERE id=?').run(Date.now()+15*60_000, row.id);
  }
}
export async function runSourceJob(store: Store, config: Config, signal: AbortSignal, read: ReadJson = providerReader(sourcePolicy()), admission: (store: Store, spool: string) => Promise<unknown> = requireSourceStorage, http: GithubHttp = githubHttp): Promise<boolean> {
  if (!sourceFlags().scanning || !sourceFlags().connections || !process.env.KOPES_SOURCE_SPOOL) return false;
  if (await sourceWorkerBusy()) return false;
  // Storage failure pauses source admission without polling providers or consuming retries.
  try {
    await mkdir(join(process.env.KOPES_SOURCE_SPOOL,'in'),{recursive:true,mode:0o700});
    await mkdir(join(process.env.KOPES_SOURCE_SPOOL,'out'),{recursive:true,mode:0o700});
    await cleanSourceSpool(process.env.KOPES_SOURCE_SPOOL);
    await admission(store, process.env.KOPES_SOURCE_SPOOL);
    recordStorageError(store,'');
  } catch(e) { recordStorageError(store,e instanceof SourceStoragePressure?e.reason:'Source scanning paused: temporary storage maintenance failed.'); return false; }
  queueDueSources(store);
  const job = store.db.prepare(`SELECT j.*,b.repository_id,b.connection_id,b.branch,b.folder,b.project_id,b.head_sha,b.error AS binding_error,r.provider_id,c.auth_kind,c.credential_version,b.access_revision AS binding_revision
    FROM source_jobs j JOIN source_bindings b ON b.id=j.binding_id LEFT JOIN projects p ON p.id=b.project_id
    JOIN source_repositories r ON r.id=b.repository_id JOIN source_connections c ON c.id=b.connection_id
    WHERE j.state='queued' AND j.available_at<=? AND b.enabled=1 AND b.access_status='active' AND c.disconnected=0 AND (b.project_id IS NULL OR p.archived=0) ORDER BY j.created_at LIMIT 1`).get(Date.now());
  if (!job) return false;
  const jobId = String(job.id), spool = process.env.KOPES_SOURCE_SPOOL;
  const attemptId = randomUUID();
  const input = join(spool, 'in', attemptId+'.json'), output = join(spool, 'out', attemptId+'.json');
  store.db.prepare("UPDATE source_jobs SET state='running',attempted_at=?,attempts=attempts+1 WHERE id=?").run(Date.now(), jobId);
  let accessRevision = '';
  try { accessRevision = connectionRevision(store,String(job.connection_id),String(job.provider_id)); } catch { store.db.prepare("UPDATE source_jobs SET state='cancelled' WHERE id=?").run(jobId); return true; }
  const grantUser=job.auth_kind==='gitlab_oauth' ? store.db.prepare('SELECT user_id FROM gitlab_grants WHERE connection_id=?').get(job.connection_id)?.user_id : null;
  const checkOwner=()=>{
    if(job.auth_kind!=='gitlab_oauth')return;
    const owner=store.db.prepare('SELECT githubLogin,accessLogin,emailVerified,accessId FROM user WHERE id=?').get(grantUser??null);
    const app=gitlabApp(store), accessId=String(owner?.accessId??'');
    if(!owner || !isAdministrator({githubLogin:String(owner.githubLogin??''),accessLogin:String(owner.accessLogin??''),emailVerified:!!owner.emailVerified},readAuthConfig(store,config)) || accessId.startsWith('gitlab:') && (!app?.login || JSON.parse(accessId.slice(7))[0]!==app.origin)){
      pause(store,String(job.connection_id),!owner,owner?String(job.provider_id):undefined);throw new Error('Reauthorization required');
    }
  };
  const accessCurrent = () => { try { checkOwner(); return connectionRevision(store,String(job.connection_id),String(job.provider_id))===accessRevision; } catch { return false; } };
  const active = () => accessCurrent() && !signal.aborted && Boolean(store.db.prepare(`SELECT 1 FROM source_jobs j JOIN source_bindings b ON b.id=j.binding_id JOIN source_connections c ON c.id=b.connection_id LEFT JOIN projects p ON p.id=b.project_id
    WHERE (b.project_id IS NULL OR p.archived=0) AND j.id=? AND j.state='running' AND b.enabled=1 AND b.access_status='active' AND c.disconnected=0 AND c.credential_version=? AND b.connection_id=? AND b.access_revision=?`).get(jobId, job.credential_version,job.connection_id,job.binding_revision));
  let stage = 'Repository credentials';
  try {
    const { provider } = credentialProvider(store,String(job.connection_id),config.secret,read,String(job.provider_id),http,grantUser ? {user:String(grantUser),check:()=>{if(!active())throw new Error('GitLab binding unavailable.');}}:undefined);
    stage = 'Repository metadata lookup';
    const repo = await provider.repository(String(job.provider_id));
    if (!active()) return true;
    if (repo.providerId !== String(job.provider_id)) throw new SourceError('repository-identity');
    const historical = String(job.kind).startsWith('deployed:');
    stage = 'Saving repository branch';
    if (!historical) store.db.prepare('UPDATE source_bindings SET branch=? WHERE id=?').run(repo.branch, job.binding_id);
    stage = 'Default branch lookup';
    const commit = historical ? String(job.commit_sha) : await provider.head(repo, repo.branch);
    stage = 'Scan history lookup';
    const last = historical ? undefined : store.db.prepare("SELECT s.observed_at,s.snapshot_id,s.result_json,s.analyzer FROM source_scans s JOIN source_jobs j ON j.id=s.job_id WHERE s.binding_id=? AND j.kind NOT LIKE 'deployed:%' ORDER BY s.observed_at DESC LIMIT 1").get(job.binding_id);
    if (!active()) return true;
    if (!needsSourceAnalysis(String(job.kind), job.head_sha === null ? null : String(job.head_sha), commit, last ? Number(last.observed_at) : undefined, Date.now(), { error: job.binding_error || job.error, analyzer: last ? String(last.analyzer) : undefined })) {
      store.db.prepare("UPDATE source_jobs SET state='complete',commit_sha=?,error=NULL WHERE id=?").run(commit, jobId); return true;
    }
    const saved = last && job.head_sha === commit ? store.db.prepare('SELECT bundle_hash,inventory_json FROM source_snapshots WHERE id=?').get(last.snapshot_id) : undefined;
    const savedInventory = saved ? JSON.parse(String(saved.inventory_json)) : undefined;
    const rematch = String(job.kind) === 'poll' && savedInventory?.sbom && last && last.analyzer === sourceAnalyzerVersion ? { analyzer: sourceAnalyzerVersion, inventory: JSON.parse(String(last.result_json)), sbom: savedInventory.sbom } : undefined;
    stage = 'Repository input collection';
    const { favicon, ...bundle } = rematch ? { favicon: rematch.inventory.favicon, commit, files: {}, hash: String(saved!.bundle_hash), collectedAt: Date.now() } : await provider.bundle(repo, commit);
    if (!active()) return true;
    await mkdir(join(spool,'in'), { recursive: true, mode: 0o700 }); await mkdir(join(spool,'out'), { recursive: true, mode: 0o700 });
    await admission(store,spool);
    if (!active()) return true;
    await rm(output, { force: true });
    await writeFile(input+'.tmp', JSON.stringify({ bundle, folder: job.folder, rematch }), { mode: 0o600 }); if (!active()) return true; await rename(input+'.tmp', input);
    stage = 'Isolated dependency analysis';
    let completed = false;
    for (let tick = 0; tick < 220; tick++) {
      if (!active()) return true;
      try { await stat(output); completed = true; break; } catch { /* atomic result not published yet */ }
      await delay(1000, undefined, { signal });
    }
    if (!completed) throw new Error('Source worker timed out.');
    const resultFile = await open(output, constants.O_RDONLY | constants.O_NOFOLLOW);
    let payload: string;
    try { const info = await resultFile.stat(); if (!info.isFile() || info.size > 32*1024*1024) throw new Error('Unsafe or oversized source result.'); payload = await resultFile.readFile('utf8'); } finally { await resultFile.close(); }
    stage = 'Isolated analysis result validation';
    const result = resultSchema.parse(JSON.parse(payload));
    if (result.bundleHash !== bundle.hash || result.analysis.folder !== String(job.folder)) throw new Error('Result identity mismatch.');
    const ids = new Set([...result.analysis.nodes, ...result.analysis.roots].map(n => n.id));
    if (result.analysis.edges.some(e => !ids.has(e.from) || !ids.has(e.to)) || result.analysis.findings.some(f => !ids.has(f.node))) throw new Error('Invalid result references.');
    await enrichLegacyCvss(result.analysis.findings);
    if (!active()) return true;
    let history: Awaited<ReturnType<GitProvider['history']>> | undefined;
    if (sourceFlags().provenance && store.db.prepare("SELECT 1 FROM source_connections WHERE id=? AND (auth_kind NOT IN ('pat','github_app') OR history=1)").get(job.connection_id)) { try { history = await provider.history(repo, commit); } catch { /* Attribution unavailable; scan evidence is still useful. */ } }
    if (!active()) return true;
    await admission(store,spool);
    if (job.auth_kind === 'gitlab_oauth') {
      stage = 'Rechecking GitLab repository access';
      const current = await provider.repository(String(job.provider_id));
      await provider.head(current, current.branch);
    }
    stage = 'Saving source scan results';
    store.transaction(() => {
      if (!active()) return;
      const currentBinding = store.db.prepare('SELECT project_id FROM source_bindings WHERE id=?').get(job.binding_id)!;
      const evidenceProject = currentBinding.project_id === null ? null : String(currentBinding.project_id);
      const previousScan = store.db.prepare("SELECT s.result_json,s.observed_at FROM source_scans s JOIN source_jobs j ON j.id=s.job_id WHERE s.binding_id=? AND j.kind NOT LIKE 'deployed:%' ORDER BY s.observed_at DESC LIMIT 1").get(job.binding_id);
      const snapshotId = randomUUID();
      store.db.prepare('INSERT OR IGNORE INTO source_snapshots VALUES (?,?,?,?,?,?)').run(snapshotId, job.repository_id, commit, bundle.hash, JSON.stringify({ nodes: result.analysis.nodes, edges: result.analysis.edges, roots: result.analysis.roots, manager: result.analysis.manager, analyzerPackages: result.analysis.analyzerPackages, sbom: result.sbom }), Date.now());
      const snapshot = store.db.prepare('SELECT id FROM source_snapshots WHERE repository_id=? AND commit_sha=? AND bundle_hash=?').get(job.repository_id, commit, bundle.hash)!;
      store.db.prepare('INSERT INTO source_scans VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), job.binding_id, snapshot.id, jobId, Date.now(), result.analyzer, JSON.stringify(result.database), JSON.stringify({ ...result.analysis, paths: result.paths, favicon }));
      if (history) {
        appendEvidence(store, evidenceProject, 'commit-metadata-observed', history, null, String(job.binding_id));
        for (const change of history.associatedRequests) if (change.merged && change.mergeCommit === commit && change.targetBranch === repo.branch) appendEvidence(store, evidenceProject, 'merged', { ...change, commit, actorRole: 'merger', authenticatedFixer: null }, change.mergedAt && Number.isFinite(Date.parse(change.mergedAt)) ? Date.parse(change.mergedAt) : null, String(job.binding_id), change.merger ? { ...change.merger, role: 'merger' } : null);
      }
      for (const finding of result.analysis.findings) if (finding.fixed) appendEvidence(store, evidenceProject, 'fix-available', { advisory: finding.advisory, node: finding.node, fixed: finding.fixed, commit, database: result.database.UpdatedAt }, null, String(job.binding_id));
      if (previousScan && !historical) {
        const comparison = sourceComparison(JSON.parse(String(previousScan.result_json)) as Analysis, result.analysis);
        for (const observation of comparison.observations) appendEvidence(store, evidenceProject, observation.state, { ...observation, commit, observedBetween: [Number(previousScan.observed_at), Date.now()], actor: 'unknown' }, null, String(job.binding_id));
      }
      store.db.prepare("UPDATE source_jobs SET state='complete',commit_sha=?,error=NULL WHERE id=?").run(commit, jobId);
      if (!historical) store.db.prepare('UPDATE source_bindings SET head_sha=?,error=NULL,polled_at=? WHERE id=?').run(commit, Date.now(), job.binding_id);
      store.db.prepare('UPDATE source_repositories SET name=? WHERE id=?').run(repo.name, job.repository_id);
      store.db.prepare("UPDATE source_connections SET health='read-success',observed_at=? WHERE id=? AND auth_kind!='gitlab_oauth'").run(Date.now(), job.connection_id);
    });
  } catch (failure) {
    if (active()) {
      if (failure instanceof SourceStoragePressure) {
        store.db.prepare("UPDATE source_jobs SET state='queued',attempts=MAX(0,attempts-1),available_at=?,error=? WHERE id=?").run(Date.now()+60_000,failure.reason,jobId);
        recordStorageError(store,failure.reason);
        return true;
      }
      const detail = failure instanceof SourceError ? sourceErrorMessage(failure)
        : failure instanceof GithubError ? githubErrorMessage(failure)
        : failure instanceof ProviderError ? new ProviderError(failure.status).message
        : 'Retry the scan; if it continues, report this scan stage and check the application configuration.';
      const error = `${stage} failed. ${detail} Coverage is unknown; historical scans are retained.`;
      const attempts = Number(job.attempts)+1;
      store.db.prepare("UPDATE source_jobs SET state=?,error=?,available_at=? WHERE id=?").run(attempts >= 3 ? 'failed' : 'queued', error, failure instanceof GithubError && failure.retryAt ? failure.retryAt : Date.now()+Math.min(3600_000, 60_000*2**attempts), jobId);
      store.db.prepare('UPDATE source_bindings SET error=? WHERE id=?').run(error, job.binding_id);
      store.db.prepare("UPDATE source_connections SET health=?,observed_at=? WHERE id=? AND auth_kind!='gitlab_oauth'").run(failure instanceof GithubError ? failure.reason : 'stale-or-error',Date.now(),job.connection_id);
    } else store.db.prepare("UPDATE source_jobs SET state='cancelled' WHERE id=? AND state='running'").run(jobId);
  } finally {
    if (!active()) store.db.prepare("UPDATE source_jobs SET state=?,available_at=? WHERE id=? AND state='running'").run(signal.aborted ? 'queued' : 'cancelled', Date.now(), jobId);
    await rm(input, { force: true }); await rm(input+'.tmp', { force: true }); await rm(output, { force: true });
  }
  return true;
}
