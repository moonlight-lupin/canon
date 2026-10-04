// Database backups: on demand from Settings → Backups, automatically on a schedule, or `npm run backup`.
// A backup is a consistent copy made with SQLite's VACUUM INTO, safe while Canon is running.
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.ts';
import { config } from '../config.ts';
import { getMeta, getSettings, setMeta } from './settings.ts';

export const DEFAULT_BACKUP_DIR = path.join(config.root, 'backups');
const NAME_RE = /^canon-\d{4}-\d{2}-\d{2}-\d{4}(-\d+)?\.db$/;

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
