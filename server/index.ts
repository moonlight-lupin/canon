import { config } from './config.ts';
import { createApp } from './app.ts';
import { seed } from './seed/index.ts';
import { publicUrl } from './lib/public-url.ts';
import { startBackupScheduler } from './repo/backups.ts';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { startLogFile } from './lib/logfile.ts';
import { handleControl, stop, writeControlFile } from './lib/control.ts';

// the log file next to the database (CANON_LOG=off to leave it out)
if (process.env.CANON_LOG !== 'off') {
  const version = (JSON.parse(fs.readFileSync(path.join(config.root, 'package.json'), 'utf8')) as { version: string }).version;
  startLogFile(path.join(path.dirname(config.dbPath), 'logs'), version);
}

await seed();
startBackupScheduler();

const app = createApp();
// the tray icon's Exit (POST /control/stop from this computer, with the token) is answered before the app sees it
const server = http.createServer((req, res) => {
  if (!handleControl(server, req, res)) app(req, res);
});
server.listen(config.port, config.host, () => {
  writeControlFile();
  console.log(`Canon running on http://localhost:${config.port}`);
  if (publicUrl()) console.log(`Public URL (OAuth / MCP): ${publicUrl()}/mcp`);
});
// Ctrl+C in the window, closing it (SIGBREAK / SIGHUP on Windows), `docker stop` (SIGTERM): stop properly
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'] as const) process.on(sig, () => stop(server, sig));
