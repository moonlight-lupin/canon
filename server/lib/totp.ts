// Two-step sign-in codes (0.13): time-based one-time passwords (RFC 6238, the kind authenticator apps such as
// Google Authenticator, Microsoft Authenticator or 1Password make) — 6 digits, a new one every 30 seconds — and
// one-time recovery codes for a lost phone. No dependencies.
import crypto from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function fromBase32(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    value = (value << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new secret (160 bits, as authenticator apps expect). */
export const newSecret = () => base32(crypto.randomBytes(20));

/** The code for a time step (default: now). */
export function totp(secret: string, at = Date.now(), step = 30): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / step)));
  const h = crypto.createHmac('sha1', fromBase32(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

/** Does this code match now (allowing one step either side for a phone clock that is a little off)? */
export function verifyTotp(secret: string, code: string, at = Date.now()): boolean {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  return [-1, 0, 1].some((d) => crypto.timingSafeEqual(Buffer.from(totp(secret, at + d * 30_000)), Buffer.from(c)));
}

/** The address an authenticator app reads from a QR code. */
export const otpauthUri = (secret: string, account: string, issuer: string) =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

/** Eight one-time recovery codes (shown once; only their hashes are kept). */
export const newRecoveryCodes = () => Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex').replace(/(.{5})/, '$1-'));
export const hashCode = (code: string) => crypto.createHash('sha256').update(code.trim().toLowerCase()).digest('base64url');
