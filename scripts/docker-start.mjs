// Docker (0.18.0): Canon's container starts as root only to make its data and backups folders Canon's own (uid 1000)
// — a NAS (Synology, QNAP) creates a bind-mounted folder such as ./backups as root, and Canon could not write its
// backups there — then drops to the unprivileged "node" user for good and starts Canon in this same process, so
// `docker stop` still reaches it directly. Run with `user:` set in docker-compose.yml, it starts Canon as that user.
import fs from 'node:fs';

const NODE_UID = 1000;
if (process.getuid?.() === 0) {
  for (const dir of ['/app/data', '/app/backups']) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      if (fs.statSync(dir).uid !== NODE_UID) fs.chownSync(dir, NODE_UID, NODE_UID);
    } catch (e) {
      console.error(`Could not give ${dir} to Canon (uid ${NODE_UID}): ${e.message}`);
    }
  }
  process.initgroups('node', NODE_UID);
  process.setgid(NODE_UID);
  process.setuid(NODE_UID);
  process.env.HOME = '/home/node';
}
await import('../server/index.ts');
