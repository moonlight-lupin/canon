// Sign-in hardening (0.19.8, from a code study of 0.19.7): one's own sign-in no longer forgives an address's wrong
// guesses at other accounts; the OAuth and MCP endpoints have limits; a full limiter drops its oldest addresses, not
// all of them; a two-step code works once; an unknown username costs what a known one does; changing a password or
// two-step sign-in ends the account's other sessions. Fictional data.
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-hardening-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');
delete process.env.CANON_PUBLIC_URL;

const { createApp } = await import('../server/app.ts');
const { createUser, authenticate } = await import('../server/auth.ts');
const { makeLimiter, addressKey } = await import('../server/lib/rate-limit.ts');
const { updateSettings, getSettings } = await import('../server/repo/settings.ts');
const T = await import('../server/lib/totp.ts');
const { db, get, run } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Session = { cookie: string; csrf: string };
let server: Server;
let base = '';

// Canon believes X-Forwarded-For only from the church's own proxy (here: this computer), so each test can play a
// visitor from its own address
const from = (ip?: string): Record<string, string> => (ip ? { 'X-Forwarded-For': ip } : {});
const post = async (url: string, body: unknown, ip?: string) => {
  const r = await fetch(`${base}/api${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...from(ip) }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => null)) as Json, cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') };
};
const call = async (who: Session, method: string, url: string, body?: unknown) => {
  const r = await fetch(`${base}/api${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: who.cookie, 'X-CSRF-Token': who.csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => null)) as Json };
};
async function login(username: string, password = 'correct-horse-3', ip?: string): Promise<Session> {
  const r = await post('/login', { username, password }, ip);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { cookie: r.cookie, csrf: r.body.csrf };
}
const signedIn = async (who: Session) => !!(await call(who, 'GET', '/me')).body?.user;
const user = (username: string, role = 'editor') => createUser({ username, display_name: `Test ${username}`, password: 'correct-horse-3', role });

before(async () => {
  updateSettings({ trust_proxy: true } as never);
  updateSettings({ mcp: { ...getSettings().mcp, enabled: true } });
  await user('boss', 'admin');
  server = createApp().listen(0, '127.0.0.1');
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

test('password spraying: signing in to one’s own account between guesses doesn’t forgive guesses at other accounts', async () => {
  const ip = '203.0.113.10';
  await user('sprayer');
  for (let i = 0; i < 9; i++) await user(`target${i}`);
  // one wrong guess at each of eight accounts (none of them locks), signing in to one's own account in between
  for (let i = 0; i < 8; i++) {
    if (i) await login('sprayer', 'correct-horse-3', ip);
    assert.equal((await post('/login', { username: `target${i}`, password: 'Summer2026!' }, ip)).status, 401, `guess ${i + 1}`);
  }
  assert.equal((await post('/login', { username: 'sprayer', password: 'correct-horse-3' }, ip)).status, 429, 'the address has had its eight wrong tries, and waits — own account or not');
  assert.equal((await post('/login', { username: 'target8', password: 'Summer2026!' }, ip)).status, 429);
  // another address is not affected
  await login('sprayer', 'correct-horse-3', '203.0.113.11');
});

test('someone who mistypes their own password and then gets it right is forgiven those tries', async () => {
  const ip = '203.0.113.20';
  await user('typo');
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 4; i++) assert.equal((await post('/login', { username: 'TYPO', password: 'correct-horse-4' }, ip)).status, 401);
    await login('typo', 'correct-horse-3', ip);
  }
});

test('the two-step code step counts towards the address too, and the right code forgives only that account', async () => {
  const ip = '203.0.113.30';
  await user('coder');
  const s = await login('coder', 'correct-horse-3', ip);
  const setup = (await call(s, 'POST', '/me/two-step/setup', {})).body;
  assert.equal((await call(s, 'POST', '/me/two-step/enable', { code: T.totp(setup.secret), password: 'correct-horse-3' })).status, 200);
  for (let i = 0; i < 7; i++) assert.equal((await post('/login', { username: `nobody${i}`, password: 'x' }, ip)).status, 401);
  const t = await post('/login', { username: 'coder', password: 'correct-horse-3' }, ip);
  assert.equal((await post('/login/code', { ticket: t.body.ticket, code: 'abc' }, ip)).status, 401, 'eighth wrong try');
  assert.equal((await post('/login/code', { ticket: t.body.ticket, code: T.totp(setup.secret, Date.now() + 30_000) }, ip)).status, 429);
});

test('the OAuth endpoints and the MCP endpoint have limits per address', async () => {
  // made-up bearer tokens at /mcp: 401 until the address has had its tries, then 429
  const mcp = (ip: string) => fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer made-up-${crypto.randomUUID()}`, ...from(ip) }, body: '{}' });
  for (let i = 0; i < 30; i++) assert.equal((await mcp('203.0.113.40')).status, 401, `token ${i + 1}`);
  assert.equal((await mcp('203.0.113.40')).status, 429);
  assert.equal((await mcp('203.0.113.41')).status, 401, 'another address still gets an answer');
  // no token at all is how a connector discovers where to sign in: not counted
  for (let i = 0; i < 40; i++) assert.equal((await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...from('203.0.113.42') }, body: '{}' })).status, 401);

  // made-up codes at the token endpoint
  const token = (ip: string) => fetch(`${base}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...from(ip) }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: 'canon-made-up', code: crypto.randomUUID(), code_verifier: 'x'.repeat(43) }) });
  for (let i = 0; i < 30; i++) assert.equal((await token('203.0.113.43')).status, 401, `try ${i + 1}`);
  const limited = await token('203.0.113.43');
  assert.equal(limited.status, 429);
  assert.equal(((await limited.json()) as Json).error, 'too_many_requests');

  // the authorization page
  const authorize = (ip: string) => fetch(`${base}/oauth/authorize?client_id=canon-made-up`, { headers: from(ip), redirect: 'manual' });
  for (let i = 0; i < 60; i++) assert.equal((await authorize('203.0.113.44')).status, 400, `page ${i + 1}`);
  assert.equal((await authorize('203.0.113.44')).status, 429);
});

test('a limiter that is full drops its oldest addresses, not everyone’s counts', () => {
  const l = makeLimiter(1, 60_000, 100);
  for (let i = 0; i < 100; i++) assert.equal(l.limited(`198.51.100.${i}`), false);
  for (let i = 0; i < 100; i++) assert.equal(l.limited(`198.51.100.${i}`), true, 'each has had its one');
  // a hundred new addresses push out the hundred oldest, one at a time; the rest keep their counts
  for (let i = 0; i < 50; i++) l.limited(`192.0.2.${i}`);
  assert.ok(l.size() <= 100, `size ${l.size()}`);
  assert.equal(l.limited('198.51.100.99'), true, 'a recent address is still counted');
  assert.equal(l.limited('198.51.100.0'), false, 'the oldest went first');
  // the OAuth client registration limit uses it too
  const src = fs.readFileSync(path.join(import.meta.dirname, '../server/oauth.ts'), 'utf8');
  assert.doesNotMatch(src, /\.clear\(\)/, 'no limiter in oauth.ts is wiped');
});

test('an IPv6 visitor is counted by their /64 network (a home or church gets a whole one, and could rotate through it)', () => {
  assert.equal(addressKey('2001:db8:1:2:aaaa::1'), addressKey('2001:db8:1:2:bbbb:cccc:dddd:2'));
  assert.notEqual(addressKey('2001:db8:1:2::1'), addressKey('2001:db8:1:3::1'));
  assert.equal(addressKey('2001:db8::1'), addressKey('2001:0db8:0000:0000:ffff::9'));
  assert.equal(addressKey('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(addressKey('203.0.113.9'), '203.0.113.9');
  assert.equal(addressKey('::1'), addressKey('::1'));
  assert.equal(addressKey(undefined), '');
});

test('a two-step code works once: the same code can’t sign in again, the next one can', async () => {
  await user('tina');
  const s = await login('tina', 'correct-horse-3', '203.0.113.50');
  const setup = (await call(s, 'POST', '/me/two-step/setup', {})).body;
  const now = Date.now();
  assert.equal((await call(s, 'POST', '/me/two-step/enable', { code: T.totp(setup.secret, now), password: 'correct-horse-3' })).status, 200);
  const ticket = async () => (await post('/login', { username: 'tina', password: 'correct-horse-3' }, '203.0.113.51')).body.ticket as string;
  // the code just used to turn it on can't sign in
  assert.equal((await post('/login/code', { ticket: await ticket(), code: T.totp(setup.secret, now) }, '203.0.113.51')).status, 401, 'used to turn it on');
  // the next code (one step ahead, allowed for a phone clock that is a little fast) signs in, once
  const next = T.totp(setup.secret, now + 30_000);
  assert.equal((await post('/login/code', { ticket: await ticket(), code: next }, '203.0.113.51')).status, 200);
  assert.equal((await post('/login/code', { ticket: await ticket(), code: next }, '203.0.113.52')).status, 401, 'seen on someone’s screen, typed again');
  // and nor can an older code still inside the window
  assert.equal((await post('/login/code', { ticket: await ticket(), code: T.totp(setup.secret, now - 30_000) }, '203.0.113.52')).status, 401);
  assert.ok(get<{ totp_last_step: number }>("SELECT totp_last_step FROM users WHERE username = 'tina'")!.totp_last_step > 0);
});

test('an unknown username costs one password check, like a known one', async () => {
  await user('known');
  const scrypt = mock.method(crypto, 'scrypt');
  try {
    await authenticate('no-such-person', 'whatever-1');
    assert.equal(scrypt.mock.callCount(), 1, 'unknown username');
    scrypt.mock.resetCalls();
    await authenticate('known', 'whatever-1');
    assert.equal(scrypt.mock.callCount(), 1, 'known username');
  } finally {
    scrypt.mock.restore();
  }
});

test('changing one’s password ends one’s other sessions; this one stays', async () => {
  await user('pat');
  const here = await login('pat', 'correct-horse-3', '203.0.113.60');
  const phone = await login('pat', 'correct-horse-3', '203.0.113.61');
  assert.equal((await call(here, 'PATCH', '/me', { current_password: 'correct-horse-3', new_password: 'correct-horse-9' })).status, 200);
  assert.equal(await signedIn(here), true, 'the session that changed it');
  assert.equal(await signedIn(phone), false, 'every other session');
  // a language change is not a credential change: sessions stay
  const phone2 = await login('pat', 'correct-horse-9', '203.0.113.61');
  assert.equal((await call(here, 'PATCH', '/me', { lang: 'en' })).status, 200);
  assert.equal(await signedIn(phone2), true);
});

test('turning one’s own two-step sign-in on or off ends one’s other sessions', async () => {
  await user('quin');
  const here = await login('quin', 'correct-horse-3', '203.0.113.62');
  const other = await login('quin', 'correct-horse-3', '203.0.113.63');
  const setup = (await call(here, 'POST', '/me/two-step/setup', {})).body;
  assert.equal((await call(here, 'POST', '/me/two-step/enable', { code: T.totp(setup.secret), password: 'correct-horse-3' })).status, 200);
  assert.equal(await signedIn(here), true);
  assert.equal(await signedIn(other), false, 'on');
  const t = await post('/login', { username: 'quin', password: 'correct-horse-3' }, '203.0.113.63');
  const r = await post('/login/code', { ticket: t.body.ticket, code: T.totp(setup.secret, Date.now() + 30_000) }, '203.0.113.63');
  assert.equal(r.status, 200);
  const other2 = { cookie: r.cookie, csrf: r.body.csrf };
  assert.equal((await call(here, 'POST', '/me/two-step/disable', { password: 'correct-horse-3' })).status, 200);
  assert.equal(await signedIn(here), true);
  assert.equal(await signedIn(other2), false, 'off');
});

test('an administrator resetting someone’s password or two-step sign-in ends that person’s sessions (not their own)', async () => {
  const boss = await login('boss', 'correct-horse-3', '203.0.113.70');
  const bossElsewhere = await login('boss', 'correct-horse-3', '203.0.113.71');
  await user('rae');
  const raeId = get<{ id: number }>("SELECT id FROM users WHERE username = 'rae'")!.id;
  const bossId = get<{ id: number }>("SELECT id FROM users WHERE username = 'boss'")!.id;
  // two-step reset (a lost phone — or a stolen one)
  let rae = await login('rae', 'correct-horse-3', '203.0.113.72');
  const setup = (await call(rae, 'POST', '/me/two-step/setup', {})).body;
  assert.equal((await call(rae, 'POST', '/me/two-step/enable', { code: T.totp(setup.secret), password: 'correct-horse-3' })).status, 200);
  assert.equal((await call(boss, 'PATCH', `/users/${raeId}`, { reset_two_step: true })).status, 200);
  assert.equal(await signedIn(rae), false, 'two-step reset');
  // password reset
  rae = await login('rae', 'correct-horse-3', '203.0.113.72');
  assert.equal((await call(boss, 'PATCH', `/users/${raeId}`, { password: 'correct-horse-5' })).status, 200);
  assert.equal(await signedIn(rae), false, 'password reset');
  // an administrator resetting their own password in the list keeps the session they did it from
  assert.equal((await call(boss, 'PATCH', `/users/${bossId}`, { password: 'correct-horse-6' })).status, 200);
  assert.equal(await signedIn(boss), true, 'this session');
  assert.equal(await signedIn(bossElsewhere), false, 'their other sessions');
  // resetting two-step for an account that doesn't exist changes nothing and says so
  assert.equal((await call(boss, 'PATCH', '/users/999999', { reset_two_step: true })).status, 404);
});

test('expired sessions are cleared away', async () => {
  const uid = get<{ id: number }>("SELECT id FROM users WHERE username = 'boss'")!.id;
  run('INSERT INTO sessions (token_hash, user_id, csrf, expires_at) VALUES (?,?,?,?)', 'expired-session-for-test', uid, 'x', Date.now() - 1000);
  await login('boss', 'correct-horse-6', '203.0.113.73');
  assert.equal(get('SELECT 1 AS x FROM sessions WHERE token_hash = ?', 'expired-session-for-test'), undefined);
});

test('an administrator resetting someone’s password or two-step sign-in also disconnects that person’s AI assistants', async () => {
  const { sha256 } = await import('../server/auth.ts');
  const boss = await login('boss', 'correct-horse-6', '203.0.113.80');
  await user('sam');
  await user('uma');
  const idOf = (u: string) => get<{ id: number }>('SELECT id FROM users WHERE username = ?', u)!.id;
  // a connection (as claude.ai would have after the person approved it): an access token and its refresh token
  const connect = (uid: number) => {
    const access = `access-${crypto.randomUUID()}`;
    const grant = crypto.randomUUID();
    const ins = 'INSERT INTO oauth_tokens (token_hash, token_type, client_id, user_id, scope, resource, grant_id, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)';
    run(ins, sha256(access), 'access', 'canon-test-client', uid, 'canon:read', null, grant, Date.now() + 3600_000, Date.now());
    run(ins, sha256(`refresh-${grant}`), 'refresh', 'canon-test-client', uid, 'canon:read', null, grant, Date.now() + 30 * 86400_000, Date.now());
    return access;
  };
  const works = async (access: string) => (await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${access}`, ...from('203.0.113.81') }, body: '{}' })).status !== 401;
  const live = (uid: number) => get<{ n: number }>('SELECT COUNT(*) AS n FROM oauth_tokens WHERE user_id = ? AND revoked = 0', uid)!.n;

  for (const reset of [{ password: 'correct-horse-7' }, { reset_two_step: true }]) {
    const sams = connect(idOf('sam'));
    const umas = connect(idOf('uma'));
    assert.equal(await works(sams), true, 'connected');
    assert.equal((await call(boss, 'PATCH', `/users/${idOf('sam')}`, reset)).status, 200);
    assert.equal(await works(sams), false, `disconnected by ${Object.keys(reset)[0]}`);
    assert.equal(live(idOf('sam')), 0, 'refresh tokens too');
    assert.equal(await works(umas), true, 'someone else’s connection stays');
  }
  // changing one's own password keeps one's own AI connections (one chose to connect them)
  const sams = connect(idOf('sam'));
  const sam = await login('sam', 'correct-horse-7', '203.0.113.82');
  assert.equal((await call(sam, 'PATCH', '/me', { current_password: 'correct-horse-7', new_password: 'correct-horse-8' })).status, 200);
  assert.equal(await works(sams), true);
});
