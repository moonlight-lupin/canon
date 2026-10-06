import { config } from './config.ts';
import { createApp } from './app.ts';
import { seed } from './seed/index.ts';
import { publicUrl } from './lib/public-url.ts';
import { startBackupScheduler } from './repo/backups.ts';
import fs from 'node:fs';
import path from 'node:path';
import { startLogFile } from './lib/logfile.ts';

// the log file next to the database (CANON_LOG=off to leave it out)
if (process.env.CANON_LOG !== 'off') {
  const version = (JSON.parse(fs.readFileSync(path.join(config.root, 'package.json'), 'utf8')) as { version: string }).version;
  startLogFile(path.join(path.dirname(config.dbPath), 'logs'), version);
}

await seed();
startBackupScheduler();

createApp().listen(config.port, config.host, () => {
  console.log(`Canon running on http://localhost:${config.port}`);
  if (publicUrl()) console.log(`Public URL (OAuth / MCP): ${publicUrl()}/mcp`);
});
