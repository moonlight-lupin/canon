import { config } from './config.ts';
import { createApp } from './app.ts';
import { seed } from './seed/index.ts';
import { publicUrl } from './lib/public-url.ts';
import { startBackupScheduler } from './repo/backups.ts';

await seed();
startBackupScheduler();

createApp().listen(config.port, config.host, () => {
  console.log(`Canon running on http://localhost:${config.port}`);
  if (publicUrl()) console.log(`Public URL (OAuth / MCP): ${publicUrl()}/mcp`);
});
