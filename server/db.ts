import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { MIGRATIONS, type Migration } from './migrations.ts';
import { openDb, type Db } from './lib/sqlite.ts';
import { createKeys, loadKeys, type Keys } from './lib/keys.ts';

export { MIGRATIONS };

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

/**
 * A new database is encrypted from the start (0.19.0): its keys are made first, so nothing is ever written in plain.
 * Tests keep plain databases unless they ask (CANON_ENCRYPT=1); CANON_ENCRYPT=0 keeps a new one plain.
 */
const encryptNew = () => process.env.CANON_ENCRYPT === '1' || (process.env.CANON_ENCRYPT !== '0' && !process.env.NODE_TEST_CONTEXT);
if (!fs.existsSync(config.dbPath) && encryptNew()) {
  try {
    loadKeys() ?? createKeys();
  } catch (e) {
    console.error('Encryption keys could not be made:', (e as Error).message);
  }
}
// throws KeysLockedError when the keys can't be unlocked on this computer (server/index.ts then asks for the recovery key)
let keys: Keys | null = loadKeys();
let encrypted = false;

const open = () => {
  let d: Db;
  if (keys && fs.existsSync(config.dbPath)) {
    try {
      d = openDb(config.dbPath, { key: keys.db });
      encrypted = true;
    } catch (e) {
      // keys made, but the database not encrypted yet (encrypting was interrupted): it opens as it is, and Settings
      // still says it is not encrypted
      if ((e as { code?: string }).code !== 'SQLITE_NOTADB') throw e;
      d = openDb(config.dbPath);
      encrypted = false;
    }
  } else {
    d = openDb(config.dbPath, { key: keys?.db });
    encrypted = !!keys;
  }
  d.pragma('busy_timeout = 5000');
  return d;
};
/** The database is encrypted on disk. */
export const dbEncrypted = () => encrypted;
/** The database key, when the database is encrypted (for its copies and the archived years). */
export const dbKey = () => (encrypted ? keys!.db : null);
/** After the database was encrypted in place: it is opened with its key from now on. */
export function setEncrypted(k: Keys) {
  keys = k;
  encrypted = true;
}
/** The church's database. `let`: a restore closes it, puts the restored file in its place and opens it again. */
export let db: Db = open();

/** Close the database for good (tests, and Canon stopping). */
export const closeDb = () => db.close();

/** Close the database, run fn on the closed file (e.g. put a restored copy in its place), and open it again. */
export function reopenDb(fn: () => void) {
  db.close();
  try {
    fn();
  } finally {
    db = open();
  }
}
/** The newest schema version this Canon knows. */
export const schemaVersion = () => MIGRATIONS.length;

/** Apply migrations to a database up to `upTo` (default: all). Exported for tests that build older databases. */
export function applyMigrations(d: Db, upTo = MIGRATIONS.length) {
  const current = (d.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  for (let v = current; v < upTo; v++) {
    const m: Migration = typeof MIGRATIONS[v] === 'string' ? { sql: MIGRATIONS[v] as string } : (MIGRATIONS[v] as Migration);
    if (m.noForeignKeys) d.exec('PRAGMA foreign_keys = OFF');
    d.exec('BEGIN');
    try {
      d.exec(m.sql);
      m.run?.(d);
      if (m.noForeignKeys) {
        const broken = d.prepare('PRAGMA foreign_key_check').all();
        if (broken.length) throw new Error(`migration ${v + 1}: foreign key check failed (${JSON.stringify(broken.slice(0, 3))})`);
      }
      d.exec(`PRAGMA user_version = ${v + 1}`);
      d.exec('COMMIT');
    } catch (e) {
      d.exec('ROLLBACK');
      throw e;
    } finally {
      if (m.noForeignKeys) d.exec('PRAGMA foreign_keys = ON');
    }
  }
}

/** Where a copy of the database is kept before it is upgraded (the last three). */
export const preUpgradeDir = () => path.join(path.dirname(config.dbPath), 'pre-upgrade');

/**
 * Bring the database up to this version of Canon. Refuses a database from a newer Canon (old code would damage it)
 * and keeps a copy of the database as it was before upgrading it, so an update can always be undone.
 */
export function migrate() {
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (current > MIGRATIONS.length) {
    throw new Error(
      `This database was made by a newer version of Canon (database version ${current}; this Canon knows up to ${MIGRATIONS.length}). ` +
      'Install the newer Canon again (or restore a backup made with this version). Nothing was changed.',
    );
  }
  // only once the database is known to be ours to open (a refused one is left exactly as it was)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  if (current > 0 && current < MIGRATIONS.length) {
    const dir = preUpgradeDir();
    fs.mkdirSync(dir, { recursive: true });
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
    const file = path.join(dir, `canon-v${current}-before-v${MIGRATIONS.length}-${stamp}.db`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    // keep the newest three copies (by time, not name: v8 sorts after v14)
    const copies = fs.readdirSync(dir).filter((n) => /^canon-v\d+-before-v\d+-[\d-]+\.db$/.test(n))
      .map((n) => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs })).sort((a, b) => a.t - b.t);
    for (const old of copies.slice(0, -3)) fs.rmSync(path.join(dir, old.n), { force: true });
  }
  applyMigrations(db);
}
migrate();

/** Run fn inside a transaction (nested calls join the outer one). */
let txDepth = 0;
export function tx<T>(fn: () => T): T {
  if (txDepth > 0) return fn();
  txDepth++;
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    txDepth--;
  }
}

export type SqlValue = string | number | bigint | null | Uint8Array;

export function all<T>(sql: string, ...params: SqlValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}
export function get<T>(sql: string, ...params: SqlValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}
export function run(sql: string, ...params: SqlValue[]) {
  return db.prepare(sql).run(...params);
}
