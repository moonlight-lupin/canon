// Backup files of an encrypted Canon (0.19.0, "CANONENC2"): the database (or an archived year) as an SQLCipher file
// encrypted with the BACKUP key — not the database's own key — behind a short header:
//   CANONENC2 | header length (4 bytes, little-endian) | header (JSON) | the encrypted database
// The header says when it was made and carries the backup key locked with the recovery key current then (and that
// recovery key's ID, printed on its sheet). So a backup restores on this computer by itself, and on any other
// computer with the recovery sheet. Nothing in a backup is ever written in plain.
//
// Older backups stay readable: "CANONENC1" (encrypted with a backup password, lib/backup-crypto.ts) and plain .db.
import fs from 'node:fs';
import path from 'node:path';
import { openDb, rekeyDb } from './sqlite.ts';
import { backupKeyForRecovery, openBackupKey, type Keys } from './keys.ts';

const MAGIC = Buffer.from('CANONENC2');
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

/**
 * Write `dest` as a backup of the database file `src` (encrypted with `srcKey`, or plain): a copy is re-keyed to the
 * backup key next to `dest`, then wrapped with the header. `src` is left as it is.
 */
export function writeBackupFile(src: string, srcKey: Buffer | null, dest: string, keys: Keys, kind: BackupHeader['kind'] = 'database') {
  const part = `${dest}.part`;
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

/** The data folder's scratch files for backups and restores (never inside the backup folder). */
export const scratch = (dir: string, what: string) => path.join(dir, `.${what}-${process.pid}-${Date.now()}.db`);
