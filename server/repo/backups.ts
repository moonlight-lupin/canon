// Database backups: on demand from Settings → Backups, automatically on a schedule, or `npm run backup`.
// A backup is a consistent copy made with SQLite's VACUUM INTO, safe while Canon is running.
import fs from 'node:fs';
import path from 'node:path';
import { db, dbEncrypted, dbKey, migrate, reopenDb, schemaVersion } from '../db.ts';
import { openDb, rekeyDb, type Db } from '../lib/sqlite.ts';
import { loadKeys } from '../lib/keys.ts';
import { isBackupV2, isBackupV2Data, scratch, unwrapBackupFile, writeBackupFile } from '../lib/backup-file.ts';
import { config } from '../config.ts';
import { logChange, pruneAudit, pruneChanges } from './changelog.ts';
import { pruneMemberViews, recordSizeSnapshot } from './security.ts';
import { copyArchivesTo, eraseVisitorContacts, syncArchiveIndex } from './archive.ts';
import { createAllMeetingsAhead } from './services.ts';
import { clearSettingsCache, getMeta, getSettings, setMeta, updateSettings } from './settings.ts';
import { decryptFile, encryptFile, isEncrypted, keyForBackup } from '../lib/backup-crypto.ts';
import { driveMeta, putDriveMeta, syncToDrive } from '../lib/gdrive.ts';

export const DEFAULT_BACKUP_DIR = path.join(config.root, 'backups');
// .db.enc: encrypted — with the backup key of an encrypted Canon (lib/backup-file.ts), or (before 0.19.0) with the
// church's backup password (lib/backup-crypto.ts)
const NAME_RE = /^canon-\d{4}-\d{2}-\d{2}-\d{4}(-\d+|-upload\d*)?\.db(\.enc)?$/;

export interface BackupFile {
  name: string;
  size: number;
  created: string; // ISO
}

/** The folder backups go to: Settings → Backups, else ./backups (in Docker: the /app/backups volume). */
export const backupDir = () => path.resolve(getSettings().backup.dir || DEFAULT_BACKUP_DIR);

const stamp = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;

/** Check a folder can hold backups (creating it if needed). Returns a plain-language problem, or null. */
export function checkFolder(dir: string): string | null {
  if (!dir.trim()) return null;
  if (!path.isAbsolute(dir)) return 'Enter a full folder path, e.g. D:\\CanonBackups or /mnt/backups.';
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.canon-write-test-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe);
    return null;
  } catch (e) {
    return `Canon cannot write to this folder (${(e as NodeJS.ErrnoException).code ?? (e as Error).message}). Check that the drive is connected and the folder is not read-only.`;
  }
}

export function listBackups(dir = backupDir()): BackupFile[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => NAME_RE.test(n))
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size, created: st.mtime.toISOString() };
    })
    .sort((a, b) => b.created.localeCompare(a.created));
}

/** Write a backup now. Returns the new file. */
export function createBackup(dir = backupDir()): BackupFile & { path: string } {
  fs.mkdirSync(dir, { recursive: true });
  // an encrypted Canon: always encrypted, with the backup key (a copy re-keyed in the data folder, never in plain)
  if (dbEncrypted()) {
    let file = path.join(dir, `canon-${stamp()}.db.enc`);
    for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `canon-${stamp()}-${i}.db.enc`);
    const tmp = scratch(path.dirname(config.dbPath), 'backup');
    try {
      db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      writeBackupFile(tmp, dbKey(), file, loadKeys()!);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    copyArchivesTo(dir);
    setMeta('last_backup_at', new Date().toISOString());
    const st = fs.statSync(file);
    return { name: path.basename(file), path: file, size: st.size, created: st.mtime.toISOString() };
  }
  // configured encryption with a missing or damaged key stops here (never a plain copy instead)
  const key = keyForBackup(getSettings().backup.encrypted);
  const ext = key ? '.db.enc' : '.db';
  let file = path.join(dir, `canon-${stamp()}${ext}`);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `canon-${stamp()}-${i}${ext}`);
  if (key) {
    // a plain copy only for as long as it takes to encrypt it, in the data folder (not the backup folder)
    const tmp = path.join(path.dirname(config.dbPath), `.backup-${process.pid}-${Date.now()}.db`);
    try {
      db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      encryptFile(tmp, file, key);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  } else {
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  }
  // archive files (one per archived year) go along with every backup
  copyArchivesTo(dir);
  setMeta('last_backup_at', new Date().toISOString());
  const st = fs.statSync(file);
  return { name: path.basename(file), path: file, size: st.size, created: st.mtime.toISOString() };
}

/** Resolve a backup file name safely inside the backup folder (no path tricks). */
export function backupPath(name: string): string | null {
  if (!NAME_RE.test(name)) return null;
  const p = path.join(backupDir(), name);
  return fs.existsSync(p) ? p : null;
}

export function deleteBackup(name: string): boolean {
  const p = backupPath(name);
  if (!p) return false;
  fs.rmSync(p);
  return true;
}

/** Keep the newest `keep` backups, delete older ones. Returns how many were removed. */
export function prune(keep: number, dir = backupDir()): number {
  if (keep <= 0) return 0;
  const old = listBackups(dir).slice(keep);
  for (const b of old) fs.rmSync(path.join(dir, b.name));
  return old.length;
}

export const lastBackupAt = () => getMeta('last_backup_at') ?? null;

// ---------------------------------------------------------------- restore

/** Tables every Canon database has; a file without them is not a Canon backup. */
const CANON_TABLES = ['settings', 'users', 'services', 'service_items', 'songs', 'texts', 'people'];

/**
 * Run fn on the plain database of a backup: the file itself, or (encrypted) a decrypted copy in the data folder that
 * is removed afterwards. The password is needed only for a backup made with another backup password.
 */
export async function withPlainBackup<T>(file: string, password: string | null | undefined, fn: (plain: string) => T | Promise<T>): Promise<T> {
  if (!isEncrypted(file)) return fn(file);
  const tmp = path.join(path.dirname(config.dbPath), `.restore-${process.pid}-${Date.now()}.db`);
  try {
    decryptFile(file, tmp, password);
    return await fn(tmp);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Check that a file is a readable Canon database this version can open. Returns a plain-language problem, or null. */
export function checkBackupFile(file: string, key: Buffer | null = null): string | null {
  let src: Db | null = null;
  try {
    src = openDb(file, { readonly: true, key });
    const tables = new Set((src.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
    if (CANON_TABLES.some((t) => !tables.has(t))) return 'This file is not a Canon backup.';
    const v = (src.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (v > schemaVersion()) return 'This backup was made by a newer version of Canon. Update Canon first, then restore it.';
    const ok = (src.prepare('PRAGMA quick_check').get() as { quick_check: string }).quick_check;
    if (ok !== 'ok') return 'This backup file is damaged and cannot be restored.';
    return null;
  } catch {
    return 'This file is not a Canon backup (it could not be opened as a database).';
  } finally {
    src?.close();
  }
}

/**
 * Replace all of Canon's data with a backup: a copy of the current data is saved first, the database is closed, the
 * backup (copied into the data folder) takes its place and is opened, then the schema is brought up to date. If the
 * swap fails, the database as it was is put back. Everyone is signed out unless their sign-in is also in the backup.
 */
export async function restoreBackup(file: string, password?: string | null): Promise<{ safety: string; restored_schema: number }> {
  // the backup, copied into the data folder as a database: still encrypted (a backup of an encrypted Canon), or
  // decrypted (one made with a backup password, before 0.19.0), or as it is (a plain one)
  const incoming = scratch(path.dirname(config.dbPath), 'restore-in');
  try {
    let key: Buffer | null = null;
    if (isBackupV2(file)) key = unwrapBackupFile(file, incoming, loadKeys(), password);
    else if (isEncrypted(file)) decryptFile(file, incoming, password);
    else fs.copyFileSync(file, incoming);
    const problem = checkBackupFile(incoming, key);
    if (problem) throw Object.assign(new Error(problem), { status: 400 });
    // given this database's own key (or none, while this Canon isn't encrypted)
    if (key || dbKey()) {
      const d = openDb(incoming, { key });
      try {
        rekeyDb(d, dbKey());
      } finally {
        d.close();
      }
    }
    return await restoreInto(incoming, path.basename(file));
  } finally {
    fs.rmSync(incoming, { force: true });
  }
}

/** Put a prepared database (keyed as the live one) in the live database's place, then bring it up to date. */
async function restoreInto(incoming: string, name: string): Promise<{ safety: string; restored_schema: number }> {
  // settings that belong to this computer, not to the data: kept as they are
  const here = getSettings();
  const keep = { backup: here.backup, public_url: here.public_url, trust_proxy: here.trust_proxy };
  // the Google Drive connection belongs to this computer too
  const drive = driveMeta();
  const safety = createBackup();
  const outgoing = scratch(path.dirname(config.dbPath), 'restore-out');
  let restored = 0;
  try {
    const src = openDb(incoming, { key: dbKey() });
    restored = (src.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    src.close();
    reopenDb(() => {
      // the database as it was steps aside (its write-ahead log was folded in when it closed), the backup takes its place
      for (const x of ['-wal', '-shm']) fs.rmSync(config.dbPath + x, { force: true });
      fs.renameSync(config.dbPath, outgoing);
      try {
        fs.renameSync(incoming, config.dbPath);
      } catch (e) {
        fs.renameSync(outgoing, config.dbPath);
        throw e;
      }
    });
  } finally {
    fs.rmSync(incoming, { force: true });
  }
  fs.rmSync(outgoing, { force: true });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate();
  clearSettingsCache();
  updateSettings(keep);
  putDriveMeta(drive);
  // an older backup may still hold visitors' details since erased, or records since archived
  syncArchiveIndex();
  eraseVisitorContacts(getSettings().retention.visitor_contact_months);
  setMeta('last_backup_at', safety.created);
  setMeta('last_restore', JSON.stringify({ at: new Date().toISOString(), from: name, safety: safety.name }));
  logChange({ entity: 'backups', entity_id: null, action: 'update', summary: `Restored backup ${name} (the data before it was saved as ${safety.name})` });
  return { safety: safety.name, restored_schema: restored };
}

/** The newest backup in the folder when it is encrypted (the only kind sent to Google Drive). */
export function newestEncrypted(dir = backupDir()): { name: string; path: string } | null {
  const b = listBackups(dir)[0];
  return b && b.name.endsWith('.db.enc') ? { name: b.name, path: path.join(dir, b.name) } : null;
}

/** Save an uploaded backup file into the backup folder (under a backup-style name) and return its path. */
export function saveUpload(data: Buffer, dir = backupDir()): string {
  fs.mkdirSync(dir, { recursive: true });
  const ext = data.subarray(0, 9).toString() === 'CANONENC1' || isBackupV2Data(data) ? '.db.enc' : '.db';
  let file = path.join(dir, `canon-${stamp()}-upload${ext}`);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `canon-${stamp()}-upload${i}${ext}`);
  fs.writeFileSync(file, data);
  return file;
}

export function lastRestore(): { at: string; from: string; safety: string } | null {
  try {
    return JSON.parse(getMeta('last_restore') ?? 'null');
  } catch {
    return null;
  }
}

/** When the next automatic backup is due (ISO), or null when automatic backups are off. */
export function nextDue(): string | null {
  const { auto } = getSettings().backup;
  if (auto === 'off') return null;
  const last = lastBackupAt();
  const period = (auto === 'daily' ? 1 : 7) * 86400_000;
  return new Date(last ? Date.parse(last) + period : Date.now()).toISOString();
}

let timer: NodeJS.Timeout | null = null;

/** Check every 30 minutes whether an automatic backup is due (also shortly after start-up). */
export function startBackupScheduler(log: (s: string) => void = console.log) {
  if (timer) return;
  try {
    // archives made by 0.11.0 (or copied in by hand): their services' records become read-only here too
    const n = syncArchiveIndex();
    if (n) log(`archives: ${n} archived service records linked`);
  } catch (e) {
    log(`archives: could not read the archive files — ${(e as Error).message}`);
  }
  const tick = () => {
    try {
      const due = nextDue();
      if (due && Date.parse(due) <= Date.now()) {
        const b = createBackup();
        const removed = prune(getSettings().backup.keep);
        log(`backup: automatic backup ${b.name}${removed ? `, removed ${removed} old` : ''}`);
      }
    } catch (e) {
      log(`backup: automatic backup failed — ${(e as Error).message}`);
    }
    // the newest backup to Google Drive when connected (also one made by `npm run backup` since the last check)
    try {
      void syncToDrive(newestEncrypted(), log);
    } catch {
      /* the folder can't be read: reported in Settings → Backups */
    }
  };
  // the change log and AI activity log keep only as many months as Settings says
  const tidy = () => {
    try {
      const { change_log_months, mcp_audit_months } = getSettings().retention;
      const a = pruneChanges(change_log_months);
      const b = pruneAudit(mcp_audit_months);
      const c = pruneMemberViews(change_log_months);
      if (a || b || c) log(`logs: removed ${a} change-log, ${b} AI-activity and ${c} member-view entries past the keep period`);
      const v = eraseVisitorContacts(getSettings().retention.visitor_contact_months);
      if (v.visitors || v.log) log(`records: erased the details of ${v.visitors} visitors (and ${v.log} change-log copies) past the keep period`);
      const m = createAllMeetingsAhead();
      if (m) log(`meetings: created ${m} meetings ahead from the groups' meeting patterns`);
      // lending self-service: check the public address again (a gate), drop old sign-in codes
      void import('./lending-self.ts').then((s) => { s.pruneCodes(); return s.checkPublicAddress(true); }).catch(() => undefined);
      // the lending library's due-date and overdue e-mails (when it is on and its rules say so)
      void import('./lending-reminders.ts').then((r) => r.dailyLoanReminders())
        .then((r) => { if (r && (r.sent || r.failed)) log(`library: sent ${r.sent} loan reminders${r.failed ? `, ${r.failed} failed` : ''}`); })
        .catch((e) => log(`library: reminders failed — ${(e as Error).message}`));
      recordSizeSnapshot();
    } catch (e) {
      log(`logs: tidy failed — ${(e as Error).message}`);
    }
  };
  setTimeout(tidy, 90_000).unref();
  setInterval(tidy, 24 * 3600_000).unref();
  setTimeout(tick, 60_000).unref();
  timer = setInterval(tick, 30 * 60_000);
  timer.unref();
}
