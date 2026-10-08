// Turn an encrypted backup (.db.enc) back into a plain database file, for restoring by hand when Canon won't start.
//   npm run decrypt-backup -- <file.db.enc>                 -> this computer's keys
//   npm run decrypt-backup -- <file.db.enc> <recovery key>  -> a backup of an encrypted Canon (0.19.0) from another
//                                                              computer, or made under an earlier recovery key
//   npm run decrypt-backup -- <file.db.enc> <password>      -> a backup made with a backup password (before 0.19.0)
// Writes <file>.db next to it, NOT encrypted (members' personal data: delete it once restored). Put in the place of
// data/canon.db, Canon opens it as it is and asks an administrator to encrypt it again (Settings → Security & privacy).
import fs from 'node:fs';
import path from 'node:path';
import { decryptFile } from '../server/lib/backup-crypto.ts';
import { isBackupV2, unwrapBackupFile } from '../server/lib/backup-file.ts';
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
  if (isBackupV2(from)) {
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
