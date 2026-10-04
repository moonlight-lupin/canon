// Backups: create, list, prune, safe file names, folder checks, settings.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-backups-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

let B: typeof import('../server/repo/backups.ts');
let S: typeof import('../server/repo/settings.ts');

before(async () => {
  B = await import('../server/repo/backups.ts');
  S = await import('../server/repo/settings.ts');
});

test('backups: create into the configured folder, list newest first, prune', async () => {
  const dir = path.join(tmp, 'store');
  S.updateSettings({ backup: { dir, auto: 'weekly', keep: 2 } });
  assert.equal(B.backupDir(), path.resolve(dir));
  const a = B.createBackup();
  const b = B.createBackup();
  const c = B.createBackup();
  assert.ok(fs.existsSync(a.path) && fs.statSync(a.path).size > 0);
  assert.notEqual(a.name, b.name, 'same-minute backups get distinct names');
  assert.equal(B.listBackups().length, 3);
  assert.equal(B.prune(2), 1);
  const names = B.listBackups().map((x) => x.name);
  assert.equal(names.length, 2);
  assert.ok(names.includes(c.name));
  assert.ok(B.lastBackupAt(), 'last backup time recorded');
  assert.ok(B.nextDue(), 'weekly schedule has a next due time');
  S.updateSettings({ backup: { dir, auto: 'off', keep: 2 } });
  assert.equal(B.nextDue(), null);
});

test('backups: only real backup files can be downloaded or deleted', () => {
  assert.equal(B.backupPath('../canon.db'), null);
  assert.equal(B.backupPath('canon.db'), null);
  assert.equal(B.backupPath('canon-2026-01-01-0000.db'), null, 'missing file');
  assert.equal(B.deleteBackup('..\\..\\x.db'), false);
  const name = B.listBackups()[0].name;
  assert.ok(B.backupPath(name));
  assert.equal(B.deleteBackup(name), true);
});

test('backups: folder check explains problems in plain language', () => {
  assert.equal(B.checkFolder(''), null, 'empty = default folder');
  assert.match(B.checkFolder('relative/folder') ?? '', /full folder path/);
  assert.equal(B.checkFolder(path.join(tmp, 'new', 'nested')), null, 'missing folders are created');
});

test('restore: a backup replaces the data in place, after saving a copy of the current data', async () => {
  const { run, get } = await import('../server/db.ts');
  const dir = path.join(tmp, 'restore');
  S.updateSettings({ backup: { dir, auto: 'off', keep: 20 } });
  run("INSERT INTO songs (title, stanzas) VALUES ('{\"en\":\"Before Restore Qx\"}', '[]')");
  const b = B.createBackup();
  run("UPDATE songs SET title = '{\"en\":\"Changed After Qx\"}' WHERE json_extract(title, '$.en') = 'Before Restore Qx'");
  S.updateSettings({ church_name: { en: 'Changed Church Qx' } });
  const r = await B.restoreBackup(b.path);
  assert.ok(r.safety && r.safety !== b.name, 'the current data was saved first');
  assert.ok(get("SELECT 1 FROM songs WHERE json_extract(title, '$.en') = 'Before Restore Qx'"), 'data is back as it was');
  assert.notEqual(S.getSettings().church_name.en, 'Changed Church Qx', 'settings are re-read after a restore');
  assert.ok(B.lastRestore()?.from === b.name);
  assert.equal(B.backupDir(), path.resolve(dir), 'this computer’s backup folder is kept');
  assert.equal(B.lastBackupAt(), B.listBackups().find((x) => x.name === r.safety)?.created, 'last backup = the safety copy');
  // the safety copy holds the data from just before the restore
  const back = await B.restoreBackup(path.join(dir, r.safety));
  assert.ok(back.safety);
  assert.ok(get("SELECT 1 FROM songs WHERE json_extract(title, '$.en') = 'Changed After Qx'"), 'undo by restoring the safety copy');
});

test('restore: only real Canon backups are accepted', () => {
  const junk = path.join(tmp, 'junk.db');
  fs.writeFileSync(junk, 'not a database at all');
  assert.match(B.checkBackupFile(junk) ?? '', /not a Canon backup/);
  const other = path.join(tmp, 'other.db');
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
  const d = new DatabaseSync(other);
  d.exec('CREATE TABLE things (id INTEGER)');
  d.close();
  assert.match(B.checkBackupFile(other) ?? '', /not a Canon backup/);
});
