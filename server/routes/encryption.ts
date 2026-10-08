// Settings → Security & privacy → Encryption (administrators): the status, encrypting a database made before
// 0.19.0, and a new recovery key (shown once). Making a new recovery key when there is one needs the
// administrator's password again: a signed-in browser left open is not enough to get a key that opens every backup.
import express from 'express';
import { z } from 'zod';
import { requireAdmin, sessionUser, verifyPassword } from '../auth.ts';
import { get } from '../db.ts';
import { recoveryInfo } from '../lib/keys.ts';
import { encryptNow, encryptionStatus, newRecoveryKey } from '../repo/encryption.ts';

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
encryptionRoutes.post('/security/encryption/encrypt', requireAdmin, h(() => encryptNow()));
encryptionRoutes.post('/security/recovery-key', requireAdmin, h((req) => {
  if (recoveryInfo()) {
    const { password } = z.object({ password: z.string().max(500) }).parse(req.body ?? {});
    const u = sessionUser(req)!;
    const row = get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', u.id);
    if (!row || !verifyPassword(password, row.password_hash)) throw Object.assign(new Error('That password is not right.'), { status: 403 });
  }
  return newRecoveryKey();
}));
