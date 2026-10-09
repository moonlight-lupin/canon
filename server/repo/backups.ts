// Database backups: on demand from Settings → Backups, automatically on a schedule, or `npm run backup`.
// A backup is a consistent copy made with SQLite's VACUUM INTO, safe while Canon is running.
import fs from 'node:fs';
import path from 'node:path';
import { db, dbEncrypted, dbKey, migrate, reopenDb, schemaVersion } from '../db.ts';
import { openDb, rekeyDb, type Db } from '../lib/sqlite.ts';
import { loadKeys } from '../lib/keys.ts';
import { resealTotpSecrets, sealTotpSecrets } from '../lib/secret-field.ts';
import { SCRATCH_RE, isBackupV2, isEncryptedBackupData, isPackage, scratch, unwrapBackupFile, unwrapPackage, writePackage } from '../lib/backup-file.ts';
import { config } from '../config.ts';
import { logChange, pruneAudit, pruneChanges } from './changelog.ts';
import { asSystem } from '../lib/actor.ts';
import { pruneMemberViews, recordSizeSnapshot } from './security.ts';
import { archiveDir, copyArchivesTo, eraseVisitorContacts, syncArchiveIndex } from './archive.ts';
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

/**
 * When Canon starts: scratch files a crash left behind — copies in the data folder made while backing up, restoring
 * or encrypting (some of them plain), and half-written backups in the backup folder — are removed.
 */
export function sweepScratch() {
  const gone = (f: string) => {
    try {
      fs.rmSync(f, { force: true });
    } catch { /* in use: next time */ }
  };
  const data = path.dirname(config.dbPath);
  if (fs.existsSync(data)) for (const n of fs.readdirSync(data)) if (SCRATCH_RE.test(n)) gone(path.join(data, n));
  for (const d of [backupDir(), path.join(backupDir(), 'archives')]) {
    if (fs.existsSync(d)) for (const n of fs.readdirSync(d)) if (/\.enc\.tmp$/.test(n)) gone(path.join(d, n));
  }
}

const canonVersion = () => {
  try {
    return (JSON.parse(fs.readFileSync(path.join(config.root, 'package.json'), 'utf8')) as { version: string }).version;
  } catch {
    return '';
  }
};

/** Write a backup now. Returns the new file. */
export function createBackup(dir = backupDir()): BackupFile & { path: string } {
  fs.mkdirSync(dir, { recursive: true });
  // an encrypted Canon: a backup package (0.19.3) — the database and every archived year in one file, encrypted with
  // the backup key (copies re-keyed in the data folder, never in plain). One file is the whole of the church's data,
  // so the copy in Google Drive is complete.
  if (dbEncrypted()) {
    let file = path.join(dir, `canon-${stamp()}.db.enc`);
    for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `canon-${stamp()}-${i}.db.enc`);
    const tmp = scratch(path.dirname(config.dbPath), 'backup');
    try {
      db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      const archives = fs.existsSync(archiveDir()) ? fs.readdirSync(archiveDir()).filter((n) => /^canon-archive-\d{4}\.db$/.test(n)).sort() : [];
      writePackage([
        { name: 'canon.db', kind: 'database', src: tmp, key: dbKey() },
        ...archives.map((n) => ({ name: n, kind: 'archive' as const, src: path.join(archiveDir(), n), key: dbKey() })),
      ], file, loadKeys()!, { canon: canonVersion(), schema: schemaVersion() });
    } finally {
      fs.rmSync(tmp, { force: true });
    }
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
  // a package (0.19.3): its database and its archived years
  if (isPackage(file)) {
    const u = unwrapPackage(file, loadKeys(), password);
    const parts = [u.database, ...u.archives.map((a) => a.file)];
    try {
      const problem = checkBackupFile(u.database, u.key);
      if (problem) throw Object.assign(new Error(problem), { status: 400 });
      for (const f of parts) {
        const d = openDb(f, { key: u.key });
        try {
          rekeyDb(d, dbKey());
          // its two-step secrets were sealed with that backup's key: sealed again with this Canon's
          if (f === u.database) resealTotpSecrets(d, u.key, loadKeys()?.backup ?? null);
        } finally {
          d.close();
        }
      }
      return await restoreInto(u.database, path.basename(file), u.archives);
    } finally {
      for (const f of parts) fs.rmSync(f, { force: true });
    }
  }
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
        if (key) resealTotpSecrets(d, key, loadKeys()?.backup ?? null);
      } finally {
        d.close();
      }
    }
    return await restoreInto(incoming, path.basename(file));
  } finally {
    fs.rmSync(incoming, { force: true });
  }
}

/**
 * Put a prepared database (keyed as the live one) in the live database's place, then bring it up to date. With a
 * package's archived years, they take the place of the archived years there were (those are set aside in
 * data/pre-restore/), so the data is as it was when the backup was made.
 */
async function restoreInto(incoming: string, name: string, archives?: { name: string; file: string }[]): Promise<{ safety: string; restored_schema: number }> {
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
  if (archives) {
    const dir = archiveDir();
    const now = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /^canon-archive-\d{4}\.db$/.test(n)) : [];
    if (now.length) {
      const aside = path.join(path.dirname(config.dbPath), 'pre-restore', `archives-${stamp()}-${Date.now() % 100000}`);
      fs.mkdirSync(aside, { recursive: true });
      for (const n of now) fs.renameSync(path.join(dir, n), path.join(aside, n));
    }
    fs.mkdirSync(dir, { recursive: true });
    for (const a of archives) fs.renameSync(a.file, path.join(dir, a.name));
  }
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate();
  // two-step secrets an older backup kept in plain are sealed with this Canon's keys
  sealTotpSecrets(db);
  clearSettingsCache();
  updateSettings(keep);
  putDriveMeta(drive);
  // an older backup may still hold visitors' details since erased, or records since archived
  syncArchiveIndex();
  eraseVisitorContacts(getSettings().retention.visitor_contact_months);
  setMeta('last_backup_at', safety.created);
  setMeta('last_restore', JSON.stringify({ at: new Date().toISOString(), from: name, safety: safety.name }));
  logChange({ entity: 'backups', entity_id: null, action: 'update', summary: `Restored backup ${name}${archives ? ` with ${archives.length} archived year${archives.length === 1 ? '' : 's'}` : ''} (the data before it was saved as ${safety.name})` });
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
  const ext = data.subarray(0, 9).toString() === 'CANONENC1' || isEncryptedBackupData(data) ? '.db.enc' : '.db';
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

export interface TidyDuty {
  key: string;
  /** what it does, for the log and the Security checklist */
  what: string;
  run: (log: (s: string) => void) => unknown;
}

/**
 * The daily tidy's duties, each on its own: one that fails no longer skips the rest (Daedalus Workshop study of
 * 0.19.10: they ran in one try, so a log that couldn't be pruned stopped the privacy erasure). The erasure goes first.
 */
export const TIDY_DUTIES: TidyDuty[] = [
  {
    key: 'erase', what: 'Erasing visitors’ contact details',
    run: (log) => {
      const months = getSettings().retention.visitor_contact_months;
      const v = eraseVisitorContacts(months);
      if (v.visitors || v.log) {
        log(`records: erased the details of ${v.visitors} visitors (and ${v.log} change-log copies) past the keep period`);
        logChange({ entity: 'service_records', entity_id: null, action: 'update', summary: `Visitors’ contact details erased after ${months} months: ${v.visitors} visitors, ${v.log} change-log copies` });
      }
    },
  },
  {
    // the change log and AI activity log keep only as many months as Settings says
    key: 'logs', what: 'Pruning the logs',
    run: (log) => {
      const { change_log_months, mcp_audit_months } = getSettings().retention;
      const a = pruneChanges(change_log_months);
      const b = pruneAudit(mcp_audit_months);
      const c = pruneMemberViews(change_log_months);
      if (a || b || c) log(`logs: removed ${a} change-log, ${b} AI-activity and ${c} member-view entries past the keep period`);
    },
  },
  {
    key: 'meetings', what: 'Creating meetings ahead',
    run: (log) => {
      const m = createAllMeetingsAhead();
      if (m) log(`meetings: created ${m} meetings ahead from the groups' meeting patterns`);
    },
  },
  {
    // lending self-service: check the public address again (a gate), drop old sign-in codes
    key: 'self_service', what: 'Checking the lending library’s self-service',
    run: async () => {
      const s = await import('./lending-self.ts');
      s.pruneCodes();
      await s.checkPublicAddress(true);
    },
  },
  {
    // the lending library's due-date and overdue e-mails (when it is on and its rules say so)
    key: 'reminders', what: 'Sending the library’s reminders',
    run: async (log) => {
      const r = await (await import('./lending-reminders.ts')).dailyLoanReminders();
      if (r && (r.sent || r.failed)) log(`library: sent ${r.sent} loan reminders${r.failed ? `, ${r.failed} failed` : ''}`);
    },
  },
  { key: 'size', what: 'Recording the storage size', run: () => recordSizeSnapshot() },
];

export interface TidyStatus { at: string; failed: Record<string, { what: string; error: string }> }

/** Run the daily tidy as Canon: every duty, whatever happens to the others; what failed is kept for the checklist. */
export async function dailyTidy(log: (s: string) => void = console.log, duties: TidyDuty[] = TIDY_DUTIES) {
  const failed: TidyStatus['failed'] = {};
  await asSystem(async () => {
    for (const d of duties) {
      try {
        await d.run(log);
      } catch (e) {
        const error = (e as Error)?.message ?? String(e);
        failed[d.key] = { what: d.what, error: error.slice(0, 300) };
        log(`tidy: ${d.what} failed — ${error}`);
      }
    }
  });
  const status: TidyStatus = { at: new Date().toISOString(), failed };
  setMeta('tidy_status', JSON.stringify(status));
}

/** How the last daily tidy went (Settings → Security & privacy warns when a duty failed). */
export function tidyStatus(): TidyStatus | null {
  try {
    return JSON.parse(getMeta('tidy_status') ?? 'null') as TidyStatus | null;
  } catch {
    return null;
  }
}

let timer: NodeJS.Timeout | null = null;
/** Every timer the scheduler started, so Canon can stop them when it stops. */
const timers: NodeJS.Timeout[] = [];

/** Stop the backup checks and the daily tidy (Canon is stopping). How many timers were stopped. */
export function stopSchedulers(): number {
  const n = timers.length;
  for (const t of timers.splice(0)) clearTimeout(t);
  timer = null;
  return n;
}

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
  const tick = () => asSystem(() => {
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
  });
  const tidy = () => void dailyTidy(log);
  timer = setInterval(tick, 30 * 60_000);
  timers.push(setTimeout(tidy, 90_000), setInterval(tidy, 24 * 3600_000), setTimeout(tick, 60_000), timer);
  for (const t of timers) t.unref();
}
