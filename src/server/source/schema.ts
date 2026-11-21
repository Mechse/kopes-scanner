import type { DatabaseSync } from 'node:sqlite';
export function migrateSource(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS source_connections(id TEXT PRIMARY KEY, provider TEXT NOT NULL, origin TEXT NOT NULL,
      credential TEXT NOT NULL, credential_version INTEGER NOT NULL DEFAULT 1, disconnected INTEGER NOT NULL DEFAULT 0,
      health TEXT NOT NULL DEFAULT 'unvalidated', observed_at INTEGER);
    CREATE TABLE IF NOT EXISTS source_repositories(id TEXT PRIMARY KEY, provider TEXT NOT NULL, origin TEXT NOT NULL,
      provider_id TEXT NOT NULL, name TEXT NOT NULL, UNIQUE(provider,origin,provider_id));
    CREATE TABLE IF NOT EXISTS source_bindings(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      repository_id TEXT NOT NULL REFERENCES source_repositories(id), connection_id TEXT NOT NULL REFERENCES source_connections(id),
      branch TEXT NOT NULL, folder TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, head_sha TEXT, error TEXT,
      polled_at INTEGER, next_poll INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS binding_project ON source_bindings(project_id);
    CREATE TABLE IF NOT EXISTS source_binding_resources(binding_id TEXT NOT NULL REFERENCES source_bindings(id),
      resource_id TEXT NOT NULL REFERENCES resources(id), PRIMARY KEY(binding_id,resource_id));
    CREATE TABLE IF NOT EXISTS source_jobs(id TEXT PRIMARY KEY, binding_id TEXT NOT NULL REFERENCES source_bindings(id),
      kind TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL, available_at INTEGER NOT NULL,
      attempted_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0, error TEXT, commit_sha TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS source_job_pending ON source_jobs(binding_id,kind) WHERE state IN ('queued','running');
    CREATE TABLE IF NOT EXISTS source_snapshots(id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES source_repositories(id),
      commit_sha TEXT NOT NULL, bundle_hash TEXT NOT NULL, inventory_json TEXT NOT NULL, created_at INTEGER NOT NULL,
      UNIQUE(repository_id,commit_sha,bundle_hash));
    CREATE TABLE IF NOT EXISTS source_scans(id TEXT PRIMARY KEY, binding_id TEXT NOT NULL REFERENCES source_bindings(id),
      snapshot_id TEXT NOT NULL REFERENCES source_snapshots(id), job_id TEXT NOT NULL REFERENCES source_jobs(id),
      observed_at INTEGER NOT NULL, analyzer TEXT NOT NULL, database_json TEXT NOT NULL, result_json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS source_scan_binding ON source_scans(binding_id,observed_at);
    CREATE TABLE IF NOT EXISTS source_events(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      binding_id TEXT REFERENCES source_bindings(id), kind TEXT NOT NULL, source_time INTEGER, observed_at INTEGER NOT NULL,
      actor_json TEXT, evidence_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS source_deliveries(connection_id TEXT NOT NULL REFERENCES source_connections(id),
      delivery_id TEXT NOT NULL, received_at INTEGER NOT NULL, PRIMARY KEY(connection_id,delivery_id));
  `);
}

/** Rebuild only the two project-owned tables; dependent foreign keys retain their names. */
export function migrateStandaloneSources(db: DatabaseSync) {
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    for (const table of ['source_bindings', 'source_events']) {
      if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === 'project_id' && c.notnull === 1)) continue;
      const schema = String(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)!.sql);
      const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL").all(table);
      db.exec(schema.replace(`CREATE TABLE ${table}`, `CREATE TABLE ${table}_new`).replace('project_id TEXT NOT NULL', 'project_id TEXT'));
      db.exec(`INSERT INTO ${table}_new SELECT * FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${table}_new RENAME TO ${table}`);
      for (const index of indexes) db.exec(String(index.sql));
    }
    db.exec(`CREATE TABLE IF NOT EXISTS source_discovery(resource_id TEXT NOT NULL REFERENCES resources(id), repository TEXT NOT NULL,
      attempted_at INTEGER NOT NULL DEFAULT 0, error TEXT, PRIMARY KEY(resource_id,repository))`);
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Source migration foreign key check failed.');
    db.exec('PRAGMA user_version=10; COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  finally { db.exec('PRAGMA foreign_keys=ON'); }
}

/** Remove container associations while retaining repository history and access ownership. */
export function migrateIndependentRepositories(db: DatabaseSync) {
  db.exec(`BEGIN IMMEDIATE;
    DROP TABLE IF EXISTS source_binding_resources;
    DROP TABLE IF EXISTS source_discovery;
    UPDATE source_jobs SET state='cancelled' WHERE kind LIKE 'deployed:%' AND state IN ('queued','running');
    PRAGMA user_version=13;
    COMMIT;`);
}

/** v15: retain legacy credential ciphertext and its original associated data. */
export function migrateGithubConnections(db: DatabaseSync) {
  const backfill = !db.prepare('PRAGMA table_info(source_connections)').all().some(c=>c.name==='auth_kind');
  const schema = `
    CREATE TABLE IF NOT EXISTS github_apps(id TEXT PRIMARY KEY, github_id TEXT UNIQUE, client_id TEXT, slug TEXT,
      owner_id TEXT, owner_login TEXT NOT NULL, owner_type TEXT NOT NULL, origin TEXT NOT NULL,
      private_key TEXT NOT NULL DEFAULT '', client_secret TEXT NOT NULL DEFAULT '', webhook_secret TEXT NOT NULL DEFAULT '',
      credential_revision INTEGER NOT NULL DEFAULT 1, history INTEGER NOT NULL DEFAULT 0, webhook_mode TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending-registration', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS github_installations(id TEXT PRIMARY KEY, app_id TEXT NOT NULL REFERENCES github_apps(id),
      github_id TEXT NOT NULL, owner_id TEXT NOT NULL, owner_login TEXT NOT NULL, permissions TEXT NOT NULL,
      selection TEXT NOT NULL, status TEXT NOT NULL, access_revision INTEGER NOT NULL DEFAULT 1,
      reconciled_at INTEGER, next_check INTEGER NOT NULL DEFAULT 0, UNIQUE(app_id,github_id));
    ALTER TABLE source_connections ADD COLUMN auth_kind TEXT NOT NULL DEFAULT 'anonymous';
    ALTER TABLE source_connections ADD COLUMN label TEXT NOT NULL DEFAULT '';
    ALTER TABLE source_connections ADD COLUMN installation_id TEXT REFERENCES github_installations(id);
    ALTER TABLE source_connections ADD COLUMN owner_login TEXT;
    ALTER TABLE source_connections ADD COLUMN expires_at INTEGER;
    ALTER TABLE source_connections ADD COLUMN history INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE source_connections ADD COLUMN validated_at INTEGER;
    ALTER TABLE source_connections ADD COLUMN next_check INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE source_connections ADD COLUMN validation_repository TEXT;
    ALTER TABLE source_bindings ADD COLUMN access_revision INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE source_bindings ADD COLUMN access_status TEXT NOT NULL DEFAULT 'active';

    CREATE TABLE IF NOT EXISTS github_installation_repositories(installation_id TEXT NOT NULL REFERENCES github_installations(id),
      repository_id TEXT NOT NULL, name TEXT NOT NULL, private INTEGER NOT NULL, status TEXT NOT NULL,
      access_revision INTEGER NOT NULL DEFAULT 1, generation TEXT NOT NULL, observed_at INTEGER NOT NULL,
      PRIMARY KEY(installation_id,repository_id));
    CREATE TABLE IF NOT EXISTS github_setup_attempts(state_hash TEXT PRIMARY KEY, app_id TEXT NOT NULL REFERENCES github_apps(id),
      user_id TEXT NOT NULL, session_hash TEXT NOT NULL, purpose TEXT NOT NULL, owner_login TEXT NOT NULL,
      status TEXT NOT NULL, expires_at INTEGER NOT NULL, claimed_at INTEGER, completed_at INTEGER,
      material TEXT NOT NULL DEFAULT '');
    CREATE UNIQUE INDEX IF NOT EXISTS github_setup_active ON github_setup_attempts(app_id) WHERE status='pending';
    CREATE TABLE IF NOT EXISTS github_webhook_deliveries(app_id TEXT NOT NULL REFERENCES github_apps(id), delivery_id TEXT NOT NULL,
      event TEXT NOT NULL, metadata TEXT NOT NULL, received_at INTEGER NOT NULL, processed_at INTEGER,
      state TEXT NOT NULL DEFAULT 'queued', PRIMARY KEY(app_id,delivery_id));
    PRAGMA user_version=15;
  `;
  // Introspection also supports older schema fixtures and interrupted manual recoveries.
  const sql = schema.replace(/ALTER TABLE (source_connections|source_bindings) ADD COLUMN ([a-z_]+) ([^;]+);/g, (statement,table,column) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===column) ? '' : statement);
  db.exec(sql);
  if (backfill) db.exec("UPDATE source_connections SET auth_kind=CASE WHEN credential='' THEN 'anonymous' WHEN provider='github' THEN 'legacy_pat' ELSE 'legacy_token' END");
}

/** v16: repair installations that initialized before v15 gained its PAT polling schedule. */
export function migrateGithubPollingSchedule(db: DatabaseSync) {
  if (!db.prepare('PRAGMA table_info(source_connections)').all().some(column => column.name === 'next_check')) {
    db.exec('ALTER TABLE source_connections ADD COLUMN next_check INTEGER NOT NULL DEFAULT 0');
  }
  db.exec('PRAGMA user_version=16');
}
