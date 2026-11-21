import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Container } from '../lib/model';
import { defaultSettings, resourceKey, type ScanSettings } from '../lib/settings';

/** Additive schema; caller owns the migration transaction. No foreign key to transient targets. */
export function migrateProjects(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
      settings_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS project_members (project_id TEXT NOT NULL REFERENCES projects(id), user_id TEXT NOT NULL,
      PRIMARY KEY(project_id,user_id));
    CREATE TABLE IF NOT EXISTS resources (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), name TEXT NOT NULL,
      environment TEXT, settings_json TEXT NOT NULL, inherited_json TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS resource_aliases (alias TEXT PRIMARY KEY, resource_id TEXT NOT NULL REFERENCES resources(id));
    CREATE TABLE IF NOT EXISTS resource_identity_conflicts(alias TEXT NOT NULL, resource_id TEXT NOT NULL REFERENCES resources(id), candidate_id TEXT NOT NULL REFERENCES resources(id), observed_at INTEGER NOT NULL, PRIMARY KEY(alias,resource_id,candidate_id));
    CREATE TABLE IF NOT EXISTS legacy_resource_keys (legacy_key TEXT NOT NULL, resource_id TEXT NOT NULL REFERENCES resources(id),
      PRIMARY KEY(legacy_key,resource_id));
    CREATE TABLE IF NOT EXISTS runtime_instances (container_id TEXT PRIMARY KEY, resource_id TEXT NOT NULL REFERENCES resources(id),
      target_id TEXT NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, active INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS resource_project ON resources(project_id);
    CREATE INDEX IF NOT EXISTS membership_user ON project_members(user_id,project_id);
    CREATE TABLE IF NOT EXISTS scan_observations (id TEXT PRIMARY KEY, target_id TEXT NOT NULL, scanned_at INTEGER NOT NULL,
      report_json TEXT NOT NULL, sbom TEXT, platform TEXT, imported INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS scan_observation_resources (observation_id TEXT NOT NULL REFERENCES scan_observations(id),
      resource_id TEXT NOT NULL REFERENCES resources(id), PRIMARY KEY(observation_id,resource_id));
    CREATE INDEX IF NOT EXISTS observation_target ON scan_observations(target_id,scanned_at);
    CREATE TABLE IF NOT EXISTS project_events (seq INTEGER PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      actor_id TEXT NOT NULL, action TEXT NOT NULL, detail_json TEXT NOT NULL, observed_at INTEGER NOT NULL);
  `);
  syncResources(db, db.prepare('SELECT * FROM containers').all() as Container[]);
  for (const row of db.prepare('SELECT * FROM targets WHERE report_json IS NOT NULL AND scanned_at IS NOT NULL').all()) {
    db.prepare('INSERT OR IGNORE INTO scan_observations VALUES (?,?,?,?,?,?,1)')
      .run(`import:${row.id}:${row.scanned_at}`, row.id, row.scanned_at, row.report_json, row.sbom, row.platform);
    linkScanResources(db, `import:${row.id}:${row.scanned_at}`, String(row.id));
  }
}

/** Only supplied stable discovery identities can join replacements. Names are never identity. */
export function syncResources(db: DatabaseSync, containers: Container[]) {
  const now = Date.now();
  db.prepare('UPDATE runtime_instances SET active=0').run();
  for (const c of containers) {
    const containerAlias = JSON.stringify(['local', 'container', c.id]);
    const canonical = c.discoveryKey ?? containerAlias;
    const candidate = db.prepare('SELECT resource_id FROM resource_aliases WHERE alias=?').get(canonical);
    const instance = db.prepare('SELECT resource_id FROM runtime_instances WHERE container_id=?').get(c.id);
    const ambiguous = Boolean(candidate && instance && candidate.resource_id !== instance.resource_id || db.prepare('SELECT 1 FROM resource_identity_conflicts WHERE alias=?').get(canonical));
    const alias = ambiguous ? containerAlias : canonical;
    const existing = db.prepare('SELECT resource_id FROM resource_aliases WHERE alias=?').get(alias);
    let id = existing ? String(existing.resource_id) : instance ? String(instance.resource_id) : undefined;
    if (id && !existing) db.prepare('INSERT INTO resource_aliases VALUES (?,?)').run(alias, id);
    if (!id) {
      id = randomUUID();
      const read = (scope: string, key: string) => {
        const row = db.prepare('SELECT settings_json FROM scan_settings WHERE scope=? AND key=?').get(scope, key);
        return row ? JSON.parse(String(row.settings_json)) : {};
      };
      const inherited = { ...defaultSettings, ...read('project', c.project) };
      const effective = { ...inherited, ...read('resource', resourceKey(c)) };
      const display = db.prepare("SELECT name FROM display_names WHERE scope='resource' AND key=?").get(resourceKey(c));
      db.prepare('INSERT INTO resources(id,project_id,name,environment,settings_json,inherited_json,created_at) VALUES (?,NULL,?,?,?,?,?)')
        .run(id, display?.name ?? c.name, c.environment ?? null, JSON.stringify(effective), JSON.stringify(inherited), now);
      db.prepare('INSERT INTO resource_aliases VALUES (?,?)').run(alias, id);
    }
    if (ambiguous && candidate && candidate.resource_id !== id) db.prepare('INSERT OR IGNORE INTO resource_identity_conflicts VALUES (?,?,?,?)').run(canonical, id, candidate.resource_id, now);
    db.prepare('INSERT OR IGNORE INTO legacy_resource_keys VALUES (?,?)').run(resourceKey(c), id);
    db.prepare(`INSERT INTO runtime_instances VALUES (?,?,?,?,?,1) ON CONFLICT(container_id) DO UPDATE SET
      resource_id=excluded.resource_id,target_id=excluded.target_id,last_seen=excluded.last_seen,active=1`)
      .run(c.id, id, c.target_id, now, now);
  }
}

export function linkScanResources(db: DatabaseSync, observationId: string, targetId: string) {
  db.prepare(`INSERT OR IGNORE INTO scan_observation_resources SELECT ?,resource_id FROM runtime_instances
    WHERE target_id=? AND active=1`).run(observationId, targetId);
}

export type ProjectPrincipal = { userId: string; administrator: boolean };
export class ProjectStore {
  constructor(private db: DatabaseSync, private principal: ProjectPrincipal) {}
  private admin() { if (!this.principal.administrator) throw new Error('Administrator access required.'); }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  canRead(id: string) {
    return Boolean(this.db.prepare(`SELECT 1 FROM projects p WHERE p.id=? AND
      (?=1 OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=?))`)
      .get(id, Number(this.principal.administrator), this.principal.userId));
  }
  private requireProject(id: string) { if (!this.canRead(id)) throw new Error('Container not found.'); }
  list() {
    // Filter at the query boundary, before counts or future source enrichment.
    return this.db.prepare(`SELECT id,name,archived,created_at FROM projects p WHERE ?=1 OR EXISTS
      (SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=?) ORDER BY name,id`)
      .all(Number(this.principal.administrator), this.principal.userId);
  }
  private event(id: string, action: string, detail: unknown) {
    this.db.prepare('INSERT INTO project_events(project_id,actor_id,action,detail_json,observed_at) VALUES (?,?,?,?,?)')
      .run(id, this.principal.userId, action, JSON.stringify(detail), Date.now());
  }
  create(name: string) {
    this.admin();
    if (!name.trim() || name.trim().length > 120) throw new Error('Invalid container name.');
    const id = randomUUID();
    this.transaction(() => {
      this.db.prepare('INSERT INTO projects(id,name,created_at) VALUES (?,?,?)').run(id, name.trim(), Date.now());
      this.event(id, 'created', { name: name.trim() });
    });
    return id;
  }
  discoveredGroups(id: string) {
    this.requireProject(id);
    return this.db.prepare(`SELECT c.project FROM containers c JOIN runtime_instances i ON i.container_id=c.id JOIN resources r ON r.id=i.resource_id GROUP BY c.project HAVING count(*)=sum(CASE WHEN r.project_id=? THEN 1 ELSE 0 END)`).all(id).map(r => String(r.project));
  }
  adopt(group: string) {
    this.admin();
    return this.transaction(() => {
      const resources = this.db.prepare(`SELECT DISTINCT r.id,r.project_id FROM resources r JOIN runtime_instances i ON i.resource_id=r.id JOIN containers c ON c.id=i.container_id WHERE c.project=?`).all(group);
      if (!resources.length) throw new Error('Discovery group no longer exists.');
      const assigned = new Set(resources.map(r => r.project_id).filter(Boolean));
      if (assigned.size > 1 || assigned.size && resources.some(r => r.project_id === null)) throw new Error('Resources already have separate assignments. Use resource assignment controls.');
      if (assigned.size === 1) return String([...assigned][0]);
      const id = randomUUID();
      const label = this.db.prepare("SELECT name FROM display_names WHERE scope='project' AND key=?").get(group)?.name ?? group;
      this.db.prepare('INSERT INTO projects(id,name,created_at) VALUES (?,?,?)').run(id, String(label).slice(0,120), Date.now());
      for (const r of resources) this.db.prepare('UPDATE resources SET project_id=? WHERE id=?').run(id, r.id);
      this.event(id, 'discovery-group-adopted', { group, resources: resources.map(r => r.id) });
      return id;
    });
  }
  update(id: string, name: string, archived: boolean) {
    this.admin(); this.requireProject(id);
    if (!name.trim() || name.trim().length > 120) throw new Error('Invalid container name.');
    this.transaction(() => {
      this.db.prepare('UPDATE projects SET name=?,archived=? WHERE id=?').run(name.trim(), Number(archived), id);
      if (archived) this.db.prepare("UPDATE source_jobs SET state='cancelled' WHERE binding_id IN (SELECT id FROM source_bindings WHERE project_id=?) AND state IN ('queued','running')").run(id);
      this.event(id, 'updated', { name: name.trim(), archived });
    });
  }
  grant(id: string, userId: string, enabled: boolean) {
    this.admin(); this.requireProject(id);
    // Membership refers to the immutable authenticated user ID, never a supplied email/name.
    if (!this.db.prepare('SELECT 1 FROM user WHERE id=?').get(userId)) throw new Error('Unknown user.');
    this.transaction(() => {
      if (enabled) this.db.prepare('INSERT OR IGNORE INTO project_members VALUES (?,?)').run(id, userId);
      else this.db.prepare('DELETE FROM project_members WHERE project_id=? AND user_id=?').run(id, userId);
      this.event(id, enabled ? 'member-granted' : 'member-revoked', { userId });
    });
  }
  detail(id: string) {
    this.requireProject(id);
    return { project: this.db.prepare('SELECT id,name,archived,settings_json FROM projects WHERE id=?').get(id),
      resources: this.db.prepare('SELECT id,name,environment,EXISTS(SELECT 1 FROM resource_identity_conflicts c WHERE c.resource_id=resources.id OR c.candidate_id=resources.id) AS identity_warning FROM resources WHERE project_id=?').all(id) };
  }
  setProjectSettings(id: string, settings: ScanSettings) {
    this.admin(); this.requireProject(id);
    this.transaction(() => {
      this.db.prepare('UPDATE projects SET settings_json=? WHERE id=?').run(JSON.stringify(settings), id);
      this.db.prepare("UPDATE resources SET settings_json=? WHERE project_id=? AND settings_mode='inherit'").run(JSON.stringify(settings), id);
      this.event(id, 'scan-defaults-updated', settings);
    });
  }
  resetResourceSettings(id: string, resourceId: string) {
    this.admin(); this.resource(id, resourceId);
    this.transaction(() => {
      const defaults = { ...defaultSettings, ...JSON.parse(String(this.db.prepare('SELECT settings_json FROM projects WHERE id=?').get(id)!.settings_json)) };
      this.db.prepare("UPDATE resources SET settings_json=?,settings_mode='inherit' WHERE id=?").run(JSON.stringify(defaults), resourceId);
      this.event(id, 'scan-settings-inherited', { resourceId });
    });
  }
  members(id: string) {
    this.admin(); this.requireProject(id);
    return this.db.prepare(`SELECT u.id,u.name,u.email,EXISTS(SELECT 1 FROM project_members m WHERE m.user_id=u.id AND m.project_id=?) AS member FROM user u ORDER BY u.name,u.id`).all(id);
  }
  resource(id: string, resourceId: string) {
    this.requireProject(id);
    const resource = this.db.prepare('SELECT * FROM resources WHERE id=? AND project_id=?').get(resourceId, id);
    if (!resource) throw new Error('Resource not found.');
    return resource;
  }
  editResource(id: string, resourceId: string, name: string, environment: string) {
    this.admin(); this.resource(id, resourceId);
    this.transaction(() => {
      this.db.prepare('UPDATE resources SET name=?,environment=? WHERE id=?').run(name, environment || null, resourceId);
      this.db.prepare("INSERT INTO display_names(scope,key,name) VALUES ('stable-resource',?,?) ON CONFLICT(scope,key) DO UPDATE SET name=excluded.name").run(resourceId,name);
      this.event(id, 'resource-updated', { resourceId, name, environment });
    });
  }
  observations(id: string, resourceId: string) {
    this.resource(id, resourceId);
    return this.db.prepare(`SELECT s.id,s.target_id,s.scanned_at,s.imported,
      EXISTS(SELECT 1 FROM runtime_instances i WHERE i.resource_id=? AND i.active=1 AND i.target_id=s.target_id) AS current_image
      FROM scan_observations s JOIN scan_observation_resources r ON r.observation_id=s.id WHERE r.resource_id=? ORDER BY s.scanned_at DESC LIMIT 100`).all(resourceId, resourceId);
  }
  observation(id: string, resourceId: string, observationId: string) {
    this.resource(id, resourceId);
    return this.db.prepare(`SELECT s.* FROM scan_observations s JOIN scan_observation_resources r ON r.observation_id=s.id
      WHERE r.resource_id=? AND s.id=?`).get(resourceId, observationId);
  }
  requestScan(id: string, resourceId: string) {
    this.resource(id, resourceId);
    const result = this.db.prepare(`UPDATE targets SET requested=1,status=CASE WHEN status='scanning' THEN status ELSE 'queued' END
      WHERE id IN (SELECT target_id FROM runtime_instances WHERE resource_id=? AND active=1)
      AND (attempted_at IS NULL OR attempted_at<?)`).run(resourceId, Date.now()-60_000);
    return result.changes;
  }
  unassigned() {
    this.admin();
    return this.db.prepare(`SELECT r.*, EXISTS(SELECT 1 FROM resource_identity_conflicts c WHERE c.resource_id=r.id OR c.candidate_id=r.id) AS identity_warning, (SELECT group_concat(legacy_key) FROM legacy_resource_keys k WHERE k.resource_id=r.id) AS legacy_keys
      FROM resources r WHERE project_id IS NULL AND EXISTS (SELECT 1 FROM runtime_instances i JOIN selected_containers s ON s.id=i.container_id WHERE i.resource_id=r.id) ORDER BY r.name,r.id`).all().map(r => ({ ...r, id: String(r.id), legacyGroups: this.db.prepare('SELECT legacy_key FROM legacy_resource_keys WHERE resource_id=?').all(r.id).map(k => { try { return String(JSON.parse(String(k.legacy_key))[0]); } catch { return 'Unknown discovery group'; } }) }));
  }
  previewMove(resourceId: string, projectId: string) {
    this.admin(); this.requireProject(projectId);
    const resource = this.db.prepare('SELECT * FROM resources WHERE id=?').get(resourceId);
    if (!resource) throw new Error('Resource not found.');
    const project = this.db.prepare('SELECT settings_json,archived FROM projects WHERE id=?').get(projectId)!;
    if (project.archived) throw new Error('Cannot assign to an archived container.');
    const inherited = { ...defaultSettings, ...JSON.parse(String(project.settings_json)) } as ScanSettings;
    const preview = { resourceId, from: resource.project_id, to: projectId, preserved: JSON.parse(String(resource.settings_json)) as ScanSettings, reset: inherited };
    return { ...preview, revision: createHash('sha256').update(JSON.stringify(preview)).digest('hex') };
  }
  move(resourceId: string, projectId: string, reset = false, revision?: string) {
    this.admin();
    this.transaction(() => {
      const preview = this.previewMove(resourceId, projectId);
      if (revision !== undefined && revision !== preview.revision) throw new Error('Assignment changed. Review a new preview.');
      this.db.prepare('UPDATE resources SET project_id=?,settings_json=? WHERE id=?')
        .run(projectId, JSON.stringify(reset ? preview.reset : preview.preserved), resourceId);
      this.db.prepare('UPDATE resources SET settings_mode=? WHERE id=?').run(reset ? 'inherit' : 'pinned', resourceId);
      this.event(projectId, 'resource-assigned', { ...preview, reset });
      if (preview.from && preview.from !== projectId) this.event(String(preview.from), 'resource-moved', { resourceId, to: projectId });
    });
  }
}
