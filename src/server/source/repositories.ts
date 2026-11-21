import { githubHttp, type GithubHttp } from './github-http';
import { credentialProvider, auditGithub } from './github-app';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Store } from '../store';
import { ProjectStore, type ProjectPrincipal } from '../project-store';
import { GitProvider, providerReader, type ReadJson } from './provider';
import { enqueueSource, sourceFlags, sourcePolicy } from './service';
import { boundedBody } from './body';

export function githubRepository(input: string) {
  const value = input.trim().replace(/\.git\/?$/, '').replace(/\/$/, '');
  const path = value.startsWith('https://github.com/') ? value.slice(19) : value;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/.test(path) || ['.', '..'].includes(path.split('/')[1])) throw new Error('Enter a GitHub repository URL or owner/repository.');
  return path;
}
const command = z.discriminatedUnion('action', [
  z.object({ action: z.literal('remove'), bindingId: z.string().min(1) }).strict(),
  z.object({ action: z.literal('add'), connectionId: z.string().min(1).nullable().default(null), repository: z.string().max(300), asProject: z.boolean().default(false), projectId: z.string().min(1).nullable().default(null), resources: z.array(z.string().min(1)).max(0).default([]) }).strict(),
  z.object({ action: z.literal('switch'), bindingId: z.string(), connectionId: z.string().min(1) }).strict(),
  z.object({ action: z.literal('settings'), bindingId: z.string(), projectId: z.string().min(1).nullable(), resources: z.array(z.string().min(1)).max(0) }).strict(),
]);
function validateLinks(store: Store, projectId: string | null, resources: string[]) {
  if (projectId && !store.db.prepare('SELECT 1 FROM projects WHERE id=? AND archived=0').get(projectId)) throw new Error('Choose an active container.');
  for (const id of resources) if (!store.db.prepare('SELECT 1 FROM resources WHERE id=?').get(id)) throw new Error('Resource no longer exists.');
}
/** Anonymous GitHub reads only. No credentials are reused, even for existing repositories. */
export async function addPublicRepository(store: Store, input: { repository: string; projectId: string | null; resources: string[] }, reader: ReadJson = providerReader(sourcePolicy()), projectActor?: string, automatic = false, recheck: () => Promise<void> = async () => {}) {
  if (input.resources.length) throw new Error("Repository resource links are no longer supported.");
  validateLinks(store, input.projectId, []);
  const name = githubRepository(input.repository);
  const connection = { provider: 'github' as const, origin: 'https://api.github.com', token: '' };
  const provider = new GitProvider(connection, reader);
  const repo = await provider.repository(name);
  await provider.head(repo, repo.branch);
  await recheck();
  return store.transaction(() => {
    // Recheck after provider awaits: removal may have happened while discovery was in flight.
    const removed = store.db.prepare('SELECT 1 FROM source_removed_repositories WHERE provider=? AND origin=? AND (provider_id=? OR name=? OR name=?)').get(connection.provider, connection.origin, repo.providerId, repo.name, name);
    if (automatic && removed) return null;
    validateLinks(store, input.projectId, input.resources);
    if (!automatic) store.db.prepare('DELETE FROM source_removed_repositories WHERE provider=? AND origin=? AND (provider_id=? OR name=? OR name=?)').run(connection.provider, connection.origin, repo.providerId, repo.name, name);
    let projectId = input.projectId;
    if (projectActor) {
      projectId = randomUUID();
      const name = repo.name.split('/').pop()!;
      store.db.prepare('INSERT INTO projects(id,name,created_at) VALUES (?,?,?)').run(projectId, name, Date.now());
      store.db.prepare('INSERT INTO project_events(project_id,actor_id,action,detail_json,observed_at) VALUES (?,?,?,?,?)').run(projectId, projectActor, 'created', JSON.stringify({ name, repository: repo.name }), Date.now());
    }
    store.db.prepare('INSERT OR IGNORE INTO source_repositories VALUES (?,?,?,?,?)').run(randomUUID(), connection.provider, connection.origin, repo.providerId, repo.name);
    const repository = store.db.prepare('SELECT id FROM source_repositories WHERE provider=? AND origin=? AND provider_id=?').get(connection.provider, connection.origin, repo.providerId)!;
    let binding = store.db.prepare(`SELECT b.id FROM source_bindings b JOIN source_connections c ON c.id=b.connection_id
      WHERE b.repository_id=? AND b.project_id IS ? AND b.branch=? AND b.folder='' AND b.enabled=1 AND c.auth_kind='anonymous' AND c.disconnected=0`).get(repository.id, projectId, repo.branch);
    if (!binding) {
      const connectionId = randomUUID(), bindingId = randomUUID();
      store.db.prepare("INSERT INTO source_connections(id,provider,origin,credential,health,observed_at) VALUES (?,?,?,'','public-read',?)").run(connectionId, connection.provider, connection.origin, Date.now());
      store.db.prepare("INSERT INTO source_bindings(id,project_id,repository_id,connection_id,branch,folder) VALUES (?,?,?,?,?,'')").run(bindingId, projectId, repository.id, connectionId, repo.branch);
      binding = { id: bindingId };
    }
    if (sourceFlags().connections && sourceFlags().scanning) enqueueSource(store, String(binding.id));
    return { id: binding.id, projectId, queued: sourceFlags().connections && sourceFlags().scanning };
  });
}
export async function handleRepositories(request: Request, store: Store, principal: ProjectPrincipal, origin: string, reader: ReadJson = providerReader(sourcePolicy()), secret = '', recheck: () => Promise<void> = async () => {}, http: GithubHttp = githubHttp) {
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
  const projects = new ProjectStore(store.db, principal), url = new URL(request.url);
  const canRead = (project: unknown) => project === null ? principal.administrator : projects.canRead(String(project));
  const resourceVisible = (row: Record<string, unknown>) => principal.administrator || row.project_id !== null && canRead(row.project_id);
  if (request.method === 'GET') {
    const scanId = url.searchParams.get('scanId');
    if (scanId) {
      const scan = store.db.prepare(`SELECT s.*, b.project_id,n.inventory_json FROM source_scans s JOIN source_bindings b ON b.id=s.binding_id JOIN source_snapshots n ON n.id=s.snapshot_id WHERE s.id=?`).get(scanId);
      if (!scan || !canRead(scan.project_id)) return json({ error: 'Scan not found.' }, 404);
      if (url.searchParams.get('view') === 'export') return new Response(JSON.parse(String(scan.inventory_json)).sbom, { headers: { 'Content-Type': 'application/vnd.cyclonedx+json', 'Content-Disposition': 'attachment; filename="kopes-source-sbom.json"', 'Cache-Control': 'private, no-store' } });
      const result = JSON.parse(String(scan.result_json));
      return json({ result });
    }
    const bindings = store.db.prepare(`SELECT b.*,r.name AS repository,
      EXISTS(SELECT 1 FROM source_jobs j WHERE j.binding_id=b.id AND j.kind NOT LIKE 'deployed:%' AND j.state IN ('complete','failed')) AS first_run_finished,
      c.label AS connection_label,c.owner_login AS connection_owner,c.health AS connection_health,c.auth_kind FROM source_bindings b JOIN source_repositories r ON r.id=b.repository_id JOIN source_connections c ON c.id=b.connection_id ORDER BY r.name`).all().filter(b => canRead(b.project_id));
    return json({ administrator: principal.administrator, flags: sourceFlags(), storageError: store.getMeta('source.storage.error') || null,
      projects: projects.list(), resources: store.db.prepare('SELECT id,name,project_id FROM resources ORDER BY name').all().filter(resourceVisible).map(r => ({ ...r, containerIds: store.db.prepare('SELECT container_id FROM runtime_instances WHERE resource_id=? AND active=1').all(r.id).map(i => i.container_id) })),
      bindings: bindings.map(b => ({ ...b, resources: [],
        jobs: store.db.prepare(`SELECT state,error FROM source_jobs WHERE binding_id=? AND kind NOT LIKE 'deployed:%' ORDER BY CASE state WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END, created_at DESC, rowid DESC LIMIT 1`).all(b.id),
        scans: store.db.prepare(`SELECT s.id,s.binding_id,s.observed_at,s.analyzer,json_array_length(s.result_json,'$.findings') AS occurrences,json_extract(s.result_json,'$.coverage.inventory') AS inventoryCoverage,json_array_length(s.result_json,'$.nodes') AS packageCount,n.commit_sha FROM source_scans s JOIN source_snapshots n ON n.id=s.snapshot_id JOIN source_jobs j ON j.id=s.job_id WHERE s.binding_id=? AND j.kind NOT LIKE 'deployed:%' ORDER BY s.observed_at DESC LIMIT 5`).all(b.id) })) });
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!principal.administrator || request.headers.get('origin') !== origin) return json({ error: 'Administrator access and same origin required.' }, 403);
  try {
    const body = command.parse(JSON.parse(await boundedBody(request, 24000)));
    await recheck();
    if (body.action === 'add') {
      if (body.asProject && (body.projectId || body.resources.length)) throw new Error('A new repository container cannot belong to another container or resource.');
      if (body.connectionId) return json(await addConnectedRepository(store,body,secret,reader,principal.userId,recheck,http));
      return json(await addPublicRepository(store, body, reader, body.asProject ? principal.userId : undefined,false,recheck));
    }
    if (body.action === 'switch') {
      const binding = store.db.prepare('SELECT b.*,r.provider_id,r.provider AS repository_provider FROM source_bindings b JOIN source_repositories r ON r.id=b.repository_id WHERE b.id=?').get(body.bindingId);
      if (!binding || binding.repository_provider!=='github') throw new Error();
      const access = credentialProvider(store,body.connectionId,secret,reader,String(binding.provider_id),http);
      const repo = await access.provider.repository(String(binding.provider_id));
      await access.provider.head(repo,repo.branch); await recheck(); access.current();
      if (repo.providerId!==binding.provider_id || access.connection.provider!=='github') throw new Error();
      store.transaction(()=>{
        store.db.prepare("UPDATE source_bindings SET connection_id=?,access_revision=access_revision+1,access_status='active',next_poll=0,error=NULL WHERE id=?").run(body.connectionId,body.bindingId);
        store.db.prepare("UPDATE source_jobs SET state='cancelled' WHERE binding_id=? AND state IN ('queued','running')").run(body.bindingId);
        auditGithub(store,principal.userId,'github-binding-switched',body.bindingId);
      }); return json({ok:true});
    }
    if (body.action === 'remove') {
      const removed = store.transaction(() => {
        const repo = store.db.prepare('SELECT r.* FROM source_repositories r JOIN source_bindings b ON b.repository_id=r.id WHERE b.id=?').get(body.bindingId);
        if (!repo) return false;
        store.db.prepare('INSERT OR IGNORE INTO source_removed_repositories VALUES (?,?,?,?)').run(repo.provider, repo.origin, repo.provider_id, repo.name);
        const bindings = store.db.prepare('SELECT id,connection_id FROM source_bindings WHERE repository_id=?').all(repo.id);
        for (const binding of bindings) {
          store.db.prepare("DELETE FROM favourites WHERE scope='resource' AND key=?").run(`repo:${binding.id}`);
          for (const table of ['source_events', 'source_scans', 'source_jobs']) store.db.prepare(`DELETE FROM ${table} WHERE binding_id=?`).run(binding.id);
        }
        store.db.prepare('DELETE FROM source_bindings WHERE repository_id=?').run(repo.id);
        store.db.prepare('DELETE FROM source_snapshots WHERE repository_id=?').run(repo.id);
        store.db.prepare('DELETE FROM source_repositories WHERE id=?').run(repo.id);
        // Anonymous per-repository connections can be discarded; retain credentials and shared connections.
        for (const binding of bindings) store.db.prepare(`DELETE FROM source_connections WHERE id=? AND auth_kind='anonymous'
          AND NOT EXISTS(SELECT 1 FROM source_bindings WHERE connection_id=source_connections.id)
          AND NOT EXISTS(SELECT 1 FROM source_deliveries WHERE connection_id=source_connections.id)`).run(binding.connection_id);
        return true;
      });
      return removed ? json({ ok: true }) : json({ error: 'Repository not found.' }, 404);
    }
    validateLinks(store, body.projectId, body.resources);
    if (!store.db.prepare('SELECT 1 FROM source_bindings WHERE id=?').get(body.bindingId)) return json({ error: 'Repository not found.' }, 404);
    store.transaction(() => {
      store.db.prepare('UPDATE source_bindings SET project_id=? WHERE id=?').run(body.projectId, body.bindingId);
      // History follows repository access when its project changes.
      store.db.prepare('UPDATE source_events SET project_id=? WHERE binding_id=?').run(body.projectId, body.bindingId);
    });
    return json({ ok: true });
  } catch { return json({ error: 'Could not update repository. Check the selected connection, GitHub URL, available default branch, container and resources; GitHub may also be rate limiting requests.' }, 400); }
}


async function addConnectedRepository(store: Store, input: { repository: string; connectionId: string | null; projectId: string | null; asProject: boolean }, secret: string, reader: ReadJson, actor: string, recheck: () => Promise<void>, http: GithubHttp) {
  validateLinks(store,input.projectId,[]);
  const connection = store.db.prepare("SELECT * FROM source_connections WHERE id=? AND provider='github' AND auth_kind<>'anonymous' AND disconnected=0").get(input.connectionId!);
  if (!connection) throw new Error('Select an active connection.');
  const name = githubRepository(input.repository);
  const cached = connection.installation_id ? store.db.prepare("SELECT repository_id FROM github_installation_repositories WHERE installation_id=? AND name=? AND status='active'").get(connection.installation_id,name) : undefined;
  if (connection.installation_id && !cached) throw new Error('Refresh App access and select an available repository.');
  const access = credentialProvider(store,String(connection.id),secret,reader,cached ? String(cached.repository_id) : undefined,http);
  const repo = await access.provider.repository(name); await access.provider.head(repo,repo.branch); await recheck(); access.current();
  if (cached && repo.providerId!==cached.repository_id || connection.owner_login && repo.name.split('/')[0].toLowerCase()!==String(connection.owner_login).toLowerCase()) throw new Error('Repository identity changed.');
  return store.transaction(()=>{
    validateLinks(store,input.projectId,[]);
    let projectId = input.projectId;
    if (input.asProject) {
      projectId = randomUUID(); store.db.prepare('INSERT INTO projects(id,name,created_at) VALUES (?,?,?)').run(projectId,repo.name.split('/').pop()!,Date.now());
    }
    store.db.prepare('INSERT OR IGNORE INTO source_repositories(id,provider,origin,provider_id,name) VALUES (?,?,?,?,?)').run(randomUUID(),'github','https://api.github.com',repo.providerId,repo.name);
    const repository = store.db.prepare("SELECT id FROM source_repositories WHERE provider='github' AND origin='https://api.github.com' AND provider_id=?").get(repo.providerId)!;
    const id = randomUUID();
    store.db.prepare("INSERT INTO source_bindings(id,project_id,repository_id,connection_id,branch,folder) VALUES (?,?,?,?,?,'')").run(id,projectId,repository.id,connection.id,repo.branch);
    auditGithub(store,actor,'github-repository-bound',id);
    if (sourceFlags().connections && sourceFlags().scanning) enqueueSource(store,id);
    return {id,projectId,queued:sourceFlags().connections && sourceFlags().scanning};
  });
}
