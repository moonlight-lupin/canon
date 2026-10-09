// Secrets kept in a database column, sealed with this Canon's keys (0.19.9): two-step sign-in secrets. The database is
// encrypted already; sealing them too keeps them out of anything made from a decrypted copy (an export, a test copy,
// an older plain database), so a stolen copy can't make the codes that sign in.
//
// The key comes from the BACKUP key (server/lib/keys.ts), not the database key: a backup carries its backup key
// (locked with the church's recovery key), so a backup restored on another computer can still open them, and they
// are sealed again with that Canon's key (resealTotpSecrets). A Canon without keys (made before 0.19.0 and never
// encrypted) keeps them in plain, as before; they are sealed once it is encrypted.
import crypto from 'node:crypto';
import type { Db } from './sqlite.ts';
import { loadKeys } from './keys.ts';

const PREFIX = 'enc1:';
const AAD = 'canon-field-v1';

/** The key that seals columns, made from a Canon's backup key; null without one (an unencrypted Canon). */
export const fieldKey = (backupKey: Buffer | null | undefined): Buffer | null =>
  backupKey ? Buffer.from(crypto.hkdfSync('sha256', backupKey, 'canon-field-v1', 'secret-columns', 32)) : null;

/** This Canon's key for sealed columns (null while it isn't encrypted). */
export const currentFieldKey = () => fieldKey(loadKeys()?.backup);

/** Seal a value (as it is, without a key). */
export function sealField(value: string, key: Buffer | null): string {
  if (!key) return value;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(AAD));
  const body = Buffer.concat([c.update(value, 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}

export const isSealed = (stored: string | null | undefined) => !!stored && stored.startsWith(PREFIX);

/** Open a sealed value (a plain one is returned as it is). Throws when the key is not the one it was sealed with. */
export function openField(stored: string, key: Buffer | null): string {
  if (!isSealed(stored)) return stored;
  if (!key) throw new Error('This value is sealed with keys this Canon doesn’t have.');
  const b = Buffer.from(stored.slice(PREFIX.length), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
  d.setAAD(Buffer.from(AAD));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

/** Seal two-step secrets still in plain (from before 0.19.9, or from before this Canon was encrypted). Returns how many. */
export function sealTotpSecrets(d: Db, key = currentFieldKey()): number {
  if (!key) return 0;
  const rows = d.prepare('SELECT id, totp_secret FROM users WHERE totp_secret IS NOT NULL').all() as { id: number; totp_secret: string }[];
  let n = 0;
  for (const r of rows) {
    if (isSealed(r.totp_secret)) continue;
    d.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(sealField(r.totp_secret, key), r.id);
    n++;
  }
  return n;
}

/**
 * A database from another Canon (a restored backup): its two-step secrets were sealed with that Canon's backup key
 * (`from`); seal them again with this one's (`to`, or kept in plain without one). A secret that key doesn't open is left as
 * it is (sealed with this Canon's key already, or with neither: its account signs in with a recovery code, or an
 * administrator resets its two-step sign-in). Returns how many were sealed again.
 */
export function resealTotpSecrets(d: Db, from: Buffer | null, to: Buffer | null): number {
  const a = fieldKey(from);
  const b = fieldKey(to);
  const rows = d.prepare('SELECT id, totp_secret FROM users WHERE totp_secret IS NOT NULL').all() as { id: number; totp_secret: string }[];
  let n = 0;
  for (const r of rows) {
    // in plain (an older backup): sealed with this Canon's key; sealed with that backup's key: sealed again with this one's
    let plain: string;
    if (!isSealed(r.totp_secret)) plain = r.totp_secret;
    else {
      try {
        plain = openField(r.totp_secret, a);
      } catch {
        continue;
      }
    }
    if (!b && !isSealed(r.totp_secret)) continue;
    d.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(sealField(plain, b), r.id);
    n++;
  }
  return n;
}
