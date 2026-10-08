// Consistent online backup of the Canon database (safe while the server is running).
//   npm run backup                -> the folder set in Settings → Backups (default: backups/)
//   npm run backup -- D:\Backups  -> another folder (e.g. a USB drive or synced folder)
// The same backups can be made, listed, downloaded and scheduled in Settings → Backups.
//
// This script opens the database directly and never loads the rest of Canon: loading Canon upgrades the database
// to the newest version, and a backup taken just before installing an update must be of the data as it is.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../server/config.ts';
import { openDb, type Db } from '../server/lib/sqlite.ts';
import { loadKeys, type Keys } from '../server/lib/keys.ts';
import { scratch, writeBackupFile } from '../server/lib/backup-file.ts';
import { encryptFile, keyForBackup } from '../server/lib/backup-crypto.ts';

// an encrypted Canon (0.19.0): the database opens with its key, and the backup is encrypted with the backup key
let keys: Keys | null = null;
try {
  keys = loadKeys();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
let db: Db;
let encrypted = false;
if (keys) {
  try {
    db = openDb(config.dbPath, { key: keys.db });
    encrypted = true;
  } catch (e) {
    if ((e as { code?: string }).code !== 'SQLITE_NOTADB') throw e;
    db = openDb(config.dbPath);
  }
} else {
  db = openDb(config.dbPath);
}
db.pragma('busy_timeout = 5000');
const setting = db.prepare("SELECT value FROM settings WHERE key = 'backup'").get() as { value: string } | undefined;
const backupSettings = setting ? (JSON.parse(setting.value) as { dir?: string; encrypted?: boolean }) : {};
const configured = backupSettings.dir ?? '';
const dir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(configured || path.join(config.root, 'backups'));
fs.mkdirSync(dir, { recursive: true });

const d = new Date();
const p2 = (n: number) => String(n).padStart(2, '0');
const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
// encrypted when the church set a backup password (Settings → Backups); a missing or damaged key stops the backup
let key: ReturnType<typeof keyForBackup> = null;
try {
  if (!encrypted) key = keyForBackup(backupSettings.encrypted);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
const ext = encrypted || key ? '.db.enc' : '.db';
let file = path.join(dir, `canon-${stamp}${ext}`);
for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `canon-${stamp}-${i}${ext}`);
if (encrypted) {
  const tmp = scratch(path.dirname(config.dbPath), 'backup');
  try {
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    writeBackupFile(tmp, keys!.db, file, keys!);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
} else if (key) {
  const tmp = path.join(path.dirname(config.dbPath), `.backup-${process.pid}.db`);
  try {
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    encryptFile(tmp, file, key);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
} else {
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
}
db.prepare("INSERT INTO settings (key, value) VALUES ('_last_backup_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(new Date().toISOString());
// archive files (one per archived year) go along with every backup
const archives = path.join(path.dirname(config.dbPath), 'archives');
if (fs.existsSync(archives)) {
  fs.mkdirSync(path.join(dir, 'archives'), { recursive: true });
  for (const name of fs.readdirSync(archives).filter((n) => /^canon-archive-\d{4}\.db$/.test(n))) {
    const from = path.join(archives, name);
    const to = path.join(dir, 'archives', encrypted || key ? `${name}.enc` : name);
    if (fs.existsSync(to) && fs.statSync(to).mtimeMs >= fs.statSync(from).mtimeMs) continue;
    if (encrypted) writeBackupFile(from, keys!.db, to, keys!, 'archive');
    else if (key) encryptFile(from, to, key);
    else fs.copyFileSync(from, to);
  }
}
const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
console.log(`Backup written: ${file} (${(fs.statSync(file).size / 1e6).toFixed(1)} MB, database version ${version})`);
