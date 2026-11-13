import { DatabaseSync, backup } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Store } from '../src/server/store';

// Source is opened read-only; all migrations run on disposable online backups.
const source = new DatabaseSync(resolve(process.argv[2] ?? 'data/kopes.sqlite'), { readOnly: true });
const directory = await mkdtemp(join(tmpdir(), 'kopes-rehearsal-'));
let migrated: Store | undefined;
try {
  const originalVersion = source.prepare('PRAGMA user_version').get()!.user_version;
  await backup(source, join(directory, 'backup.sqlite'));
  const copy = new DatabaseSync(join(directory, 'backup.sqlite'), { readOnly: true });
  await backup(copy, join(directory, 'kopes.sqlite')); copy.close();
  const digest = (db: DatabaseSync, table: string) => createHash('sha256').update(JSON.stringify(db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all())).digest('hex');
  const tables = ['targets', 'containers', 'scan_settings', 'display_names', 'pulse_events', 'pulse_states', 'issue_events', 'scan_activity', 'allowed_users'];
  const existing = tables.filter(t => source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t));
  const before = Object.fromEntries(existing.map(t => [t, digest(source, t)]));
  migrated = new Store(directory);
  const preserved = existing.filter(t => digest(migrated!.db, t) === before[t]);
  assert.deepEqual(preserved, existing);
  const targetVersion = migrated.db.prepare('PRAGMA user_version').get()!.user_version;
  migrated.db.close(); migrated = undefined;
  // Restore backup into a second temporary database and verify original content/schema.
  const restore = new DatabaseSync(join(directory, 'backup.sqlite'), { readOnly: true });
  assert.equal(restore.prepare('PRAGMA user_version').get()!.user_version, originalVersion);
  for (const t of existing) assert.equal(digest(restore, t), before[t]);
  restore.close();
  assert.equal(source.prepare('PRAGMA user_version').get()!.user_version, originalVersion);
  console.log(JSON.stringify({ sourceOpenedReadOnly: true, originalVersion, targetVersion, preservedTables: preserved, restoreVerified: true, sourceSchemaUnchanged: true }, null, 2));
} finally { migrated?.db.close(); source.close(); await rm(directory, { recursive: true, force: true }); }
