// Encrypting Canon's data (0.19.0): the status for Settings → Security & privacy and the administrators' banner,
// encrypting a database that was made before 0.19.0 (with the plain copies Canon holds), and the recovery key.
// The keys themselves: lib/keys.ts. The database driver: lib/sqlite.ts. Backups: lib/backup-file.ts.
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { db, dbEncrypted, reopenDb, setEncrypted } from '../db.ts';
import { config } from '../config.ts';
import { openDb, rekeyDb } from '../lib/sqlite.ts';
import { clearEncrypting, createKeys, keyProtection, loadKeys, machineAccount, makeRecoveryKey, markEncrypting, recoveryInfo, type Keys } from '../lib/keys.ts';
import { writeBackupFile } from '../lib/backup-file.ts';
import { Conflict } from '../lib/table.ts';
import { logChange } from './changelog.ts';
import { backupDir, createBackup } from './backups.ts';

const dataDir = () => path.dirname(config.dbPath);
const BACKUP_RE = /^canon-\d{4}-\d{2}-\d{2}-\d{4}(-\d+|-upload\d*)?\.db$/;
const ARCHIVE_RE = /^canon-archive-\d{4}\.db$/;
const PRE_UPGRADE_RE = /^canon-v\d+-before-v\d+-[\d-]+\.db$/;
export const SCRATCH_RE = /^\.(backup|restore|restore-in|restore-out|part)-[\w-]+\.db$/;

/** A plain SQLite database (its first bytes say so; an encrypted one starts with random bytes). */
const isPlainDb = (file: string) => {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const b = Buffer.alloc(16);
      fs.readSync(fd, b, 0, 16, 0);
      return b.toString('latin1') === 'SQLite format 3\0';
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
};
const filesIn = (dir: string, re: RegExp) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => re.test(n)).map((n) => path.join(dir, n)) : []);

/** The plain copies Canon holds, by kind (made before the database was encrypted). */
function plainCopies() {
  const bdir = backupDir();
  // a test copy of the church's data (CANON_TEST_COPY=1) leaves its backup folder alone: it may be the real Canon's
  const backupsToo = !config.testCopy;
  return {
    pre_upgrade: filesIn(path.join(dataDir(), 'pre-upgrade'), PRE_UPGRADE_RE).filter(isPlainDb),
    archives: filesIn(path.join(dataDir(), 'archives'), ARCHIVE_RE).filter(isPlainDb),
    backups: backupsToo ? filesIn(bdir, BACKUP_RE).filter(isPlainDb) : [],
    backup_archives: backupsToo ? filesIn(path.join(bdir, 'archives'), ARCHIVE_RE).filter(isPlainDb) : [],
    scratch: filesIn(dataDir(), SCRATCH_RE),
  };
}
/** Plain database files in Canon's folders that Canon didn't make: left alone, but named, so nobody forgets them. */
function othersInFolders(): string[] {
  const known = new Set([path.resolve(config.dbPath)]);
  return [dataDir(), backupDir()]
    .flatMap((d) => (fs.existsSync(d) ? fs.readdirSync(d).map((n) => path.join(d, n)) : []))
    .filter((f) => /\.(db|sqlite|sqlite3)$/i.test(f) && !known.has(path.resolve(f)) && (config.testCopy || !BACKUP_RE.test(path.basename(f))) && !SCRATCH_RE.test(path.basename(f)) && isPlainDb(f));
}

export function encryptionStatus() {
  const plain = plainCopies();
  return {
    encrypted: dbEncrypted(),
    /** how the keys are locked to this computer: dpapi (the Windows account), keychain, secret (CANON_KEY_FILE) or file */
    protection: keyProtection(),
    account: machineAccount(),
    recovery: recoveryInfo(),
    /** where backups go: Encrypt now converts the plain ones there (shown before it does) */
    backup_dir: backupDir(),
    plain_copies: Object.values(plain).flat().map((f) => path.basename(f)),
    others: othersInFolders().map((f) => f),
  };
}

const recoveryOut = async (r: { key: string; id: string; made_at: string }) => ({ ...r, qr: await QRCode.toDataURL(r.key, { margin: 1, width: 260, errorCorrectionLevel: 'M' }) });

/** A new recovery key, shown once. */
export async function newRecoveryKey() {
  if (!dbEncrypted()) throw new Conflict('Encrypt the database first.');
  const r = makeRecoveryKey();
  logChange({ entity: 'settings', entity_id: null, action: 'update', summary: `A new recovery key was made (ID ${r.id}); the one before no longer opens the database` });
  return recoveryOut(r);
}

/**
 * Encrypt a database made before 0.19.0, in place, with the plain copies Canon holds: a backup first (as backups are
 * made now), then the keys and the recovery key, then the database itself (opened again with its key, to be sure),
 * then the copies — the copies kept before upgrades and the archived years with the database key, the backups and
 * their archive copies in the backup format (each plain original removed once its encrypted copy is written).
 */
export async function encryptNow() {
  if (dbEncrypted()) throw new Conflict('The database is encrypted already.');
  const safety = createBackup();
  // keys beside a plain database exist only after an interrupted encryption (db.ts refuses any other plain file)
  const keys: Keys = loadKeys() ?? createKeys();
  markEncrypting(keys);
  const recovery = makeRecoveryKey();
  rekeyDb(db, keys.db);
  setEncrypted(keys);
  reopenDb(() => undefined);
  clearEncrypting();
  const copies = encryptPlainCopies(keys);
  logChange({
    entity: 'settings', entity_id: null, action: 'update',
    summary: `The database was encrypted (recovery key ID ${recovery.id}); ${copies.converted.length} plain cop${copies.converted.length === 1 ? 'y' : 'ies'} encrypted or removed${copies.failed.length ? `, ${copies.failed.length} could not be` : ''}`,
  });
  return { recovery: await recoveryOut(recovery), safety: safety.name, ...copies };
}

/**
 * The plain copies Canon holds, encrypted: the copies kept before upgrades and the archived years with the database
 * key, backups and their archive copies in the backup format (each plain original removed once its encrypted copy is
 * written). Part of Encrypt now, and again later for any it couldn't do then (a USB drive unplugged, a file in use).
 */
export function encryptPlainCopies(keys: Keys | null = loadKeys()) {
  if (!dbEncrypted() || !keys) throw new Conflict('Encrypt the database first.');
  const done: string[] = [];
  const failed: { file: string; error: string }[] = [];
  const step = (file: string, fn: () => void) => {
    try {
      fn();
      done.push(path.basename(file));
    } catch (e) {
      failed.push({ file: path.basename(file), error: (e as Error).message });
    }
  };
  const inPlace = (file: string) => {
    const d = openDb(file);
    try {
      rekeyDb(d, keys.db);
    } finally {
      d.close();
    }
  };
  const asBackup = (file: string, kind: 'database' | 'archive') => {
    const dest = `${file}.enc`;
    writeBackupFile(file, null, dest, keys, kind);
    fs.rmSync(file);
  };
  const plain = plainCopies();
  for (const f of plain.pre_upgrade) step(f, () => inPlace(f));
  for (const f of plain.archives) step(f, () => inPlace(f));
  for (const f of plain.backups) step(f, () => asBackup(f, 'database'));
  for (const f of plain.backup_archives) step(f, () => asBackup(f, 'archive'));
  for (const f of plain.scratch) step(f, () => fs.rmSync(f, { force: true }));
  return { converted: done, failed, others: othersInFolders() };
}
