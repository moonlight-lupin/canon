// Canon's server. The log file first; then, when the database is encrypted, its keys: if this computer can't unlock
// them (another Windows account, a new computer), a page asks for the recovery key before anything else loads
// (lib/locked.ts). Then Canon itself (start.ts), loaded only now so nothing opens the database before its key is in hand.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { startLogFile } from './lib/logfile.ts';
import { KeysLockedError, loadKeys } from './lib/keys.ts';
import { serveLocked } from './lib/locked.ts';

// the log file next to the database (CANON_LOG=off to leave it out)
if (process.env.CANON_LOG !== 'off') {
  const version = (JSON.parse(fs.readFileSync(path.join(config.root, 'package.json'), 'utf8')) as { version: string }).version;
  startLogFile(path.join(path.dirname(config.dbPath), 'logs'), version);
}

try {
  loadKeys();
} catch (e) {
  if (!(e instanceof KeysLockedError)) throw e;
  await serveLocked(e.message);
}
await import('./start.ts');
