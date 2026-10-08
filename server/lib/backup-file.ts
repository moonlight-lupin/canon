// Backup files of an encrypted Canon (0.19.0, "CANONENC2"): the database (or an archived year) as an SQLCipher file
// encrypted with the BACKUP key — not the database's own key — behind a short header:
//   CANONENC2 | header length (4 bytes, little-endian) | header (JSON) | the encrypted database
// The header says when it was made and carries the backup key locked with the recovery key current then (and that
// recovery key's ID, printed on its sheet). So a backup restores on this computer by itself, and on any other
// computer with the recovery sheet. Nothing in a backup is ever written in plain.
//
// Older backups stay readable: "CANONENC1" (encrypted with a backup password, lib/backup-crypto.ts) and plain .db.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.ts';
import { openDb, rekeyDb } from './sqlite.ts';
import { backupKeyForRecovery, openBackupKey, type Keys } from './keys.ts';

const MAGIC = Buffer.from('CANONENC2');
const PACKAGE = Buffer.from('CANONENC3');
export interface BackupHeader {
  v: 2;
  kind: 'database' | 'archive';
  made_at: string;
  /** the recovery key current when it was made: its ID, and the backup key locked with it */
  recovery: { id: string; sealed: string } | null;
}

const magicOf = (file: string): string => {
  const fd = fs.openSync(file, 'r');
  try {
    const b = Buffer.alloc(9);
    fs.readSync(fd, b, 0, 9, 0);
    return b.toString('latin1');
  } finally {
    fs.closeSync(fd);
  }
};
/** A backup in this format. */
export const isBackupV2 = (file: string) => magicOf(file) === 'CANONENC2';
export const isBackupV2Data = (b: Buffer) => b.subarray(0, 9).equals(MAGIC);
/** A backup package (0.19.3): the database and the archived years in one file. */
export const isPackage = (file: string) => magicOf(file) === 'CANONENC3';
/** Any backup of an encrypted Canon (a single database, or a package). */
export const isEncryptedBackupData = (b: Buffer) => b.subarray(0, 9).equals(MAGIC) || b.subarray(0, 9).equals(PACKAGE);

/**
 * Write `dest` as a backup of the database file `src` (encrypted with `srcKey`, or plain): a copy is re-keyed to the
 * backup key in the data folder (never in the backup folder, which may be a synced folder or a USB drive: the copy of
 * a plain file is plain until it is re-keyed), then wrapped with the header. `src` is left as it is.
 */
export function writeBackupFile(src: string, srcKey: Buffer | null, dest: string, keys: Keys, kind: BackupHeader['kind'] = 'database') {
  const part = scratch(path.dirname(config.dbPath), 'part');
  fs.copyFileSync(src, part);
  try {
    const d = openDb(part, { key: srcKey });
    try {
      rekeyDb(d, keys.backup);
    } finally {
      d.close();
    }
    const header = Buffer.from(JSON.stringify({ v: 2, kind, made_at: new Date().toISOString(), recovery: backupKeyForRecovery() } satisfies BackupHeader));
    const len = Buffer.alloc(4);
    len.writeUInt32LE(header.length);
    const tmp = `${dest}.tmp`;
    fs.writeFileSync(tmp, Buffer.concat([MAGIC, len, header, fs.readFileSync(part)]));
    fs.renameSync(tmp, dest);
  } finally {
    fs.rmSync(part, { force: true });
  }
}

export function readHeader(file: string): { header: BackupHeader; offset: number } {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(13);
    fs.readSync(fd, head, 0, 13, 0);
    if (!head.subarray(0, 9).equals(MAGIC)) throw new Error('Not a Canon backup of this kind.');
    const n = head.readUInt32LE(9);
    if (n > 65_536) throw new Error('This backup file is damaged.');
    const h = Buffer.alloc(n);
    fs.readSync(fd, h, 0, n, 13);
    return { header: JSON.parse(h.toString('utf8')) as BackupHeader, offset: 13 + n };
  } finally {
    fs.closeSync(fd);
  }
}

/** The backup needs its recovery key: on another computer, or made under an earlier recovery key. */
export class NeedsRecoveryKey extends Error {
  status = 400;
  needs_password = true;
  needs_recovery = true;
  recovery_id: string | null;
  constructor(message: string, id: string | null) {
    super(message);
    this.recovery_id = id;
  }
}

/**
 * Unwrap a backup into `dest` (still encrypted, with the backup key) and return that key: this computer's backup key
 * when it is the one, else the backup key from the header, opened with the recovery key typed in.
 */
export function unwrapBackupFile(file: string, dest: string, keys: Keys | null, recoveryKey?: string | null): Buffer {
  const { header, offset } = readHeader(file);
  const all = fs.readFileSync(file);
  fs.writeFileSync(dest, all.subarray(offset));
  const opens = (k: Buffer) => {
    try {
      openDb(dest, { key: k, readonly: true }).close();
      return true;
    } catch {
      return false;
    }
  };
  if (keys && opens(keys.backup)) return keys.backup;
  const id = header.recovery?.id ?? null;
  if (!header.recovery) {
    fs.rmSync(dest, { force: true });
    throw new Error('This backup was made by another Canon before it had a recovery key, so it can only be restored there.');
  }
  if (recoveryKey) {
    const k = openBackupKey(header.recovery.sealed, recoveryKey);
    if (k && opens(k)) return k;
    fs.rmSync(dest, { force: true });
    throw new NeedsRecoveryKey(`That is not the recovery key for this backup (it needs the one with ID ${id}).`, id);
  }
  fs.rmSync(dest, { force: true });
  throw new NeedsRecoveryKey(`This backup is from another Canon, or from before the recovery key was replaced. Enter the recovery key with ID ${id} to restore it.`, id);
}

/** The data folder's scratch files (below): what a crash may leave behind, removed when Canon starts. */
export const SCRATCH_RE = /^\.(backup|restore|restore-in|restore-out|part|upload)-[\w-]+\.db$/;
/** The data folder's scratch files for backups and restores (never inside the backup folder). */
let scratchCount = 0;
export const scratch = (dir: string, what: string) =>
  // unique within this process too: several made in the same millisecond (a package's parts) must not share a name
  path.join(dir, `.${what}-${process.pid}-${Date.now()}-${++scratchCount}-${crypto.randomBytes(4).toString('hex')}.db`);

// ---------------------------------------------------------------- the backup package (0.19.3)
//
// One file holds everything a restore needs, so a backup in Google Drive is a complete one:
//   CANONENC3 | header length (4 bytes) | header (JSON) | part | part | …
// The header lists the parts — the database first, then each archived year — with their size and SHA-256 (a damaged
// or cut-short file is refused), and carries the backup key locked with the recovery key, as single-file backups do.
// Each part is an SQLCipher database encrypted with the backup key.

export interface PackagePart { name: string; kind: 'database' | 'archive'; size: number; sha256: string }
export interface PackageHeader {
  v: 3;
  made_at: string;
  /** the Canon version that made it, and its database version */
  canon: string;
  schema: number;
  recovery: { id: string; sealed: string } | null;
  parts: PackagePart[];
}
export interface PackageSource { name: string; kind: PackagePart['kind']; src: string; key: Buffer | null }

/** Write a package: each source copied into the data folder, re-keyed to the backup key, then written in. */
export function writePackage(sources: PackageSource[], dest: string, keys: Keys, meta: { canon: string; schema: number }) {
  const work = path.dirname(config.dbPath);
  const made: { part: PackagePart; file: string }[] = [];
  try {
    for (const s of sources) {
      const file = scratch(work, 'part');
      fs.copyFileSync(s.src, file);
      made.push({ part: { name: s.name, kind: s.kind, size: 0, sha256: '' }, file });
      const d = openDb(file, { key: s.key });
      try {
        rekeyDb(d, keys.backup);
      } finally {
        d.close();
      }
      const bytes = fs.readFileSync(file);
      made[made.length - 1].part.size = bytes.length;
      made[made.length - 1].part.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    }
    const header = Buffer.from(JSON.stringify({
      v: 3, made_at: new Date().toISOString(), canon: meta.canon, schema: meta.schema, recovery: backupKeyForRecovery(), parts: made.map((m) => m.part),
    } satisfies PackageHeader));
    const len = Buffer.alloc(4);
    len.writeUInt32LE(header.length);
    const tmp = `${dest}.tmp`;
    fs.writeFileSync(tmp, Buffer.concat([PACKAGE, len, header]));
    for (const m of made) fs.appendFileSync(tmp, fs.readFileSync(m.file));
    fs.renameSync(tmp, dest);
  } finally {
    for (const m of made) fs.rmSync(m.file, { force: true });
  }
}

export function readPackageHeader(file: string): { header: PackageHeader; offset: number } {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(13);
    fs.readSync(fd, head, 0, 13, 0);
    if (!head.subarray(0, 9).equals(PACKAGE)) throw new Error('Not a Canon backup package.');
    const n = head.readUInt32LE(9);
    if (n > 1_048_576) throw new Error('This backup file is damaged.');
    const h = Buffer.alloc(n);
    fs.readSync(fd, h, 0, n, 13);
    const header = JSON.parse(h.toString('utf8')) as PackageHeader;
    if (header.v !== 3 || !Array.isArray(header.parts) || header.parts[0]?.kind !== 'database') throw new Error('This backup file is damaged.');
    for (const p of header.parts) {
      if (!/^canon(-archive-\d{4})?\.db$/.test(p.name) || !Number.isSafeInteger(p.size) || p.size < 0 || !/^[0-9a-f]{64}$/.test(p.sha256)) throw new Error('This backup file is damaged.');
    }
    return { header, offset: 13 + n };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Unpack a package into the data folder: each part checked against its SHA-256 and opened with the backup key —
 * this computer's, else the one locked with the recovery key typed in. The parts stay encrypted with the backup key;
 * the caller re-keys them and removes them.
 */
export function unwrapPackage(file: string, keys: Keys | null, recoveryKey?: string | null): { key: Buffer; header: PackageHeader; database: string; archives: { name: string; file: string }[] } {
  const { header, offset } = readPackageHeader(file);
  const work = path.dirname(config.dbPath);
  const total = fs.statSync(file).size;
  if (offset + header.parts.reduce((n, p) => n + p.size, 0) !== total) throw new Error('This backup file is damaged or incomplete (its size is not what it says).');
  const out: { part: PackagePart; file: string }[] = [];
  const fd = fs.openSync(file, 'r');
  try {
    let at = offset;
    for (const p of header.parts) {
      const buf = Buffer.alloc(p.size);
      fs.readSync(fd, buf, 0, p.size, at);
      at += p.size;
      if (crypto.createHash('sha256').update(buf).digest('hex') !== p.sha256) throw new Error(`This backup file is damaged (${p.name} doesn't match its checksum).`);
      const f = scratch(work, 'restore-in');
      fs.writeFileSync(f, buf);
      out.push({ part: p, file: f });
    }
  } catch (e) {
    for (const o of out) fs.rmSync(o.file, { force: true });
    throw e;
  } finally {
    fs.closeSync(fd);
  }
  const opens = (k: Buffer) => {
    try {
      openDb(out[0].file, { key: k, readonly: true }).close();
      return true;
    } catch {
      return false;
    }
  };
  const done = (key: Buffer) => ({ key, header, database: out[0].file, archives: out.slice(1).map((o) => ({ name: o.part.name, file: o.file })) });
  if (keys && opens(keys.backup)) return done(keys.backup);
  const fail = (e: Error): never => {
    for (const o of out) fs.rmSync(o.file, { force: true });
    throw e;
  };
  const id = header.recovery?.id ?? null;
  if (!header.recovery) return fail(new Error('This backup was made by another Canon before it had a recovery key, so it can only be restored there.'));
  if (!recoveryKey) return fail(new NeedsRecoveryKey(`This backup is from another Canon, or from before the recovery key was replaced. Enter the recovery key with ID ${id} to restore it.`, id));
  const k = openBackupKey(header.recovery.sealed, recoveryKey);
  if (!k || !opens(k)) return fail(new NeedsRecoveryKey(`That is not the recovery key for this backup (it needs the one with ID ${id}).`, id));
  return done(k);
}
