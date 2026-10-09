// Lending library self-service (0.15): the gates (working e-mail, a public https address that reaches this Canon,
// the library on with its rules saved), members signing in with an e-mailed code, borrowing / renewing / returning on
// their phones, the renewal link in reminders, and pausing when a gate breaks. Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-lending-self-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const { seed } = await import('../server/seed/index.ts');
const reg = await import('../server/repo/registers.ts');
const L = await import('../server/repo/lending.ts');
const SS = await import('../server/repo/lending-self.ts');
const { sendLoanReminders } = await import('../server/repo/lending-reminders.ts');
const { resetSelfLimits } = await import('../server/routes/lending-self.ts');
const mailer = await import('../server/lib/mailer.ts');
const { updateSettings, getSettings, setMeta, deleteMeta } = await import('../server/repo/settings.ts');
const { securityChecklist } = await import('../server/repo/security.ts');
const { run } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Session = { cookie: string; csrf: string };
let server: Server;
let base = '';
let admin: Session;
const outbox: { to: string; subject: string; text: string }[] = [];
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
const codeIn = (to: string) => outbox.filter((m) => m.to === to).at(-1)!.text.match(/\b(\d{6})\b/)![1];

before(async () => {
  await seed();
  updateSettings({ languages: ['en', 'zh'], church_name: { en: 'Grace Fellowship (test)', zh: '恩典团契' }, modules: { ...getSettings().modules, lending: true } });
  await createUser({ username: 'admin', display_name: 'Admin', password: 'correct-horse-6', role: 'admin' });
  ids.ruth = reg.people.insert({ first_name: 'Ruth', last_name: 'Koh', status: 'member', email: 'ruth@example.org' } as never).id;
  reg.people.insert({ first_name: 'Twin', last_name: 'A', status: 'member', email: 'shared@example.org' } as never);
  reg.people.insert({ first_name: 'Twin', last_name: 'B', status: 'member', email: 'shared@example.org' } as never);
  const book = L.saveBook(null, { title: 'Knowing God', authors: 'J. I. Packer' }, 2);
  ids.book = book.id;
  mailer.setTransportFactory(() => ({
    async sendMail(m) {
      outbox.push({ to: m.to, subject: m.subject, text: m.text });
      return { messageId: 'x' };
    },
  }));
  server = createApp().listen(0, '127.0.0.1');
  // a full parallel test run is slow: idle connections stay open for the next request (no reset mid-test)
  server.keepAliveTimeout = 120_000;
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // the public address is answered by this test server (stands in for a tunnel or reverse proxy)
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    return real(u.startsWith(PUBLIC) ? base + u.slice(PUBLIC.length) : url, init);
  }) as typeof fetch;
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'correct-horse-6' }) });
  admin = { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), csrf: ((await r.json()) as Json).csrf };
});
after(() => {
  mailer.setTransportFactory(null);
  server.close();
});

const gate = (st: Json, key: string) => st.gates.find((g: Json) => g.key === key);

test('the gates: self-service stays off until e-mail works and the public address reaches this Canon', async () => {
  let st = (await call(admin, 'GET', '/lending/self-service?check=1')).body;
  assert.equal(st.on, false);
  assert.equal(gate(st, 'email').problem, 'not_tested');
  assert.equal(gate(st, 'public_address').problem, 'none');
  assert.equal((await call(admin, 'PUT', '/lending/settings', { self_service: true })).status, 400, 'refused while a gate fails');
  assert.equal((await self('GET', '/self/copy/B0001')).status, 503, 'phones are told to see the librarian');

  // e-mail: set up, then a successful test e-mail (for these settings)
  updateSettings({ smtp: { host: 'smtp.example.org', port: 587, secure: false, user: '', from_name: 'Grace', from_email: 'office@example.org', reply_to: '' } });
  assert.equal(gate((await call(admin, 'GET', '/lending/self-service')).body, 'email').problem, 'not_tested', 'settings alone are not enough');
  assert.equal((await call(admin, 'POST', '/email/test', { to: 'office@example.org' })).status, 200);
  assert.equal(gate((await call(admin, 'GET', '/lending/self-service')).body, 'email').ok, true);

  // the public address: http is refused; an https address must answer as this Canon
  updateSettings({ public_url: 'https://elsewhere.example.org' });
  st = (await call(admin, 'GET', '/lending/self-service?check=1')).body;
  assert.equal(gate(st, 'public_address').problem, 'unreachable', 'someone else’s address');
  updateSettings({ public_url: PUBLIC });
  st = (await call(admin, 'GET', '/lending/self-service?check=1')).body;
  assert.equal(gate(st, 'public_address').ok, true, JSON.stringify(gate(st, 'public_address')));

  const on = await call(admin, 'PUT', '/lending/settings', { self_service: true });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  assert.equal(on.body.rules_saved, true);
  assert.equal((await call(admin, 'GET', '/lending/self-service')).body.on, true);
});

test('a member signs in with an e-mailed code, borrows, renews and returns; the librarian checks it in', async () => {
  resetSelfLimits();
  const copy = (await self('GET', '/self/copy/B0001')).body;
  assert.equal(copy.status, 'available');
  assert.equal(copy.title, 'Knowing God');
  // an address that isn't on the register (or is shared) gets the same answer and no e-mail
  const before = outbox.length;
  assert.deepEqual((await self('POST', '/self/code', { email: 'stranger@example.org' })).body, { ok: true });
  assert.deepEqual((await self('POST', '/self/code', { email: 'shared@example.org' })).body, { ok: true });
  assert.equal(outbox.length, before);
  assert.equal((await self('POST', '/self/code', { email: 'Ruth@Example.org' })).status, 200);
  const code = codeIn('ruth@example.org');
  assert.equal((await self('POST', '/self/verify', { email: 'ruth@example.org', code: code === '000000' ? '111111' : '000000' })).status, 400);
  const v = await self('POST', '/self/verify', { email: 'ruth@example.org', code });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(v.body.name, 'Ruth');
  const token = v.body.token as string;
  assert.equal((await self('POST', '/self/verify', { email: 'ruth@example.org', code })).status, 400, 'a code works once');

  const b = await self('POST', '/self/borrow', { number: `${PUBLIC}/lending/copy/B0001` }, token);
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(b.body.loans.length, 1);
  assert.equal((await self('GET', '/self/copy/B0001')).body.status, 'out');
  assert.equal(JSON.stringify((await self('GET', '/self/copy/B0001')).body).includes('Ruth'), false, 'never who has it');
  assert.equal((await self('POST', '/self/borrow', { number: 'B0002' }, 'forged.token')).status, 401);
  const loanId = b.body.loans[0].id;
  assert.equal((await self('POST', `/self/loans/${loanId}/renew`, {}, token)).status, 200);
  assert.equal((await self('POST', '/self/return', { number: 'B0001' })).status, 200);
  assert.equal((await self('GET', '/self/copy/B0001')).body.status, 'returned');
  const pending = (await call(admin, 'GET', '/lending/loans?status=pending')).body;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].via, 'self');
  assert.equal((await call(admin, 'POST', `/lending/loans/${loanId}/return`, {})).status, 200, 'checked in');
  assert.equal((await self('GET', '/self/copy/B0001')).body.status, 'available');
});

test('reminder e-mails carry a renewal link: opening it changes nothing, the button renews', async () => {
  const loan = L.lend({ copy_id: L.findCopy('B0002').copy.id, person_id: ids.ruth }, null);
  run('UPDATE lending_loans SET due_on = ? WHERE id = ?', L.addDays(L.localToday(), 1), loan.id);
  const sent = await sendLoanReminders();
  assert.equal(sent.sent, 1);
  const mail = outbox.at(-1)!;
  const link = mail.text.match(/https:\/\/library\.example\.org\/self\/renew\/(\S+)/)?.[1];
  assert.ok(link, mail.text);
  const info = await self('GET', `/self/renew-link/${link}`);
  assert.equal(info.body.title, 'Knowing God');
  assert.equal(L.loans.get(loan.id).renewals, 0, 'looking changes nothing');
  assert.equal((await self('POST', `/self/renew-link/${link}`)).status, 200);
  assert.equal(L.loans.get(loan.id).renewals, 1);
  assert.equal((await self('POST', `/self/renew-link/${link.slice(0, -3)}abc`)).status, 404, 'a changed link is refused');
});

test('a gate that breaks pauses self-service; fixing it resumes it; the checklist says so', async () => {
  setMeta('smtp_failing', JSON.stringify({ at: new Date().toISOString(), error: 'Sign-in to the e-mail server failed' }));
  assert.equal((await self('GET', '/self/copy/B0001')).status, 503);
  assert.equal(securityChecklist().find((c) => c.key === 'self_service')?.status, 'warn');
  deleteMeta('smtp_failing');
  assert.equal((await self('GET', '/self/copy/B0001')).status, 200);
  assert.equal(securityChecklist().find((c) => c.key === 'self_service')?.status, 'info');
  // changing the e-mail settings needs a new test e-mail
  updateSettings({ smtp: { ...getSettings().smtp, host: 'smtp2.example.org' } });
  assert.equal((await self('GET', '/self/copy/B0001')).status, 503);
  assert.equal(SS.gates().find((g) => g.key === 'email')?.problem, 'not_tested');
});

test('too many codes for one address are refused', async () => {
  resetSelfLimits();
  updateSettings({ smtp: { ...getSettings().smtp, host: 'smtp.example.org' } });
  setMeta('smtp_tested', mailer.smtpFingerprint());
  for (let i = 0; i < 3; i++) assert.equal((await self('POST', '/self/code', { email: 'ruth@example.org' })).status, 200);
  assert.equal((await self('POST', '/self/code', { email: 'ruth@example.org' })).status, 429);
  // and says when to try again (0.19.9)
  const r = await fetch(`${base}/api/self/code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'ruth@example.org' }) });
  assert.equal(r.status, 429);
  const wait = Number(r.headers.get('retry-after'));
  assert.ok(wait > 0 && wait <= 15 * 60, `Retry-After ${r.headers.get('retry-after')}`);
});
