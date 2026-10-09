// E-mail: SMTP settings (write-only password), reminder preview/send through an injected jsonTransport, error mapping, log.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import nodemailer from 'nodemailer';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-email-test-'));
process.env.CANON_DB = path.join(tmp, 'test.db');
process.env.CANON_PUBLIC_URL = 'https://canon.example.org';
delete process.env.CANON_TRUST_PROXY;

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const { updateSettings } = await import('../server/repo/settings.ts');
const { all, db } = await import('../server/db.ts');
const reg = await import('../server/repo/registers.ts');
const vol = await import('../server/repo/volunteers.ts');
const svc = await import('../server/repo/services.ts');
const mailer = await import('../server/lib/mailer.ts');
const { messageLangs } = await import('../server/repo/email.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let server: Server;
let base = '';
let serviceId = 0;
const ids: Record<string, number> = {};

/** Messages captured by the jsonTransport. */
const outbox: Json[] = [];
let failWith: Json | null = null;
const jsonFactory: import('../server/lib/mailer.ts').TransportFactory = (opts) => {
  const t = nodemailer.createTransport({ jsonTransport: true });
  return {
    async sendMail(msg) {
      if (failWith) throw Object.assign(new Error(failWith.message ?? 'fail'), failWith);
      const info = await t.sendMail(msg);
      outbox.push({ ...JSON.parse(String(info.message)), _opts: opts });
      return { messageId: info.messageId };
    },
  };
};

before(async () => {
  await createUser({ username: 'admin', display_name: 'Admin', password: 'correct-horse-1', role: 'admin' });
  await createUser({ username: 'editor', display_name: 'Ed', password: 'correct-horse-2', role: 'editor' });
  await createUser({ username: 'viewer', display_name: 'Vic', password: 'correct-horse-3', role: 'viewer' });
  updateSettings({ languages: ['en', 'zh'], church_name: { en: 'Grace Church', zh: '恩典堂' }, church_contact: '03-1234 5678' });

  const team = vol.teams.insert({ name: { en: 'Music', zh: '音乐' }, color: '#123456', sort: 0 } as never);
  const lead = vol.roles.insert({ team_id: team.id, name: { en: 'Liturgist', zh: '领会' }, needed: 1, sort: 0 } as never);
  const piano = vol.roles.insert({ team_id: team.id, name: { en: 'Pianist', zh: '司琴' }, needed: 1, sort: 1 } as never);
  const p = (first: string, extra: Json) => reg.people.insert({ first_name: first, last_name: 'Tan', status: 'member', ...extra } as never).id;
  ids.grace = p('Grace', { email: 'grace@example.org', native_name: '陈恩惠' }); // no preference → bilingual
  ids.tom = p('Tom', { email: 'tom@example.org', preferred_lang: 'en' }); // English only
  ids.wei = p('Wei', { email: null }); // no e-mail
  ids.dan = p('Dan', { email: 'dan@example.org' }); // declined → excluded

  const s = svc.createService({ date: '2026-10-11', start_time: '10:00', title: { en: "Lord's Day Worship", zh: '主日崇拜' } }).service;
  serviceId = s.id;
  svc.addItem(serviceId, { kind: 'prayer', title: { en: 'Call to Worship', zh: '宣召' }, duration_min: 5, role_id: lead.id });
  svc.addItem(serviceId, { kind: 'other', title: { en: 'Prelude', zh: '序乐' }, duration_min: 4, role_id: piano.id });
  svc.addItem(serviceId, { kind: 'sermon', title: { en: 'Sermon', zh: '讲道' }, duration_min: 30 });
  vol.assign(serviceId, lead.id, ids.grace);
  vol.assign(serviceId, piano.id, ids.grace); // two roles → still one e-mail
  vol.assign(serviceId, piano.id, ids.tom, 'confirmed');
  vol.assign(serviceId, lead.id, ids.wei);
  vol.assign(serviceId, lead.id, ids.dan, 'declined');
  svc.setShare(serviceId, true);

  mailer.setTransportFactory(jsonFactory);
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

async function login(username: string, password: string) {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  assert.equal(r.status, 200);
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { csrf } = (await r.json()) as Json;
  return { cookie, csrf: csrf as string };
}
type Session = Awaited<ReturnType<typeof login>>;
async function call(s: Session, method: string, p: string, body?: unknown) {
  const r = await fetch(`${base}/api${p}`, {
    method,
    headers: { Cookie: s.cookie, 'X-CSRF-Token': s.csrf, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, text, body: (text ? JSON.parse(text) : {}) as Json };
}

const SMTP = { host: 'smtp.example.org', port: 587, secure: false, user: 'office@example.org', from_name: 'Grace Church', from_email: 'office@example.org', reply_to: '' };

test('message language follows preference, else church primary (+ English when bilingual)', () => {
  assert.deepEqual(messageLangs(null, ['en', 'zh']), ['en', 'zh']);
  assert.deepEqual(messageLangs(null, ['zh', 'en']), ['zh', 'en']);
  assert.deepEqual(messageLangs('en', ['zh', 'en']), ['en']);
  assert.deepEqual(messageLangs('ta', ['zh', 'en']), ['zh']);
  assert.deepEqual(messageLangs('zh-Hant', ['en', 'zh']), ['zh-Hant']);
  assert.deepEqual(messageLangs(null, ['en']), ['en']);
});

test('SMTP errors map to clear messages', () => {
  const s = { host: 'smtp.x.org', port: 587, secure: false };
  assert.equal(mailer.mapMailError({ code: 'EAUTH', responseCode: 535, message: 'Invalid login' }, s).code, 'auth');
  assert.equal(mailer.mapMailError({ code: 'ESOCKET', message: 'connect ECONNREFUSED 127.0.0.1:2525' }, s).code, 'connection');
  assert.equal(mailer.mapMailError({ code: 'ETLS', message: 'STARTTLS failed' }, s).code, 'tls');
  assert.equal(mailer.mapMailError({ code: 'ESOCKET', message: 'ssl3_get_record:wrong version number' }, s).code, 'tls');
  assert.equal(mailer.mapMailError({ code: 'EDNS', message: 'getaddrinfo ENOTFOUND smtp.x.org' }, s).code, 'dns');
  assert.equal(mailer.mapMailError({ code: 'ETIMEDOUT', message: 'Connection timeout' }, s).code, 'timeout');
  assert.equal(mailer.mapMailError({ code: 'EENVELOPE', message: 'Recipient refused' }, s).code, 'recipient');
  assert.ok(mailer.mapMailError({ code: 'EAUTH' }, s).message.includes('app password'));
});

test('SMTP settings are admin-only and the password is write-only', async () => {
  const admin = await login('admin', 'correct-horse-1');
  const editor = await login('editor', 'correct-horse-2');
  assert.equal((await call(editor, 'GET', '/email/settings')).status, 403);
  assert.equal((await call(editor, 'PUT', '/email/settings', SMTP)).status, 403);

  let r = await call(admin, 'PUT', '/email/settings', { ...SMTP, password: 's3cret-app-pw' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.has_password, true);
  r = await call(admin, 'GET', '/email/settings');
  assert.equal(r.body.host, 'smtp.example.org');
  assert.equal(r.body.has_password, true);
  assert.ok(!r.text.includes('s3cret-app-pw'));
  assert.ok(!(await call(admin, 'GET', '/settings')).text.includes('s3cret-app-pw'));

  // omitted password keeps it
  r = await call(admin, 'PUT', '/email/settings', { ...SMTP, from_name: 'GC Office' });
  assert.equal(r.body.has_password, true);
  assert.equal(r.body.from_name, 'GC Office');
  // "" clears it
  r = await call(admin, 'PUT', '/email/settings', { ...SMTP, password: '' });
  assert.equal(r.body.has_password, false);
  // header injection / bad address rejected
  assert.equal((await call(admin, 'PUT', '/email/settings', { ...SMTP, from_name: 'x\r\nBcc: a@b.c' })).status, 400);
  assert.equal((await call(admin, 'PUT', '/email/settings', { ...SMTP, from_email: 'nope' })).status, 400);

  r = await call(admin, 'PUT', '/email/settings', { ...SMTP, password: 's3cret-app-pw' });
  // transport options carry the password and insist on TLS for a remote server
  const opts = mailer.transportOptions();
  assert.equal(opts.auth?.pass, 's3cret-app-pw');
  assert.equal(opts.requireTLS, true);
  assert.ok(opts.connectionTimeout > 0 && opts.socketTimeout > 0);
});

test('test e-mail is bilingual and logged', async () => {
  const admin = await login('admin', 'correct-horse-1');
  outbox.length = 0;
  const r = await call(admin, 'POST', '/email/test', { to: 'admin@example.org' });
  assert.equal(r.status, 200, r.text);
  assert.equal(outbox.length, 1);
  assert.match(outbox[0].subject, /Canon test e-mail \/ Canon 测试邮件/);
  assert.match(outbox[0].text, /e-mail is set up correctly[\s\S]*电邮设定正确/);
  assert.equal(outbox[0].from.address, 'office@example.org');
  const log = all<Json>("SELECT * FROM email_log WHERE kind = 'test'");
  assert.equal(log.length, 1);
  assert.equal(log[0].ok, 1);
});

test('reminder preview: one entry per serving person, languages, roles, led items, no addresses', async () => {
  const editor = await login('editor', 'correct-horse-2');
  const r = await call(editor, 'GET', `/services/${serviceId}/reminders/preview`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.smtp_configured, true);
  assert.ok(!r.text.includes('@example.org'), 'preview must not contain e-mail addresses');
  const recips = r.body.recipients as Json[];
  assert.deepEqual(recips.map((x) => x.person_id).sort(), [ids.grace, ids.tom, ids.wei].sort()); // Dan declined
  const grace = recips.find((x) => x.person_id === ids.grace)!;
  assert.equal(grace.roles.length, 2);
  assert.deepEqual(grace.langs, ['en', 'zh']);
  assert.deepEqual(grace.items.map((i: Json) => i.start), ['10:00', '10:05']);
  assert.match(grace.text, /Dear Grace,/);
  assert.match(grace.text, /陈恩惠 平安！/);
  assert.match(grace.text, /Please arrive 30 minutes early\./);
  assert.match(grace.text, /https:\/\/canon\.example\.org\/share\//);
  assert.match(grace.subject, /^Serving reminder: Lord's Day Worship, 11 Oct \/ 服事提醒：主日崇拜/);
  const tom = recips.find((x) => x.person_id === ids.tom)!;
  assert.deepEqual(tom.langs, ['en']);
  assert.doesNotMatch(tom.text, /[一-鿿]/);
  assert.match(tom.text, /10:05 {2}Prelude/);
  assert.equal(recips.find((x) => x.person_id === ids.wei)!.has_email, false);

  const withNote = await call(editor, 'GET', `/services/${serviceId}/reminders/preview?note=${encodeURIComponent('Arrive by 9:15 for sound check')}`);
  assert.match(withNote.body.recipients[0].text, /Arrive by 9:15 for sound check/);
  assert.doesNotMatch(withNote.body.recipients[0].text, /30 minutes early/);

  const viewer = await login('viewer', 'correct-horse-3');
  assert.equal((await call(viewer, 'GET', `/services/${serviceId}/reminders/preview`)).status, 403);
});

test('send reminders to everyone with an e-mail address, log each attempt', async () => {
  const editor = await login('editor', 'correct-horse-2');
  outbox.length = 0;
  const r = await call(editor, 'POST', `/services/${serviceId}/reminders`, {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.sent, 2);
  assert.equal(r.body.failed, 0);
  assert.equal(outbox.length, 2);
  const toGrace = outbox.find((m) => m.to[0].address === 'grace@example.org')!;
  assert.match(toGrace.html, /background:#F3EEE2/);
  assert.match(toGrace.html, /主日崇拜/);
  assert.doesNotMatch(toGrace.html, /<img/i);
  const log = all<Json>("SELECT * FROM email_log WHERE kind = 'reminder' ORDER BY id");
  assert.equal(log.length, 2);
  assert.ok(log.every((l) => l.ok === 1 && l.service_id === serviceId && l.user_id));
  assert.ok(!Object.keys(log[0]).some((k) => /body|text|html/.test(k)), 'no message body in the log');

  // last sent shows up in the preview; the log API masks addresses
  const pv = await call(editor, 'GET', `/services/${serviceId}/reminders/preview`);
  assert.ok(pv.body.recipients.find((x: Json) => x.person_id === ids.grace).last_sent.ok);
  const lg = await call(editor, 'GET', `/email/log?service_id=${serviceId}`);
  assert.equal(lg.status, 200);
  assert.equal(lg.body.length, 2);
  assert.ok(!lg.text.includes('grace@example.org'));
  assert.ok(lg.text.includes('g•••@example.org'));
});

test('selected people only; a person without e-mail is skipped', async () => {
  const editor = await login('editor', 'correct-horse-2');
  outbox.length = 0;
  const r = await call(editor, 'POST', `/services/${serviceId}/reminders`, { person_ids: [ids.tom, ids.wei], note: 'Bring your music' });
  assert.equal(r.body.sent, 1);
  assert.equal(r.body.skipped, 1);
  assert.equal(r.body.results.find((x: Json) => x.person_id === ids.wei).code, 'no_email');
  assert.equal(outbox.length, 1);
  assert.match(outbox[0].text, /Bring your music/);
});

test('auth failure stops the batch and is logged with a clear error', async () => {
  const editor = await login('editor', 'correct-horse-2');
  failWith = { code: 'EAUTH', responseCode: 535, message: '535 5.7.8 Authentication credentials invalid' };
  try {
    const before = all<Json>('SELECT id FROM email_log').length;
    const r = await call(editor, 'POST', `/services/${serviceId}/reminders`, {});
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.sent, 0);
    assert.equal(r.body.failed, 1);
    assert.equal(r.body.skipped, 1); // second recipient not attempted
    assert.equal(r.body.results[0].code, 'auth');
    assert.equal(all<Json>('SELECT id FROM email_log').length, before + 1);
    const rows = all<Json>('SELECT * FROM email_log ORDER BY id DESC LIMIT 1');
    assert.equal(rows[0].ok, 0);
    assert.match(rows[0].error, /sign-in failed/);
  } finally {
    failWith = null;
  }
});

test('not configured → 400; viewers cannot send', async () => {
  const admin = await login('admin', 'correct-horse-1');
  const viewer = await login('viewer', 'correct-horse-3');
  assert.equal((await call(viewer, 'POST', `/services/${serviceId}/reminders`, {})).status, 403);
  await call(admin, 'PUT', '/email/settings', { ...SMTP, host: '' });
  const r = await call(admin, 'POST', `/services/${serviceId}/reminders`, {});
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Settings → E-mail/);
  assert.equal((await call(admin, 'GET', `/services/${serviceId}/reminders/preview`)).body.smtp_configured, false);
});
