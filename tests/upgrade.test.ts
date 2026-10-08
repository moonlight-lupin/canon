// Updating Canon: a database from any older version is brought up to date with its data intact, a copy of it is
// kept first (the newest three), a database from a newer Canon is refused untouched, and an older backup can be
// restored. Fictional data.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, type Db } from '../server/lib/sqlite.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-upgrade-'));
process.env.CANON_DB = path.join(tmp, 'live', 'canon.db');

const { MIGRATIONS, applyMigrations, preUpgradeDir, get, closeDb } = await import('../server/db.ts');
const B = await import('../server/repo/backups.ts');
const S = await import('../server/repo/settings.ts');
const LATEST = MIGRATIONS.length;
const root = path.resolve(import.meta.dirname, '..');

after(() => {
  try {
    closeDb();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const version = (file: string) => {
  const d = openDb(file, { readonly: true });
  try {
    return (d.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  } finally {
    d.close();
  }
};

/** A database as an older Canon left it, with a member, a song and a service in it. */
function oldDatabase(file: string, v: number) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = openDb(file);
  applyMigrations(d, v);
  d.exec(`
    INSERT INTO people (first_name, last_name, phone) VALUES ('Tobias', 'Fernleigh', '9000 0101');
    INSERT INTO songs (title) VALUES ('{"en":"Test Hymn of Old"}');
    INSERT INTO services (date, title) VALUES ('2024-02-04', '{"en":"Test Old Service"}');
  `);
  d.close();
}

/** Start Canon's database layer on a file in a separate process, as the server does when it starts. */
function startOn(file: string) {
  return spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', "await import('./server/db.ts')"], {
    cwd: root, env: { ...process.env, CANON_DB: file }, encoding: 'utf8',
  });
}

test('every older schema upgrades step by step to the same schema as a new database, keeping its data', () => {
  const schema = (d: Db) => d.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
  const fresh = openDb(':memory:');
  applyMigrations(fresh);
  for (let v = 1; v < LATEST; v++) {
    const d = openDb(':memory:');
    applyMigrations(d, v);
    d.exec("INSERT INTO people (first_name) VALUES ('Tobias')");
    applyMigrations(d);
    assert.equal((d.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, LATEST, `from ${v}`);
    assert.deepEqual(schema(d), schema(fresh), `from ${v}`);
    assert.equal(d.prepare('PRAGMA foreign_key_check').all().length, 0, `from ${v}`);
    assert.equal((d.prepare('SELECT first_name FROM people').get() as { first_name: string }).first_name, 'Tobias', `from ${v}`);
    d.close();
  }
  fresh.close();
});

test('starting a newer Canon on an older database keeps a copy of it first, then upgrades it', () => {
  const file = path.join(tmp, 'old', 'canon.db');
  oldDatabase(file, 8);
  const r = startOn(file);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(version(file), LATEST);
  const d = openDb(file, { readonly: true });
  assert.equal((d.prepare('SELECT phone FROM people').get() as { phone: string }).phone, '9000 0101');
  assert.equal((d.prepare('SELECT title FROM services').get() as { title: string }).title, '{"en":"Test Old Service"}');
  d.close();

  const copies = fs.readdirSync(path.join(tmp, 'old', 'pre-upgrade'));
  assert.equal(copies.length, 1);
  assert.match(copies[0], new RegExp(`^canon-v8-before-v${LATEST}-\\d{8}-\\d{6}\\.db$`));
  assert.equal(version(path.join(tmp, 'old', 'pre-upgrade', copies[0])), 8, 'the copy is the database as it was');

  // already up to date: no further copy
  assert.equal(startOn(file).status, 0);
  assert.equal(fs.readdirSync(path.join(tmp, 'old', 'pre-upgrade')).length, 1);
});

test('only the newest three pre-upgrade copies are kept', () => {
  const dir = path.join(tmp, 'many', 'pre-upgrade');
  fs.mkdirSync(dir, { recursive: true });
  // older copies, named so that sorting by name would keep the wrong ones
  ['canon-v9-before-v12-20250101-000000.db', 'canon-v14-before-v16-20250601-000000.db', 'canon-v16-before-v18-20260101-000000.db'].forEach((n, i) => {
    fs.writeFileSync(path.join(dir, n), '');
    const t = new Date(Date.UTC(2025, i * 4, 1));
    fs.utimesSync(path.join(dir, n), t, t);
  });
  const file = path.join(tmp, 'many', 'canon.db');
  oldDatabase(file, 18);
  assert.equal(startOn(file).status, 0);
  const left = fs.readdirSync(dir).sort();
  assert.equal(left.length, 3);
  assert.ok(!left.includes('canon-v9-before-v12-20250101-000000.db'), 'the oldest copy went');
  assert.ok(left.some((n) => n.startsWith(`canon-v18-before-v${LATEST}-`)), 'the new copy stays');
});

test('a database from a newer Canon is refused and left untouched', () => {
  const file = path.join(tmp, 'newer', 'canon.db');
  oldDatabase(file, LATEST);
  const d = openDb(file);
  d.exec(`PRAGMA user_version = ${LATEST + 3}`);
  d.close();
  const before = fs.readFileSync(file);
  const r = startOn(file);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /made by a newer version of Canon/);
  assert.equal(version(file), LATEST + 3);
  assert.ok(fs.readFileSync(file).equals(before), 'nothing was changed');
  assert.ok(!fs.existsSync(path.join(tmp, 'newer', 'pre-upgrade')));
});

test('an older backup can be restored: it is upgraded, and the data from before is kept as a backup', async () => {
  // the safety copy a restore makes goes to this test's own folder, never the project's backups/
  S.updateSettings({ backup: { dir: path.join(tmp, 'backups'), auto: 'off', keep: 5 } });
  const file = path.join(tmp, 'backup-from-v8.db');
  oldDatabase(file, 8);
  assert.equal(B.checkBackupFile(file), null);
  const r = await B.restoreBackup(file);
  assert.equal(r.restored_schema, 8);
  assert.equal(get<{ user_version: number }>('PRAGMA user_version')!.user_version, LATEST);
  assert.equal(get<{ last_name: string }>("SELECT last_name FROM people WHERE first_name = 'Tobias'")!.last_name, 'Fernleigh');
  assert.ok(fs.existsSync(path.join(tmp, 'backups', r.safety)), 'the data before the restore was saved');
  assert.ok(fs.readdirSync(preUpgradeDir()).some((n) => n.startsWith('canon-v8-before-')), 'the restored backup was copied before upgrading');

  const newer = path.join(tmp, 'backup-from-newer.db');
  oldDatabase(newer, LATEST);
  const d = openDb(newer);
  d.exec(`PRAGMA user_version = ${LATEST + 1}`);
  d.close();
  assert.match(B.checkBackupFile(newer) ?? '', /newer version of Canon/);
});
