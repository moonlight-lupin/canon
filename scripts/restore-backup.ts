// Restore a backup by hand, with Canon stopped (0.19.1 review, C) — when Canon won't start, or on a new computer
// after the old one was lost. In-app restore (Settings → Backups) is the usual way; this is for when there is no app.
//   npm run restore-backup -- <backup file> [recovery key or backup password]
//   docker compose run --rm --user node canon npm run restore-backup -- /app/backups/<file> [recovery key]
//
// It opens the backup (this computer's backup key; else the recovery key, or for a backup from before 0.19.0 its
// backup password), checks it, gives it this Canon's own database key, sets the database there was aside in
// data/pre-restore/ and puts the backup in its place. Archived years found next to the backup (its archives/ folder)
// that this Canon doesn't have are brought back too. Nothing is ever written in plain where it stays.
// On a computer with no keys yet (a new one), new keys are made and a new recovery key is shown: print it.
// It never loads the rest of Canon, which would open the database it is replacing.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../server/config.ts';
import { MIGRATIONS } from '../server/migrations.ts';
import { openDb, rekeyDb } from '../server/lib/sqlite.ts';
import { KeysLockedError, createKeys, keysExist, loadKeys, makeRecoveryKey, unlockWithRecovery, type Keys } from '../server/lib/keys.ts';
import { isBackupV2, scratch, unwrapBackupFile } from '../server/lib/backup-file.ts';
import { decryptFile, isEncrypted as isPasswordBackup } from '../server/lib/backup-crypto.ts';

const [fileArg, secretArg] = process.argv.slice(2);
const fail = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};
if (!fileArg) fail('Usage: npm run restore-backup -- <backup file> [recovery key or backup password]   (with Canon stopped)');
const file = path.resolve(fileArg);
if (!fs.existsSync(file)) fail(`There is no file ${file}.`);
const secret = secretArg?.trim() || null;
const data = path.dirname(config.dbPath);
fs.mkdirSync(data, { recursive: true });

// ---------------------------------------------------------------- Canon must be stopped
const control = path.join(data, 'run', `control-${config.port}.json`);
const running = (() => {
  try {
    const { pid } = JSON.parse(fs.readFileSync(control, 'utf8')) as { pid: number };
    process.kill(pid, 0); // throws when there is no such process
    return true;
  } catch (e) {
    return (e as { code?: string }).code === 'EPERM'; // there is, as another user
  }
})();
if (running) fail('Canon is running: stop it first (the icon by the clock → Exit, `docker compose stop canon`, or close its window).');

// ---------------------------------------------------------------- this Canon's keys (or new ones)
let keys: Keys | null = null;
let madeKeys = false;
const encryptWanted = process.env.CANON_ENCRYPT !== '0';
if (keysExist()) {
  try {
    keys = loadKeys();
  } catch (e) {
    if (!(e instanceof KeysLockedError)) throw e;
    // keys this computer can't open: the recovery key given opens them (and locks them to this computer again)
    if (!secret) fail('This Canon\'s keys can\'t be opened on this computer. Give its recovery key after the file name.');
    try {
      keys = unlockWithRecovery(secret!);
    } catch (e2) {
      fail((e2 as Error).message);
    }
  }
} else if (encryptWanted) {
  keys = createKeys();
  madeKeys = true;
}

// ---------------------------------------------------------------- the backup, as a database in the data folder
const incoming = scratch(data, 'restore-in');
const cleanup = () => fs.rmSync(incoming, { force: true });
let backupKey: Buffer | null = null;
try {
  if (isBackupV2(file)) backupKey = unwrapBackupFile(file, incoming, keys, secret);
  else if (isPasswordBackup(file)) decryptFile(file, incoming, secret);
  else fs.copyFileSync(file, incoming);
} catch (e) {
  cleanup();
  fail((e as Error).message);
}

// checked as in-app restore does: Canon's tables, a version this Canon knows, an intact file
try {
  const d = openDb(incoming, { key: backupKey, readonly: true });
  const tables = new Set((d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
  const v = (d.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  const ok = (d.prepare('PRAGMA quick_check').get() as { quick_check: string }).quick_check;
  d.close();
  if (['settings', 'users', 'services', 'people'].some((t) => !tables.has(t))) throw new Error('This file is not a Canon backup.');
  if (v > MIGRATIONS.length) throw new Error('This backup was made by a newer version of Canon. Install that version first.');
  if (ok !== 'ok') throw new Error('This backup file is damaged.');
} catch (e) {
  cleanup();
  fail((e as Error).message);
}

// this Canon's own key (or none, when it isn't encrypted)
if (backupKey || keys) {
  const d = openDb(incoming, { key: backupKey });
  try {
    rekeyDb(d, keys?.db ?? null);
  } finally {
    d.close();
  }
}

// ---------------------------------------------------------------- the database there was steps aside; the backup takes its place
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
if (fs.existsSync(config.dbPath)) {
  const aside = path.join(data, 'pre-restore');
  fs.mkdirSync(aside, { recursive: true });
  const kept = path.join(aside, `canon-before-restore-${stamp}.db`);
  // its write-ahead log goes with it, so the copy set aside is whole
  for (const x of ['', '-wal', '-shm']) if (fs.existsSync(config.dbPath + x)) fs.renameSync(config.dbPath + x, kept + x);
  console.log(`The database there was is kept as ${kept} (with this Canon's key).`);
}
fs.renameSync(incoming, config.dbPath);

// ---------------------------------------------------------------- archived years next to the backup
const archivesHere = path.join(data, 'archives');
const archivesThere = path.join(path.dirname(file), 'archives');
const restored: string[] = [];
const skipped: string[] = [];
if (fs.existsSync(archivesThere)) {
  for (const n of fs.readdirSync(archivesThere)) {
    const m = /^(canon-archive-\d{4}\.db)(\.enc)?$/.exec(n);
    if (!m) continue;
    const dest = path.join(archivesHere, m[1]);
    if (fs.existsSync(dest)) {
      skipped.push(m[1]);
      continue;
    }
    const src = path.join(archivesThere, n);
    const tmp = scratch(data, 'restore-in');
    try {
      let k: Buffer | null = null;
      if (isBackupV2(src)) k = unwrapBackupFile(src, tmp, backupKey ? { db: backupKey, backup: backupKey } : keys, secret);
      else if (isPasswordBackup(src)) decryptFile(src, tmp, secret);
      else fs.copyFileSync(src, tmp);
      const d = openDb(tmp, { key: k });
      try {
        if (k || keys) rekeyDb(d, keys?.db ?? null);
      } finally {
        d.close();
      }
      fs.mkdirSync(archivesHere, { recursive: true });
      fs.renameSync(tmp, dest);
      restored.push(m[1]);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      console.error(`${n} was not brought back: ${(e as Error).message}`);
    }
  }
}

console.log(`Restored ${path.basename(file)}.${restored.length ? ` Archived years brought back: ${restored.join(', ')}.` : ''}${skipped.length ? ` Already here (kept): ${skipped.join(', ')}.` : ''}`);
if (madeKeys) {
  // a new computer: new keys, and their recovery key, shown this once
  const r = makeRecoveryKey();
  console.log('');
  console.log('This computer has new encryption keys. Their RECOVERY KEY is shown only now — print it or write it down,');
  console.log('and keep it away from this computer (the backup\'s old recovery key still opens the old backups):');
  console.log('');
  console.log(`    ${r.key}      (ID ${r.id})`);
  console.log('');
}
console.log('Start Canon now. It upgrades the database if the backup is from an older version.');
