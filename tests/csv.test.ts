// CSV framework: parser edge cases, Chinese legacy encodings, round trips, songs / templates imports,
// all-or-nothing, dry runs, viewer permissions and the older import endpoints.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-csv-'));
process.env.CANON_DB = path.join(tmp, 'test.db');
delete process.env.CANON_TRUST_PROXY;

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const { seed, installLibrary } = await import('../server/seed/index.ts');
const reg = await import('../server/repo/registers.ts');
const lib = await import('../server/repo/library.ts');
const svc = await import('../server/repo/services.ts');
const { updateSettings } = await import('../server/repo/settings.ts');
const { all, get, db } = await import('../server/db.ts');
const csv = await import('../server/lib/csv.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let server: Server;
let base = '';
const sessions: Record<string, { cookie: string; csrf: string }> = {};

async function login(username: string) {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'correct-horse-1' }) });
  assert.equal(r.status, 200);
  sessions[username] = { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), csrf: ((await r.json()) as Json).csrf };
}

async function GET(user: string, url: string) {
  return fetch(`${base}/api${url}`, { headers: { Cookie: sessions[user].cookie } });
}
async function POST(user: string, url: string, body: string | Uint8Array, type = 'text/csv') {
  return fetch(`${base}/api${url}`, {
    method: 'POST',
    headers: { Cookie: sessions[user].cookie, 'X-CSRF-Token': sessions[user].csrf, 'Content-Type': type },
    body: typeof body === 'string' ? body : new Blob([body as Uint8Array<ArrayBuffer>]),
  });
}
async function importCsv(entity: string, body: string | Uint8Array, q = 'dry_run=1', user = 'editor') {
  const r = await POST(user, `/csv/${entity}/import?${q}&lang=en`, body);
  return { status: r.status, json: (await r.json()) as Json };
}

before(async () => {
  for (const role of ['admin', 'editor', 'viewer'] as const) await createUser({ username: role, display_name: role, password: 'correct-horse-1', role });
  updateSettings({ languages: ['en', 'zh'] });
  await seed();
  await installLibrary(['songs', 'texts', 'templates']);
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

// ---------------------------------------------------------------- parser / writer / decoder

test('parser: quotes, embedded newlines, CRLF, BOM, blank rows and row numbers', () => {
  const text = '﻿a,b,c\r\n"x, y","say ""hi""","line 1\r\nline 2"\r\n\r\n1,,3\n';
  const recs = csv.parseRecords(text);
  assert.deepEqual(recs.map((r) => r.cells), [['a', 'b', 'c'], ['x, y', 'say "hi"', 'line 1\nline 2'], ['1', '', '3']]);
  assert.deepEqual(recs.map((r) => r.row), [1, 2, 4], 'blank row 3 skipped but counted');
  assert.deepEqual(csv.parseCsv('a,b\n"unterminated'), [['a', 'b'], ['unterminated']]);
});

test('parser: semicolon and tab delimiters are detected (commas inside cells kept)', () => {
  assert.equal(csv.detectDelimiter('first_name;last_name;notes\nDavid;Tan;"a, b"'), ';');
  assert.deepEqual(csv.parseCsv('first_name;last_name;notes\r\nDavid;Tan;a, b'), [['first_name', 'last_name', 'notes'], ['David', 'Tan', 'a, b']]);
  assert.equal(csv.detectDelimiter('a\tb\tc\n1\t2\t3'), '\t');
  assert.equal(csv.detectDelimiter('sep=;\na,b;c'), ';');
  assert.deepEqual(csv.parseCsv('sep=;\na;b'), [['a', 'b']]);
});

test('writer: BOM, CRLF, quoting and the Excel formula guard round-trip', () => {
  const out = csv.writeCsv([['phone', 'note', 'n'], ['+60 12-345 6789', 'a "b", c\nd', -5], ['=SUM(A1)', ' padded ', true]]);
  assert.ok(out.startsWith('﻿phone,note,n\r\n'));
  const back = csv.parseCsv(out).map((r) => r.map((c) => csv.readCell(c)));
  assert.deepEqual(back[1], ['+60 12-345 6789', 'a "b", c\nd', '-5']);
  assert.equal(csv.parseCsv(out)[2][0], "'=SUM(A1)", 'formula guarded in the file');
  assert.equal(back[2][0], '=SUM(A1)', '…and unguarded on import');
  assert.equal(back[2][2], 'yes');
});

// "first_name,native_name\r\nDavid,陈大卫\r\nGrace,林明华\r\n" saved by Excel in GBK (code page 936)
const GBK = Uint8Array.from([
  ...Buffer.from('first_name,native_name\r\nDavid,'), 0xb3, 0xc2, 0xb4, 0xf3, 0xce, 0xc0, 0x0d, 0x0a,
  ...Buffer.from('Grace,'), 0xc1, 0xd6, 0xc3, 0xf7, 0xbb, 0xaa, 0x0d, 0x0a,
]);
// "first_name,native_name\r\nDavid,陳大衛\r\nMing,林明\r\n" saved in Big5 (code page 950)
const BIG5 = Uint8Array.from([
  ...Buffer.from('first_name,native_name\r\nDavid,'), 0xb3, 0xaf, 0xa4, 0x6a, 0xbd, 0xc3, 0x0d, 0x0a,
  ...Buffer.from('Ming,'), 0xaa, 0x4c, 0xa9, 0xfa, 0x0d, 0x0a,
]);

test('decoder: UTF-8, GBK and Big5 files are read correctly', () => {
  assert.deepEqual(csv.decodeCsv(Buffer.from('﻿a,中文')), { text: 'a,中文', encoding: 'utf-8' });
  const g = csv.decodeCsv(GBK);
  assert.equal(g.encoding, 'gb18030');
  assert.match(g.text, /David,陈大卫\r\nGrace,林明华/);
  const b = csv.decodeCsv(BIG5);
  assert.equal(b.encoding, 'big5');
  assert.match(b.text, /David,陳大衛\r\nMing,林明/);
  const u16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('a\tb\r\n中\t文', 'utf16le')]);
  assert.equal(csv.decodeCsv(u16).text, 'a\tb\r\n中\t文');
});

test('a GBK upload is converted and the preview says so', async () => {
  const { status, json } = await importCsv('members', GBK);
  assert.equal(status, 200);
  assert.equal(json.encoding, 'gb18030');
  assert.ok(json.notes.some((n: string) => /Chinese \(GBK\).*CSV UTF-8/.test(n)), json.notes.join(' | '));
  assert.equal(json.counts.create, 2);
  assert.equal(json.rows[0].label, 'David 陈大卫');
});

// ---------------------------------------------------------------- members

test('members: export → import is unchanged (round trip)', async () => {
  const hh = reg.households.insert({ name: 'Tan family' });
  reg.people.insert({ first_name: 'David', last_name: 'Tan', native_name: '陈大卫', gender: 'M', birth_date: '1978-03-12', phone: '+60 12-345 6789', email: 'david@example.org', status: 'member', household_id: hh.id, household_role: 'head', notes: 'Line one\nline "two", with comma' });
  reg.people.insert({ first_name: 'Grace', last_name: 'Tan', native_name: '林美恩', gender: 'F', status: 'regular', household_id: hh.id, household_role: 'spouse', baptism_date: '1999-12-25', baptism_type: 'adult' });
  const exp = await GET('editor', '/csv/members/export.csv');
  assert.equal(exp.status, 200);
  assert.match(exp.headers.get('content-type')!, /text\/csv/);
  const body = new Uint8Array(await exp.arrayBuffer());
  assert.deepEqual([...body.slice(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM for Excel');
  const { json } = await importCsv('members', body);
  assert.equal(json.fatal, null);
  assert.deepEqual(json.counts, { create: 0, update: 0, unchanged: 2, error: 0 });

  // an edited copy (as Excel saves it: semicolons, day-first dates) shows a short diff
  const edited = 'id;phone;birth_date;household\n' + `${reg.listPeople({ q: 'David' }).rows[0].id};+60 19-999 0000;12/3/1978;Tan family`;
  const r2 = await importCsv('members', edited);
  assert.equal(r2.json.counts.update, 1);
  assert.deepEqual(r2.json.rows[0].changes, [{ field: 'phone', from: '+60 12-345 6789', to: '+60 19-999 0000' }]);
  assert.ok(r2.json.notes.some((n: string) => /semicolons/.test(n)));
});

test('members: matched by name + birth date without an id; new households are created', async () => {
  const before = all('SELECT id FROM people').length;
  const text = 'First Name,Surname,DOB,Chinese Name,Household,Status\nDavid,Tan,1978-03-12,陈大卫,Tan family,member\nAnna,Lee,2001-07-04,李安娜,Lee family,visitor\n';
  const dry = await importCsv('members', text);
  assert.deepEqual(dry.json.counts, { create: 1, update: 0, unchanged: 1, error: 0 }, JSON.stringify(dry.json.rows));
  const real = await importCsv('members', text, 'x=1');
  assert.equal(real.status, 200);
  assert.equal(real.json.applied, true);
  assert.equal(all('SELECT id FROM people').length, before + 1);
  assert.ok(get("SELECT 1 FROM households WHERE name = 'Lee family'"));
});

test('dry run writes nothing; errors block the whole import unless skip_errors', async () => {
  const count = () => get<{ n: number }>('SELECT COUNT(*) n FROM people')!.n;
  const n0 = count();
  const text = 'first_name,last_name,birth_date,gender,email\nJohn,Ong,1990-01-01,M,john@example.org\n,NoFirst,,,\nMary,Wong,31/02/1990,F,mary@example.org\nPaul,Koh,,X,not-an-email\n';
  const dry = await importCsv('members', text);
  assert.equal(dry.status, 200);
  assert.equal(dry.json.applied, false);
  assert.deepEqual(dry.json.counts, { create: 1, update: 0, unchanged: 0, error: 3 });
  const errs = dry.json.rows.filter((r: Json) => r.action === 'error');
  assert.deepEqual(errs.map((r: Json) => r.row), [3, 4, 5], 'spreadsheet row numbers');
  assert.match(errs[0].errors.join(' '), /first_name is empty/);
  assert.match(errs[1].errors.join(' '), /not a real date/);
  assert.equal(errs[1].errors.length, 1, 'a bad date is reported once');
  assert.match(errs[2].errors.join(' '), /gender.*accepted values/);
  assert.match(errs[2].errors.join(' '), /email/);
  assert.equal(count(), n0, 'dry run wrote nothing');

  const blocked = await importCsv('members', text, 'x=1');
  assert.equal(blocked.status, 422);
  assert.match(blocked.json.error, /Nothing was imported: 3 rows have problems/);
  assert.equal(count(), n0, 'all-or-nothing');

  const skip = await importCsv('members', text, 'skip_errors=1');
  assert.equal(skip.status, 200);
  assert.equal(skip.json.counts.create, 1);
  assert.equal(count(), n0 + 1);
  assert.ok(get("SELECT 1 FROM people WHERE first_name = 'John' AND last_name = 'Ong'"));

  // Chinese UI gets Chinese messages
  const zh = await POST('editor', '/csv/members/import?dry_run=1&lang=zh', text);
  assert.match(((await zh.json()) as Json).rows[2].errors[0], /日期/);
});

// ---------------------------------------------------------------- library

test('songs: words per language, refrain labels and hymnal numbers', async () => {
  lib.hymnals.insert({ name: { en: 'Hymns of Praise', zh: '赞美诗' }, abbr: 'HP', sort: 1 });
  lib.hymnals.insert({ name: { en: 'Trinity Hymnal' }, abbr: 'TH', sort: 2 });
  const words_en = '[1]\nPraise God, from whom all blessings flow;\nPraise him, all creatures here below;\n\n[R]\nAmen, amen.';
  const words_zh = '赞美真神万福之根，\n世上万民都当颂扬；\n\n[R]\n阿们，阿们。';
  const text = csv.writeCsv([
    ['key', 'title_en', 'title_zh', 'author', 'category', 'public_domain', 'tags', 'hymnals', 'words_en', 'words_zh', 'refrain_after_each'],
    ['test-doxology', 'Test Doxology', '测试三一颂', 'Thomas Ken', 'doxology', 'yes', 'praise; trinity', 'HP 470; TH#731', words_en, words_zh, 'yes'],
  ]);
  const dry = await importCsv('songs', text);
  assert.deepEqual(dry.json.counts, { create: 1, update: 0, unchanged: 0, error: 0 }, JSON.stringify(dry.json.rows));
  const real = await importCsv('songs', text, 'x=1');
  assert.equal(real.status, 200, JSON.stringify(real.json));
  const s = lib.songs.list("key = 'test-doxology'")[0];
  assert.deepEqual(s.title, { en: 'Test Doxology', zh: '测试三一颂' });
  assert.deepEqual(s.stanzas, [
    { label: '1', text: { en: 'Praise God, from whom all blessings flow;\nPraise him, all creatures here below;', zh: '赞美真神万福之根，\n世上万民都当颂扬；' } },
    { label: 'R', text: { en: 'Amen, amen.', zh: '阿们，阿们。' } },
  ]);
  assert.equal(s.refrain_after_each, true);
  assert.deepEqual(s.tags, ['praise', 'trinity']);
  assert.deepEqual(s.hymnals!.map((h) => `${h.abbr} ${h.number}`), ['HP 470', 'TH 731']);
  // a partial file (title + numbers only) matches by title and leaves every other field alone
  const gl = await importCsv('songs', 'title_en,hymnals\nGloria Patri,hp 5\n', 'x=1');
  assert.deepEqual(gl.json.rows[0].changes, [{ field: 'hymnals', from: '', to: 'HP 5' }]);
  const gloria = lib.songs.list("key = 'gloria-patri'")[0];
  assert.deepEqual(gloria.hymnals!.map((h) => `${h.abbr} ${h.number}`), ['HP 5']);
  assert.ok(gloria.stanzas.length > 0 && gloria.title.zh === '荣耀颂');

  // the export round-trips
  const exp = new Uint8Array(await (await GET('viewer', '/csv/songs/export.csv')).arrayBuffer());
  const again = await importCsv('songs', exp);
  assert.equal(again.json.counts.error, 0, JSON.stringify(again.json.rows.filter((r: Json) => r.action === 'error')));
  assert.equal(again.json.counts.update, 0, JSON.stringify(again.json.rows.filter((r: Json) => r.action === 'update').slice(0, 3)));

  // unknown hymnal abbreviation is a plain error
  const bad = await importCsv('songs', 'title_en,hymnals\nNew Song,XYZ 12\n');
  assert.match(bad.json.rows[0].errors[0], /no hymnal with the abbreviation "XYZ"/);
});

test('texts: matched by key, parts untouched', async () => {
  const wsc = lib.texts.insert({ key: 'wsc-test', category: 'catechism', title: { en: 'Catechism' }, body: {}, tags: [], parts: [{ label: '1', body: { en: 'L: Q\nC: A' } }] });
  const text = 'key,category,title_en,body_en,tags\nwsc-test,catechism,Catechism,Intro line,catechism\nnew-prayer,prayer,A Prayer,"L: Let us pray.\nA: Amen.",prayer\n';
  const r = await importCsv('texts', text, 'x=1');
  assert.deepEqual(r.json.counts, { create: 1, update: 1, unchanged: 0, error: 0 });
  const after_ = lib.texts.get(wsc.id);
  assert.equal(after_.body.en, 'Intro line');
  assert.equal(after_.parts!.length, 1);
  assert.equal(lib.texts.list("key = 'new-prayer'")[0].body.en, 'L: Let us pray.\nA: Amen.');
});

test('hymnal index: new framework and the old endpoint alias', async () => {
  const hp = lib.hymnals.list("abbr = 'HP'")[0];
  const r = await POST('editor', `/hymnals/${hp.id}/import`, 'number,title_en,title_zh\n1,Gloria Patri,\n2,A Brand New Hymn,新诗歌\n');
  const j = (await r.json()) as Json;
  assert.equal(r.status, 200);
  assert.deepEqual(j, { created: 1, linked: 1, errors: [] });
  assert.equal(lib.findByNumber('1', 'HP')[0].song.key, 'gloria-patri', 'number moved from 5 to 1');
  const stub = lib.findByNumber('2', 'HP')[0].song;
  assert.deepEqual(stub.tags, ['needs-words']);
  const exp = new Uint8Array(await (await GET('viewer', `/csv/hymnal_index/export.csv?hymnal_id=${hp.id}`)).arrayBuffer());
  const again = await importCsv('hymnal_index', exp, `dry_run=1&hymnal_id=${hp.id}`);
  assert.equal(again.json.counts.unchanged, again.json.rows.length);
  const missing = await importCsv('hymnal_index', 'number,title_en\n1,x\n');
  assert.match(missing.json.fatal, /hymnal/i);
});

// ---------------------------------------------------------------- templates

test('templates: rows grouped by template_key upsert whole templates', async () => {
  const text = csv.writeCsv([
    ['template_key', 'name_en', 'name_zh', 'start_time', 'service_type', 'kind', 'title_en', 'title_zh', 'song_key', 'duration_min', 'role', 'in_bulletin', 'notes'],
    ['evening', 'Evening Prayer', '晚祷会', '8:00 pm', 'prayer_meeting', 'section', 'Gathering', '聚集', '', '0', '', '', ''],
    ['evening', '', '', '', '', 'hymn', 'Opening Hymn', '开会诗', '', '4', 'Liturgist', '', 'Choose weekly'],
    ['evening', '', '', '', '', 'song', 'Doxology', '三一颂', 'doxology', '1', 'Liturgist', 'no', ''],
    ['other', 'Other', '', '10:00', '', 'prayer', '', '', '', '5', 'Nobody Role', '', ''],
  ]);
  const dry = await importCsv('templates', text);
  assert.deepEqual(dry.json.counts, { create: 2, update: 0, unchanged: 0, error: 0 }, JSON.stringify(dry.json.rows));
  assert.equal(dry.json.rows[0].to_row, 4);
  assert.match(dry.json.rows[1].warnings[0], /Nobody Role/);
  await importCsv('templates', text, 'x=1');
  const t = svc.templates.list("key = 'evening'")[0];
  assert.equal(t.start_time, '20:00');
  assert.equal(t.service_type, 'prayer_meeting');
  assert.deepEqual(t.name, { en: 'Evening Prayer', zh: '晚祷会' });
  assert.deepEqual(t.items.map((i) => i.kind), ['section', 'song', 'song']);
  assert.equal(t.items[2].song_key, 'doxology');
  assert.equal(t.items[2].in_bulletin, false);
  assert.equal(t.items[1].notes, 'Choose weekly');
  assert.deepEqual(svc.templates.list("key = 'other'")[0].items[0].title, { en: 'Prayer', zh: '祷告' }, 'default title for the kind');

  // export of all templates (seeded ones included) re-imports unchanged
  const exp = new Uint8Array(await (await GET('viewer', '/csv/templates/export.csv')).arrayBuffer());
  const again = await importCsv('templates', exp);
  assert.equal(again.json.counts.error, 0, JSON.stringify(again.json.rows.filter((r: Json) => r.errors)));
  assert.equal(again.json.counts.update, 0, JSON.stringify(again.json.rows.filter((r: Json) => r.action === 'update').slice(0, 2)));

  // a changed order is an update with a diff
  const upd = await importCsv('templates', 'template_key,kind,title_en,duration_min\nevening,prayer,Closing Prayer,2\n');
  assert.equal(upd.json.counts.update, 1);
  assert.ok(upd.json.rows[0].changes.some((c: Json) => c.field === 'items' && c.from === '3' && c.to === '1'));
});

test('templates: posture, bulletin text and slide QR codes import and round-trip', async () => {
  const { createBlock } = await import('../server/repo/presentation.ts');
  createBlock({ name: 'PayNow giving', kind: 'image', data: { caption: { en: 'Scan to give' } } } as never);
  const text = csv.writeCsv([
    ['template_key', 'name_en', 'kind', 'title_en', 'duration_min', 'posture', 'bulletin_text', 'slide_blocks'],
    ['qr-test', 'QR test', 'song', 'Hymn', '4', '众立', '', ''],
    ['qr-test', '', 'offering', 'Offering', '3', 'sit', 'title', 'PayNow giving; Missing block'],
    ['qr-test', '', 'text', 'Creed', '2', 'stand', 'full text', ''],
  ]);
  const dry = await importCsv('templates', text);
  assert.equal(dry.json.counts.error, 0, JSON.stringify(dry.json.rows));
  assert.ok(dry.json.rows[0].warnings.some((w: string) => /Missing block/.test(w)), 'warns about an unknown block');
  await importCsv('templates', text, 'x=1');
  const t = svc.templates.list("key = 'qr-test'")[0];
  assert.deepEqual(t.items.map((i) => i.posture), ['stand', 'sit', 'stand']);
  assert.deepEqual(t.items.map((i) => i.bulletin_text ?? null), [null, 'title', 'full']);
  assert.deepEqual(t.items[1].slide_blocks, ['PayNow giving', 'Missing block']);
  // export → import is unchanged, and the new columns are in the export
  const expRes = await GET('viewer', '/csv/templates/export.csv');
  const exp = new Uint8Array(await expRes.arrayBuffer());
  assert.match(new TextDecoder().decode(exp), /slide_blocks/);
  const again = await importCsv('templates', exp);
  assert.equal(again.json.counts.update, 0, JSON.stringify(again.json.rows.filter((r: Json) => r.action === 'update').slice(0, 2)));
  // a file without those columns keeps the current values
  await importCsv('templates', 'template_key,kind,title_en,duration_min\nqr-test,song,Hymn,4\nqr-test,offering,Offering,3\nqr-test,text,Creed,2\n', 'x=1');
  const kept = svc.templates.list("key = 'qr-test'")[0];
  assert.equal(kept.items[1].posture, 'sit');
  assert.deepEqual(kept.items[1].slide_blocks, ['PayNow giving', 'Missing block']);
});

// ---------------------------------------------------------------- people-linked entities

test('co-workers, groups, team members and unavailability import by name', async () => {
  const cw = await importCsv('coworkers', 'person,position,category,employment,ordained,start_date\nDavid Tan,Senior Pastor,Pastor,full time,yes,2015-01-01\n陈大卫,Elder,elder,,,\nNobody Here,Deacon,deacon,,,\n', 'skip_errors=1');
  assert.deepEqual(cw.json.counts, { create: 2, update: 0, unchanged: 0, error: 1 });
  assert.match(cw.json.rows[2].errors[0], /No one called "Nobody Here"/);

  const groups = 'name_en,name_zh,kind,meeting,person,role,start_date\nYouth Fellowship,青年团契,fellowship,Saturdays 3pm,David Tan,Leader,2025-01-01\nYouth Fellowship,,,,林美恩,Member,\nBoard of Deacons,执事会,committee,,,,\n';
  const g = await importCsv('groups', groups, 'x=1');
  assert.deepEqual(g.json.counts, { create: 3, update: 0, unchanged: 0, error: 0 }, JSON.stringify(g.json.rows));
  const yf = get<{ id: number }>("SELECT id FROM groups WHERE json_extract(name,'$.en') = 'Youth Fellowship'")!;
  assert.equal(all('SELECT * FROM group_members WHERE group_id = ?', yf.id).length, 2);
  assert.equal(all("SELECT * FROM groups WHERE json_extract(name,'$.en') = 'Youth Fellowship'").length, 1, 'one group, not two');
  const gexp = new Uint8Array(await (await GET('editor', '/csv/groups/export.csv')).arrayBuffer());
  assert.equal((await importCsv('groups', gexp)).json.counts.unchanged, 3);

  const tm = await importCsv('team_members', 'team,person,leader,roles\nAV & Media,David Tan,yes,Sound; AV / Slides\n影音,林美恩,,AV / Slides\nAV & Media,Grace Tan,,Organist\n', 'skip_errors=1');
  assert.deepEqual(tm.json.counts, { create: 2, update: 0, unchanged: 0, error: 1 }, JSON.stringify(tm.json.rows));
  assert.match(tm.json.rows[2].errors[0], /"Organist" is not a role/);
  const texp = new Uint8Array(await (await GET('editor', '/csv/team_members/export.csv')).arrayBuffer());
  assert.equal((await importCsv('team_members', texp)).json.counts.unchanged, 2);

  const un = await importCsv('unavailability', 'person,start_date,end_date,reason\nDavid Tan,2025-12-01,2025-12-21,Overseas\nDavid Tan,2025-11-09,,Exams\n', 'x=1');
  assert.equal(un.json.counts.create, 2);
  assert.equal(get<{ end_date: string }>("SELECT end_date FROM unavailability WHERE reason = 'Exams'")!.end_date, '2025-11-09');
});

// ---------------------------------------------------------------- permissions

test('viewers: no import; no export of personal data; library and template export allowed', async () => {
  for (const e of ['members', 'coworkers', 'groups', 'team_members', 'unavailability']) {
    assert.equal((await GET('viewer', `/csv/${e}/export.csv`)).status, 403, `${e} export`);
  }
  assert.equal((await GET('viewer', '/people/export.csv')).status, 403, 'old members export URL too');
  for (const e of ['songs', 'texts', 'templates']) assert.equal((await GET('viewer', `/csv/${e}/export.csv`)).status, 200, `${e} export`);
  assert.equal((await GET('viewer', '/csv/members/template.csv')).status, 200, 'blank template with examples is fine');
  const imp = await POST('viewer', '/csv/songs/import?dry_run=1', 'title_en\nX\n');
  assert.equal(imp.status, 403);
  assert.equal((await GET('editor', '/csv/members/export.csv')).status, 200);
  assert.equal((await GET('admin', '/csv/nope/export.csv')).status, 404);
});

test('templates and guides exist for every entity; template files re-import without errors', async () => {
  const list = (await (await GET('viewer', '/csv')).json()) as Json[];
  assert.equal(list.length, 9);
  const hp = lib.hymnals.list("abbr = 'HP'")[0];
  for (const e of list) {
    const q = e.key === 'hymnal_index' ? `hymnal_id=${hp.id}` : '';
    const guide = (await (await GET('viewer', `/csv/${e.key}/guide?lang=zh-Hant&${q}`)).json()) as Json;
    assert.ok(guide.columns.length > 2, e.key);
    assert.ok(guide.columns.some((c: Json) => c.required), `${e.key} has a required column`);
    assert.ok(/[一-鿿]/.test(guide.intro), 'guide in the UI language');
    const tpl = await GET('editor', `/csv/${e.key}/template.csv?${q}`);
    assert.equal(tpl.status, 200);
    const body = new Uint8Array(await tpl.arrayBuffer());
    const head = csv.parseCsv(Buffer.from(body).toString('utf8'))[0];
    assert.ok(head.includes(guide.columns[0].key));
    const r = await importCsv(e.key, body, `dry_run=1&${q}`);
    assert.equal(r.json.fatal, null, e.key);
    // examples refer to people/teams that may not exist; parsing itself must succeed
    for (const row of r.json.rows) for (const m of row.errors ?? []) assert.doesNotMatch(m, /accepted values|not a date|not a real date|yes or no/, `${e.key}: ${m}`);
  }
});

test('old members import endpoint keeps its response shape', async () => {
  const r = await POST('editor', '/people/import', 'first_name,last_name\nOld,Endpoint\n,\n');
  assert.equal(r.status, 200);
  const j = (await r.json()) as Json;
  assert.equal(j.created, 1);
  assert.deepEqual(j.errors, []);
});
