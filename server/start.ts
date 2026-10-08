// Canon itself, once its database can be opened (server/index.ts checks the keys first).
import { config } from './config.ts';
import { createApp } from './app.ts';
import { seed } from './seed/index.ts';
import { publicUrl } from './lib/public-url.ts';
import { startBackupScheduler, sweepScratch } from './repo/backups.ts';
import http from 'node:http';
import { handleControl, stop, writeControlFile } from './lib/control.ts';
import { noteUpdateResult, setUpdateServer, startUpdateChecks } from './lib/updates.ts';

// Ctrl+C in the window, closing it (SIGBREAK / SIGHUP on Windows), `docker stop` (SIGTERM): stop properly — also
// while the first start is still setting up (node as Docker's first process ignores signals nobody listens for)
let server: http.Server | null = null;
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'] as const) process.on(sig, () => (server ? stop(server, sig) : process.exit(0)));

await seed();
sweepScratch();
startBackupScheduler();
// an update the launcher has just prepared (or rolled back): noted for About Canon
noteUpdateResult();
startUpdateChecks();

const app = createApp();
// the tray icon's Exit (POST /control/stop from this computer, with the token) is answered before the app sees it
server = http.createServer((req, res) => {
  if (!handleControl(server!, req, res)) app(req, res);
});
setUpdateServer(server);
server.listen(config.port, config.host, () => {
  writeControlFile();
  console.log(`Canon running on http://localhost:${config.port}`);
  if (publicUrl()) console.log(`Public URL (OAuth / MCP): ${publicUrl()}/mcp`);
});
