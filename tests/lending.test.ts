// The lending library and the asset register (0.15): optional modules (off until a church turns them on), the
// catalogue with numbered copies, lending / renewing / returning, overdue loans, e-mail reminders, the librarian and
// asset keeper roles, ISBN lookup, labels, maintenance, photos and receipts, and members' personal data. Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-lending-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const { seed } = await import('../server/seed/index.ts');
const reg = await import('../server/repo/registers.ts');
const L = await import('../server/repo/lending.ts');
const { sendLoanReminders, dueReminders } = await import('../server/repo/lending-reminders.ts');
const { lookupIsbn } = await import('../server/lib/isbn.ts');
const mailer = await import('../server/lib/mailer.ts');
const { updateSettings } = await import('../server/repo/settings.ts');
const { personalData } = await import('../server/repo/pdpa.ts');
const { run, get } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Session = { cookie: string; csrf: string };
let server: Server;
let base = '';
const as: Record<string, Session> = {};
const ids: Record<string, number> = {};
const outbox: { to: string; subject: string; text: string }[] = [];

async function call(who: Session, method: string, url: string, body?: unknown, type = 'application/json') {
  const r = await fetch(`${base}/api${url}`, {
    method,
    headers: { 'Content-Type': type, Cookie: who.cookie, 'X-CSRF-Token': who.csrf },
    body: body === undefined ? undefined : Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body),
  });
  const txt = await r.text();
  let json: Json | null = null;
  try {
    json = JSON.parse(txt);
  } catch { /* not JSON */ }
  return { status: r.status, body: json as Json, text: txt, type: r.headers.get('content-type') ?? '' };
}
async function login(username: string): Promise<Session> {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'correct-horse-6' }) });
  assert.equal(r.status, 200);
  return { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), csrf: ((await r.json()) as Json).csrf };
}

before(async () => {
  await seed();
  updateSettings({ languages: ['en', 'zh'], church_name: { en: 'Grace Fellowship (test)', zh: '恩典团契' } });
  for (const [u, role] of [['admin', 'admin'], ['librarian', 'librarian'], ['keeper', 'keeper'], ['viewer', 'viewer']]) {
    createUser({ username: u, display_name: `Test ${u}`, password: 'correct-horse-6', role });
  }
  const p = (first: string, extra: Json = {}) => reg.people.insert({ first_name: first, last_name: 'Koh', status: 'member', ...extra } as never).id;
  ids.ruth = p('Ruth', { email: 'ruth@example.org', native_name: '许路得' });
  ids.amos = p('Amos', { email: 'amos@example.org', preferred_lang: 'en' });
  ids.eli = p('Eli');
  mailer.setTransportFactory(() => ({
    async sendMail(m) {
      outbox.push({ to: m.to, subject: m.subject, text: m.text });
      return { messageId: 'x' };
    },
  }));
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const u of ['admin', 'librarian', 'keeper', 'viewer']) as[u] = await login(u);
});
after(() => {
  mailer.setTransportFactory(null);
  server.close();
});

test('both modules are off until the church turns them on', async () => {
  assert.equal((await call(as.admin, 'GET', '/lending/books')).status, 404);
  assert.equal((await call(as.admin, 'GET', '/equipment/items')).status, 404);
  assert.equal((await call(as.admin, 'GET', '/dashboard')).body.lending, null);
  assert.equal((await call(as.admin, 'PUT', '/modules', { lending: true })).status, 200);
  assert.equal((await call(as.admin, 'PUT', '/modules', { equipment: true })).status, 200);
  assert.equal((await call(as.admin, 'GET', '/lending/books')).status, 200);
  assert.deepEqual((await call(as.admin, 'GET', '/dashboard')).body.lending, { on_loan: 0, overdue: 0, titles: 0 });
});

test('the catalogue: a book with numbered copies; ISBNs are checked and found', async () => {
  const bad = await call(as.librarian, 'POST', '/lending/books', { title: 'Knowing God', isbn: '12345' });
  assert.equal(bad.status, 400);
  const r = await call(as.librarian, 'POST', '/lending/books', { title: 'Knowing God', authors: 'J. I. Packer', isbn: '978-0-8308-1650-6', category: 'Doctrine', copies: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.isbn, '9780830816506');
  assert.deepEqual(r.body.copies.map((c: Json) => c.number), ['B0001', 'B0002']);
  ids.book = r.body.id;
  ids.copy1 = r.body.copies[0].id;
  const found = await call(as.viewer, 'GET', '/lending/books?q=9780830816506');
  assert.equal(found.body.length, 1);
  assert.equal(found.body[0].available, 2);
  assert.equal((await call(as.viewer, 'POST', '/lending/books', { title: 'Nope' })).status, 403, 'read-only');
  assert.equal((await call(as.librarian, 'GET', '/people')).status, 403, 'a librarian has no member register');
  const who = await call(as.librarian, 'GET', '/lending/borrowers?q=ruth');
  assert.deepEqual(Object.keys(who.body[0]).sort(), ['id', 'name', 'on_loan', 'overdue', 'status'], 'names only');
});

test('lending: lend, scan, renew (up to the rules), return; one loan per copy', async () => {
  const lent = await call(as.librarian, 'POST', '/lending/loans', { copy_id: ids.copy1, person_id: ids.ruth });
  assert.equal(lent.status, 200, JSON.stringify(lent.body));
  assert.equal(lent.body.due_on, L.addDays(L.localToday(), 21));
  ids.loan = lent.body.id;
  assert.equal((await call(as.librarian, 'POST', '/lending/loans', { copy_id: ids.copy1, person_id: ids.amos })).status, 409, 'already out');
  const scan = await call(as.librarian, 'GET', `/lending/scan?q=${encodeURIComponent('http://office:5018/lending/copy/B0001')}`);
  assert.equal(scan.body.copy.number, 'B0001');
  assert.match(scan.body.loan.borrower, /Ruth Koh/);
  updateSettings({ lending: { loan_days: 21, max_renewals: 1, remind_days_before: 3, send_reminders: false } });
  assert.equal((await call(as.librarian, 'POST', `/lending/loans/${ids.loan}/renew`, {})).status, 200);
  const twice = await call(as.librarian, 'POST', `/lending/loans/${ids.loan}/renew`, {});
  assert.equal(twice.status, 400);
  assert.match(twice.body.error, /Renewed 1 time/);
  assert.equal((await call(as.admin, 'DELETE', `/people/${ids.ruth}`)).status, 400, 'a borrower with a book out stays');
  assert.equal((await call(as.librarian, 'POST', `/lending/loans/${ids.loan}/return`, {})).status, 200);
  assert.equal((await call(as.librarian, 'GET', `/lending/books/${ids.book}`)).body.history.length, 1);
  assert.equal((await call(as.librarian, 'DELETE', `/lending/copies/${ids.copy1}`)).status, 400, 'a copy with history is withdrawn, not deleted');
});

test('overdue loans and e-mail reminders: due soon once, overdue once a week, in the borrower’s languages', async () => {
  const copy2 = get<{ id: number }>("SELECT id FROM lending_copies WHERE number = 'B0002'")!.id;
  const a = (await call(as.librarian, 'POST', '/lending/loans', { copy_id: copy2, person_id: ids.amos })).body;
  const extra = (await call(as.librarian, 'POST', '/lending/books', { title: 'The Pilgrim’s Progress', copies: 1 })).body;
  const b = (await call(as.librarian, 'POST', '/lending/loans', { copy_id: extra.copies[0].id, person_id: ids.ruth })).body;
  run('UPDATE lending_loans SET due_on = ? WHERE id = ?', L.addDays(L.localToday(), -5), a.id); // overdue
  run('UPDATE lending_loans SET due_on = ? WHERE id = ?', L.addDays(L.localToday(), 2), b.id); // due soon
  const overdue = await call(as.viewer, 'GET', '/lending/loans?status=overdue');
  assert.equal(overdue.body.length, 1);
  assert.equal(overdue.body[0].overdue_days, 5);
  assert.deepEqual((await call(as.librarian, 'GET', '/lending/reminders')).body, { due_soon: 1, overdue: 1, people: 2 });

  assert.equal((await call(as.librarian, 'POST', '/lending/reminders/send', {})).status, 400, 'no e-mail set up yet');
  updateSettings({ smtp: { host: 'smtp.example.org', port: 587, secure: false, user: '', from_name: 'Grace', from_email: 'office@example.org', reply_to: '' } });
  const sent = await sendLoanReminders();
  assert.equal(sent.sent, 2);
  const toAmos = outbox.find((m) => m.to === 'amos@example.org')!;
  assert.match(toAmos.subject, /overdue since/);
  assert.doesNotMatch(toAmos.text, /逾期/, 'Amos reads English');
  const toRuth = outbox.find((m) => m.to === 'ruth@example.org')!;
  assert.match(toRuth.text, /Pilgrim/);
  assert.match(toRuth.text, /许路得/, 'bilingual, her Chinese name in the Chinese part');
  assert.deepEqual(dueReminders(), { due: [], overdue: [] }, 'each once');
  assert.equal(get<{ n: number }>("SELECT COUNT(*) n FROM email_log WHERE kind IN ('loan_due', 'loan_overdue') AND ok = 1")!.n, 2);
  assert.ok(personalData(ids.ruth).library_loans.length >= 2, 'her loans are in her personal data');
});

test('ISBN lookup: Open Library, else Google Books', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes('openlibrary.org')) return new Response('{}', { headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ items: [{ volumeInfo: { title: '认识神', authors: ['巴刻'], publisher: '校园书房', publishedDate: '1998-05', language: 'zh-TW', imageLinks: { thumbnail: 'http://books.google.com/x.jpg' } } }] }),
      { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const r = await lookupIsbn('9789575872934');
    assert.equal(r?.title, '认识神');
    assert.equal(r?.year, 1998);
    assert.equal(r?.language, 'zh-Hant');
    assert.equal(r?.source, 'Google Books');
    assert.equal(r?.cover_url, 'https://books.google.com/x.jpg');
  } finally {
    globalThis.fetch = real;
  }
});

test('labels: QR codes that open the copy in Canon', async () => {
  const r = await call(as.librarian, 'GET', `/lending/labels?copies=${ids.copy1}&base=${encodeURIComponent('http://192.168.1.20:3000')}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.base, 'http://192.168.1.20:3000');
  assert.equal(r.body.labels[0].number, 'B0001');
  assert.match(r.body.labels[0].qr, /^<svg/);
  assert.equal((await call(as.librarian, 'GET', `/lending/labels?copies=${ids.copy1}&base=javascript:alert(1)`)).status, 400);
});

test('the asset register: numbers, maintenance due, photos and receipts, the asset keeper', async () => {
  const r = await call(as.keeper, 'POST', '/equipment/items', { name: 'Projector', category: 'AV', location: 'Sanctuary', custodian_id: ids.eli, price: 1299, maintenance_every_months: 6 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.number, 'E0001');
  assert.match(r.body.custodian, /Eli Koh/);
  ids.item = r.body.id;
  const m = await call(as.keeper, 'POST', `/equipment/items/${ids.item}/maintenance`, { done_on: '2026-01-31', what: 'Cleaned the filter', cost: 40 });
  assert.equal(m.body.next_maintenance_on, '2026-07-31', 'six months later');
  assert.equal((await call(as.keeper, 'GET', '/equipment/items?due=1')).body.length, 1, 'past due');
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  const up = await call(as.keeper, 'POST', `/equipment/items/${ids.item}/files?kind=photo&name=front.png`, png, 'image/png');
  assert.equal(up.status, 200, up.text);
  assert.equal(up.body.files.length, 1);
  const fake = await call(as.keeper, 'POST', `/equipment/items/${ids.item}/files?kind=receipt&name=receipt.pdf`, png, 'application/pdf');
  assert.equal(fake.status, 400, 'a PNG is not a PDF');
  const file = await fetch(`${base}/api/equipment/files/${up.body.files[0].id}`, { headers: { Cookie: as.keeper.cookie } });
  assert.equal(file.headers.get('content-type'), 'image/png');
  assert.equal((await call(as.keeper, 'GET', '/lending/books')).status, 403, 'the asset keeper has no library');
  assert.equal((await call(as.viewer, 'PATCH', `/equipment/items/${ids.item}`, { location: 'Hall' })).status, 403);
  assert.deepEqual((personalData(ids.eli).looks_after as Json[]).map((x) => x.number), ['E0001']);
});

test('switched off again: refused, gone from the dashboard, the data kept', async () => {
  assert.equal((await call(as.admin, 'PUT', '/modules', { lending: false })).status, 200);
  assert.equal((await call(as.librarian, 'GET', '/lending/loans')).status, 404);
  assert.equal((await call(as.admin, 'GET', '/dashboard')).body.lending, null);
  assert.equal((await call(as.admin, 'PUT', '/modules', { lending: true })).status, 200);
  assert.ok((await call(as.librarian, 'GET', '/lending/books')).body.length >= 2, 'everything is still there');
});
