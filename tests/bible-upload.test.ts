// Church-uploaded Bibles: CSV / JSON parsing (book names in English, abbreviations, Chinese, numbers),
// GBK files, dry runs, missing-book and problem reports, replacing, admin-only access, Bible version
// precedence in a service (reading → service → church default) and the Chinese-script fallback.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-bible-'));
process.env.CANON_DB = path.join(tmp, 'test.db');
delete process.env.CANON_TRUST_PROXY;

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const svc = await import('../server/repo/services.ts');
const bible = await import('../server/repo/bible.ts');
const { renderService } = await import('../server/repo/render.ts');
const { updateSettings } = await import('../server/repo/settings.ts');
const { LIBRARY_TOOLS } = await import('../server/mcp-tools/library.ts');
const { get, db } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let server: Server;
let base = '';
const sessions: Record<string, { cookie: string; csrf: string }> = {};

async function login(username: string) {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'correct-horse-1' }) });
  assert.equal(r.status, 200);
  sessions[username] = { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), csrf: ((await r.json()) as Json).csrf };
}
const GET = (user: string, url: string) => fetch(`${base}/api${url}`, { headers: { Cookie: sessions[user].cookie } });
const DEL = (user: string, url: string) =>
  fetch(`${base}/api${url}`, { method: 'DELETE', headers: { Cookie: sessions[user].cookie, 'X-CSRF-Token': sessions[user].csrf } });

/** POST a Bible file to /bible/uploads with metadata as query parameters. */
async function upload(body: string | Uint8Array, meta: Record<string, string | number>, user = 'admin') {
  const q = new URLSearchParams({ lang: 'en', language: 'en', permission: '1', ...Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, String(v)])) });
  const r = await fetch(`${base}/api/bible/uploads?${q}`, {
    method: 'POST',
    headers: { Cookie: sessions[user].cookie, 'X-CSRF-Token': sessions[user].csrf, 'Content-Type': 'application/octet-stream' },
    body: typeof body === 'string' ? body : new Blob([body as Uint8Array<ArrayBuffer>]),
  });
  return { status: r.status, json: (await r.json()) as Json };
}
const verseCount = (code: string) => get<{ n: number }>('SELECT COUNT(*) n FROM bible_verses WHERE translation = ?', code)!.n;
const verseText = (code: string, b: number, c: number, v: number) =>
  get<{ text: string }>('SELECT text FROM bible_verses WHERE translation = ? AND book = ? AND chapter = ? AND verse = ?', code, b, c, v)?.text;

before(async () => {
  for (const role of ['admin', 'editor', 'viewer'] as const) createUser({ username: role, display_name: role, password: 'correct-horse-1', role });
  updateSettings({ languages: ['en', 'zh', 'zh-Hant'] });
  server = createApp().listen(0, '127.0.0.1');
  // a full parallel test run is slow: idle connections stay open for the next request (no reset mid-test)
  server.keepAliveTimeout = 120_000;
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const u of ['admin', 'editor', 'viewer']) await login(u);
});

after(async () => {
  await new Promise((r) => server.close(r));
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------- parsing & dry run

const MIXED = [
  'book,chapter,verse,text',
  'Genesis,1,1,In the beginning.',
  'Gen,1,2,And the earth was without form.',
  '1,1,3,Let there be light.',
  'Ps,23,1,The LORD is my shepherd.',
  '"1 Cor",13,4,Love suffereth long.',
  'II Kings,2,11,A chariot of fire.',
  '约翰福音,3,16,神爱世人。',
  '林前,13,13,如今常存的有信，有望，有爱。',
  '創,1,4,神看光是好的。',
  'Jhn,3,17,For God sent not his Son.',
  '66,22,21,The grace of our Lord.',
].join('\r\n');

test('dry run: English names, abbreviations, Chinese (both scripts) and numbers; nothing is written', async () => {
  const before = get<{ n: number }>('SELECT COUNT(*) n FROM bible_verses')!.n;
  const { status, json } = await upload(MIXED, { dry_run: 1, code: 'mix', name: 'Mixed test' });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.applied, false);
  assert.equal(json.fatal, null);
  assert.equal(json.verses, 11);
  assert.equal(json.errors.count, 0);
  assert.equal(json.meta.code, 'MIX', 'code is upper-cased');
  const found = json.books.found.map((b: Json) => b.n);
  assert.deepEqual(found, [1, 12, 19, 43, 46, 66]);
  assert.equal(json.books.found.find((b: Json) => b.n === 1).verses, 4);
  assert.equal(json.books.missing.length, 60);
  assert.deepEqual(json.samples.map((s: Json) => s.ref), ['Genesis 1:1', 'Psalms 23:1', 'John 3:16']);
  assert.equal(json.samples[2].text, '神爱世人。');
  assert.equal(get<{ n: number }>('SELECT COUNT(*) n FROM bible_verses')!.n, before, 'dry run wrote no verses');
  assert.equal(get('SELECT 1 FROM bible_translations WHERE code = ?', 'MIX'), undefined, 'dry run wrote no translation');
});

test('reference,text columns and scrollmapper JSON are read too', async () => {
  const ref = await upload('reference,text\r\nJohn 3:16,For God so loved.\r\n约 3:17,因为神差他的儿子。\r\nRom 8,not a verse\r\n', { dry_run: 1, code: 'REF', name: 'Ref' });
  assert.equal(ref.json.verses, 2);
  assert.equal(ref.json.errors.count, 1);
  assert.equal(ref.json.errors.rows[0].row, 4);
  const sm = JSON.stringify({ translation: 'X', books: [{ name: 'Genesis', chapters: [{ chapter: 1, verses: [{ verse: 1, text: 'In the beginning' }, { verse: 2, text: 'And the earth' }] }] }, { name: 'I Samuel', chapters: [{ chapter: 3, verses: [{ verse: 10, text: 'Speak; for thy servant heareth.' }] }] }] });
  const j = await upload(sm, { dry_run: 1, code: 'SMJ', name: 'Scrollmapper JSON' });
  assert.equal(j.json.format, 'json');
  assert.equal(j.json.verses, 3);
  assert.deepEqual(j.json.books.found.map((b: Json) => b.n), [1, 9]);
});

// "book,chapter,verse,text\r\n创世记,1,1,起初神创造天地。\r\n约翰福音,3,16,神爱世人，甚至将他的独生子赐给他们，叫一切信他的，不至灭亡，反得永生。\r\n" saved in GBK
const GBK = Uint8Array.from([
  0x62, 0x6f, 0x6f, 0x6b, 0x2c, 0x63, 0x68, 0x61, 0x70, 0x74, 0x65, 0x72, 0x2c, 0x76, 0x65, 0x72, 0x73, 0x65, 0x2c, 0x74, 0x65, 0x78, 0x74, 0xd, 0xa,
  0xb4, 0xb4, 0xca, 0xc0, 0xbc, 0xc7, 0x2c, 0x31, 0x2c, 0x31, 0x2c, 0xc6, 0xf0, 0xb3, 0xf5, 0xc9, 0xf1, 0xb4, 0xb4, 0xd4, 0xec, 0xcc, 0xec, 0xb5, 0xd8, 0xa1, 0xa3, 0xd, 0xa,
  0xd4, 0xbc, 0xba, 0xb2, 0xb8, 0xa3, 0xd2, 0xf4, 0x2c, 0x33, 0x2c, 0x31, 0x36, 0x2c, 0xc9, 0xf1, 0xb0, 0xae, 0xca, 0xc0, 0xc8, 0xcb, 0xa3, 0xac, 0xc9, 0xf5, 0xd6, 0xc1,
  0xbd, 0xab, 0xcb, 0xfb, 0xb5, 0xc4, 0xb6, 0xc0, 0xc9, 0xfa, 0xd7, 0xd3, 0xb4, 0xcd, 0xb8, 0xf8, 0xcb, 0xfb, 0xc3, 0xc7, 0xa3, 0xac, 0xbd, 0xd0, 0xd2, 0xbb, 0xc7, 0xd0,
  0xd0, 0xc5, 0xcb, 0xfb, 0xb5, 0xc4, 0xa3, 0xac, 0xb2, 0xbb, 0xd6, 0xc1, 0xc3, 0xf0, 0xcd, 0xf6, 0xa3, 0xac, 0xb7, 0xb4, 0xb5, 0xc3, 0xd3, 0xc0, 0xc9, 0xfa, 0xa1, 0xa3, 0xd, 0xa,
]);

test('a GBK file is decoded and imported (Chinese text intact)', async () => {
  const dry = await upload(GBK, { dry_run: 1, code: 'GBKT', name: '测试', language: 'zh' });
  assert.equal(dry.json.encoding, 'gb18030');
  assert.ok(dry.json.notes.some((n: string) => /GBK/.test(n)), dry.json.notes.join(' | '));
  assert.equal(dry.json.verses, 2);
  const r = await upload(GBK, { code: 'GBKT', name: '测试', language: 'zh' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.applied, true);
  assert.equal(verseText('GBKT', 1, 1, 1), '起初神创造天地。');
  const row = get<Json>('SELECT * FROM bible_translations WHERE code = ?', 'GBKT')!;
  assert.equal(row.source, 'upload');
  assert.equal(row.lang, 'zh');
});

test('missing books, duplicates and unreadable rows are reported with row numbers; problems block the import', async () => {
  const csv = 'book,chapter,verse,text\nMatt,1,1,The book of the generation.\nMatt,1,1,Again.\nNowhere,1,1,x\nMark,one,1,y\nLuke,1,1,\nMark,1,1,The beginning.\n';
  const { json } = await upload(csv, { dry_run: 1, code: 'NTX', name: 'NT test' });
  assert.equal(json.verses, 2);
  assert.equal(json.duplicates.count, 1);
  assert.deepEqual(json.duplicates.rows[0], { row: 3, first: 2, ref: 'Matthew 1:1' });
  assert.deepEqual(json.errors.rows.map((e: Json) => e.row), [4, 5, 6]);
  assert.match(json.errors.rows[0].message, /unknown book "Nowhere"/);
  assert.match(json.errors.rows[1].message, /chapter "one"/);
  assert.match(json.errors.rows[2].message, /text is empty/);
  assert.equal(json.books.missing.length, 64);
  assert.ok(json.books.missing.some((b: Json) => b.name === 'Genesis'));
  const zh = await upload(csv, { dry_run: 1, code: 'NTX', name: 'NT test', lang: 'zh' });
  assert.ok(zh.json.books.missing.some((b: Json) => b.name === '创世记'), 'book names follow the message language');
  assert.match(zh.json.errors.rows[0].message, /无法识别的书卷/);

  const blocked = await upload(csv, { code: 'NTX', name: 'NT test' });
  assert.equal(blocked.status, 422);
  assert.equal(verseCount('NTX'), 0);
  const ok = await upload(csv, { code: 'NTX', name: 'NT test', skip_errors: 1 });
  assert.equal(ok.status, 200);
  assert.equal(verseCount('NTX'), 2);
  assert.equal(verseText('NTX', 40, 1, 1), 'The book of the generation.', 'the first of duplicate rows is kept');
});

test('replacing an installed translation needs confirmation and swaps the text', async () => {
  const first = await upload('book,chapter,verse,text\nJohn,1,1,Old text.\nJohn,1,2,Only in the old file.\n', { code: 'RPL', name: 'Replace me' });
  assert.equal(first.status, 200);
  const dry = await upload('book,chapter,verse,text\nJohn,1,1,New text.\n', { dry_run: 1, code: 'rpl', name: 'Replaced' });
  assert.equal(dry.json.existing.verses, 2, 'the preview shows what would be replaced');
  const refused = await upload('book,chapter,verse,text\nJohn,1,1,New text.\n', { code: 'RPL', name: 'Replaced' });
  assert.equal(refused.status, 409);
  assert.equal(verseText('RPL', 43, 1, 1), 'Old text.');
  const ok = await upload('book,chapter,verse,text\nJohn,1,1,New text.\n', { code: 'RPL', name: 'Replaced', replace: 1 });
  assert.equal(ok.status, 200);
  assert.equal(verseCount('RPL'), 1);
  assert.equal(verseText('RPL', 43, 1, 1), 'New text.');
  assert.equal(get<{ name: string }>('SELECT name FROM bible_translations WHERE code = ?', 'RPL')!.name, 'Replaced');
});

test('admins only; the permission box, the code and catalog clashes are checked', async () => {
  const csv = 'book,chapter,verse,text\nGen,1,1,x\n';
  for (const u of ['editor', 'viewer']) {
    const r = await upload(csv, { dry_run: 1, code: 'NOPE', name: 'x' }, u);
    assert.equal(r.status, 403, u);
    assert.equal((await DEL(u, '/bible/translations/RPL')).status, 403);
    assert.equal((await GET(u, '/bible/translations/RPL/export.csv')).status, 403);
  }
  assert.equal((await upload(csv, { code: 'PERM', name: 'x', permission: 0 })).status, 400);
  assert.equal(verseCount('PERM'), 0);
  const bad = await upload(csv, { dry_run: 1, code: 'E S V!', name: 'x' });
  assert.equal(bad.json.meta_errors.length, 1);
  assert.equal((await upload(csv, { code: 'E', name: 'x' })).status, 400);
  const clash = await upload(csv, { code: 'KJV', name: 'Not KJV', language: 'zh' });
  assert.equal(clash.status, 400);
  assert.match(clash.json.error, /KJV is the code of the English/);
  const lang = await upload(csv, { code: 'XX1', name: 'x', language: 'xx' });
  assert.equal(lang.status, 400);
});

test('a full-size Bible (31k verses, ~5 MB) imports quickly in one transaction', async () => {
  const rows = ['book,chapter,verse,text'];
  for (let i = 0; i < 31102; i++) {
    const j = Math.floor(i / 66);
    rows.push(`${(i % 66) + 1},${Math.floor(j / 40) + 1},${(j % 40) + 1},"Verse ${i}: ${'and the word of the Lord came, saying, '.repeat(4)}"`);
  }
  const body = rows.join('\r\n');
  assert.ok(body.length > 5_000_000);
  const t0 = Date.now();
  const r = await upload(body, { code: 'BIG', name: 'Big' });
  const ms = Date.now() - t0;
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 300));
  assert.equal(verseCount('BIG'), 31102);
  // one transaction: under a second on its own; a commit per verse would take minutes (30 s allows a busy machine)
  assert.ok(ms < 30_000, `took ${ms} ms`);
});

// ---------------------------------------------------------------- using versions

const JOHN = (s: string) => `book,chapter,verse,text\nJohn,3,16,${s}\n`;

test('render precedence: a reading’s version beats the service’s, which beats the church default', async () => {
  for (const c of ['DEFA', 'SVCB', 'ITMC']) assert.equal((await upload(JOHN(`${c} text`), { code: c, name: c })).status, 200);
  updateSettings({ bibles: { en: 'DEFA', zh: 'CUVS', 'zh-Hant': 'CUVT' } });
  const { service } = svc.createService({ date: '2026-11-08', languages: ['en'] });
  const it = svc.addItem(service.id, { kind: 'scripture', title: { en: 'Reading' }, scripture_ref: 'John 3:16' });
  const tr = () => renderService(service.id).items.find((x) => x.id === it.id)!.scripture!.passages.en!;
  assert.equal(tr().translation, 'DEFA');
  svc.services.update(service.id, { bibles: { en: 'SVCB' } });
  assert.equal(tr().translation, 'SVCB');
  assert.equal(tr().verses[0].text, 'SVCB text');
  svc.updateItem(it.id, { bibles: { en: 'ITMC' } });
  assert.equal(tr().translation, 'ITMC');
  // a version that has been deleted, or one in the wrong language, falls back
  svc.updateItem(it.id, { bibles: { en: 'GBKT' } });
  assert.equal(tr().translation, 'SVCB', 'a Chinese Bible is not used for English');
  const del = await DEL('admin', '/bible/translations/SVCB');
  assert.equal(del.status, 200);
  assert.equal(tr().translation, 'DEFA');
});

test('Chinese fallback: a Traditional-only Bible serves Simplified readings (converted)', async () => {
  assert.equal((await upload('book,chapter,verse,text\n約翰福音,3,16,神愛世人。\n', { code: 'TCV', name: '測試', language: 'zh-Hant' })).status, 200);
  updateSettings({ bibles: { en: 'DEFA', zh: 'NOSUCH', 'zh-Hant': 'TCV' } });
  const p = bible.passage('约 3:16', 'zh');
  assert.equal(p.translation, 'TCV');
  assert.equal(p.verses[0].text, '神爱世人。');
  // explicitly chosen across scripts is converted too
  const q = bible.passage('John 3:16', 'zh-Hant', 'GBKT');
  assert.equal(q.translation, 'GBKT');
  assert.equal(q.verses[0].text, '神愛世人，甚至將他的獨生子賜給他們，叫一切信他的，不至滅亡，反得永生。');
});

test('passage endpoint: any installed version; unknown or wrong-language versions are refused clearly', async () => {
  const ok = (await (await GET('viewer', '/bible/passage?ref=John%203:16&lang=en&translation=itmc')).json()) as Json;
  assert.equal(ok.translation, 'ITMC');
  const wrong = await GET('viewer', '/bible/passage?ref=John%203:16&lang=zh&translation=ITMC');
  assert.equal(wrong.status, 400);
  assert.match(((await wrong.json()) as Json).error, /ITMC is a English Bible; it cannot be used for Chinese/);
  const missing = await GET('viewer', '/bible/passage?ref=John%203:16&lang=en&translation=ESV');
  assert.equal(missing.status, 404);
  assert.match(((await missing.json()) as Json).error, /not installed/);
  const list = (await (await GET('viewer', '/bible/translations')).json()) as Json[];
  const itmc = list.find((t) => t.code === 'ITMC')!;
  assert.equal(itmc.source, 'upload');
  assert.equal(itmc.verses, 1);
});

test('MCP canon_bible: no ref lists the installed versions; a reading in a chosen version', async () => {
  const tool = LIBRARY_TOOLS.find((t) => t.name === 'canon_bible')!;
  const list = (await tool.handler({ limit: 30 }, {} as never)) as Json[];
  assert.ok(list.some((t) => t.code === 'DEFA' && t.default === true && t.source === 'upload'));
  const p = (await tool.handler({ ref: 'John 3:16', lang: 'en', translation: 'ITMC', limit: 30 }, {} as never)) as Json;
  assert.equal(p.translation, 'ITMC');
  assert.throws(() => tool.handler({ ref: 'John 3:16', lang: 'zh', translation: 'ITMC', limit: 30 }, {} as never), /cannot be used for Chinese/);
});

test('delete reports usage; export and template download as CSV', async () => {
  const { service } = svc.createService({ date: '2026-11-15', languages: ['en'], bibles: { en: 'ITMC' } });
  const usage = (await (await GET('admin', '/bible/translations/ITMC/usage')).json()) as Json;
  assert.equal(usage.services, 1);
  updateSettings({ bibles: { en: 'ITMC' } });
  assert.deepEqual(((await (await GET('admin', '/bible/translations/ITMC/usage')).json()) as Json).default_for, ['en']);

  const exp = await GET('admin', '/bible/translations/NTX/export.csv');
  assert.equal(exp.status, 200);
  const text = await exp.text();
  assert.ok(text.replace(/^﻿/, '').startsWith('book,chapter,verse,text\r\nMatthew,1,1,The book of the generation.'), text.slice(0, 80));
  const tpl = await (await GET('viewer', '/bible/template.csv')).text();
  assert.match(tpl, /Genesis,1,1,In the beginning God created the heaven and the earth\./);
  assert.match(tpl, /创世记,1,1,起初，神创造天地。/);
  // the template itself imports (its 创世记 1:1 is reported as a duplicate of Genesis 1:1)
  const dry = await upload(tpl, { dry_run: 1, code: 'TPL', name: 'Template' });
  assert.equal(dry.json.verses, 3);
  assert.equal(dry.json.duplicates.count, 1);

  const del = (await (await DEL('admin', '/bible/translations/ITMC')).json()) as Json;
  assert.deepEqual([del.verses, del.services, del.default_for], [1, 1, ['en']]);
  assert.equal(verseCount('ITMC'), 0);
  assert.equal((await DEL('admin', '/bible/translations/ITMC')).status, 404);
  svc.services.remove(service.id);
});

// ---------------------------------------------------------------- licence: edition, allowed uses (0.13)

test('licence rights: an upload starts without "online"; outputs not allowed show the reference only; the planner warns', async () => {
  const send = (user: string, method: string, url: string, body: unknown) => fetch(`${base}/api${url}`, {
    method, headers: { Cookie: sessions[user].cookie, 'X-CSRF-Token': sessions[user].csrf, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await upload(JOHN('Licensed text'), { code: 'LICV', name: 'Licensed Version' })).status, 200);
  assert.deepEqual(bible.translations().find((x) => x.code === 'LICV')!.rights, { print: true, project: true, online: false });
  const { service } = svc.createService({ date: '2026-11-15', languages: ['en'] });
  svc.addItem(service.id, { kind: 'scripture', title: { en: 'Reading' }, scripture_ref: 'John 3:16', bibles: { en: 'LICV' } });
  const passage = async (url: string, user: string | null = 'editor') => {
    const r = await fetch(`${base}/api${url}`, user ? { headers: { Cookie: sessions[user].cookie } } : {});
    assert.equal(r.status, 200, url);
    return ((await r.json()) as Json).items.find((x: Json) => x.scripture).scripture.passages.en;
  };
  assert.equal((await passage(`/services/${service.id}/render`)).verses.length, 1, 'the planner sees the text');
  assert.equal((await (await GET('editor', `/services/${service.id}/rights`)).json() as Json[]).length, 0, 'no share link yet: nothing to warn about');

  // the share page (online) gives the reference only
  const token = ((await (await send('editor', 'POST', `/services/${service.id}/share`, { enabled: true })).json()) as Json).token;
  const shared = await passage(`/share/${token}`, null);
  assert.deepEqual(shared.verses, []);
  assert.equal(shared.withheld, 'online');
  assert.deepEqual(((await (await GET('editor', `/services/${service.id}/rights`)).json()) as Json[]).map((w) => [w.translation, w.uses]), [['LICV', ['online']]]);

  // administrators record the licence; projection not allowed → slides give the reference only, the bulletin the text
  assert.equal((await send('editor', 'PATCH', '/bible/translations/LICV', { rights: { project: false } })).status, 403);
  const set = await send('admin', 'PATCH', '/bible/translations/LICV', { edition: '2020 text', rights: { project: false, online: true } });
  assert.equal(set.status, 200);
  assert.equal(((await set.json()) as Json).edition, '2020 text');
  assert.deepEqual((await passage(`/services/${service.id}/render?for=project`)).verses, []);
  assert.equal((await passage(`/services/${service.id}/render?for=print`)).verses.length, 1);
  assert.equal((await passage(`/share/${token}`, null)).verses.length, 1, 'online now allowed');
  assert.deepEqual(((await (await GET('editor', `/services/${service.id}/rights`)).json()) as Json[]).map((w) => w.uses), [['project']]);

  // uploading the version again keeps what the administrator recorded
  assert.equal((await upload(JOHN('Licensed text v2'), { code: 'LICV', name: 'Licensed Version', replace: 1 })).status, 200);
  assert.deepEqual(bible.translations().find((x) => x.code === 'LICV')!.rights, { print: true, project: false, online: true });
});
