// Turn an encrypted backup (.db.enc) back into a plain database file, for restoring by hand when Canon won't start.
//   npm run decrypt-backup -- <file.db.enc>                 -> this computer's keys
//   npm run decrypt-backup -- <file.db.enc> <recovery key>  -> a backup of an encrypted Canon (0.19.0) from another
//                                                              computer, or made under an earlier recovery key
//   npm run decrypt-backup -- <file.db.enc> <password>      -> a backup made with a backup password (before 0.19.0)
// Writes <file>.db next to it (a package's archived years in <file>-archives/), NOT encrypted — for looking into a
// backup elsewhere; delete it afterwards. To RESTORE a backup by hand, use `npm run restore-backup` instead: an
// encrypted Canon refuses a plain database put in place of its own.
import fs from 'node:fs';
import path from 'node:path';
import { decryptFile } from '../server/lib/backup-crypto.ts';
import { isBackupV2, isPackage, unwrapBackupFile, unwrapPackage } from '../server/lib/backup-file.ts';
import { loadKeys } from '../server/lib/keys.ts';
import { openDb, rekeyDb } from '../server/lib/sqlite.ts';

const [src, secret] = process.argv.slice(2);
if (!src) {
  console.error('Usage: npm run decrypt-backup -- <backup.db.enc> [recovery key or backup password]');
  process.exit(1);
}
const from = path.resolve(src);
let dest = path.resolve(src.replace(/\.enc$/, '').replace(/(\.db)?$/, '.db'));
if (dest === from) dest = `${dest}.plain.db`;
try {
  if (isPackage(from)) {
    // a package: the database as <name>.db, its archived years in <name>-archives/
    let keys = null;
    try {
      keys = loadKeys();
    } catch {
      keys = null;
    }
    const u = unwrapPackage(from, keys, secret ?? null);
    const archivesDir = dest.replace(/\.db$/, '-archives');
    try {
      for (const [f, to] of [[u.database, dest], ...u.archives.map((a) => [a.file, path.join(archivesDir, a.name)])] as [string, string][]) {
        const d = openDb(f, { key: u.key });
        try {
          rekeyDb(d, null);
        } finally {
          d.close();
        }
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(f, to);
      }
    } finally {
      for (const f of [u.database, ...u.archives.map((a) => a.file)]) fs.rmSync(f, { force: true });
    }
    if (u.archives.length) console.log(`Its archived years: ${archivesDir} (not encrypted either).`);
  } else if (isBackupV2(from)) {
    let keys = null;
    try {
      keys = loadKeys();
    } catch {
      keys = null; // keys this computer can't unlock: the recovery key still opens the backup
    }
    const key = unwrapBackupFile(from, dest, keys, secret ?? null);
    const d = openDb(dest, { key });
    try {
      rekeyDb(d, null);
    } finally {
      d.close();
    }
  } else {
    decryptFile(from, dest, secret ?? null);
  }
  console.log(`Decrypted to ${dest} (not encrypted: delete it once it is restored).`);
} catch (e) {
  fs.rmSync(dest, { force: true });
  console.error((e as Error).message);
  process.exit(1);
}
