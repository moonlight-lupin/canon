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
