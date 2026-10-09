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

/**
 * The time step (30-second counter) whose code this is, allowing one step either side for a phone clock that is a
 * little off; null when it matches none. Remembering the step used lets a code work only once.
 */
export function totpStep(secret: string, code: string, at = Date.now()): number | null {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const off = [-1, 0, 1].find((d) => crypto.timingSafeEqual(Buffer.from(totp(secret, at + d * 30_000)), Buffer.from(c)));
  return off === undefined ? null : Math.floor(at / 30_000) + off;
}

/** The address an authenticator app reads from a QR code. */
export const otpauthUri = (secret: string, account: string, issuer: string) =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

// ---- recovery codes

// Crockford's base32 (no I, L, O or U): read off paper and typed without mix-ups
const C32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** As typed: upper case, no spaces or dashes, the letters that look like digits read as digits. */
const normalCode = (code: string) => code.toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0').replace(/[^0-9A-Z]/g, '');

/**
 * Eight one-time recovery codes, shown once: 80 random bits each (16 characters in four groups). Before 0.19.9 they
 * were 40 bits, kept as an unsalted SHA-256 — a stolen copy of the accounts could be worked back to the codes.
 */
export const newRecoveryCodes = () =>
  Array.from({ length: 8 }, () => Array.from(crypto.randomBytes(16), (b) => C32[b & 31]).join('').replace(/^(.{4})(.{4})(.{4})(.{4})$/, '$1-$2-$3-$4'));

/** What is kept of a recovery code: "s1$<salt>$<HMAC-SHA256 of the code with the salt>". */
export function hashRecoveryCode(code: string): string {
  const salt = crypto.randomBytes(16);
  return `s1$${salt.toString('base64url')}$${crypto.createHmac('sha256', salt).update(normalCode(code)).digest('base64url')}`;
}

/** A code kept as before 0.19.9 (an unsalted SHA-256 of the code as typed, in lower case): good until used. */
export const isOldRecoveryHash = (h: string) => !h.startsWith('s1$');
const oldHash = (code: string) => crypto.createHash('sha256').update(code.trim().toLowerCase()).digest('base64url');

/**
 * Which of the kept codes this one is (-1: none). Every kept code is compared, each in constant time, so neither the
 * answer's timing nor its place in the list tells anything.
 */
export function matchRecoveryCode(code: string, kept: string[]): number {
  let found = -1;
  const typed = normalCode(code);
  const old = Buffer.from(oldHash(code));
  for (let i = 0; i < kept.length; i++) {
    const h = kept[i];
    let same: boolean;
    if (isOldRecoveryHash(h)) {
      const want = Buffer.from(h);
      same = want.length === old.length && crypto.timingSafeEqual(want, old);
    } else {
      const [, salt, mac] = h.split('$');
      const want = Buffer.from(mac ?? '', 'base64url');
      const got = crypto.createHmac('sha256', Buffer.from(salt ?? '', 'base64url')).update(typed).digest();
      same = want.length === got.length && crypto.timingSafeEqual(want, got);
    }
    if (same && found < 0) found = i;
  }
  return found;
}
