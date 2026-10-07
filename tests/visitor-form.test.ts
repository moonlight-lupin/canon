// The visitor form: the public page and its protections, the review queue (accept / discard), privacy for read-only
// users, the QR code on the bulletin and slides, and copies of a service not sharing its link. Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-visitor-form-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const svc = await import('../server/repo/services.ts');
const vf = await import('../server/repo/visitor-form.ts');
const { renderService } = await import('../server/repo/render.ts');
const { db } = await import('../server/db.ts');
const { resetVisitorFormLimits, PER_ADDRESS } = await import('../server/routes/visitor-form.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Session = { cookie: string; csrf: string };
let server: Server;
let base = '';
const as: Record<'admin' | 'editor' | 'viewer', Session> = {} as never;
const today = new Date().toISOString().slice(0, 10);
let sid = 0;
let token = '';

async function login(username: string): Promise<Session> {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'correct-horse-5' }) });
  assert.equal(r.status, 200);
  return { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), csrf: ((await r.json()) as Json).csrf };
}
async function call(who: Session, method: string, url: string, body?: unknown) {
  const r = await fetch(`${base}/api${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: who.cookie, 'X-CSRF-Token': who.csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => null)) as Json };
}
/** Open the public form and send it the way a phone would (waiting past the "too fast" guard). */
async function fill(fields: Record<string, string>, opts: { wait?: boolean; forwardedFor?: string } = {}) {
  const page = await fetch(`${base}/v/${token}`);
  const html = await page.text();
  const t = /name="t" value="([^"]+)"/.exec(html)?.[1] ?? '';
  if (opts.wait !== false) await new Promise((r) => setTimeout(r, 2100));
  const r = await fetch(`${base}/v/${token}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(opts.forwardedFor ? { 'X-Forwarded-For': opts.forwardedFor } : {}) },
    body: new URLSearchParams({ t, lang: 'en', ...fields }).toString(),
  });
  return { status: r.status, html: await r.text() };
}

before(async () => {
  for (const role of ['admin', 'editor', 'viewer'] as const) createUser({ username: role, display_name: `Test ${role}`, password: 'correct-horse-5', role });
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const role of ['admin', 'editor', 'viewer'] as const) as[role] = await login(role);
  sid = svc.createService({ date: today, ref: 'EN-TEST-1' }).service.id;
});

after(async () => {
  await new Promise((r) => server.close(r));
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('off for the church: no form; administrators switch it on, editors switch a service on', async () => {
  assert.equal((await call(as.editor, 'PUT', '/visitor-form-settings', { enabled: true })).status, 403);
  let info = await call(as.editor, 'PUT', `/services/${sid}/visitor-form`, { enabled: true, bulletin: true, slides: true });
  assert.equal(info.status, 200);
  token = info.body.token;
  assert.match(token, /^[\w-]{20,}$/);
  assert.equal((await fetch(`${base}/v/${token}`)).status, 404, 'church switch is off');
  assert.equal((await call(as.admin, 'PUT', '/visitor-form-settings', { enabled: true, prayer: true })).status, 200);
  const page = await fetch(`${base}/v/${token}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'none'/);
  assert.ok(html.includes('name="prayer"'));
  assert.ok(!html.includes('<script'), 'no scripts');
  assert.equal((await call(as.viewer, 'PUT', `/services/${sid}/visitor-form`, { enabled: false })).status, 403);
  info = await call(as.viewer, 'GET', `/services/${sid}/visitor-form`);
  assert.equal(info.body.url.endsWith(`/v/${token}`), true);
  // the link uses this computer's network address; only without a network does it fall back to 127.0.0.1 (and warn)
  const { lanAddress } = await import('../server/lib/lan.ts');
  assert.equal(info.body.local_only, !lanAddress(), 'a link phones can open, or a warning');
});

test('protections: trap field, too fast, missing name, consent for contact details, closed window', async () => {
  const trap = await fill({ name: 'Bot', website: 'http://spam.example' }, { wait: false });
  assert.equal(trap.status, 200, 'answers as if it worked');
  assert.equal(vf.cardsFor(sid).length, 0, '…but keeps nothing');
  assert.equal((await fill({ name: 'Too Fast' }, { wait: false })).status, 400);
  assert.equal((await fill({ name: '' })).status, 400);
  const noConsent = await fill({ name: 'Pat Example', contact: '9000 0002' });
  assert.equal(noConsent.status, 400);
  assert.match(noConsent.html, /tick the box/);
  assert.ok(noConsent.html.includes('value="Pat Example"'), 'what was typed is kept');

  const old = svc.createService({ date: '2020-01-05' }).service.id;
  const oldTok = vf.setServiceForm(old, { enabled: true }).token!;
  assert.equal((await fetch(`${base}/v/${oldTok}`)).status, 410);
  assert.equal(vf.formOpen('2026-10-04', '2026-10-03'), true, 'opens the day before');
  assert.equal(vf.formOpen('2026-10-04', '2026-10-02'), false);
  assert.equal(vf.formOpen('2026-10-04', '2026-10-07'), true, '3 days after (default)');
  assert.equal(vf.formOpen('2026-10-04', '2026-10-08'), false);
});

test('an entry waits for review; accepting adds the visitor (prayer kept private); discarding deletes', async () => {
  const ok = await fill({ name: 'Pat Example', contact: '9000 0002', source: 'a friend', wants_contact: '1', prayer: 'For my exams', consent: '1' });
  assert.equal(ok.status, 200);
  assert.match(ok.html, /Thank you/);
  await fill({ name: 'Duplicate Entry' });
  const cards = (await call(as.editor, 'GET', `/services/${sid}/visitor-cards`)).body as Json[];
  assert.equal(cards.length, 2);
  assert.equal(cards[0].prayer, 'For my exams');
  assert.equal((await call(as.viewer, 'GET', `/services/${sid}/visitor-cards`)).status, 403);
  const list = await call(as.editor, 'GET', `/records?from=${today}&to=${today}`);
  assert.equal(list.body.find((r: Json) => r.service_id === sid).pending_cards, 2);

  assert.equal((await call(as.editor, 'POST', `/visitor-cards/${cards[0].id}/accept`, {})).status, 200);
  assert.equal((await call(as.editor, 'DELETE', `/visitor-cards/${cards[1].id}`)).status, 200);
  assert.equal(vf.cardsFor(sid).length, 0);
  const rec = await call(as.editor, 'GET', `/services/${sid}/record`);
  const v = rec.body.visitors[0];
  assert.deepEqual([v.name, v.contact, v.source, v.prayer], ['Pat Example', '9000 0002', 'a friend', 'For my exams']);
  assert.match(v.notes, /Would like to be contacted · via visitor form/);
  const asViewer = await call(as.viewer, 'GET', `/services/${sid}/record`);
  const seen = asViewer.body.visitors[0];
  assert.equal(seen.name, 'Pat Example');
  for (const k of ['contact', 'prayer', 'notes']) assert.ok(!(k in seen), `${k} hidden from read-only users`);
});

test('the QR code goes on the bulletin back page and on a slide when chosen; copies get no link or reference', () => {
  db.prepare('INSERT INTO service_items (service_id, position, kind, title, on_slides) VALUES (?, 0, ?, ?, 1)').run(sid, 'announcements', JSON.stringify({ en: 'Announcements' }));
  db.prepare('INSERT INTO service_items (service_id, position, kind, title, on_slides) VALUES (?, 1, ?, ?, 1)').run(sid, 'prayer', JSON.stringify({ en: 'Prayer' }));
  const r = renderService(sid);
  const qr = (r.bulletin.blocks ?? []).find((b) => b.id < 0);
  assert.ok(qr && qr.data.value?.endsWith(`/v/${token}`));
  assert.match(qr!.data.value ?? '', /^http:\/\/[\d.]+:\d+\/v\//, 'a full address (this computer on the network), not a bare path');
  assert.ok(r.bulletin.options.page_layout.some((s) => s.id === 'visitor-form' && s.last_page));
  const ann = r.items.find((x) => x.kind === 'announcements')!;
  assert.equal(ann.slide_blocks.at(-1)?.value?.endsWith(`/v/${token}`), true);
  assert.equal(r.items.find((x) => x.kind === 'prayer')!.slide_blocks.length, 0);

  vf.setServiceForm(sid, { enabled: true, bulletin: false, slides: false });
  assert.equal((renderService(sid).bulletin.blocks ?? []).some((b) => b.id < 0), false);

  const copy = svc.duplicateService(sid, '2034-04-02');
  assert.equal(copy.ref ?? null, null, 'reference not copied (it is unique)');
  assert.deepEqual(copy.visitor_form ?? {}, {}, 'visitor form link not copied');
});

test('"How did you hear about us?": the church\'s answers (kept in its first language), Other with words, edited in Settings', async () => {
  resetVisitorFormLimits();
  const page = await (await fetch(`${base}/v/${token}`)).text();
  assert.ok(page.includes('A friend or family member invited me') && page.includes('亲友邀请'), 'default answers in both languages');
  assert.ok(page.includes('name="source_choice" value="other"'));
  await fill({ name: 'Chooser One', source_choice: '0' });
  await fill({ name: 'Chooser Two', source_choice: 'other', source: 'a podcast' });
  await fill({ name: 'Chooser Three', source_choice: '99', source: '' });
  const cards = vf.cardsFor(sid);
  assert.deepEqual(cards.map((c) => [c.name, c.source]), [
    ['Chooser One', 'A friend or family member invited me'], ['Chooser Two', 'a podcast'], ['Chooser Three', null],
  ]);
  const saved = await call(as.admin, 'PUT', '/visitor-form-settings', { sources: [{ en: 'Test answer', zh: '测试' }, {}] });
  assert.deepEqual(saved.body.sources, [{ en: 'Test answer', zh: '测试' }], 'empty answers are dropped');
  assert.ok((await (await fetch(`${base}/v/${token}`)).text()).includes('Test answer'));
});

test('per-address limit: generous (church Wi-Fi shares one address), then refused', async () => {
  resetVisitorFormLimits();
  const pages = await Promise.all(Array.from({ length: PER_ADDRESS + 1 }, () => fetch(`${base}/v/${token}`).then((r) => r.text())));
  await new Promise((r) => setTimeout(r, 2100));
  const statuses: number[] = [];
  for (const html of pages) {
    const t = /name="t" value="([^"]+)"/.exec(html)?.[1] ?? '';
    const r = await fetch(`${base}/v/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ t, name: 'Repeat Sender' }).toString() });
    statuses.push(r.status);
  }
  assert.deepEqual(statuses, [...Array(PER_ADDRESS).fill(200), 429]);
  assert.ok(PER_ADDRESS >= 30, 'room for a congregation on shared Wi-Fi');
});

test('"Which describes you best?": one of the church\'s answers, sensitive, counted in the report for editors only', async () => {
  resetVisitorFormLimits();
  const page = await (await fetch(`${base}/v/${token}`)).text();
  assert.ok(page.includes('慕道友') && page.includes('Interested in the Christian faith'));
  await fill({ name: 'Seeker Example', about_choice: '0', source_choice: '1' });
  await fill({ name: 'Made Up', about_choice: '42' });
  const cards = vf.cardsFor(sid).filter((c) => ['Seeker Example', 'Made Up'].includes(c.name));
  assert.deepEqual(cards.map((c) => c.about), ['Interested in the Christian faith', null], 'only the church\'s answers are kept');
  await call(as.editor, 'POST', `/visitor-cards/${cards[0].id}/accept`, {});
  const rec = await call(as.editor, 'GET', `/services/${sid}/record`);
  assert.equal(rec.body.visitors.find((v: Json) => v.name === 'Seeker Example').about, 'Interested in the Christian faith');
  const viewer = await call(as.viewer, 'GET', `/services/${sid}/record`);
  assert.ok(!('about' in viewer.body.visitors.find((v: Json) => v.name === 'Seeker Example')), 'hidden from read-only users');
  const rep = await call(as.editor, 'GET', `/reports/visitors?from=${today}&to=${today}`);
  assert.deepEqual(rep.body.abouts, [{ about: 'Interested in the Christian faith', count: 1 }]);
  const repViewer = await call(as.viewer, 'GET', `/reports/visitors?from=${today}&to=${today}`);
  assert.equal(repViewer.body.abouts, undefined);
  // no answers = the question is not asked
  await call(as.admin, 'PUT', '/visitor-form-settings', { abouts: [] });
  assert.ok(!(await (await fetch(`${base}/v/${token}`)).text()).includes('about_choice'));
});

test('0.16.0: a Traditional Chinese service gets the form in Traditional, the church\'s Simplified wording converted', async () => {
  const s2 = svc.createService({ date: new Date().toISOString().slice(0, 10), languages: ['zh-Hant', 'en'] }).service.id;
  const t2 = (await call(as.editor, 'PUT', `/services/${s2}/visitor-form`, { enabled: true })).body.token as string;
  await call(as.admin, 'PUT', '/visitor-form-settings', { sources: [{ en: 'A friend or family member invited me', zh: '亲友邀请' }] });
  const html = await (await fetch(`${base}/v/${t2}`)).text();
  assert.match(html, /<html lang="zh-Hant">/);
  assert.ok(html.includes('您的姓名') && html.includes('Your name'), 'the label in Traditional (same characters here), English below');
  assert.ok(html.includes('親友邀請'), 'the church’s answer, kept in Simplified, shows converted: 亲友邀请 → 親友邀請');
  assert.ok(!html.includes('亲友邀请'), 'not the Simplified');
});
