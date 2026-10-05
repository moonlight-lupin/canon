// Staff accounts, password hashing, cookie sessions and role checks for the web app.
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Role } from '../shared/types.ts';
import { all, get, run } from './db.ts';
import { config } from './config.ts';
import { leaderMayWrite } from './lib/leaders.ts';

export interface User {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  lang: string;
  /** the member this account belongs to (meeting leaders record the meetings they lead) */
  person_id?: number | null;
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
  get<User>('SELECT id, username, display_name, role, lang, person_id FROM users WHERE id = ?', id);
export const listUsers = () => all<User & { created_at: string; person_name: string | null }>(
  `SELECT u.id, u.username, u.display_name, u.role, u.lang, u.created_at, u.person_id,
          CASE WHEN p.id IS NOT NULL THEN TRIM(IFNULL(p.preferred_name, p.first_name) || ' ' || p.last_name) END AS person_name
   FROM users u LEFT JOIN people p ON p.id = u.person_id ORDER BY u.id`,
);

export function authenticate(username: string, password: string): User | null {
  const row = get<User & { password_hash: string }>('SELECT * FROM users WHERE username = ?', username.trim());
  // Always run scrypt to keep timing similar for unknown users
  const ok = verifyPassword(password, row?.password_hash ?? hashPassword('x-dummy-password'));
  return row && ok ? getUser(row.id)! : null;
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

/** Require a logged-in user; mutating requests also need the session's CSRF token and a non-viewer role. */
export function requireUser(req: Request, res: Response, next: NextFunction) {
  const u = sessionUser(req);
  if (!u) return res.status(401).json({ error: 'Not signed in' });
  if (!SAFE.has(req.method)) {
    if (req.get('x-csrf-token') !== u.csrf) return res.status(403).json({ error: 'Bad CSRF token' });
    // viewers may still update their own profile (language, password), and record the meetings they lead
    if (u.role === 'viewer' && req.path !== '/me' && !leaderMayWrite(u.person_id, req)) return res.status(403).json({ error: 'Read-only account' });
  }
  req.user = u;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Administrators only' });
  next();
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
