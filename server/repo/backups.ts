// Database backups: on demand from Settings → Backups, automatically on a schedule, or `npm run backup`.
// A backup is a consistent copy made with SQLite's VACUUM INTO, safe while Canon is running.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import { db, migrate, schemaVersion } from '../db.ts';
import { config } from '../config.ts';
import { clearSettingsCache, getMeta, getSettings, setMeta, updateSettings } from './settings.ts';

export const DEFAULT_BACKUP_DIR = path.join(config.root, 'backups');
const NAME_RE = /^canon-\d{4}-\d{2}-\d{2}-\d{4}(-\d+|-upload\d*)?\.db$/;

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
  let file = path.join(dir, `canon-${stamp()}.db`);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `canon-${stamp()}-${i}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
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

/** Check that a file is a readable Canon database this version can open. Returns a plain-language problem, or null. */
export function checkBackupFile(file: string): string | null {
  let src: DatabaseSync | null = null;
  try {
    src = new DatabaseSync(file, { readOnly: true });
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
 * Replace all of Canon's data with a backup, in place: a copy of the current data is saved first, the backup is
 * copied into the live database with SQLite's backup API, then the schema is brought up to date. Everyone is
 * signed out unless their sign-in also exists in the backup.
 */
export async function restoreBackup(file: string): Promise<{ safety: string; restored_schema: number }> {
  const problem = checkBackupFile(file);
  if (problem) throw Object.assign(new Error(problem), { status: 400 });
  // settings that belong to this computer, not to the data: kept as they are
  const here = getSettings();
  const keep = { backup: here.backup, public_url: here.public_url, trust_proxy: here.trust_proxy };
  const safety = createBackup();
  const src = new DatabaseSync(file, { readOnly: true });
  let restored = 0;
  try {
    restored = (src.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    await sqliteBackup(src, config.dbPath);
  } finally {
    src.close();
  }
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate();
  clearSettingsCache();
  updateSettings(keep);
  setMeta('last_backup_at', safety.created);
  setMeta('last_restore', JSON.stringify({ at: new Date().toISOString(), from: path.basename(file), safety: safety.name }));
  return { safety: safety.name, restored_schema: restored };
}

/** Save an uploaded backup file into the backup folder (under a backup-style name) and return its path. */
export function saveUpload(data: Buffer, dir = backupDir()): string {
  fs.mkdirSync(dir, { recursive: true });
  let file = path.join(dir, `canon-${stamp()}-upload.db`);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `canon-${stamp()}-upload${i}.db`);
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
  const tick = () => {
    try {
      const due = nextDue();
      if (!due || Date.parse(due) > Date.now()) return;
      const b = createBackup();
      const removed = prune(getSettings().backup.keep);
      log(`backup: automatic backup ${b.name}${removed ? `, removed ${removed} old` : ''}`);
    } catch (e) {
      log(`backup: automatic backup failed — ${(e as Error).message}`);
    }
  };
  setTimeout(tick, 60_000).unref();
  timer = setInterval(tick, 30 * 60_000);
  timer.unref();
}
