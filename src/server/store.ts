import { groupPulse, pulseChanges, type PulseEvent, type PulseState } from '../lib/pulse';
import { defaultSettings, resourceKey, type ScanSettings, type SettingsData } from '../lib/settings';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Container, Dashboard, Report, Suggestion, Target } from '../lib/model';
import { compareReports } from './trivy';
import type { AccessData, AccessPerson } from '../lib/user-access';
import { summarize } from '../lib/model';

type TargetRow = Omit<Target, 'summary' | 'suggestions'> & { summary_json: string | null; suggestions_json: string; requested: number };
export class Store {
  readonly db: DatabaseSync;
  constructor(directory: string) {
    if (directory !== ':memory:') mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(directory === ':memory:' ? directory : join(directory, 'kopes.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const version = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version.user_version > 5) throw new Error('Database is newer than this application. Refusing to downgrade.');
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
      CREATE TABLE IF NOT EXISTS scan_settings (
        scope TEXT NOT NULL, key TEXT NOT NULL, settings_json TEXT NOT NULL, PRIMARY KEY(scope,key)
      );
      CREATE TABLE IF NOT EXISTS display_names (
        scope TEXT NOT NULL, key TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY(scope,key)
      );
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS allowed_users (login TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS access_profiles (
        github_id TEXT PRIMARY KEY, login TEXT NOT NULL UNIQUE, name TEXT, email TEXT, image TEXT, last_sign_in INTEGER
      );
      CREATE TABLE IF NOT EXISTS access_history (
        seq INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, identifier TEXT NOT NULL, time INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pulse_events (
        seq INTEGER PRIMARY KEY, target TEXT NOT NULL, name TEXT NOT NULL, time INTEGER NOT NULL, payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pulse_states (
        user TEXT NOT NULL, issue TEXT NOT NULL, seen INTEGER NOT NULL DEFAULT 0,
        dismissed INTEGER NOT NULL DEFAULT 0, bookmarked INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user,issue)
      );
      CREATE TABLE IF NOT EXISTS issue_events (
        seq INTEGER PRIMARY KEY, app TEXT NOT NULL, name TEXT NOT NULL, issue TEXT NOT NULL,
        package TEXT NOT NULL, ecosystem TEXT NOT NULL, kind TEXT NOT NULL, time INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS first_discovery ON issue_events(app, issue, package, ecosystem)
        WHERE kind='discovered';
    `);
    if (version.user_version < 3) this.transaction(() => {
      const rows = this.db.prepare('SELECT id, scanned_at, report_json FROM targets WHERE report_json IS NOT NULL AND scanned_at IS NOT NULL').all();
      for (const row of rows) this.recordDiscoveries(String(row.id), JSON.parse(String(row.report_json)), Number(row.scanned_at));
      this.db.exec('PRAGMA user_version=3');
    });
    if (version.user_version < 4) this.transaction(() => {
      const columns = this.db.prepare('PRAGMA table_info(allowed_users)').all();
      if (!columns.some(column => column.name === 'github_id')) this.db.exec('ALTER TABLE allowed_users ADD COLUMN github_id TEXT');
      this.db.exec('PRAGMA user_version=4');
    });
    if (version.user_version < 5) this.db.exec('PRAGMA user_version=5');
    if (!this.getMeta('pulseInitialized')) this.transaction(() => {
      for (const row of this.db.prepare('SELECT id, scanned_at, report_json FROM targets WHERE report_json IS NOT NULL').all()) {
        this.recordPulse(String(row.id), null, JSON.parse(String(row.report_json)), Number(row.scanned_at));
      }
      this.setMeta('pulseInitialized', 'true');
    });
  }
  private recordPulse(id: string, previous: Report | null, report: Report, time: number) {
    for (const resource of this.resources(id)) {
      const settings = this.settings('resource', resource.key)!.effective;
      for (const change of pulseChanges(previous, report)) {
        if (change.kind === 'discovered' && !settings.notifyNewCve) continue;
        if (change.kind === 'fix' && !settings.notifyFix) continue;
        this.insertPulse(id, { ...change, project: resource.project, resource: resource.key, resourceName: resource.name }, time);
      }
    }
  }
  private insertPulse(id: string, change: import('../lib/pulse').PulseChange, time = Date.now()) {
    if (change.resource === undefined) {
      for (const resource of this.resources(id)) this.insertPulse(id, { ...change, project: resource.project, resource: resource.key, resourceName: resource.name }, time);
      return;
    }
    this.db.prepare('INSERT INTO pulse_events(target,name,time,payload) SELECT id,name,?,? FROM targets WHERE id=?')
      .run(time, JSON.stringify(change), id);
  }
  pulseFeed(user: string) {
    const events = this.db.prepare('SELECT * FROM pulse_events ORDER BY seq DESC').all().map(row => ({
      seq: Number(row.seq), target: String(row.target), name: String(row.name), time: Number(row.time), ...JSON.parse(String(row.payload)),
    })) as PulseEvent[];
    const states = Object.fromEntries(this.db.prepare('SELECT * FROM pulse_states WHERE user=?').all(user).map(row =>
      [String(row.issue), { dismissed: Number(row.dismissed), bookmarked: !!row.bookmarked }])) as Record<string, PulseState>;
    const names = this.displayNames('resource');
    return groupPulse(events.map(event => ({ ...event, resourceName: Object.hasOwn(names, event.resource ?? event.target) ? names[event.resource ?? event.target] : event.resourceName })), states);
  }
  setPulseState(user: string, issue: string, seq: number, action: 'dismiss' | 'restore' | 'bookmark' | 'unbookmark') {
    const event = this.pulseFeed(user).find(item => item.id === issue && item.seq === seq);
    if (!event) return false;
    this.db.prepare('INSERT OR IGNORE INTO pulse_states(user,issue) VALUES (?,?)').run(user, issue);
    const column = action === 'dismiss' || action === 'restore' ? 'dismissed' : 'bookmarked';
    const value = action === 'dismiss' ? seq : action === 'bookmark' ? 1 : 0;
    this.db.prepare(`UPDATE pulse_states SET ${column}=? WHERE user=? AND issue=?`).run(value, user, issue);
    return true;
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
  hasUser(login: string, githubId?: string) {
    return Boolean(this.db.prepare('SELECT 1 FROM allowed_users WHERE (login=? AND (github_id IS NULL OR github_id=?)) OR (github_id IS NOT NULL AND github_id=?)').get(login, githubId ?? '', githubId ?? ''));
  }
  private accessEvent(actor: string, action: string, identifier: string) {
    this.db.prepare('INSERT INTO access_history(actor,action,identifier,time) VALUES (?,?,?,?)').run(actor, action, identifier, Date.now());
  }
  addUser(identifier: string, actor = 'Administrator') {
    let added = false;
    this.transaction(() => {
      const profile = this.db.prepare('SELECT github_id FROM access_profiles WHERE login=? OR lower(email)=?').get(identifier, identifier);
      if (profile && this.db.prepare('SELECT 1 FROM allowed_users WHERE github_id=?').get(profile.github_id)) return;
      added = this.db.prepare('INSERT OR IGNORE INTO allowed_users(login) VALUES (?)').run(identifier).changes > 0;
      if (added) this.accessEvent(actor, 'granted', identifier);
    });
    return added;
  }
  removeUser(identifier: string, actor = 'Administrator') {
    this.transaction(() => {
      const grant = this.db.prepare('SELECT github_id FROM allowed_users WHERE login=?').get(identifier);
      if (!grant) return;
      const profile = grant.github_id
        ? this.db.prepare('SELECT login, github_id FROM access_profiles WHERE github_id=?').get(grant.github_id)
        : this.db.prepare('SELECT login, github_id FROM access_profiles WHERE login=?').get(identifier);
      // Remove all known grants for this account so another entry cannot silently retain access.
      const login = String(profile?.login ?? identifier);
      const grants = this.db.prepare('SELECT login FROM allowed_users WHERE login=? OR login=? OR (github_id IS NOT NULL AND github_id=?)').all(identifier, login, profile?.github_id ?? grant.github_id);
      for (const row of grants) {
        this.db.prepare('DELETE FROM allowed_users WHERE login=?').run(row.login);
        this.accessEvent(actor, 'revoked', String(row.login));
      }
      if (login !== actor) this.db.prepare('DELETE FROM session WHERE userId IN (SELECT id FROM user WHERE lower(githubLogin)=? OR githubId=? OR accessLogin=? OR accessId=?)').run(login, profile?.github_id ?? grant.github_id, login, profile?.github_id ?? grant.github_id);
    });
  }
  // Legacy column names also hold provider-prefixed IDs for Google and Microsoft.
  matchGithubProfile(profile: { id: string; login: string; name: string | null; email: string | null; image: string | null }, verifiedEmails: string[], admin: string) {
    let allowed = false;
    this.transaction(() => {
      const matches = this.db.prepare('SELECT login, github_id FROM allowed_users').all().filter(row =>
        (row.login === profile.login && (row.github_id === null || row.github_id === profile.id)) || row.github_id === profile.id ||
        (row.github_id === null && verifiedEmails.includes(String(row.login))));
      allowed = profile.login === admin || matches.length > 0;
      if (!allowed) return;
      for (const row of matches) {
        if (row.github_id === null) {
          this.db.prepare('UPDATE allowed_users SET github_id=? WHERE login=?').run(profile.id, row.login);
          if (String(row.login).includes('@')) this.accessEvent(profile.login, 'matched', String(row.login));
        }
      }
      this.db.prepare(`INSERT INTO access_profiles VALUES (?,?,?,?,?,?) ON CONFLICT(github_id) DO UPDATE SET
        login=excluded.login,name=excluded.name,email=excluded.email,image=excluded.image`)
        .run(profile.id, profile.login, profile.name, profile.email, profile.image, null);
    });
    return allowed;
  }
  userAccess(admin: string, adminEmail = ''): AccessData {
    const rows = this.db.prepare(`SELECT a.login AS identifier, p.login, p.name, p.email, p.image, p.last_sign_in AS lastSignIn
      FROM allowed_users a LEFT JOIN access_profiles p ON p.github_id=a.github_id OR (a.github_id IS NULL AND p.login=a.login)
      WHERE a.login<>? ORDER BY a.login`).all(admin);
    const profile = this.db.prepare('SELECT login,name,email,image,last_sign_in AS lastSignIn FROM access_profiles WHERE login=?').get(admin);
    const administrator = { identifier: admin, login: admin, name: null, email: null, image: null, lastSignIn: null, ...profile, role: 'Administrator' } as AccessPerson;
    const emailProfile = adminEmail ? this.db.prepare('SELECT login,name,email,image,last_sign_in AS lastSignIn FROM access_profiles WHERE login=?').get(adminEmail) : undefined;
    return { people: [...(admin ? [administrator] : []), ...(adminEmail && adminEmail !== admin ? [{ identifier: adminEmail, login: adminEmail, name: null, email: adminEmail, image: null, lastSignIn: null, ...emailProfile, role: 'Administrator' as const }] : []), ...rows.filter(row => row.identifier !== adminEmail).map(row => ({ ...row, role: 'Member' } as AccessPerson))],
      history: this.db.prepare('SELECT * FROM access_history ORDER BY seq DESC LIMIT 100').all() as AccessData['history'] };
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
  next(_legacyIntervalMs?: number): Target | null {
    const now = Date.now();
    const rows = this.db.prepare(`SELECT * FROM targets WHERE status!='scanning'
      ORDER BY requested DESC, COALESCE(attempted_at,0), id`).all() as TargetRow[];
    const row = rows.find(row => {
      if (row.requested || (row.scanned_at === null && row.attempted_at === null)) return true;
      const intervals = this.resources(row.id).map(resource => this.settings('resource', resource.key)!.effective.rescanHours).filter(hours => hours > 0);
      return intervals.length > 0 && (row.attempted_at ?? 0) <= now - Math.min(...intervals) * 3_600_000;
    });
    if (!row) return null;
    this.db.prepare("UPDATE targets SET status='scanning', requested=0, attempted_at=?, error=NULL WHERE id=?").run(now, row.id);
    return this.decode(row);
  }
  private resources(target: string) {
    if (target === 'host') return [{ key: 'host', project: null, name: 'Host OS' }];
    return (this.db.prepare('SELECT DISTINCT project,name FROM containers WHERE target_id=?').all(target) as { project: string; name: string }[])
      .map(container => ({ ...container, key: resourceKey(container) }));
  }
  displayNames(scope: 'project' | 'resource'): Record<string, string> {
    return Object.fromEntries(this.db.prepare('SELECT key,name FROM display_names WHERE scope=?').all(scope).map(row => [String(row.key), String(row.name)]));
  }
  private displayName(scope: 'project' | 'resource', key: string) {
    return String(this.db.prepare('SELECT name FROM display_names WHERE scope=? AND key=?').get(scope, key)?.name ?? '');
  }
  settings(scope: 'project' | 'resource', key: string): SettingsData | null {
    let project: string | null = key;
    if (scope === 'project') {
      if (!this.db.prepare('SELECT 1 FROM containers WHERE project=?').get(key)) return null;
    } else if (key === 'host') {
      if (!this.db.prepare("SELECT 1 FROM targets WHERE id='host'").get()) return null;
      project = null;
    } else {
      const container = (this.db.prepare('SELECT project,name FROM containers').all() as { project: string; name: string }[]).find(c => resourceKey(c) === key);
      if (!container) return null;
      project = container.project;
    }
    const read = (scope: string, key: string): Partial<ScanSettings> => {
      const row = this.db.prepare('SELECT settings_json FROM scan_settings WHERE scope=? AND key=?').get(scope, key);
      return row ? JSON.parse(String(row.settings_json)) : {};
    };
    const defaults = { ...defaultSettings, ...(project !== null ? read('project', project) : {}) };
    const overrides = scope === 'resource' ? read(scope, key) : {};
    return { displayName: this.displayName(scope, key), project, defaults, overrides, effective: { ...defaults, ...overrides } };
  }
  saveSettings(scope: 'project' | 'resource', key: string, settings: Partial<ScanSettings> & { displayName?: string }) {
    if (!this.settings(scope, key)) return null;
    const { displayName, ...scanSettings } = settings;
    this.transaction(() => {
      this.db.prepare(`INSERT INTO scan_settings VALUES (?,?,?) ON CONFLICT(scope,key) DO UPDATE SET settings_json=excluded.settings_json`)
        .run(scope, key, JSON.stringify(scanSettings));
      if (displayName !== undefined) {
        const name = displayName.trim();
        if (name) this.db.prepare('INSERT INTO display_names VALUES (?,?,?) ON CONFLICT(scope,key) DO UPDATE SET name=excluded.name').run(scope, key, name);
        else this.db.prepare('DELETE FROM display_names WHERE scope=? AND key=?').run(scope, key);
      }
    });
    return this.settings(scope, key);
  }
  decode(row: TargetRow): Target {
    return { ...(row.kind === 'host' && { displayName: this.displayName('resource', 'host') }), id: row.id, kind: row.kind, name: row.name, image_id: row.image_id, platform: row.platform,
      status: row.status, scanned_at: row.scanned_at, attempted_at: row.attempted_at, error: row.error,
      summary: row.summary_json ? JSON.parse(row.summary_json) : null,
      suggestions: JSON.parse(row.suggestions_json), recommendation_note: row.recommendation_note };
  }
  complete(id: string, report: Report, sbom: string, platform: string | null, suggestions: Suggestion[], note: string) {
    this.transaction(() => {
      const scannedAt = Date.now();
      this.recordDiscoveries(id, report, scannedAt);
      const previous = this.report(id);
      if (previous && previous.coverage !== report.coverage) {
        this.insertPulse(id, { issue: `coverage:${id}`, kind: 'coverage', detail: 'Scan coverage changed. Findings from different coverage cannot be compared.' }, scannedAt);
      }
      if (previous && previous.coverage !== report.coverage) {
        const currentIds = new Set(report.findings.map(f => f.id));
        for (const issue of new Set(previous.findings.map(f => f.id))) if (!currentIds.has(issue)) {
          this.insertPulse(id, { issue, kind: 'coverage', detail: 'Coverage changed; this previously detected advisory is no longer assessed by the same scan coverage.' }, scannedAt);
        }
        this.recordPulse(id, null, report, scannedAt);
      } else this.recordPulse(id, previous, report, scannedAt);
      const failed = this.db.prepare("SELECT payload FROM pulse_events WHERE target=? AND json_extract(payload,'$.issue')=? ORDER BY seq DESC LIMIT 1").get(id, `scan:${id}`);
      if (failed && JSON.parse(String(failed.payload)).kind === 'failure') this.insertPulse(id, { issue: `scan:${id}`, kind: 'recovered', detail: 'Scanning resumed successfully.' }, scannedAt);
      const change = previous && previous.coverage === report.coverage && compareReports(previous, report);
      const summary = summarize(report);
      if (change && previous) {
        const known = new Set(previous.findings.map(finding => finding.id));
        summary.newCves = [...new Set(report.findings.map(finding => finding.id)
          .filter(id => /^CVE-/i.test(id) && !known.has(id)))].sort();
      }
      const message = change ? `${change.introduced} new · ${change.removed} no longer detected` : `First scan · ${report.findings.length} findings`;
      this.record(id, report.coverage ? `Release-source dependencies · ${message}` : message);
      this.db.prepare(`UPDATE targets SET status=CASE WHEN requested=1 THEN 'queued' ELSE 'ready' END,
        scanned_at=?, error=NULL, report_json=?, summary_json=?, sbom=?, platform=?, suggestions_json=?, recommendation_note=? WHERE id=?`)
        .run(scannedAt, JSON.stringify(report), JSON.stringify(summary), sbom, platform, JSON.stringify(suggestions), note, id);
    });
  }
  fail(id: string, message: string, status: 'error' | 'unassessed' = 'error') {
    this.transaction(() => {
      this.insertPulse(id, { issue: `scan:${id}`, kind: 'failure', detail: status === 'unassessed' ? 'No identifiable packages. This target could not be assessed.' : message });
      this.record(id, status === 'unassessed' ? 'Inspection complete · No identifiable packages' : `Scan failed · ${message}`);
      this.db.prepare("UPDATE targets SET status=CASE WHEN requested=1 THEN 'queued' ELSE ? END, error=? WHERE id=?").run(status, message, id);
    });
  }
  private record(id: string, message: string) {
    this.db.prepare('INSERT INTO scan_activity(target,name,time,message) SELECT id,name,?,? FROM targets WHERE id=?').run(Date.now(), message, id);
    this.db.exec('DELETE FROM scan_activity WHERE seq <= (SELECT max(seq)-200 FROM scan_activity)');
  }
  private recordDiscoveries(id: string, report: Report, time: number) {
    const apps = this.db.prepare('SELECT project, name FROM containers WHERE target_id=?').all(id)
      .map(c => ({ key: JSON.stringify([c.project, c.name]), name: c.name }));
    if (id === 'host') apps.push({ key: 'host', name: 'Host OS' });
    const insert = this.db.prepare(`INSERT INTO issue_events(app,name,issue,package,ecosystem,kind,time)
      VALUES (?,?,?,?,?,'discovered',?) ON CONFLICT DO NOTHING`);
    for (const app of apps) {
      for (const finding of report.findings) insert.run(app.key, app.name, finding.id, finding.package, finding.type, time);
    }
  }
  timeline() {
    const names = this.displayNames('resource');
    return this.db.prepare('SELECT * FROM issue_events ORDER BY name, app, time DESC, issue, package, ecosystem').all().map((row): typeof row => ({ ...row, name: Object.hasOwn(names, String(row.app)) ? names[String(row.app)] : row.name }));
  }
  activity() {
    const data = this.dashboard();
    return this.db.prepare('SELECT * FROM scan_activity ORDER BY seq DESC').all().map((row): typeof row => ({ ...row, name: data.containers.filter(c => c.target_id === row.target).map(c => c.displayName || c.name).join(', ') || (row.target === 'host' ? this.displayName('resource', 'host') : '') || row.name }));
  }
  searchFindings(term: string) {
    return this.db.prepare(`SELECT t.id, count(*) AS matches FROM targets t,
      json_each(t.report_json, '$.findings') f
      WHERE instr(lower(f.value ->> '$.id'), lower(?)) OR instr(lower(f.value ->> '$.package'), lower(?))
      GROUP BY t.id`).all(term, term);
  }
  sbom(id: string) { return (this.db.prepare('SELECT sbom FROM targets WHERE id=?').get(id) as { sbom: string | null } | undefined)?.sbom ?? null; }
  report(id: string, scan: number | null = null): Report | null {
    const row = this.db.prepare('SELECT report_json FROM targets WHERE id=? AND (? IS NULL OR scanned_at=?)').get(id, scan, scan) as { report_json: string | null } | undefined;
    return row?.report_json ? JSON.parse(row.report_json) : null;
  }
  dashboard(intervalHours = 168): Dashboard {
    const names = this.displayNames('resource');
    return { projectNames: this.displayNames('project'), targets: (this.db.prepare('SELECT id, kind, name, image_id, platform, status, scanned_at, attempted_at, error, summary_json, suggestions_json, recommendation_note FROM targets ORDER BY kind DESC, name').all() as TargetRow[]).map(row => this.decode(row)),
      containers: (this.db.prepare('SELECT * FROM containers ORDER BY project, name').all() as Container[]).map(c => ({ ...c, displayName: names[resourceKey(c)] ?? '' })),
      inventoryAt: Number(this.getMeta('inventoryAt')) || null, inventoryError: this.getMeta('inventoryError') || null, intervalHours };
  }
}
