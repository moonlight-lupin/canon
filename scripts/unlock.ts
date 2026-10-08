// Unlock Canon's keys with the recovery key from the command line (0.19.0) — where the locked page can't be reached
// from this computer's own browser: Docker (the browser comes through Docker's network), a server without a desktop.
//   npm run unlock -- <recovery key>
//   docker compose run --rm --user node canon npm run unlock -- <recovery key>
// The keys are locked to this computer (or CANON_KEY_FILE) again; then start Canon (or restart the container).
import { keysExist, unlockWithRecovery } from '../server/lib/keys.ts';

const key = process.argv.slice(2).join(' ').trim();
if (!key) {
  console.error('Usage: npm run unlock -- <recovery key>');
  process.exit(1);
}
if (!keysExist()) {
  console.error('This Canon has no encryption keys (keys.json) next to its database: there is nothing to unlock.');
  process.exit(1);
}
try {
  unlockWithRecovery(key);
  console.log('Unlocked: the keys are locked to this computer again. Start Canon (or restart the container).');
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
