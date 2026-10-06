// This Canon's own secret (made once, kept in the database): signs links and short-lived tokens that must survive a
// restart — a lending library renewal link in an e-mail, a borrower's self-service sign-in — and answers the check
// that the church's public address really reaches this Canon.
import crypto from 'node:crypto';
import { getMeta, setMeta } from '../repo/settings.ts';

function secret(): Buffer {
  let s = getMeta('instance_secret');
  if (!s) {
    s = crypto.randomBytes(32).toString('base64url');
    setMeta('instance_secret', s);
  }
  return Buffer.from(s, 'base64url');
}

export const hmac = (text: string, len = 32) => crypto.createHmac('sha256', secret()).update(text).digest('base64url').slice(0, len);

const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** "<payload>.<signature>" for a purpose; the payload is plain (no secrets in it). */
export const signToken = (purpose: string, payload: string) => `${payload}.${hmac(`${purpose}:${payload}`)}`;

/** The payload of a token signed for this purpose, or null when it was changed or made elsewhere. */
export function verifyToken(purpose: string, token: string): string | null {
  const i = token.lastIndexOf('.');
  if (i <= 0) return null;
  const payload = token.slice(0, i);
  return same(token.slice(i + 1), hmac(`${purpose}:${payload}`)) ? payload : null;
}

/** The answer to the public-address check: only this Canon can sign the nonce. */
export const pingAnswer = (nonce: string) => hmac(`ping:${nonce}`);
