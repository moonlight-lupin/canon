// The SQLite driver (0.19.0): better-sqlite3-multiple-ciphers — SQLite with encryption built in (SQLCipher format),
// so the database, its copies and the archived years can be encrypted on disk. Node's own node:sqlite can't encrypt.
// The package carries ready-built binaries for Windows, macOS and Linux (x64 and ARM): nothing is compiled or
// downloaded when Canon is installed.
//
// Everything that opens a database file goes through openDb(), so a key (when the database is encrypted) is always
// given before anything is read. The key is 32 random bytes, used as it is (no password stretching: it isn't a
// password); lib/keys.ts keeps it.
import Database from 'better-sqlite3-multiple-ciphers';

export type Db = Database.Database;

/** SQLCipher 4's format: the same files SQLCipher tools open (with the key), should a church ever need to. */
function useKey(d: Db, key: Buffer, pragma: 'key' | 'rekey') {
  d.pragma("cipher = 'sqlcipher'");
  d.pragma('legacy = 4');
  d.pragma(`${pragma} = "x'${key.toString('hex')}'"`);
}

/** Open a database file, with its key when it is encrypted. A wrong key fails here, not at the first query. */
export function openDb(file: string, opts: { key?: Buffer | null; readonly?: boolean } = {}): Db {
  const d = new Database(file, { readonly: !!opts.readonly, fileMustExist: !!opts.readonly });
  try {
    if (opts.key) useKey(d, opts.key, 'key');
    d.prepare('SELECT count(*) FROM sqlite_master').get();
  } catch (e) {
    d.close();
    throw e;
  }
  return d;
}

/**
 * Change an open database's key: encrypt a plain one (key = the new key), re-key an encrypted one, or decrypt (null).
 * A plain database in WAL mode is switched out of it for the moment (SQLite can't encrypt a WAL database in place).
 */
export function rekeyDb(d: Db, key: Buffer | null) {
  const mode = String(d.pragma('journal_mode', { simple: true }));
  if (mode === 'wal') d.pragma('journal_mode = DELETE');
  try {
    if (key) useKey(d, key, 'rekey');
    else d.pragma("rekey = ''");
  } finally {
    if (mode === 'wal') d.pragma('journal_mode = WAL');
  }
}

/** The KEY clause for ATTACH DATABASE: an encrypted file attached to an encrypted database names its key. */
export const attachKey = (key: Buffer | null | undefined) => (key ? ` KEY "x'${key.toString('hex')}'"` : '');

/** SQLite's own errors (a constraint, a damaged file …), as opposed to Canon's. */
export const isSqliteError = (e: unknown): boolean =>
  e instanceof Database.SqliteError || /^SQLITE_/.test(String((e as { code?: unknown } | null)?.code ?? ''));
