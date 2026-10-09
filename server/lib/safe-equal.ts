// Comparing secrets (CSRF tokens, setup codes, client secrets …) in constant time: how long the comparison takes
// doesn't tell how much of a guess was right (0.19.9 review).
import crypto from 'node:crypto';

/** Whether two secrets are the same, in time that doesn't depend on where they differ (nor on their lengths). */
export function sameSecret(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  // hashing first gives both the same length, so a wrong length isn't answered sooner either
  const x = crypto.createHash('sha256').update(a).digest();
  const y = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(x, y);
}
