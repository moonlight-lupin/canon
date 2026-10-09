// Staff accounts, password hashing, cookie sessions and role checks for the web app.
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Role } from '../shared/types.ts';
import { all, get, run } from './db.ts';
import { config } from './config.ts';
import { leaderMayWrite } from './lib/leaders.ts';
import { gateRequest, isAdmin, meetingPath, roleDef } from './lib/permissions.ts';
import { outsideWall } from './lib/walls.ts';
import { moduleOff } from '../shared/modules.ts';
import { GUEST_ROLE } from '../shared/permissions.ts';
import { getMeta, getSettings, setMeta } from './repo/settings.ts';
import { matchRecoveryCode, totpStep } from './lib/totp.ts';
import { addressKey, makeLimiter } from './lib/rate-limit.ts';
import { sameSecret } from './lib/safe-equal.ts';
import { currentFieldKey, openField } from './lib/secret-field.ts';
import { notifyAccount } from './repo/account-notices.ts';

export { sealTotpSecrets, resealTotpSecrets } from './lib/secret-field.ts';

export interface User {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  lang: string;
  /** the member this account belongs to (meeting leaders record the meetings they lead) */
  person_id?: number | null;
  /** the congregation this account is limited to (null = the whole church) */
  congregation_id?: number | null;
  /** two-step sign-in is on */
  totp_enabled?: boolean;
  /** an administrator chose the password: the account changes it before anything else */
  must_change_password?: boolean;
}

// Cookies are scoped by host, not port: include the port so several Canon instances on one machine don't sign each other out.
const COOKIE = `canon_session_${config.port}`;
const DEVICE_COOKIE = `canon_device_${config.port}`;
const SESSION_DAYS = 14;

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

// ---- passwords --------------------------------------------------------------------------

/**
 * scrypt at OWASP's level (0.19.9): N=2^17, r=8, p=1, written into each hash. 0.19.8 and before used N=2^14 with r
 * and p left out; such a hash still signs in and is replaced at the account's next successful sign-in. The work runs
 * in Node's worker threads, so Canon keeps answering everyone else meanwhile (scryptSync held it up).
 */
export const PASSWORD_PARAMS = { N: 2 ** 17, r: 8, p: 1 } as const;
// 128 × N × r bytes while a check runs: 128 MiB, above Node's default limit of 32 MiB
const MAXMEM = 256 * 1024 * 1024;
// at most two checks at once (each takes 128 MiB): a burst of sign-ins on a small NAS waits its turn
const MAX_AT_ONCE = 2;
let running = 0;
const queue: (() => void)[] = [];
async function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  if (running < MAX_AT_ONCE) running++;
  else await new Promise<void>((go) => queue.push(go));
  try {
    return await fn();
  } finally {
    // the place goes straight to the next in line (nobody arriving meanwhile can slip in ahead)
    const next = queue.shift();
    if (next) next();
    else running--;
  }
}
const scrypt = (pw: string, salt: Buffer, len: number, o: { N: number; r: number; p: number }) =>
  oneAtATime(() => new Promise<Buffer>((done, fail) => crypto.scrypt(pw, salt, len, { N: o.N, r: o.r, p: o.p, maxmem: MAXMEM }, (e, k) => (e ? fail(e) : done(k)))));

/** A stored hash: "scrypt$N$r$p$salt$hash" (0.19.9), or "scrypt$N$salt$hash" with r=8, p=1 (before). */
function parseHash(stored: string): { N: number; r: number; p: number; salt: Buffer; hash: Buffer; old: boolean } | null {
  const parts = stored.split('$');
  if (parts[0] !== 'scrypt' || (parts.length !== 4 && parts.length !== 6)) return null;
  const old = parts.length === 4;
  const [N, r, p] = old ? [Number(parts[1]), 8, 1] : [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  // what Canon writes, and no more (a damaged hash must not ask for gigabytes)
  if (![N, r, p].every(Number.isInteger) || N < 2 || N > 2 ** 20 || (N & (N - 1)) !== 0 || r < 1 || r > 32 || p < 1 || p > 16) return null;
  return { N, r, p, salt: Buffer.from(parts[parts.length - 2], 'base64'), hash: Buffer.from(parts[parts.length - 1], 'base64'), old };
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const { N, r, p } = PASSWORD_PARAMS;
  const hash = await scrypt(pw, salt, 64, PASSWORD_PARAMS);
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const h = parseHash(stored);
  if (!h || !h.hash.length) return false;
  const got = await scrypt(pw, h.salt, h.hash.length, h);
  return crypto.timingSafeEqual(h.hash, got);
}

/** Is a stored hash weaker than Canon makes now (replaced at the next successful sign-in)? */
export function passwordNeedsRehash(stored: string): boolean {
  const h = parseHash(stored);
  return !h || h.old || h.N < PASSWORD_PARAMS.N || h.r < PASSWORD_PARAMS.r || h.p < PASSWORD_PARAMS.p;
}

// A password no one knows, hashed once at start: an unknown username then costs one password check, as a known one
// does, so the time an answer takes doesn't tell which usernames exist (0.19.8 review)
const DUMMY_HASH = hashPassword(crypto.randomBytes(24).toString('base64'));

export const userCount = () => get<{ n: number }>('SELECT COUNT(*) n FROM users')!.n;

/** A new account. must_change: an administrator chose the password, so the person changes it at their first sign-in. */
export async function createUser(u: { username: string; display_name: string; password: string; role: Role; must_change?: boolean }) {
  if (u.password.length < 8) throw Object.assign(new Error('Password must be at least 8 characters'), { status: 400 });
  const hash = await hashPassword(u.password);
  const r = run(
    'INSERT INTO users (username, display_name, password_hash, role, must_change_password) VALUES (?,?,?,?,?)',
    u.username.trim(), u.display_name.trim(), hash, u.role, u.must_change ? 1 : 0,
  );
  return getUser(Number(r.lastInsertRowid))!;
}

export const getUser = (id: number) =>
  get<User>('SELECT id, username, display_name, role, lang, person_id, congregation_id, totp_enabled = 1 AS totp_enabled, must_change_password = 1 AS must_change_password FROM users WHERE id = ?', id);
export const listUsers = () => {
  const first = firstAdminId();
  return listUserRows().map((u) => ({
    ...u, first_admin: u.id === first, needs_member: !!memberLinkProblem(u.id, u.role, u.person_id),
    // a role Canon doesn't know (e.g. from an older copy of the data): the account has no access until it gets one
    ...(roleDef(u.role).unknown ? { unknown_role: true } : {}),
  }));
};
const listUserRows = () => all<User & { created_at: string; person_name: string | null }>(
  `SELECT u.id, u.username, u.display_name, u.role, u.lang, u.created_at, u.person_id, u.congregation_id, u.totp_enabled = 1 AS totp_enabled,
          u.must_change_password = 1 AS must_change_password,
          u.locked_until > strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS locked,
          CASE WHEN p.id IS NOT NULL THEN TRIM(IFNULL(p.preferred_name, p.first_name) || ' ' || p.last_name) END AS person_name
   FROM users u LEFT JOIN people p ON p.id = u.person_id ORDER BY u.id`,
);

// ---- the account's wait after wrong passwords ----------------------------------------------

/** Wrong passwords (or codes) in a row before an account waits, and the longest it waits. */
export const MAX_FAILED = 5;
export const LOCK_MINUTES = 15;
/**
 * How long an account waits after its n-th wrong try in a row (0.19.9): from the fifth, 1 minute, then 2, 4, 8, and
 * 15 at most. It was 15 minutes at once, which let anyone who knew a username keep the account shut with five guesses
 * a quarter of an hour. Tries during a wait are refused without being counted, so they don't make it longer.
 */
export const waitMinutes = (n: number) => (n < MAX_FAILED ? 0 : Math.min(LOCK_MINUTES, 2 ** (n - MAX_FAILED)));

export type SignIn = { user: User } | { locked: true } | { second_step: number; trusted: boolean } | null;

type AccountRow = Omit<User, 'totp_enabled' | 'must_change_password'> & { password_hash: string; failed_logins: number; locked_until: string | null; totp_enabled: number };
const waiting = (row: { locked_until: string | null }) => !!row.locked_until && row.locked_until > new Date().toISOString();

/** A wrong password or code for this account: from the fifth in a row, it waits (longer each time). */
function failedFor(userId: number) {
  const row = get<{ failed_logins: number }>('SELECT failed_logins FROM users WHERE id = ?', userId);
  const n = (row?.failed_logins ?? 0) + 1;
  const wait = waitMinutes(n);
  run('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', n, wait ? new Date(Date.now() + wait * 60_000).toISOString() : null, userId);
}

// ---- browsers an account has signed in on (0.19.9) -------------------------------------------
//
// Someone who knows a username can make the account wait; its owner's own browser shouldn't. A browser that signed in
// to an account keeps a cookie saying so (signed with this Canon's key and bound to the account's password, so a new
// password forgets it); with it, the account's wait doesn't apply — the address's limit still does, and after five
// wrong tries from that browser it is treated like any other for 15 minutes.

const DEVICE_DAYS = 180;
const DEVICES_KEPT = 5;
function deviceKey(): Buffer {
  let k = getMeta('device_key');
  if (!k) {
    k = crypto.randomBytes(32).toString('base64url');
    setMeta('device_key', k);
  }
  return Buffer.from(k, 'base64url');
}
const deviceMac = (userId: number, nonce: string, passwordHash: string) =>
  crypto.createHmac('sha256', deviceKey()).update(`${userId}.${nonce}.${passwordHash}`).digest('base64url').slice(0, 32);
const deviceEntries = (req: Request) => (readCookie(req, DEVICE_COOKIE) ?? '').split('~').filter((e) => /^\d+\.[\w-]{16,}\.[\w-]{32}$/.test(e));
const deviceTries = makeLimiter(MAX_FAILED, LOCK_MINUTES * 60_000);

/** The remembered browser this request comes from, for this account (its nonce), or null. */
function knownDevice(req: Request | undefined, row: { id: number; password_hash: string }): string | null {
  if (!req) return null;
  for (const e of deviceEntries(req)) {
    const [uid, nonce, mac] = e.split('.');
    if (Number(uid) === row.id && sameSecret(mac, deviceMac(row.id, nonce, row.password_hash))) return deviceTries.over(nonce) ? null : nonce;
  }
  return null;
}

/** Remember this browser for this account (after a successful sign-in); a shared office PC keeps up to five. */
function rememberDevice(req: Request, res: Response, userId: number) {
  const hash = get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', userId)?.password_hash;
  if (!hash) return;
  const nonce = crypto.randomBytes(16).toString('base64url');
  const others = deviceEntries(req).filter((e) => Number(e.split('.')[0]) !== userId).slice(-(DEVICES_KEPT - 1));
  res.cookie(DEVICE_COOKIE, [...others, `${userId}.${nonce}.${deviceMac(userId, nonce, hash)}`].join('~'), {
    httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: DEVICE_DAYS * 86400_000, path: '/',
  });
}

/**
 * Check a username and password. Wrong passwords in a row make the account wait (waitMinutes), except in a browser
 * that signed in to it before; an account with two-step sign-in needs its code next (second_step = the account). A
 * hash weaker than Canon makes now is replaced once the password is right.
 */
export async function authenticate(username: string, password: string, req?: Request): Promise<SignIn> {
  const row = get<AccountRow>('SELECT * FROM users WHERE username = ?', username.trim());
  // always one password check, for an unknown username too
  const ok = await verifyPassword(password, row?.password_hash ?? await DUMMY_HASH);
  if (!row) return null;
  const device = knownDevice(req, row);
  if (!device && waiting(row)) return { locked: true };
  if (!ok) {
    if (device) deviceTries.add(device);
    else failedFor(row.id);
    return null;
  }
  if (passwordNeedsRehash(row.password_hash)) run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(password), row.id);
  // with two-step sign-in, the count goes on until the code is right too: a known password and a loop of guesses at
  // the code still make the account wait (0.19.0 review)
  if (row.totp_enabled) return { second_step: row.id, trusted: !!device };
  run('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?', row.id);
  return { user: getUser(row.id)! };
}

// ---- two-step sign-in -----------------------------------------------------------------

const tickets = new Map<string, { user_id: number; until: number; tries: number; trusted: boolean }>();
/** After the password: a ticket (5 minutes, 5 tries) to finish signing in with the code. */
export function secondStepTicket(userId: number, trusted = false): string {
  const t = crypto.randomBytes(24).toString('base64url');
  for (const [k, v] of tickets) if (v.until < Date.now()) tickets.delete(k);
  tickets.set(t, { user_id: userId, until: Date.now() + 5 * 60_000, tries: 0, trusted });
  return t;
}

/** The username a sign-in ticket is for (to count a wrong code against it). */
export const ticketUsername = (ticket: string) => {
  const t = tickets.get(ticket);
  return t ? get<{ username: string }>('SELECT username FROM users WHERE id = ?', t.user_id)?.username : undefined;
};

let secretWarned = false;
/** An account's two-step secret, opened with this Canon's keys (null when it has none, or they can't open it). */
export function totpSecretOf(userId: number): string | null {
  const s = get<{ totp_secret: string | null }>('SELECT totp_secret FROM users WHERE id = ?', userId)?.totp_secret;
  if (!s) return null;
  try {
    return openField(s, currentFieldKey());
  } catch {
    // sealed by another Canon's keys and not sealed again (see resealTotpSecrets): the account's recovery codes still work
    if (!secretWarned) console.error('Two-step sign-in: a secret could not be opened with this Canon’s keys. Those accounts sign in with a recovery code, or an administrator resets their two-step sign-in.');
    secretWarned = true;
    return null;
  }
}

/**
 * Finish signing in with the authenticator code, or a one-time recovery code (used up; the person is told). An
 * authenticator code works once: one seen over someone's shoulder can't sign in again while it is still current
 * (0.19.8 review).
 */
export function secondStep(ticket: string, code: string, ip?: string): User | null {
  const t = tickets.get(ticket);
  if (!t || t.until < Date.now() || t.tries >= 5) {
    tickets.delete(ticket);
    return null;
  }
  t.tries++;
  const row = get<{ totp_secret: string | null; recovery_codes: string; locked_until: string | null }>('SELECT totp_secret, recovery_codes, locked_until FROM users WHERE id = ?', t.user_id);
  if (!row?.totp_secret) return null;
  if (!t.trusted && waiting(row)) {
    tickets.delete(ticket);
    return null;
  }
  const secret = totpSecretOf(t.user_id);
  const step = secret ? totpStep(secret, code) : null;
  let ok = step !== null && useTotpStep(t.user_id, step);
  if (!ok) {
    const codes = JSON.parse(row.recovery_codes || '[]') as string[];
    const i = matchRecoveryCode(code, codes);
    if (i >= 0) {
      codes.splice(i, 1);
      run('UPDATE users SET recovery_codes = ? WHERE id = ?', JSON.stringify(codes), t.user_id);
      ok = true;
      // a recovery code is for a lost phone: if it wasn't them, they need to know at once
      notifyAccount(t.user_id, 'recovery_code_used', { ip: ip ?? null, left: codes.length });
    }
  }
  if (!ok) {
    if (!t.trusted) failedFor(t.user_id);
    return null;
  }
  tickets.delete(ticket);
  run('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?', t.user_id);
  return getUser(t.user_id) ?? null;
}

/** Record an authenticator code's time step as used; false when it (or a later one) already was. */
export const useTotpStep = (userId: number, step: number) =>
  run('UPDATE users SET totp_last_step = ? WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)', step, userId, step).changes > 0;

// ---- sessions -----------------------------------------------------------------------

export function startSession(req: Request, res: Response, user: User) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(18).toString('base64url');
  run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", user.id);
  run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  run('INSERT INTO sessions (token_hash, user_id, csrf, expires_at) VALUES (?,?,?,?)',
    sha256(token), user.id, csrf, Date.now() + SESSION_DAYS * 86400_000);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // https connections (directly or via a trusted tunnel) get a Secure cookie; plain-http LAN access still works
    secure: req.secure,
    maxAge: SESSION_DAYS * 86400_000,
    path: '/',
  });
  rememberDevice(req, res, user.id);
  return csrf;
}

export function endSession(req: Request, res: Response) {
  const t = readCookie(req, COOKIE);
  if (t) run('DELETE FROM sessions WHERE token_hash = ?', sha256(t));
  res.clearCookie(COOKIE, { path: '/' });
}

/**
 * End an account's sessions (a new password, two-step sign-in turned on or off or reset): all of them, or all but the
 * one this request comes from (the person who made the change stays signed in there).
 */
export function endSessionsOf(userId: number, keep?: Request) {
  const t = keep && readCookie(keep, COOKIE);
  if (t) run('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', userId, sha256(t));
  else run('DELETE FROM sessions WHERE user_id = ?', userId);
}

function readCookie(req: Request, name: string): string | undefined {
  const h = req.headers.cookie;
  if (!h) return undefined;
  for (const part of h.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function sessionUser(req: Request): (User & { csrf: string }) | null {
  const t = readCookie(req, COOKIE);
  if (!t) return null;
  const s = get<{ user_id: number; csrf: string; expires_at: number }>(
    'SELECT user_id, csrf, expires_at FROM sessions WHERE token_hash = ?', sha256(t),
  );
  if (!s || s.expires_at < Date.now()) return null;
  const u = getUser(s.user_id);
  return u ? { ...u, csrf: s.csrf } : null;
}

/** The request carries the session's CSRF token (compared in constant time: 0.19.9 review). */
export const csrfOk = (req: Request, u: { csrf: string }) => sameSecret(req.get('x-csrf-token') ?? '', u.csrf);

declare module 'express-serve-static-core' {
  interface Request {
    user?: User & { csrf: string };
  }
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Require a signed-in user. Changes need the session's CSRF token. Every request is then checked against what the
 * account's role allows for that part of Canon (lib/permissions.ts); a read-only account may still record the
 * meetings its member leads (lib/leaders.ts).
 */
export function requireUser(req: Request, res: Response, next: NextFunction) {
  const u = sessionUser(req);
  if (!u) return res.status(401).json({ error: 'Not signed in' });
  if (!SAFE.has(req.method) && !csrfOk(req, u)) return res.status(403).json({ error: 'Bad CSRF token' });
  // a part of Canon the church has switched off (Settings → Modules) is not there at all
  if (moduleOff(req.method, req.path, getSettings().modules) || (getSettings().modules.meetings === false && meetingPath(req.path))) {
    return res.status(404).json({ error: 'This part of Canon is turned off (Settings → Modules).' });
  }
  // an administrator chose this account's password: the person changes it before anything else
  if (u.must_change_password && !PASSWORD_CHANGE(req.method, req.path)) {
    return res.status(403).json({ error: 'Choose a new password first (Settings → My profile): an administrator set this one.', code: 'password_change_required' });
  }
  // the church requires two-step sign-in (for everyone, or for administrators): set it up before anything else
  if (!u.totp_enabled && twoStepRequired(u) && !TWO_STEP_SETUP(req.method, req.path)) {
    const who = getSettings().security.require_all_2fa ? 'every account' : 'administrators';
    return res.status(403).json({ error: `Set up two-step sign-in first (Settings → My profile): this church requires it for ${who}.`, code: 'two_step_required' });
  }
  const why = gateRequest(u, req.method, req.path);
  // a leader's exception (recording their own meeting) is for a role Canon knows: an unknown one gets nothing
  if (why && !(!SAFE.has(req.method) && !roleDef(u.role).unknown && leaderMayWrite(u.person_id, req))) return res.status(403).json({ error: why });
  // an account limited to one congregation can't reach another congregation's items (lib/walls.ts)
  if (outsideWall(wallOf(u), req.path)) return res.status(404).json({ error: 'Not found' });
  req.user = u;
  next();
}

/** The congregation an account is limited to (administrators never are). */
export const wallOf = (u: { role: string; congregation_id?: number | null } | null | undefined) => (!u || isAdmin(u) ? null : u.congregation_id ?? null);

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Administrators only' });
  // the church can require two-step sign-in for administrators (Settings → Security & privacy)
  if (twoStepRequired(req.user) && !req.user?.totp_enabled) {
    return res.status(403).json({ error: 'Set up two-step sign-in first (Settings → My profile): this church requires it for administrators.' });
  }
  next();
}

/** Must this account use two-step sign-in? The church requires it for administrators, or for every account. */
export function twoStepRequired(u: { role: string } | null | undefined): boolean {
  const s = getSettings().security;
  return !!u && (!!s.require_all_2fa || (!!s.require_admin_2fa && isAdmin(u)));
}

/** While an account that must use two-step sign-in hasn't set it up, it can only do that (and read the settings). */
const TWO_STEP_SETUP = (method: string, path: string) =>
  (method === 'POST' && (path === '/me/two-step/setup' || path === '/me/two-step/enable')) || (method === 'GET' && path === '/settings') || (method === 'PATCH' && path === '/me');

/** While an account must change its password, it can only do that (and read the settings, and its notices). */
const PASSWORD_CHANGE = (method: string, path: string) =>
  (method === 'PATCH' && path === '/me') || (method === 'GET' && path === '/settings') || (method === 'POST' && path === '/me/notices/seen');

/**
 * Every account belongs to a church member (Settings → User accounts → Member), except an external guest's
 * (read-only, e.g. an auditor) and — with a reminder until they do — the first administrator's.
 */
export function memberLinkProblem(uid: number | null, role: string, personId: number | null | undefined): string | null {
  if (personId || role === GUEST_ROLE || (uid !== null && uid === firstAdminId())) return null;
  return 'Link the account to a church member (choose them under Member). Only an external guest account is without one.';
}

/** The member an account is linked to: someone on the register, not erased, not already another account's. */
export function personLinkProblem(personId: number, uid: number | null): string | null {
  const p = get<{ erased_at: string | null }>('SELECT erased_at FROM people WHERE id = ?', personId);
  if (!p) return 'That member does not exist.';
  if (p.erased_at) return 'That member’s personal data was erased.';
  const other = get<{ display_name: string }>('SELECT display_name FROM users WHERE person_id = ? AND id IS NOT ?', personId, uid);
  return other ? `That member already has an account (${other.display_name}).` : null;
}

/**
 * The first administrator (who set Canon up): the one account that may stay unlinked to a member (with a reminder).
 * Recorded at setup; for a Canon set up before 0.15, the oldest administrator account.
 */
export function firstAdminId(): number | null {
  const m = Number(getMeta('first_admin_id'));
  if (m && get('SELECT 1 FROM users WHERE id = ?', m)) return m;
  return get<{ id: number }>("SELECT MIN(id) AS id FROM users WHERE role = 'admin'")?.id ?? null;
}

// ---- sign-in throttling (per address, in memory) ---------------------------------------

// Eight wrong passwords or codes from one address within 15 minutes, and that address waits. Signing in forgives only
// the wrong tries at that same account (a typo, then the right password): signing in to one's own account between
// guesses at others used to wipe the address's count, so one account was enough to guess on forever (0.19.8 review).
const signIns = makeLimiter(8, 15 * 60_000);
const accountTag = (username: string | undefined) => (username ?? '').trim().toLowerCase();
export const loginThrottle = (ip: string) => signIns.over(addressKey(ip));
/** Seconds until this address may try again (Retry-After). */
export const loginRetryAfter = (ip: string) => signIns.retryAfter(addressKey(ip));
export const loginFailed = (ip: string, username: string | undefined) => signIns.add(addressKey(ip), username ? accountTag(username) : undefined);
export const loginOk = (ip: string, username: string) => signIns.forgive(addressKey(ip), accountTag(username));
