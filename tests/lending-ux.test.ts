// Lending library, from an adversarial walk-through (0.19.10): a member signed in to Canon who scans a book's label
// borrows, renews and returns it as themselves (no e-mailed code, and not the librarian's screen); "I'm bringing it
// back" from My loans; renewals left; the desk doesn't renew a book its borrower says is back; the dashboard shows
// only what the role may read; pictures load for every signed-in role; the ISBN lookup fills in the language.
// Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-lending-ux-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const { seed } = await import('../server/seed/index.ts');
const reg = await import('../server/repo/registers.ts');
const L = await import('../server/repo/lending.ts');
const mailer = await import('../server/lib/mailer.ts');
const { marcLanguage } = await import('../server/lib/isbn.ts');
const { updateSettings, getSettings } = await import('../server/repo/settings.ts');
const { run } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Session = { cookie: string; csrf: string };
let server: Server;
let base = '';
const ids: Record<string, number> = {};
const PUBLIC = 'https://library.example.org';

async function call(who: Session | null, method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${base}/api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(who ? { Cookie: who.cookie, 'X-CSRF-Token': who.csrf } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => null)) as Json };
}
const self = (method: string, url: string, body?: unknown, token?: string) => call(null, method, url, body, token ? { 'X-Self-Token': token } : {});
async function login(username: string): Promise<Session> {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'correct-horse-6' }) });
  assert.equal(r.status, 200);
  return { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), csrf: ((await r.json()) as Json).csrf };
}
/** A small PNG (a 1×1 pixel). */
function png(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), data])));
    return Buffer.concat([len, Buffer.from(type), data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 200, 30, 30]))), chunk('IEND', Buffer.alloc(0))]);
}

before(async () => {
  await seed();
  updateSettings({ languages: ['en', 'zh'], church_name: { en: 'Grace Fellowship (test)' }, modules: { ...getSettings().modules, lending: true } });
  ids.dan = reg.people.insert({ first_name: 'Dan', last_name: 'Teo', status: 'member', email: 'dan@example.org' } as never).id;
  ids.eve = reg.people.insert({ first_name: 'Eve', last_name: 'Goh', status: 'member', email: 'eve@example.org' } as never).id;
  await createUser({ username: 'admin', display_name: 'Test Admin', password: 'correct-horse-6', role: 'admin' });
  await createUser({ username: 'lib', display_name: 'Test Librarian', password: 'correct-horse-6', role: 'librarian' });
  // a member with a read-only account (the library's readers have accounts for other reasons)
  const dan = await createUser({ username: 'dan', display_name: 'Dan Teo', password: 'correct-horse-6', role: 'viewer' });
  run('UPDATE users SET person_id = ? WHERE id = ?', ids.dan, dan.id);
  const eve = await createUser({ username: 'eve', display_name: 'Eve Goh', password: 'correct-horse-6', role: 'viewer' });
  run('UPDATE users SET person_id = ? WHERE id = ?', ids.eve, eve.id);
  await createUser({ username: 'auditor', display_name: 'Test Auditor', password: 'correct-horse-6', role: 'guest' });
  ids.book = L.saveBook(null, { title: 'Knowing God', authors: 'J. I. Packer' }, 3).id;
  mailer.setTransportFactory(() => ({ async sendMail() { return { messageId: 'x' }; } }));
  server = createApp().listen(0, '127.0.0.1');
  server.keepAliveTimeout = 120_000;
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // the public address is answered by this test server (stands in for a tunnel)
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    return real(u.startsWith(PUBLIC) ? base + u.slice(PUBLIC.length) : url, init);
  }) as typeof fetch;
  // self-service on: e-mail tested, the public address answering
  const admin = await login('admin');
  updateSettings({ smtp: { host: 'smtp.example.org', port: 587, secure: false, user: '', from_name: 'Grace', from_email: 'office@example.org', reply_to: '' }, public_url: PUBLIC } as never);
  assert.equal((await call(admin, 'POST', '/email/test', { to: 'office@example.org' })).status, 200);
  const on = await call(admin, 'PUT', '/lending/settings', { self_service: true, max_renewals: 2 });
  assert.equal(on.status, 200, JSON.stringify(on.body));
});
after(() => {
  mailer.setTransportFactory(null);
  server.close();
});

test('a member signed in to Canon borrows, renews and returns from the label as themselves, with no e-mailed code', async () => {
  const dan = await login('dan');
  const s = await call(dan, 'POST', '/me/lending-session');
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.name, 'Dan');
  const token = s.body.token as string;
  const b = await self('POST', '/self/borrow', { number: 'B0001' }, token);
  assert.equal(b.status, 200, JSON.stringify(b.body));
  let loans = (await self('GET', '/self/loans', undefined, token)).body as Json[];
  assert.equal(loans.length, 1);
  assert.equal(loans[0].renewals_left, 2, 'My loans says how many renewals are left');
  assert.equal((await self('POST', `/self/loans/${loans[0].id}/renew`, {}, token)).status, 200);
  loans = (await self('GET', '/self/loans', undefined, token)).body as Json[];
  assert.equal(loans[0].renewals_left, 1);
  // someone else can't say Dan's book is back from their own My loans
  const eve = (await call(await login('eve'), 'POST', '/me/lending-session')).body.token as string;
  assert.equal((await self('POST', `/self/loans/${loans[0].id}/return`, {}, eve)).status, 404);
  // Dan can, from My loans (he doesn't have to find the label again)
  const back = await self('POST', `/self/loans/${loans[0].id}/return`, {}, token);
  assert.equal(back.status, 200, JSON.stringify(back.body));
  loans = (await self('GET', '/self/loans', undefined, token)).body as Json[];
  assert.equal(loans[0].returned, true);
  assert.equal(loans[0].can_renew, false);
});

test('borrowing as oneself needs an account that belongs to a member, the library, and self-service on', async () => {
  const auditor = await login('auditor');
  const r = await call(auditor, 'POST', '/me/lending-session');
  assert.equal(r.status, 400);
  assert.match(r.body.error, /member/i);
  const dan = await login('dan');
  updateSettings({ lending: { ...getSettings().lending, self_service: false } });
  try {
    const off = await call(dan, 'POST', '/me/lending-session');
    assert.equal(off.status, 409);
    assert.match(off.body.error, /librarian/i);
  } finally {
    updateSettings({ lending: { ...getSettings().lending, self_service: true } });
  }
  updateSettings({ modules: { ...getSettings().modules, lending: false } });
  try {
    assert.equal((await call(dan, 'POST', '/me/lending-session')).status, 404);
  } finally {
    updateSettings({ modules: { ...getSettings().modules, lending: true } });
  }
});

test('the desk doesn’t renew a book its borrower says is back: it is checked in', async () => {
  const lib = await login('lib');
  const lent = await call(lib, 'POST', '/lending/loans', { copy_id: L.findCopy('B0002').copy.id, person_id: ids.eve });
  assert.equal(lent.status, 200, JSON.stringify(lent.body));
  assert.equal((await self('POST', '/self/return', { number: 'B0002' })).status, 200);
  const scan = (await call(lib, 'GET', '/lending/scan?q=B0002')).body;
  assert.ok(scan.loan.return_pending_on, 'the desk sees that the borrower said it is back');
  assert.equal((await call(lib, 'POST', `/lending/loans/${lent.body.id}/renew`, {})).status, 400);
  assert.equal((await call(lib, 'POST', `/lending/loans/${lent.body.id}/return`, {})).status, 200);
});

test('the dashboard shows only what the account’s role may read', async () => {
  const lib = (await call(await login('lib'), 'GET', '/dashboard')).body;
  assert.equal(lib.members, null, 'no member counts for a librarian');
  assert.equal(lib.birthdays, null, 'nor members’ birthdays');
  assert.equal(lib.upcoming, null, 'nor services');
  assert.equal(lib.library, null, 'nor the song library');
  assert.ok(lib.lending, 'the lending library');
  const admin = (await call(await login('admin'), 'GET', '/dashboard')).body;
  assert.ok(Array.isArray(admin.members) && Array.isArray(admin.birthdays) && Array.isArray(admin.upcoming) && admin.library);
});

test('pictures (slide backgrounds, theme and block pictures) load for every signed-in role, not only administrators', async () => {
  const admin = await login('admin');
  const up = await fetch(`${base}/api/backgrounds?name=Test%20dawn`, { method: 'POST', headers: { 'Content-Type': 'image/png', Cookie: admin.cookie, 'X-CSRF-Token': admin.csrf }, body: new Uint8Array(png()) });
  assert.equal(up.status, 200, await up.clone().text());
  const bg = (await up.json()) as Json;
  for (const who of ['dan', 'lib']) {
    const s = await login(who);
    const r = await fetch(`${base}/api/assets/slide-bg-${bg.id}`, { headers: { Cookie: s.cookie } });
    assert.equal(r.status, 200, `${who}: ${r.status}`);
    assert.equal(r.headers.get('content-type'), 'image/png');
  }
  const none = await fetch(`${base}/api/assets/slide-bg-${bg.id}`);
  assert.equal(none.status, 401, 'not without signing in');
});

test('the ISBN lookup’s language codes become the church’s languages', () => {
  assert.equal(marcLanguage('eng'), 'en');
  assert.equal(marcLanguage('/languages/chi'), 'zh');
  assert.equal(marcLanguage('zho'), 'zh');
  assert.equal(marcLanguage('may'), 'ms');
  assert.equal(marcLanguage('xyz'), null);
  assert.equal(marcLanguage(undefined), null);
});
