// Consistent online backup of the Canon database (safe while the server is running).
//   npm run backup                -> the folder set in Settings → Backups (default: backups/)
//   npm run backup -- D:\Backups  -> another folder (e.g. a USB drive or synced folder)
// The same backups can be made, listed, downloaded and scheduled in Settings → Backups.
import path from 'node:path';
import { backupDir, createBackup } from '../server/repo/backups.ts';

const dir = process.argv[2] ? path.resolve(process.argv[2]) : backupDir();
const b = createBackup(dir);
console.log(`Backup written: ${b.path} (${(b.size / 1e6).toFixed(1)} MB)`);
