// Account security (0.19.9, from the same code study of 0.19.7 as 0.19.8): stronger password hashing that doesn't hold
// Canon up, a setup code for a new Canon, two-step secrets encrypted, longer salted recovery codes, the password to
// turn two-step sign-in on, no access for an unknown role, CSRF compared in constant time, an account's wait that
// grows (and a browser it signed in on before isn't held up), Retry-After on every 429, notices of two-step changes
// and recovery codes used, and "change your password" after an administrator chose it. Fictional data.
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-account-security-'));
process.env.CANON_DB = path.join(tmp, 'data', 'canon.db');
// an encrypted Canon, as every new one is: the two-step secrets are sealed with its keys
process.env.CANON_ENCRYPT = '1';
process.env.CANON_KEY_PROTECT = 'file';
delete process.env.CANON_PUBLIC_URL;

const { createApp } = await import('../server/app.ts');
const A = await import('../server/auth.ts');
const { updateSettings, getSettings } = await import('../server/repo/settings.ts');
const T = await import('../server/lib/totp.ts');
const SF = await import('../server/lib/secret-field.ts');
const SC = await import('../server/lib/setup-code.ts');
const K = await import('../server/lib/keys.ts');
const mailer = await import('../server/lib/mailer.ts');
const { db, get, run } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Session = { cookie: string; csrf: string };
let server: Server;
let base = '';
const outbox: { to: string; subject: string; text: string }[] = [];

const from = (ip?: string): Record<string, string> => (ip ? { 'X-Forwarded-For': ip } : {});
const cookiesOf = (r: Response) => r.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.endsWith('=')).join('; ');
const post = async (url: string, body: unknown, ip?: string, cookie?: string) => {
  const r = await fetch(`${base}/api${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...from(ip), ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, headers: r.headers, body: (await r.json().catch(() => null)) as Json, cookie: cookiesOf(r) };
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
const user = (username: string, role = 'editor') => A.createUser({ username, display_name: `Test ${username}`, password: 'correct-horse-3', role });
const idOf = (u: string) => get<{ id: number }>('SELECT id FROM users WHERE username = ?', u)!.id;
/** Two-step sign-in on for an account (from its own session); returns the secret and the recovery codes. */
async function twoStepOn(s: Session, password = 'correct-horse-3') {
  const setup = (await call(s, 'POST', '/me/two-step/setup', {})).body;
  const r = await call(s, 'POST', '/me/two-step/enable', { code: T.totp(setup.secret), password });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { secret: setup.secret as string, codes: r.body.recovery_codes as string[] };
}
/** A member with an e-mail address, linked to the account (notices are e-mailed to the member's address). */
function withEmail(username: string, email: string) {
  const p = run('INSERT INTO people (first_name, last_name, email) VALUES (?,?,?)', `Test ${username}`, 'Example', email);
  run('UPDATE users SET person_id = ? WHERE username = ?', Number(p.lastInsertRowid), username);
}

before(async () => {
  updateSettings({ trust_proxy: true } as never);
  updateSettings({ mcp: { ...getSettings().mcp, enabled: true } });
  updateSettings({ smtp: { host: 'smtp.example.org', port: 587, secure: false, user: 'office@example.org', from_name: 'Grace Church (test)', from_email: 'office@example.org', reply_to: '' } } as never);
  mailer.setTransportFactory(() => ({
    async sendMail(m) {
      outbox.push({ to: m.to, subject: m.subject, text: m.text });
      return { messageId: 'test' };
    },
  }));
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

// ---------------------------------------------------------------- B. the first administrator

test('a new Canon is set up only with the setup code it printed when it started', async () => {
  const code = SC.setupCode();
  assert.match(code ?? '', /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/, 'a code to type: three groups of four');
  assert.equal(fs.readFileSync(SC.setupCodeFile(), 'utf8').trim(), code, 'kept in the data folder too (Docker, a NAS, no window)');
  assert.equal((await call({ cookie: '', csrf: '' }, 'GET', '/me')).body.needsSetup, true);
  const body = { username: 'boss', display_name: 'Test Boss', password: 'correct-horse-3' };
  assert.equal((await post('/setup', body, '203.0.113.1')).status, 403, 'no code');
  assert.equal((await post('/setup', { ...body, setup_code: 'AAAA-BBBB-CCCC' }, '203.0.113.1')).status, 403, 'a wrong code');
  // typed in lower case, without dashes: still the code
  const r = await post('/setup', { ...body, setup_code: code!.toLowerCase().replace(/-/g, ' ') }, '203.0.113.1');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(fs.existsSync(SC.setupCodeFile()), false, 'the code is gone once Canon is set up');
  assert.equal(SC.setupCode(), null);
  assert.equal(get<{ must_change_password: number }>("SELECT must_change_password FROM users WHERE username = 'boss'")!.must_change_password, 0, 'the first administrator chose their own password');
});

test('guessing at the setup code is limited, and the answer says when to try again', async () => {
  // (Canon is set up by now: the limit is checked first, like every sign-in limit)
  let last = { status: 0, headers: new Headers() };
  for (let i = 0; i < 12; i++) last = await post('/setup', { username: 'x', display_name: 'x', password: 'correct-horse-3', setup_code: `ZZZZ-ZZZZ-ZZ${String(i).padStart(2, '0')}` }, '203.0.113.2');
  assert.equal(last.status, 429);
  const wait = Number(last.headers.get('retry-after'));
  assert.ok(wait > 0 && wait <= 15 * 60, `Retry-After ${last.headers.get('retry-after')}`);
});

// ---------------------------------------------------------------- A. password hashing

test('passwords are hashed with scrypt N=2^17 (r and p kept in the hash), without holding Canon up', async () => {
  const h = await A.hashPassword('correct-horse-3');
  assert.match(h, /^scrypt\$131072\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.equal(await A.verifyPassword('correct-horse-3', h), true);
  assert.equal(await A.verifyPassword('correct-horse-4', h), false);
  // other requests are answered while a password is being checked
  let ticks = 0;
  const timer = setInterval(() => ticks++, 1);
  await A.verifyPassword('correct-horse-3', h);
  clearInterval(timer);
  assert.ok(ticks >= 2, `the event loop ran ${ticks} times during the check`);
});

test('an older, weaker hash still signs in, and is replaced by a stronger one when it does', async () => {
  await user('olive');
  // as 0.19.8 made it: scrypt N=2^14, r=8 and p=1 not written down
  const salt = crypto.randomBytes(16);
  const old = `scrypt$16384$${salt.toString('base64')}$${crypto.scryptSync('correct-horse-3', salt, 64, { N: 16384, r: 8, p: 1 }).toString('base64')}`;
  run("UPDATE users SET password_hash = ? WHERE username = 'olive'", old);
  assert.equal(A.passwordNeedsRehash(old), true);
  // a wrong password leaves it as it is
  assert.equal((await post('/login', { username: 'olive', password: 'correct-horse-4' }, '203.0.113.3')).status, 401);
  assert.equal(get<{ password_hash: string }>("SELECT password_hash FROM users WHERE username = 'olive'")!.password_hash, old);
  await login('olive', 'correct-horse-3', '203.0.113.3');
  const now = get<{ password_hash: string }>("SELECT password_hash FROM users WHERE username = 'olive'")!.password_hash;
  assert.match(now, /^scrypt\$131072\$8\$1\$/);
  assert.equal(A.passwordNeedsRehash(now), false);
  await login('olive', 'correct-horse-3', '203.0.113.3');
});

// (an unknown username still costs one password check: tests/sign-in-hardening.test.ts)

// ---------------------------------------------------------------- 1. two-step secrets encrypted

test('the two-step secret is kept encrypted with this Canon’s keys, and still signs in', async () => {
  await user('tess');
  const s = await login('tess', 'correct-horse-3', '203.0.113.10');
  const { secret } = await twoStepOn(s);
  const stored = get<{ totp_secret: string }>("SELECT totp_secret FROM users WHERE username = 'tess'")!.totp_secret;
  assert.ok(stored.startsWith('enc1:'), stored.slice(0, 12));
  assert.ok(!stored.includes(secret));
  const t = await post('/login', { username: 'tess', password: 'correct-horse-3' }, '203.0.113.10');
  assert.equal((await post('/login/code', { ticket: t.body.ticket, code: T.totp(secret, Date.now() + 30_000) }, '203.0.113.10')).status, 200);
});

test('two-step secrets kept in plain by an older Canon are encrypted, and keep working', async () => {
  await user('uri');
  const secret = T.newSecret();
  run("UPDATE users SET totp_secret = ?, totp_enabled = 1, recovery_codes = '[]' WHERE username = 'uri'", secret);
  assert.equal(A.sealTotpSecrets(db), 1);
  const stored = get<{ totp_secret: string }>("SELECT totp_secret FROM users WHERE username = 'uri'")!.totp_secret;
  assert.ok(stored.startsWith('enc1:'));
  assert.equal(A.sealTotpSecrets(db), 0, 'once only');
  const t = await post('/login', { username: 'uri', password: 'correct-horse-3' }, '203.0.113.11');
  assert.equal((await post('/login/code', { ticket: t.body.ticket, code: T.totp(secret) }, '203.0.113.11')).status, 200);
});

test('a backup restored on another computer: its two-step secrets are sealed again with this Canon’s keys', () => {
  const theirs = crypto.randomBytes(32);
  const secret = T.newSecret();
  const sealed = SF.sealField(secret, SF.fieldKey(theirs));
  assert.throws(() => SF.openField(sealed, SF.fieldKey(K.loadKeys()!.backup)), 'another Canon’s keys can’t open it');
  run("UPDATE users SET totp_secret = ? WHERE username = 'uri'", sealed);
  assert.equal(A.resealTotpSecrets(db, theirs, K.loadKeys()!.backup), 1);
  const now = get<{ totp_secret: string }>("SELECT totp_secret FROM users WHERE username = 'uri'")!.totp_secret;
  assert.equal(SF.openField(now, SF.fieldKey(K.loadKeys()!.backup)), secret);
  // a Canon that isn't encrypted keeps it in plain (it has no key to seal it with)
  assert.equal(SF.sealField(secret, null), secret);
  assert.equal(SF.openField(secret, null), secret);
});

// ---------------------------------------------------------------- 2. recovery codes

test('recovery codes are long (80 bits), salted, and each works once, typed any way', async () => {
  const codes = T.newRecoveryCodes();
  assert.equal(codes.length, 8);
  for (const c of codes) assert.match(c, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  const a = T.hashRecoveryCode(codes[0]);
  const b = T.hashRecoveryCode(codes[0]);
  assert.notEqual(a, b, 'salted: the same code hashes differently each time');
  assert.ok(!a.includes(crypto.createHash('sha256').update(codes[0].toLowerCase()).digest('base64url')));

  await user('vera');
  const s = await login('vera', 'correct-horse-3', '203.0.113.20');
  const on = await twoStepOn(s);
  const stored = JSON.parse(get<{ recovery_codes: string }>("SELECT recovery_codes FROM users WHERE username = 'vera'")!.recovery_codes) as string[];
  assert.equal(stored.length, 8);
  for (const h of stored) assert.match(h, /^s1\$/);
  const signIn = async (code: string, ip: string) => {
    const t = await post('/login', { username: 'vera', password: 'correct-horse-3' }, ip);
    return (await post('/login/code', { ticket: t.body.ticket, code }, ip)).status;
  };
  // every code is compared, in constant time
  const eq = mock.method(crypto, 'timingSafeEqual');
  try {
    assert.equal(await signIn(on.codes[3].toLowerCase().replace(/-/g, ''), '203.0.113.21'), 200, 'lower case, no dashes');
    assert.ok(eq.mock.callCount() >= 8, `compared ${eq.mock.callCount()} times`);
  } finally {
    eq.mock.restore();
  }
  assert.equal(await signIn(on.codes[3], '203.0.113.22'), 401, 'used up');
});

test('recovery codes made before 0.19.9 keep working until used; new ones replace them all (with the password)', async () => {
  await user('wade');
  const s = await login('wade', 'correct-horse-3', '203.0.113.25');
  await twoStepOn(s);
  // as 0.19.8 kept them: unsalted SHA-256 of a 40-bit code
  const old = ['abcde-12345', 'fghij-67890'];
  run("UPDATE users SET recovery_codes = ? WHERE username = 'wade'", JSON.stringify(old.map((c) => crypto.createHash('sha256').update(c).digest('base64url'))));
  const me = (await call(s, 'GET', '/me')).body.user;
  assert.equal(me.two_step.recovery_left, 2);
  assert.equal(me.two_step.recovery_old, true, 'the profile suggests making new ones');
  const signIn = async (code: string, ip: string) => {
    const t = await post('/login', { username: 'wade', password: 'correct-horse-3' }, ip);
    return (await post('/login/code', { ticket: t.body.ticket, code }, ip)).status;
  };
  assert.equal(await signIn('ABCDE-12345', '203.0.113.26'), 200);
  assert.equal(await signIn('abcde-12345', '203.0.113.26'), 401, 'once');
  assert.equal((await call(s, 'POST', '/me/two-step/recovery-codes', { password: 'wrong-horse-3' })).status, 400);
  const fresh = await call(s, 'POST', '/me/two-step/recovery-codes', { password: 'correct-horse-3' });
  assert.equal(fresh.status, 200);
  assert.equal(fresh.body.recovery_codes.length, 8);
  assert.equal(await signIn('fghij-67890', '203.0.113.27'), 401, 'the old code left is replaced');
  assert.equal((await call(s, 'GET', '/me')).body.user.two_step.recovery_old, false);
  assert.equal(await signIn(fresh.body.recovery_codes[0], '203.0.113.27'), 200);
});

// ---------------------------------------------------------------- 3. the password to turn two-step on

test('turning two-step sign-in on needs the account’s password, as turning it off does', async () => {
  await user('xena');
  const s = await login('xena', 'correct-horse-3', '203.0.113.30');
  const setup = (await call(s, 'POST', '/me/two-step/setup', {})).body;
  const code = T.totp(setup.secret);
  assert.equal((await call(s, 'POST', '/me/two-step/enable', { code })).status, 400, 'no password');
  assert.equal((await call(s, 'POST', '/me/two-step/enable', { code, password: 'wrong-horse-3' })).status, 400, 'a wrong password');
  assert.equal(get<{ totp_enabled: number }>("SELECT totp_enabled FROM users WHERE username = 'xena'")!.totp_enabled, 0);
  // a wrong password doesn't use the code up
  assert.equal((await call(s, 'POST', '/me/two-step/enable', { code, password: 'correct-horse-3' })).status, 200);
});

// ---------------------------------------------------------------- 4. an unknown role

test('an account whose role Canon doesn’t know gets no access, and is told why', async () => {
  await user('yuri');
  const s = await login('yuri', 'correct-horse-3', '203.0.113.35');
  run("UPDATE users SET role = 'retired-role' WHERE username = 'yuri'");
  for (const url of ['/people', '/services', '/library/songs', '/groups']) {
    const r = await call(s, 'GET', url);
    assert.equal(r.status, 403, url);
    assert.match(r.body.error, /role/i);
  }
  const me = (await call(s, 'GET', '/me')).body.user;
  assert.equal(me.role_def.unknown, true, 'the screens say so');
  assert.ok(Object.values(me.role_def.access).every((a) => a === 'none'));
  const boss = await login('boss', 'correct-horse-3', '203.0.113.36');
  const row = (await call(boss, 'GET', '/users')).body.find((u: Json) => u.username === 'yuri');
  assert.equal(row.unknown_role, true, 'the administrator sees which account needs a role');
});

// ---------------------------------------------------------------- 5. CSRF

test('the CSRF token is compared in constant time', async () => {
  await user('zane');
  const s = await login('zane', 'correct-horse-3', '203.0.113.40');
  assert.equal((await call({ ...s, csrf: 'not-the-token' }, 'PATCH', '/me', { lang: 'en' })).status, 403);
  assert.equal((await call({ ...s, csrf: s.csrf.slice(0, -1) }, 'PATCH', '/me', { lang: 'en' })).status, 403, 'a prefix');
  const eq = mock.method(crypto, 'timingSafeEqual');
  try {
    assert.equal((await call(s, 'PATCH', '/me', { lang: 'en' })).status, 200);
    assert.ok(eq.mock.callCount() >= 1);
  } finally {
    eq.mock.restore();
  }
});

// ---------------------------------------------------------------- 6. the account's wait

test('wrong passwords make an account wait a little longer each time (1, 2, 4, 8, then 15 minutes), not 15 at once', async () => {
  await user('abby');
  const wrong = (ip: string) => post('/login', { username: 'abby', password: 'wrong-horse-3' }, ip);
  const waitMinutes = () => {
    const u = get<{ locked_until: string | null }>("SELECT locked_until FROM users WHERE username = 'abby'")!.locked_until;
    return u ? Math.round((Date.parse(u) - Date.now()) / 60_000) : 0;
  };
  for (let i = 0; i < 5; i++) await wrong(`203.0.113.${50 + i}`);
  assert.equal(waitMinutes(), 1, 'five in a row: a minute');
  // tries during the wait don't make it longer (or anyone could keep an account waiting by trying now and then)
  const until = get<{ locked_until: string }>("SELECT locked_until FROM users WHERE username = 'abby'")!.locked_until;
  for (let i = 0; i < 3; i++) assert.equal((await wrong('203.0.113.56')).status, 401);
  assert.equal(get<{ locked_until: string }>("SELECT locked_until FROM users WHERE username = 'abby'")!.locked_until, until);
  // the right password during the wait doesn't sign in
  assert.equal((await post('/login', { username: 'abby', password: 'correct-horse-3' }, '203.0.113.57')).status, 401);
  for (const minutes of [2, 4, 8, 15, 15]) {
    run("UPDATE users SET locked_until = ? WHERE username = 'abby'", new Date(Date.now() - 1000).toISOString());
    await wrong('203.0.113.58');
    assert.equal(waitMinutes(), minutes);
  }
  run("UPDATE users SET locked_until = ? WHERE username = 'abby'", new Date(Date.now() - 1000).toISOString());
  await login('abby', 'correct-horse-3', '203.0.113.59');
  assert.equal(get<{ failed_logins: number }>("SELECT failed_logins FROM users WHERE username = 'abby'")!.failed_logins, 0, 'the right password starts afresh');
});

test('a browser that signed in to the account before isn’t held up by a wait someone else caused', async () => {
  await user('bree');
  const first = await post('/login', { username: 'bree', password: 'correct-horse-3' }, '203.0.113.60');
  assert.equal(first.status, 200);
  const device = first.cookie.split('; ').find((c) => c.startsWith('canon_device_'));
  assert.ok(device, 'a browser that signed in is remembered for this account');
  // someone who knows the username makes the account wait
  for (let i = 0; i < 5; i++) await post('/login', { username: 'bree', password: 'wrong-horse-3' }, `203.0.113.${61 + i}`);
  assert.equal((await post('/login', { username: 'bree', password: 'correct-horse-3' }, '203.0.113.66')).status, 401, 'another browser waits');
  assert.equal((await post('/login', { username: 'bree', password: 'correct-horse-3' }, '203.0.113.67', device)).status, 200, 'hers signs in');
  // with that browser, wrong passwords still count against the address as before (eight in 15 minutes)
  // a new password forgets the browsers remembered with the old one
  const s = await login('bree', 'correct-horse-3', '203.0.113.68');
  assert.equal((await call(s, 'PATCH', '/me', { current_password: 'correct-horse-3', new_password: 'correct-horse-4' })).status, 200);
  for (let i = 0; i < 5; i++) await post('/login', { username: 'bree', password: 'wrong-horse-3' }, `203.0.113.${70 + i}`);
  assert.equal((await post('/login', { username: 'bree', password: 'correct-horse-4' }, '203.0.113.75', device)).status, 401);
  // another account's browser cookie is no use for this account
  await user('cleo');
  const cleos = (await post('/login', { username: 'cleo', password: 'correct-horse-3' }, '203.0.113.76')).cookie.split('; ').find((c) => c.startsWith('canon_device_'));
  assert.equal((await post('/login', { username: 'bree', password: 'correct-horse-4' }, '203.0.113.77', cleos)).status, 401);
});

// ---------------------------------------------------------------- 7. Retry-After

test('every "too many" answer says when to try again (Retry-After)', async () => {
  const retry = (h: Headers, what: string) => {
    const v = Number(h.get('retry-after'));
    assert.ok(Number.isInteger(v) && v > 0 && v <= 3600, `${what}: Retry-After ${h.get('retry-after')}`);
  };
  // sign-in
  let r = await post('/login', { username: 'nobody', password: 'x' }, '203.0.113.90');
  for (let i = 0; i < 8; i++) r = await post('/login', { username: `nobody${i}`, password: 'x' }, '203.0.113.90');
  assert.equal(r.status, 429);
  retry(r.headers, '/login');
  r = await post('/login/code', { ticket: 'x', code: '123456' }, '203.0.113.90');
  assert.equal(r.status, 429);
  retry(r.headers, '/login/code');
  // the MCP endpoint and the OAuth token endpoint
  const mcp = () => fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer made-up-${crypto.randomUUID()}`, ...from('203.0.113.91') }, body: '{}' });
  let m = await mcp();
  for (let i = 0; i < 30; i++) m = await mcp();
  assert.equal(m.status, 429);
  retry(m.headers, '/mcp');
  const token = () => fetch(`${base}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...from('203.0.113.92') }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: 'canon-made-up', code: crypto.randomUUID(), code_verifier: 'x'.repeat(43) }) });
  let k = await token();
  for (let i = 0; i < 30; i++) k = await token();
  assert.equal(k.status, 429);
  retry(k.headers, '/oauth/token');
  const authorize = () => fetch(`${base}/oauth/authorize?client_id=canon-made-up`, { headers: from('203.0.113.93'), redirect: 'manual' });
  let a = await authorize();
  for (let i = 0; i < 60; i++) a = await authorize();
  assert.equal(a.status, 429);
  retry(a.headers, '/oauth/authorize');
  const register = () => fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...from('203.0.113.94') }, body: JSON.stringify({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], client_name: 'Test' }) });
  let g = await register();
  for (let i = 0; i < 10; i++) g = await register();
  assert.equal(g.status, 429);
  retry(g.headers, '/oauth/register');
  // every limiter can say how long is left
  const { makeLimiter } = await import('../server/lib/rate-limit.ts');
  const l = makeLimiter(1, 60_000);
  l.limited('x');
  assert.ok(l.retryAfter('x') > 0 && l.retryAfter('x') <= 60);
  assert.equal(l.retryAfter('y'), 0);
});

// ---------------------------------------------------------------- 9. notices

test('a recovery code used to sign in: the person is told, in Canon and by e-mail', async () => {
  await user('dina');
  withEmail('dina', 'dina@example.org');
  const s = await login('dina', 'correct-horse-3', '203.0.113.100');
  const on = await twoStepOn(s);
  assert.ok(outbox.some((m) => m.to === 'dina@example.org' && /two-step/i.test(m.subject)), 'turning it on is e-mailed');
  outbox.length = 0;
  const t = await post('/login', { username: 'dina', password: 'correct-horse-3' }, '203.0.113.101');
  const r = await post('/login/code', { ticket: t.body.ticket, code: on.codes[0] }, '203.0.113.101');
  assert.equal(r.status, 200);
  await new Promise((done) => setTimeout(done, 50)); // the e-mail goes out after the answer
  const mail = outbox.find((m) => m.to === 'dina@example.org');
  assert.ok(mail, 'e-mailed');
  assert.match(mail.subject, /recovery code/i);
  assert.match(mail.text, /203\.0\.113\.101/, 'from where');
  assert.match(mail.text, /7 /, 'how many are left');
  const later = { cookie: r.cookie, csrf: r.body.csrf };
  const notices = (await call(later, 'GET', '/me')).body.user.notices as Json[];
  assert.equal(notices.length, 1);
  assert.equal(notices[0].kind, 'recovery_code_used');
  assert.equal((await call(later, 'POST', '/me/notices/seen', { ids: [notices[0].id] })).status, 200);
  assert.equal((await call(later, 'GET', '/me')).body.user.notices.length, 0);
});

test('an administrator resetting someone’s two-step sign-in: they are told, in Canon and by e-mail', async () => {
  await user('emil');
  withEmail('emil', 'emil@example.org');
  const s = await login('emil', 'correct-horse-3', '203.0.113.105');
  await twoStepOn(s);
  outbox.length = 0;
  const boss = await login('boss', 'correct-horse-3', '203.0.113.106');
  assert.equal((await call(boss, 'PATCH', `/users/${idOf('emil')}`, { reset_two_step: true })).status, 200);
  await new Promise((done) => setTimeout(done, 50));
  assert.ok(outbox.some((m) => m.to === 'emil@example.org' && /two-step/i.test(m.subject)));
  const again = await login('emil', 'correct-horse-3', '203.0.113.107');
  const notices = (await call(again, 'GET', '/me')).body.user.notices as Json[];
  assert.deepEqual(notices.map((n) => n.kind), ['two_step_reset']);
  // without SMTP, the notice in Canon is still there (and nothing fails)
  const smtp = getSettings().smtp;
  updateSettings({ smtp: { ...smtp, host: '' } } as never);
  try {
    await twoStepOn(again);
    assert.equal((await call(boss, 'PATCH', `/users/${idOf('emil')}`, { reset_two_step: true })).status, 200);
  } finally {
    updateSettings({ smtp } as never);
  }
});

// ---------------------------------------------------------------- must change password

test('a password an administrator chose must be changed at the next sign-in', async () => {
  const boss = await login('boss', 'correct-horse-3', '203.0.113.110');
  const made = await call(boss, 'POST', '/users', { username: 'fern', display_name: 'Test Fern', password: 'temporary-9', role: 'guest' });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  let s = await login('fern', 'temporary-9', '203.0.113.111');
  let me = (await call(s, 'GET', '/me')).body.user;
  assert.ok(me.must_change_password);
  const blocked = await call(s, 'GET', '/services');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'password_change_required');
  // the new password must differ from the one the administrator chose
  assert.equal((await call(s, 'PATCH', '/me', { current_password: 'temporary-9', new_password: 'temporary-9' })).status, 400);
  assert.equal((await call(s, 'PATCH', '/me', { current_password: 'temporary-9', new_password: 'my-own-horse-9' })).status, 200);
  me = (await call(s, 'GET', '/me')).body.user;
  assert.ok(!me.must_change_password);
  assert.equal((await call(s, 'GET', '/services')).status, 200);
  // an administrator's reset sets it again; resetting one's own password in the list doesn't
  assert.equal((await call(boss, 'PATCH', `/users/${idOf('fern')}`, { password: 'temporary-8' })).status, 200);
  s = await login('fern', 'temporary-8', '203.0.113.112');
  assert.ok((await call(s, 'GET', '/me')).body.user.must_change_password);
  assert.equal((await call(boss, 'PATCH', `/users/${idOf('boss')}`, { password: 'correct-horse-3' })).status, 200);
  assert.equal(get<{ must_change_password: number }>("SELECT must_change_password FROM users WHERE username = 'boss'")!.must_change_password, 0);
  // nor can it connect an AI assistant until it has
  const redirect = 'https://claude.ai/api/mcp/auth_callback';
  const client = (await (await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...from('203.0.113.114') }, body: JSON.stringify({ client_name: 'Test assistant', redirect_uris: [redirect] }) })).json()) as Json;
  const q = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: redirect, state: 'st-1', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', scope: 'canon:read' });
  const consent = (who: Session) => fetch(`${base}/oauth/authorize?${q}`, { headers: { Cookie: who.cookie, ...from('203.0.113.113') }, redirect: 'manual' });
  assert.equal((await consent(boss)).status, 200, 'the consent page, for an account that may');
  assert.equal((await consent(s)).status, 403);
});
