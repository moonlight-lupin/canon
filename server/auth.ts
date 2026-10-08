// Staff accounts, password hashing, cookie sessions and role checks for the web app.
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Role } from '../shared/types.ts';
import { all, get, run } from './db.ts';
import { config } from './config.ts';
import { leaderMayWrite } from './lib/leaders.ts';
import { gateRequest, isAdmin, meetingPath } from './lib/permissions.ts';
import { outsideWall } from './lib/walls.ts';
import { moduleOff } from '../shared/modules.ts';
import { GUEST_ROLE } from '../shared/permissions.ts';
import { getMeta, getSettings } from './repo/settings.ts';
import { hashCode, verifyTotp } from './lib/totp.ts';

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
}

// Cookies are scoped by host, not port: include the port so several Canon instances on one machine don't sign each other out.
const COOKIE = `canon_session_${config.port}`;
const SESSION_DAYS = 14;

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, n, salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, got);
}

export const userCount = () => get<{ n: number }>('SELECT COUNT(*) n FROM users')!.n;

export function createUser(u: { username: string; display_name: string; password: string; role: Role }) {
  if (u.password.length < 8) throw Object.assign(new Error('Password must be at least 8 characters'), { status: 400 });
  const r = run(
    'INSERT INTO users (username, display_name, password_hash, role) VALUES (?,?,?,?)',
    u.username.trim(), u.display_name.trim(), hashPassword(u.password), u.role,
  );
  return getUser(Number(r.lastInsertRowid))!;
}

export const getUser = (id: number) =>
  get<User>('SELECT id, username, display_name, role, lang, person_id, congregation_id, totp_enabled = 1 AS totp_enabled FROM users WHERE id = ?', id);
export const listUsers = () => {
  const first = firstAdminId();
  return listUserRows().map((u) => ({ ...u, first_admin: u.id === first, needs_member: !!memberLinkProblem(u.id, u.role, u.person_id) }));
};
const listUserRows = () => all<User & { created_at: string; person_name: string | null }>(
  `SELECT u.id, u.username, u.display_name, u.role, u.lang, u.created_at, u.person_id, u.congregation_id, u.totp_enabled = 1 AS totp_enabled,
          u.locked_until > strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS locked,
          CASE WHEN p.id IS NOT NULL THEN TRIM(IFNULL(p.preferred_name, p.first_name) || ' ' || p.last_name) END AS person_name
   FROM users u LEFT JOIN people p ON p.id = u.person_id ORDER BY u.id`,
);

/** Wrong passwords in a row before an account is locked, and for how long. */
export const MAX_FAILED = 5;
export const LOCK_MINUTES = 15;

export type SignIn = { user: User } | { locked: true } | { second_step: number } | null;

/**
 * Check a username and password. Five wrong passwords in a row lock the account for 15 minutes (a correct one resets
 * the count); an account with two-step sign-in needs its code next (second_step = the account).
 */
export function authenticate(username: string, password: string): SignIn {
  const row = get<Omit<User, 'totp_enabled'> & { password_hash: string; failed_logins: number; locked_until: string | null; totp_enabled: number }>('SELECT * FROM users WHERE username = ?', username.trim());
  // Always run scrypt to keep timing similar for unknown users
  const ok = verifyPassword(password, row?.password_hash ?? hashPassword('x-dummy-password'));
  if (!row) return null;
  if (row.locked_until && row.locked_until > new Date().toISOString()) return { locked: true };
  if (!ok) {
    const n = row.failed_logins + 1;
    if (n >= MAX_FAILED) run('UPDATE users SET failed_logins = 0, locked_until = ? WHERE id = ?', new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString(), row.id);
    else run('UPDATE users SET failed_logins = ? WHERE id = ?', n, row.id);
    return null;
  }
  // with two-step sign-in, the count goes on until the code is right too: a known password and a loop of guesses at
  // the code still lock the account (0.19.0 review)
  if (row.totp_enabled) return { second_step: row.id };
  run('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?', row.id);
  return { user: getUser(row.id)! };
}

/** A wrong code (or password) for this account: five in a row lock it for 15 minutes. */
function failedFor(userId: number) {
  const row = get<{ failed_logins: number }>('SELECT failed_logins FROM users WHERE id = ?', userId);
  const n = (row?.failed_logins ?? 0) + 1;
  if (n >= MAX_FAILED) run('UPDATE users SET failed_logins = 0, locked_until = ? WHERE id = ?', new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString(), userId);
  else run('UPDATE users SET failed_logins = ? WHERE id = ?', n, userId);
}

// ---- two-step sign-in -----------------------------------------------------------------

const tickets = new Map<string, { user_id: number; until: number; tries: number }>();
/** After the password: a ticket (5 minutes, 5 tries) to finish signing in with the code. */
export function secondStepTicket(userId: number): string {
  const t = crypto.randomBytes(24).toString('base64url');
  for (const [k, v] of tickets) if (v.until < Date.now()) tickets.delete(k);
  tickets.set(t, { user_id: userId, until: Date.now() + 5 * 60_000, tries: 0 });
  return t;
}

/** Finish signing in with the authenticator code, or a one-time recovery code (used up). */
export function secondStep(ticket: string, code: string): User | null {
  const t = tickets.get(ticket);
  if (!t || t.until < Date.now() || t.tries >= 5) {
    tickets.delete(ticket);
    return null;
  }
  t.tries++;
  const row = get<{ totp_secret: string | null; recovery_codes: string; locked_until: string | null }>('SELECT totp_secret, recovery_codes, locked_until FROM users WHERE id = ?', t.user_id);
  if (!row?.totp_secret) return null;
  if (row.locked_until && row.locked_until > new Date().toISOString()) {
    tickets.delete(ticket);
    return null;
  }
  let ok = verifyTotp(row.totp_secret, code);
  if (!ok) {
    const codes = JSON.parse(row.recovery_codes || '[]') as string[];
    const h = hashCode(code);
    if (codes.includes(h)) {
      run('UPDATE users SET recovery_codes = ? WHERE id = ?', JSON.stringify(codes.filter((c) => c !== h)), t.user_id);
      ok = true;
    }
  }
  if (!ok) {
    failedFor(t.user_id);
    return null;
  }
  tickets.delete(ticket);
  run('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?', t.user_id);
  return getUser(t.user_id) ?? null;
}

// ---- sessions -----------------------------------------------------------------------

export function startSession(req: Request, res: Response, user: User) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(18).toString('base64url');
  run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", user.id);
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
  return csrf;
}

export function endSession(req: Request, res: Response) {
  const t = readCookie(req, COOKIE);
  if (t) run('DELETE FROM sessions WHERE token_hash = ?', sha256(t));
  res.clearCookie(COOKIE, { path: '/' });
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
  if (!SAFE.has(req.method) && req.get('x-csrf-token') !== u.csrf) return res.status(403).json({ error: 'Bad CSRF token' });
  // a part of Canon the church has switched off (Settings → Modules) is not there at all
  if (moduleOff(req.method, req.path, getSettings().modules) || (getSettings().modules.meetings === false && meetingPath(req.path))) {
    return res.status(404).json({ error: 'This part of Canon is turned off (Settings → Modules).' });
  }
  // the church requires two-step sign-in (for everyone, or for administrators): set it up before anything else
  if (!u.totp_enabled && twoStepRequired(u) && !TWO_STEP_SETUP(req.method, req.path)) {
    const who = getSettings().security.require_all_2fa ? 'every account' : 'administrators';
    return res.status(403).json({ error: `Set up two-step sign-in first (Settings → My profile): this church requires it for ${who}.`, code: 'two_step_required' });
  }
  const why = gateRequest(u, req.method, req.path);
  if (why && !(!SAFE.has(req.method) && leaderMayWrite(u.person_id, req))) return res.status(403).json({ error: why });
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

// ---- crude login throttling (per IP, in memory) ---------------------------------------

const attempts = new Map<string, { n: number; until: number }>();
export function loginThrottle(ip: string): boolean {
  const a = attempts.get(ip);
  return !!a && a.n >= 8 && a.until > Date.now();
}
export function loginFailed(ip: string) {
  const a = attempts.get(ip);
  const n = a && a.until > Date.now() ? a.n + 1 : 1;
  attempts.set(ip, { n, until: Date.now() + 15 * 60_000 });
}
export const loginOk = (ip: string) => attempts.delete(ip);
