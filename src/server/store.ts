import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Container, Dashboard, Report, Suggestion, Target } from '../lib/model';
import { compareReports } from './trivy';
import { summarize } from '../lib/model';

type TargetRow = Omit<Target, 'summary' | 'suggestions'> & { summary_json: string | null; suggestions_json: string; requested: number };
export class Store {
  readonly db: DatabaseSync;
  constructor(directory: string) {
    if (directory !== ':memory:') mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(directory === ':memory:' ? directory : join(directory, 'kopes.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const version = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version.user_version > 2) throw new Error('Database is newer than this application. Refusing to downgrade.');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS targets (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, image_id TEXT,
        platform TEXT, status TEXT NOT NULL DEFAULT 'queued', requested INTEGER NOT NULL DEFAULT 1,
        scanned_at INTEGER, attempted_at INTEGER, error TEXT, summary_json TEXT,
        suggestions_json TEXT NOT NULL DEFAULT '[]', recommendation_note TEXT,
        report_json TEXT, sbom TEXT
      );
      CREATE TABLE IF NOT EXISTS containers (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, image TEXT NOT NULL,
        target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
        project TEXT NOT NULL, service TEXT NOT NULL, manager TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS scan_activity (
        seq INTEGER PRIMARY KEY, target TEXT NOT NULL, name TEXT NOT NULL, time INTEGER NOT NULL,
        message TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS allowed_users (login TEXT PRIMARY KEY);
      PRAGMA user_version=2;
    `);
  }
  transaction(fn: () => void) {
    this.db.exec('BEGIN IMMEDIATE');
    try { fn(); this.db.exec('COMMIT'); } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  setMeta(key: string, value: string) {
    this.db.prepare('INSERT INTO metadata VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
  }
  getMeta(key: string) { return (this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key) as { value: string } | undefined)?.value; }
  allowedUsers() { return (this.db.prepare('SELECT login FROM allowed_users ORDER BY login').all() as { login: string }[]).map(row => row.login); }
  hasUser(login: string) { return Boolean(this.db.prepare('SELECT 1 FROM allowed_users WHERE login=?').get(login)); }
  addUser(login: string) { this.db.prepare('INSERT OR IGNORE INTO allowed_users (login) VALUES (?)').run(login); }
  removeUser(login: string) {
    this.transaction(() => {
      this.db.prepare('DELETE FROM allowed_users WHERE login=?').run(login);
      this.db.prepare('DELETE FROM session WHERE userId IN (SELECT id FROM user WHERE lower(githubLogin)=?)').run(login);
    });
  }
  recover() { this.db.exec("UPDATE targets SET status='queued', requested=1 WHERE status='scanning'"); }
  syncInventory(containers: Container[]) {
    this.transaction(() => {
      this.db.prepare("INSERT OR IGNORE INTO targets (id, kind, name) VALUES ('host', 'host', 'Host OS')").run();
      const previous = new Set((this.db.prepare('SELECT id FROM containers').all() as { id: string }[]).map(c => c.id));
      this.db.exec('DELETE FROM containers');
      for (const c of containers) {
        this.db.prepare("INSERT INTO targets (id,kind,name,image_id) VALUES (?,'image',?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name")
          .run(c.target_id, c.image, c.target_id.slice(6));
        this.db.prepare('INSERT INTO containers VALUES (?,?,?,?,?,?,?)').run(c.id, c.name, c.image, c.target_id, c.project, c.service, c.manager);
        if (!previous.has(c.id)) this.request(c.target_id);
      }
      this.db.exec("DELETE FROM targets WHERE kind='image' AND status!='scanning' AND id NOT IN (SELECT target_id FROM containers)");
      this.setMeta('inventoryAt', String(Date.now()));
      this.setMeta('inventoryError', '');
    });
  }
  request(id: string) {
    return this.db.prepare("UPDATE targets SET requested=1, status=CASE WHEN status='scanning' THEN status ELSE 'queued' END WHERE id=?").run(id).changes > 0;
  }
  next(intervalMs: number): Target | null {
    const row = this.db.prepare(`SELECT * FROM targets WHERE status!='scanning' AND
      (requested=1 OR (scanned_at IS NULL AND attempted_at IS NULL) OR COALESCE(attempted_at,0) < ?)
      ORDER BY requested DESC, COALESCE(attempted_at,0), id LIMIT 1`).get(Date.now() - intervalMs) as TargetRow | undefined;
    if (!row) return null;
    this.db.prepare("UPDATE targets SET status='scanning', requested=0, attempted_at=?, error=NULL WHERE id=?").run(Date.now(), row.id);
    return this.decode(row);
  }
  decode(row: TargetRow): Target {
    return { id: row.id, kind: row.kind, name: row.name, image_id: row.image_id, platform: row.platform,
      status: row.status, scanned_at: row.scanned_at, attempted_at: row.attempted_at, error: row.error,
      summary: row.summary_json ? JSON.parse(row.summary_json) : null,
      suggestions: JSON.parse(row.suggestions_json), recommendation_note: row.recommendation_note };
  }
  complete(id: string, report: Report, sbom: string, platform: string | null, suggestions: Suggestion[], note: string) {
    this.transaction(() => {
      const previous = this.report(id);
      const change = previous && previous.coverage === report.coverage && compareReports(previous, report);
      const message = change ? `${change.introduced} new · ${change.removed} no longer detected` : `First scan · ${report.findings.length} findings`;
      this.record(id, report.coverage ? `Release-source dependencies · ${message}` : message);
      this.db.prepare(`UPDATE targets SET status=CASE WHEN requested=1 THEN 'queued' ELSE 'ready' END,
        scanned_at=?, error=NULL, report_json=?, summary_json=?, sbom=?, platform=?, suggestions_json=?, recommendation_note=? WHERE id=?`)
        .run(Date.now(), JSON.stringify(report), JSON.stringify(summarize(report)), sbom, platform, JSON.stringify(suggestions), note, id);
    });
  }
  fail(id: string, message: string, status: 'error' | 'unassessed' = 'error') {
    this.transaction(() => {
      this.record(id, status === 'unassessed' ? 'Inspection complete · No identifiable packages' : `Scan failed · ${message}`);
      this.db.prepare("UPDATE targets SET status=CASE WHEN requested=1 THEN 'queued' ELSE ? END, error=? WHERE id=?").run(status, message, id);
    });
  }
  private record(id: string, message: string) {
    this.db.prepare('INSERT INTO scan_activity(target,name,time,message) SELECT id,name,?,? FROM targets WHERE id=?').run(Date.now(), message, id);
    this.db.exec('DELETE FROM scan_activity WHERE seq <= (SELECT max(seq)-200 FROM scan_activity)');
  }
  activity() {
    return this.db.prepare('SELECT * FROM scan_activity ORDER BY seq DESC').all();
  }
  searchFindings(term: string) {
    return this.db.prepare(`SELECT t.id, count(*) AS matches FROM targets t,
      json_each(t.report_json, '$.findings') f
      WHERE instr(lower(f.value ->> '$.id'), lower(?)) OR instr(lower(f.value ->> '$.package'), lower(?))
      GROUP BY t.id`).all(term, term);
  }
  sbom(id: string) { return (this.db.prepare('SELECT sbom FROM targets WHERE id=?').get(id) as { sbom: string | null } | undefined)?.sbom ?? null; }
  report(id: string): Report | null {
    const row = this.db.prepare('SELECT report_json FROM targets WHERE id=?').get(id) as { report_json: string | null } | undefined;
    return row?.report_json ? JSON.parse(row.report_json) : null;
  }
  dashboard(intervalHours: number): Dashboard {
    return { targets: (this.db.prepare('SELECT id, kind, name, image_id, platform, status, scanned_at, attempted_at, error, summary_json, suggestions_json, recommendation_note FROM targets ORDER BY kind DESC, name').all() as TargetRow[]).map(row => this.decode(row)),
      containers: this.db.prepare('SELECT * FROM containers ORDER BY project, name').all() as Container[],
      inventoryAt: Number(this.getMeta('inventoryAt')) || null, inventoryError: this.getMeta('inventoryError') || null, intervalHours };
  }
}
