import { credentialProvider, invalidateConnection } from './github-app';
import { boundedBody } from './body';
import { createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Store } from '../store';
import { ProjectStore, type ProjectPrincipal } from '../project-store';
import { GitProvider, providerReader, validateOrigin, safeInputPath, type Connection, type NetworkPolicy, type ReadJson } from './provider';

export const sourceFlags = () => ({ connections: process.env.KOPES_SOURCE_PILOT === '1', scanning: process.env.KOPES_SOURCE_SCAN_PILOT === '1', provenance: process.env.KOPES_PROVENANCE_PILOT === '1' });
export const sourcePolicy = (): NetworkPolicy => ({ gitlabOrigins: (process.env.KOPES_GITLAB_ORIGINS ?? '').split(',').filter(Boolean), privateOrigins: (process.env.KOPES_GITLAB_PRIVATE_ORIGINS ?? '').split(',').filter(Boolean), ca: process.env.KOPES_GITLAB_CA_PEM || undefined });
export { seal, unseal } from './credentials';
import { seal, unseal } from './credentials';
export function connectionFor(store: Store, id: string, secret: string): Connection {
  const row = store.db.prepare('SELECT * FROM source_connections WHERE id=? AND disconnected=0').get(id);
  if (!row || row.auth_kind === 'github_app' || !['github','gitlab'].includes(String(row.provider))) throw new Error('Connection unavailable.');
  return { provider: row.provider as Connection['provider'], origin: String(row.origin), token: row.credential ? unseal(String(row.credential), secret, `${row.id}:${row.origin}`) : '' };
}
export function enqueueSource(store: Store, bindingId: string, kind = 'scan', commit?: string) {
  if (commit && !/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('Invalid commit.');
  const binding = store.db.prepare(`SELECT 1 FROM source_bindings b LEFT JOIN projects p ON p.id=b.project_id
    JOIN source_connections c ON c.id=b.connection_id WHERE b.id=? AND b.enabled=1 AND (b.project_id IS NULL OR p.archived=0) AND c.disconnected=0 AND b.access_status='active'`).get(bindingId);
  if (!binding) throw new Error('Binding is not active.');
  store.db.prepare("INSERT OR IGNORE INTO source_jobs(id,binding_id,kind,state,created_at,available_at,commit_sha) VALUES (?,?,?,'queued',?,?,?)")
    .run(randomUUID(), bindingId, kind, Date.now(), Date.now(), commit ?? null);
}
const id = z.string().min(1).max(200), short = z.string().trim().min(1).max(300);
const command = z.discriminatedUnion('action', [
  z.object({ action: z.literal('connect'), provider: z.enum(['github','gitlab']), origin: z.string().max(2048), token: z.string().max(8192).default(''), repository: short }).strict(),
  z.object({ action: z.literal('rotate'), connectionId: id, token: z.string().max(8192) }).strict(),
  z.object({ action: z.literal('disconnect'), connectionId: id }).strict(),
  z.object({ action: z.literal('bind'), projectId: id, connectionId: id, repository: short, branch: short, folder: z.string().max(1024).default(''), resources: z.array(id).max(0).default([]) }).strict(),
  z.object({ action: z.literal('scan'), bindingId: id }).strict(),
  z.object({ action: z.literal('cancel'), bindingId: id }).strict(),
]);
export async function handleSource(request: Request, store: Store, principal: ProjectPrincipal, options: { secret: string; origin: string; recheck?: () => Promise<void> }, reader: ReadJson = providerReader(sourcePolicy())) {
  const flags = sourceFlags();
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
  if (!flags.connections) return json({ enabled: false, reason: 'Source pilot is disabled.' }, 503);
  const audit = (action: string, id: string) => store.db.prepare('INSERT INTO access_history(actor,action,identifier,time) VALUES (?,?,?,?)').run(principal.userId, action, id, Date.now());
  const projects = new ProjectStore(store.db, principal), url = new URL(request.url);
  const authorizedBinding = (bindingId: string) => {
    const row = store.db.prepare('SELECT * FROM source_bindings WHERE id=?').get(bindingId);
    if (!row || !(row.project_id === null ? principal.administrator : projects.canRead(String(row.project_id)))) throw new Error('Binding not found.');
    return row;
  };
  if (request.method === 'GET') {
    const project = url.searchParams.get('projectId');
    if (project) {
      if (!projects.canRead(project)) return json({ error: 'Container not found.' }, 404);
      if (url.searchParams.get('view') === 'export') {
        const scan = store.db.prepare(`SELECT n.inventory_json FROM source_scans s JOIN source_bindings b ON b.id=s.binding_id JOIN source_snapshots n ON n.id=s.snapshot_id WHERE b.project_id=? AND s.id=?`).get(project, url.searchParams.get('scanId') ?? '');
        const sbom = scan ? JSON.parse(String(scan.inventory_json)).sbom : undefined;
        if (!sbom) return json({ error: 'SBOM unavailable.' }, 404);
        return new Response(sbom, { headers: { 'Content-Type': 'application/vnd.cyclonedx+json', 'Content-Disposition': 'attachment; filename="kopes-source-sbom.json"', 'Cache-Control': 'private, no-store' } });
      }
      if (url.searchParams.get('view') === 'scan') {
        const scan = store.db.prepare('SELECT s.binding_id,s.result_json FROM source_scans s JOIN source_bindings b ON b.id=s.binding_id WHERE b.project_id=? AND s.id=?').get(project,url.searchParams.get('scanId')??'');
        if (!scan) return json({ error: 'Scan not found.' },404);
        const result = JSON.parse(String(scan.result_json));
        return json({ result });
      }
      const bindings = store.db.prepare(`SELECT b.*,r.name AS repository,r.provider FROM source_bindings b JOIN source_repositories r ON r.id=b.repository_id WHERE b.project_id=?`).all(project);
      const scans = store.db.prepare(`SELECT s.id,s.binding_id,s.observed_at,s.analyzer,s.database_json,json_array_length(s.result_json,'$.findings') AS occurrences,json_extract(s.result_json,'$.coverage.inventory') AS inventoryCoverage,json_array_length(s.result_json,'$.nodes') AS packageCount,n.commit_sha FROM source_scans s
        JOIN source_bindings b ON b.id=s.binding_id JOIN source_snapshots n ON n.id=s.snapshot_id WHERE b.project_id=? ORDER BY s.observed_at DESC LIMIT 50`).all(project);
      return json({ storageError: store.getMeta('source.storage.error') || null, bindings: bindings.map(b=>({...b,resources:[]})), scans, flags });
    }
    if (!principal.administrator) return json({ error: 'Administrator access required.' }, 403);
    if (url.searchParams.get('view') === 'webhook') {
      const id = url.searchParams.get('connectionId') ?? '';
      const c = store.db.prepare("SELECT credential_version FROM source_connections WHERE id=? AND disconnected=0 AND auth_kind NOT IN ('pat','github_app')").get(id);
      if (!c) return json({ error: 'Connection not found.' }, 404);
      return json({ url: options.origin + '/api/source-hook/' + encodeURIComponent(id), secret: createHmac('sha256',options.secret).update(`kopes.source.hook:${id}:${c.credential_version}`).digest('hex'), events: 'Push only. Manual registration; keep polling enabled.' });
    }
    return json({ connections: store.db.prepare('SELECT id,provider,origin,credential_version,disconnected,health,observed_at FROM source_connections').all(), flags });
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (request.headers.get('origin') !== options.origin) return json({ error: 'Origin not allowed.' }, 403);
  let raw: string; try { raw = await boundedBody(request, 24_000); } catch { return json({ error: 'Request too large.' }, 413); }
  if (raw.length > 24_000) return json({ error: 'Request too large.' }, 413);
  let parsed; try { parsed = command.safeParse(JSON.parse(raw)); } catch { return json({ error: 'Invalid request.' }, 400); }
  if (!parsed.success) return json({ error: 'Invalid source action.' }, 400);
  const body = parsed.data;
  await options.recheck?.();
  if (!principal.administrator && !['scan','cancel'].includes(body.action)) return json({ error: 'Administrator access required.' }, 403);
  try {
    if (body.action === 'scan' || body.action === 'cancel') {
      authorizedBinding(body.bindingId);
      if (body.action === 'scan') {
        if (!flags.scanning) return json({ error: 'Source scanning pilot is disabled.' }, 503);
        enqueueSource(store, body.bindingId);
      } else store.db.prepare("UPDATE source_jobs SET state='cancelled' WHERE binding_id=? AND state IN ('queued','running')").run(body.bindingId);
      return json({ ok: true });
    }
    if (body.action === 'connect') {
      if (/[\r\n]/.test(body.token)) throw new Error('Invalid credential.');
      const connection = { provider: body.provider, origin: body.origin, token: body.token };
      const origin = validateOrigin(connection, sourcePolicy());
      connection.origin = origin;
      const repo = await new GitProvider(connection, reader).repository(body.repository);
      await options.recheck?.();
      const connectionId = randomUUID();
      store.transaction(() => {
      store.db.prepare("INSERT INTO source_connections(id,provider,origin,credential,health,observed_at,auth_kind) VALUES (?,?,?,?,?,?,?)")
        .run(connectionId, body.provider, origin, body.token ? seal(body.token, options.secret, `${connectionId}:${origin}`) : '', body.token ? 'repository-read; permissions-unvalidated' : 'public-read', Date.now(),body.token ? body.provider==='github'?'legacy_pat':'legacy_token':'anonymous');
      audit('source-connection-created', connectionId);
      });
      return json({ id: connectionId, repository: repo, compatibility: 'Repository read only; private permissions and lifecycle unvalidated.' });
    }
    if (body.action === 'rotate') {
      if (/[\r\n]/.test(body.token)) throw new Error('Invalid credential.');
      const row = store.db.prepare('SELECT origin,auth_kind FROM source_connections WHERE id=?').get(body.connectionId);
      if (!row || ['github_app','pat'].includes(String(row.auth_kind))) throw new Error('Use GitHub settings to update this connection.');
      if (!body.token) return json({ok:true});
      store.transaction(() => {
      store.db.prepare("UPDATE source_connections SET credential=?,credential_version=credential_version+1,health='unvalidated',disconnected=0,auth_kind=CASE WHEN provider='github' THEN 'legacy_pat' ELSE 'legacy_token' END WHERE id=?")
        .run(body.token ? seal(body.token, options.secret, `${body.connectionId}:${row.origin}`) : '', body.connectionId);
      audit('source-credential-rotated', body.connectionId);
      });
      return json({ ok: true });
    }
    if (body.action === 'disconnect') {
      store.transaction(() => {
        audit('source-disconnected', body.connectionId);
        invalidateConnection(store,body.connectionId,'disconnected',true);
        store.db.prepare("UPDATE github_setup_attempts SET status='cancelled',material='' WHERE app_id IN (SELECT i.app_id FROM github_installations i JOIN source_connections c ON c.installation_id=i.id WHERE c.id=?)").run(body.connectionId);
        store.db.prepare("UPDATE source_connections SET credential='',disconnected=1,health='disconnected',credential_version=credential_version+1 WHERE id=?").run(body.connectionId);
        store.db.prepare("UPDATE source_jobs SET state='cancelled' WHERE binding_id IN (SELECT id FROM source_bindings WHERE connection_id=?) AND state IN ('running','queued')").run(body.connectionId);
      }); return json({ ok: true });
    }
    if (!projects.canRead(body.projectId)) return json({ error: 'Container not found.' }, 404);
    if (body.folder && !safeInputPath(body.folder)) throw new Error('Invalid folder.');
    if (store.db.prepare('SELECT auth_kind FROM source_connections WHERE id=?').get(body.connectionId)?.auth_kind==='github_app') throw new Error('Use the GitHub repository picker.');
    const access = credentialProvider(store,body.connectionId,options.secret,reader);
    const { connection,provider } = access;
    const repo = await provider.repository(body.repository); await provider.head(repo, body.branch); await options.recheck?.(); access.current();
    const bindingId = randomUUID();
    store.transaction(() => {
      store.db.prepare('DELETE FROM source_removed_repositories WHERE provider=? AND origin=? AND (provider_id=? OR name=?)').run(connection.provider, connection.origin, repo.providerId, repo.name);
      store.db.prepare('INSERT OR IGNORE INTO source_repositories VALUES (?,?,?,?,?)').run(randomUUID(), connection.provider, connection.origin, repo.providerId, repo.name);
      const repository = store.db.prepare('SELECT id FROM source_repositories WHERE provider=? AND origin=? AND provider_id=?').get(connection.provider, connection.origin, repo.providerId)!;
      store.db.prepare('INSERT INTO source_bindings(id,project_id,repository_id,connection_id,branch,folder) VALUES (?,?,?,?,?,?)').run(bindingId, body.projectId, repository.id, body.connectionId, body.branch, body.folder);
      store.db.prepare('INSERT INTO source_events VALUES (?,?,?, ?,NULL,?,?,?)').run(randomUUID(), body.projectId, bindingId, 'binding-created', Date.now(), JSON.stringify({ id: principal.userId, role: 'administrator' }), JSON.stringify({ repositoryId: repository.id, branch: body.branch }));
      if (flags.scanning) enqueueSource(store, bindingId);
    });
    return json({ id: bindingId });
  } catch { return json({ error: 'Source operation failed. Check access, identifiers, approved origin and connection health. Historical results are retained.' }, 400); }
}
