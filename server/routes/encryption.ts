// Settings → Security & privacy → Encryption (administrators): the status, encrypting a database made before
// 0.19.0, and a new recovery key (shown once). Making a new recovery key when there is one needs the
// administrator's password again: a signed-in browser left open is not enough to get a key that opens every backup.
import express from 'express';
import { z } from 'zod';
import { requireAdmin, sessionUser, verifyPassword } from '../auth.ts';
import { get } from '../db.ts';
import { recoveryInfo } from '../lib/keys.ts';
import { encryptNow, encryptPlainCopies, encryptionStatus, newRecoveryKey } from '../repo/encryption.ts';
import { logChange } from '../repo/changelog.ts';

export const encryptionRoutes = express.Router();
const h = (fn: (req: express.Request) => unknown) => async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await fn(req));
  } catch (e) {
    next(e);
  }
};

encryptionRoutes.get('/security/encryption', requireAdmin, h(() => encryptionStatus()));
/** The administrator's password again, for what hands out a recovery key (a browser left signed in is not enough). */
async function passwordAgain(req: express.Request) {
  const { password } = z.object({ password: z.string().max(500) }).parse(req.body ?? {});
  const u = sessionUser(req)!;
  const row = get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', u.id);
  if (!row || !(await verifyPassword(password, row.password_hash))) throw Object.assign(new Error('That password is not right.'), { status: 403 });
}

encryptionRoutes.post('/security/encryption/encrypt', requireAdmin, h(async (req) => {
  await passwordAgain(req);
  return encryptNow();
}));
/** Plain copies left after Encrypt now (a drive unplugged, a file in use), encrypted now. */
encryptionRoutes.post('/security/encryption/copies', requireAdmin, h(() => {
  const r = encryptPlainCopies();
  logChange({ entity: 'settings', entity_id: null, action: 'update', summary: `Plain copies encrypted or removed: ${r.converted.length}${r.failed.length ? `; ${r.failed.length} could not be` : ''}` });
  return r;
}));
encryptionRoutes.post('/security/recovery-key', requireAdmin, h(async (req) => {
  if (recoveryInfo()) await passwordAgain(req);
  return newRecoveryKey();
}));
