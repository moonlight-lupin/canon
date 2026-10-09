// Signing in (0.13): five wrong passwords lock an account for a while; two-step sign-in with an authenticator code or
// a one-time recovery code; a church can require it for administrators. Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-signin-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const T = await import('../server/lib/totp.ts');
const { db, get } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Session = { cookie: string; csrf: string };
let server: Server;
let base = '';

const post = async (url: string, body: unknown, who?: Session) => {
  const r = await fetch(`${base}/api${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(who ? { Cookie: who.cookie, 'X-CSRF-Token': who.csrf } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => null)) as Json, cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') };
};
const call = async (who: Session, method: string, url: string, body?: unknown) => {
  const r = await fetch(`${base}/api${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: who.cookie, 'X-CSRF-Token': who.csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => null)) as Json };
};
async function login(username: string, password = 'correct-horse-3'): Promise<Session> {
  const r = await post('/login', { username, password });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { cookie: r.cookie, csrf: r.body.csrf };
}

before(async () => {
  for (const [u, role] of [['boss', 'admin'], ['boss2', 'admin'], ['ed', 'editor'], ['locky', 'viewer']] as const) createUser({ username: u, display_name: `Test ${u}`, password: 'correct-horse-3', role });
  server = createApp().listen(0, '127.0.0.1');
  // a full parallel test run is slow: idle connections stay open for the next request (no reset mid-test)
  server.keepAliveTimeout = 120_000;
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('five wrong passwords lock the account for a while — even the right password; a new password unlocks it', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await post('/login', { username: 'locky', password: 'wrong-wrong' })).status, 401);
  const locked = await post('/login', { username: 'locky', password: 'correct-horse-3' });
  // the same answer as a wrong password: nobody learns from it which usernames exist (0.19.0 review)
  assert.equal(locked.status, 401);
  assert.equal(locked.body.error, (await post('/login', { username: 'nobody-by-this-name', password: 'x' })).body.error);
  assert.match(locked.body.error, /waits 15 minutes/);
  const boss = await login('boss');
  const id = (await call(boss, 'GET', '/users')).body.find((u: Json) => u.username === 'locky').id;
  assert.ok((await call(boss, 'GET', '/users')).body.find((u: Json) => u.username === 'locky').locked);
  assert.equal((await call(boss, 'PATCH', `/users/${id}`, { password: 'correct-horse-4' })).status, 200);
  await login('locky', 'correct-horse-4');
});

test('two-step sign-in: set up with an authenticator, then a code (or a recovery code) after the password', async () => {
  const ed = await login('ed');
  const setup = await call(ed, 'POST', '/me/two-step/setup', {});
  assert.equal(setup.status, 200);
  assert.match(setup.body.uri, /^otpauth:\/\/totp\//);
  assert.match(setup.body.qr, /^data:image\/png;base64,/);
  assert.equal((await call(ed, 'POST', '/me/two-step/enable', { code: '000000' })).status, 400);
  const on = await call(ed, 'POST', '/me/two-step/enable', { code: T.totp(setup.body.secret) });
  assert.equal(on.status, 200);
  assert.equal(on.body.recovery_codes.length, 8);
  // the password alone no longer signs in
  const step1 = await post('/login', { username: 'ed', password: 'correct-horse-3' });
  assert.equal(step1.body.second_step, true);
  assert.equal(step1.body.csrf, undefined);
  assert.equal((await post('/login/code', { ticket: step1.body.ticket, code: '123456' })).status, 401);
  // a code works once (0.19.8): the one that turned it on can't sign in, the next one can
  assert.equal((await post('/login/code', { ticket: step1.body.ticket, code: T.totp(setup.body.secret) })).status, 401);
  const done = await post('/login/code', { ticket: step1.body.ticket, code: T.totp(setup.body.secret, Date.now() + 30_000) });
  assert.equal(done.status, 200);
  assert.ok(done.body.csrf);
  // a recovery code works once
  const again = await post('/login', { username: 'ed', password: 'correct-horse-3' });
  assert.equal((await post('/login/code', { ticket: again.body.ticket, code: on.body.recovery_codes[0] })).status, 200);
  const third = await post('/login', { username: 'ed', password: 'correct-horse-3' });
  assert.equal((await post('/login/code', { ticket: third.body.ticket, code: on.body.recovery_codes[0] })).status, 401, 'used up');
  // turning it off needs the password
  const s = { cookie: done.cookie, csrf: done.body.csrf };
  assert.equal((await call(s, 'POST', '/me/two-step/disable', { password: 'nope' })).status, 400);
  assert.equal((await call(s, 'POST', '/me/two-step/disable', { password: 'correct-horse-3' })).status, 200);
  assert.ok((await post('/login', { username: 'ed', password: 'correct-horse-3' })).body.csrf);
});

test('a church can require two-step sign-in for administrators; an administrator resets a lost phone', async () => {
  const boss = await login('boss');
  assert.equal((await call(boss, 'PUT', '/security', { require_admin_2fa: true })).status, 400, 'only once you use it yourself');
  const setup = (await call(boss, 'POST', '/me/two-step/setup', {})).body;
  await call(boss, 'POST', '/me/two-step/enable', { code: T.totp(setup.secret) });
  const step = await post('/login', { username: 'boss', password: 'correct-horse-3' });
  const r = await post('/login/code', { ticket: step.body.ticket, code: T.totp(setup.secret, Date.now() + 30_000) });
  const boss2fa = { cookie: r.cookie, csrf: r.body.csrf };
  assert.equal((await call(boss2fa, 'PUT', '/security', { require_admin_2fa: true })).status, 200);
  // the other administrator can't use administrator functions until they set it up
  const boss2 = await login('boss2');
  const refused = await call(boss2, 'GET', '/users');
  assert.equal(refused.status, 403);
  assert.match(refused.body.error, /two-step/);
  // a lost phone: another administrator resets it
  const edId = get<{ id: number }>("SELECT id FROM users WHERE username = 'ed'")!.id;
  const ed = await login('ed');
  const s2 = (await call(ed, 'POST', '/me/two-step/setup', {})).body;
  await call(ed, 'POST', '/me/two-step/enable', { code: T.totp(s2.secret) });
  assert.equal((await call(boss2fa, 'PATCH', `/users/${edId}`, { reset_two_step: true })).status, 200);
  assert.ok((await post('/login', { username: 'ed', password: 'correct-horse-3' })).body.csrf, 'password alone again');
  await call(boss2fa, 'PUT', '/security', { require_admin_2fa: false });
});

test('guessing the two-step code locks the account like wrong passwords; setting it up again while it is on is refused; signing out needs the session (0.19.0 review)', async () => {
  createUser({ username: 'guessy', display_name: 'Test guessy', password: 'correct-horse-3', role: 'editor' });
  const g = await login('guessy');
  const setup = (await call(g, 'POST', '/me/two-step/setup', {})).body;
  assert.equal((await call(g, 'POST', '/me/two-step/enable', { code: T.totp(setup.secret) })).status, 200);
  // set up again while on: refused (it would have switched it off without the password)
  assert.equal((await call(g, 'POST', '/me/two-step/setup', {})).status, 409);
  // the password is known, the phone is not: a new ticket for every guess still counts against the account
  const wrong = (n: string) => (n === '000000' ? '111111' : '000000');
  for (let i = 0; i < 5; i++) {
    const t = await post('/login', { username: 'guessy', password: 'correct-horse-3' });
    assert.equal(t.body.second_step, true, JSON.stringify(t.body));
    assert.equal((await post('/login/code', { ticket: t.body.ticket, code: wrong(T.totp(setup.secret)) })).status, 401);
  }
  // locked: the right password and the right code don't sign in now
  const after5 = await post('/login', { username: 'guessy', password: 'correct-horse-3' });
  assert.equal(after5.status, 401, 'locked');
  // signing out: only with the session's own token
  const ed = await login('ed');
  assert.ok(ed.csrf, 'a session (two-step sign-in is off for this account)');
  const noToken = await fetch(`${base}/api/logout`, { method: 'POST', headers: { Cookie: ed.cookie } });
  assert.equal(noToken.status, 403);
  assert.ok((await call(ed, 'GET', '/me')).body.user, 'still signed in');
  assert.equal((await post('/logout', {}, ed)).status, 200);
  assert.equal((await call(ed, 'GET', '/me')).body.user, null, 'signed out');
});
