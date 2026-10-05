// Turn an encrypted backup (.db.enc) back into a plain database file, for restoring by hand when Canon won't start.
//   npm run decrypt-backup -- <file.db.enc>                 -> uses this computer's backup key
//   npm run decrypt-backup -- <file.db.enc> <password>      -> a backup from another computer or an older password
// Writes <file>.db next to it (members' personal data: delete it once restored).
import path from 'node:path';
import { decryptFile } from '../server/lib/backup-crypto.ts';

const [src, password] = process.argv.slice(2);
if (!src) {
  console.error('Usage: npm run decrypt-backup -- <backup.db.enc> [password]');
  process.exit(1);
}
const dest = path.resolve(src.replace(/\.enc$/, '').replace(/(\.db)?$/, '.db'));
try {
  decryptFile(path.resolve(src), dest === path.resolve(src) ? `${dest}.plain.db` : dest, password ?? null);
  console.log(`Decrypted to ${dest}`);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
