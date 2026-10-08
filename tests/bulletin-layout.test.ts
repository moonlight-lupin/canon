// Bulletin page layout: old templates turn into the layout that prints what they printed, built-ins carry explicit
// layouts, render provides the weekly texts (with the fallback to the Announcements item), booklet padding goes
// before the back cover, the Word export follows the layout with page breaks, and bulletin_content saves via PATCH.
// Fictional data only (Grace Church 恩典堂, 陈以诺传道).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-bulletin-layout-'));
process.env.CANON_DB = path.join(tmp, 'test.db');
delete process.env.CANON_PUBLIC_URL;

const PR = await import('../shared/presentation.ts');
const { normaliseBulletinOptions, normaliseLayout, legacyLayout, padBooklet, weeklySections, DEFAULT_BULLETIN_OPTIONS } = PR;
const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const { seed, installLibrary } = await import('../server/seed/index.ts');
const { seedPresentation, BUILTIN_TEMPLATES } = await import('../server/seed/presentation.ts');
const P = await import('../server/repo/presentation.ts');
const svc = await import('../server/repo/services.ts');
const { renderService } = await import('../server/repo/render.ts');
const { updateSettings } = await import('../server/repo/settings.ts');
const { get, run, db } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let server: Server;
let base = '';
let cookie = '';
let csrf = '';

async function api(method: string, p: string, body?: unknown) {
  const headers: Record<string, string> = { Cookie: cookie };
  if (method !== 'GET') headers['X-CSRF-Token'] = csrf;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${base}/api${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json: Json | null = null;
  try {
    json = JSON.parse(text);
  } catch { /* binary */ }
  return { status: r.status, json, text, buf: Buffer.from(text, 'latin1') };
}

/** One file out of a .docx (zip): enough of the zip format for Word documents. */
function unzipEntry(zip: Buffer, name: string): string {
  for (let i = 0; i + 30 < zip.length; i++) {
    if (zip.readUInt32LE(i) !== 0x04034b50) continue;
    const method = zip.readUInt16LE(i + 8);
    const size = zip.readUInt32LE(i + 18);
    const nameLen = zip.readUInt16LE(i + 26);
    const extra = zip.readUInt16LE(i + 28);
    const n = zip.subarray(i + 30, i + 30 + nameLen).toString();
    const start = i + 30 + nameLen + extra;
    if (n !== name) continue;
    const data = zip.subarray(start, start + size);
    return (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
  }
  throw new Error(`${name} not in the zip`);
}

before(async () => {
  await seed();
  await installLibrary(['songs', 'texts', 'templates']);
  createUser({ username: 'admin', display_name: 'Admin', password: 'correct-horse-1', role: 'admin' });
  updateSettings({ church_name: { en: 'Grace Church', zh: '恩典堂' } });
  server = createApp().listen(0, '127.0.0.1');
  // a full parallel test run is slow: idle connections stay open for the next request (no reset mid-test)
  server.keepAliveTimeout = 120_000;
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'correct-horse-1' }) });
  cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  csrf = ((await login.json()) as Json).csrf;
});

after(async () => {
  await new Promise((r) => server.close(r));
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const types = (l: { type: string }[]) => l.map((s) => s.type);

/** A banner template with full texts and announcements on their own pages and a designed back page (old options). */
const BANNER_LEGACY = {
  paper: 'a4-booklet', cover: 'banner', order_style: 'table', sermon_brackets: true, languages: 'primary',
  print: { song: 'title', scripture: 'reference', text: 'title', other: 'title' },
  sections: { roster: false, notes: false, ccli: false, sermon_notes: false, contact: false },
  full_text_section: 'separate', announcements_section: 'separate', announcements_heading: { zh: '家讯', en: 'Announcements' },
  back_page: { this_week_roles: ['Usher', 'Welcome'], next_week_roles: ['Preacher'], note: { zh: '敬请留下参加祷告会！' }, blocks: [3, 7] },
};

test('back-compat: old options become the layout that prints what they printed', () => {
  const o = normaliseBulletinOptions(BANNER_LEGACY);
  assert.deepEqual(types(o.page_layout), [
    'cover', 'order', 'page_break', 'full_texts', 'page_break', 'announcements', 'page_break', 'serving_this_week', 'serving_next_week', 'note', 'blocks',
  ]);
  // the back cover: a page break, then the serving tables, the note and the blocks — all on the last page
  assert.deepEqual(o.page_layout.map((s) => !!s.last_page), [false, false, false, false, false, false, true, true, true, true, true]);
  const ann = o.page_layout.find((s) => s.type === 'announcements')!;
  assert.deepEqual(ann.heading, { zh: '家讯', en: 'Announcements' });
  assert.equal(ann.service_notes, undefined, 'service notes were off');
  assert.deepEqual(o.page_layout.find((s) => s.type === 'serving_this_week')!.roles, ['Usher', 'Welcome']);
  assert.deepEqual(o.page_layout.find((s) => s.type === 'blocks')!.blocks, [3, 7]);
  // the old fields stay readable and agree with the layout
  assert.equal(o.full_text_section, 'separate');
  assert.equal(o.announcements_section, 'separate');
  assert.deepEqual(o.back_page.this_week_roles, ['Usher', 'Welcome']);

  // "Full words booklet": cover page, order, sermon notes on a spare page; the back cover (notes, roster, notices
  // and contact) follows on when there is no room for a page of its own (no page break)
  const d = DEFAULT_BULLETIN_OPTIONS.page_layout;
  assert.deepEqual(types(d), ['cover', 'order', 'sermon_notes', 'service_notes', 'serving_this_week', 'ccli_contact']);
  assert.equal(d.find((s) => s.type === 'sermon_notes')!.spare_only, true);
  assert.deepEqual(d.filter((s) => s.last_page).map((s) => s.type), ['service_notes', 'serving_this_week', 'ccli_contact']);
  assert.deepEqual(d.find((s) => s.type === 'serving_this_week')!.roles, [], 'the whole roster as a list');
  assert.deepEqual(normaliseBulletinOptions({}), DEFAULT_BULLETIN_OPTIONS);

  // separate announcements with service notes on: the notes join the announcements page
  const sep = legacyLayout({ ...DEFAULT_BULLETIN_OPTIONS, announcements_section: 'separate' });
  assert.equal(sep.find((s) => s.type === 'announcements')!.service_notes, true);
  assert.ok(!sep.some((s) => s.type === 'service_notes'));
  assert.equal(sep.find((s) => s.last_page)!.type, 'page_break', 'a separate announcements page puts the back cover on a page of its own');

  // the layout is the source of truth: a PATCH without it keeps the stored one; a given one wins
  const stored = normaliseBulletinOptions({ page_layout: [{ type: 'order' }, { type: 'fixed_text', heading: { en: 'Welcome' }, text: { en: 'Welcome to Grace Church.' } }] });
  assert.deepEqual(types(normaliseBulletinOptions({ show_times: true, full_text_section: 'separate' }, stored).page_layout), ['order', 'fixed_text']);
  assert.equal(normaliseBulletinOptions({ show_times: true }, stored).full_text_section, 'inline', 'old fields follow the layout');
});

test('normaliseLayout: unknown types dropped, one cover / order, ids filled in, back cover moved to the end', () => {
  const l = normaliseLayout([
    { type: 'note', text: { zh: '欢迎' }, last_page: true },
    { type: 'cover' }, { type: 'cover' }, { type: 'nonsense' }, null,
    { id: 'o', type: 'order', new_page: true, keep_together: 'yes' },
    { id: 'o', type: 'weekly_text', key: 'Pastor Note!', heading: { en: "Pastor's note", zh: '牧者的话', 'not a language': 'x' } },
    { type: 'serving_this_week', roles: ['Usher', 'Usher', 3, ' Welcome '] },
    { type: 'blocks', blocks: [1, 1, -2, 'x', 4] },
    { type: 'page_break', new_page: true },
  ]);
  assert.deepEqual(types(l), ['cover', 'order', 'weekly_text', 'serving_this_week', 'blocks', 'page_break', 'note']);
  assert.equal(new Set(l.map((s) => s.id)).size, l.length, 'ids are unique');
  const order = l.find((s) => s.type === 'order')!;
  assert.equal(order.new_page, true);
  assert.equal(order.keep_together, undefined);
  const w = l.find((s) => s.type === 'weekly_text')!;
  assert.match(w.key!, /^[a-z0-9_-]{1,40}$/, 'a bad key is replaced');
  assert.deepEqual(w.heading, { en: "Pastor's note", zh: '牧者的话' });
  assert.deepEqual(l.find((s) => s.type === 'serving_this_week')!.roles, ['Usher', 'Welcome']);
  assert.deepEqual(l.find((s) => s.type === 'blocks')!.blocks, [1, 4]);
  assert.equal(l.find((s) => s.type === 'page_break')!.new_page, undefined);
  assert.deepEqual(weeklySections([...l, { id: 'a', type: 'announcements', heading: { zh: '家讯' } }]).map((x) => x.key), ['announcements', w.key]);
});

test('built-ins have explicit layouts; built-ins stored before layouts are upgraded by the seed', () => {
  const b = P.builtins().bulletin;
  for (const key of ['full', 'order', 'large']) {
    const raw = JSON.parse(get<{ options: string }>('SELECT options FROM bulletin_templates WHERE id = ?', b[key])!.options);
    assert.ok(Array.isArray(raw.page_layout) && raw.page_layout.length, `${key} stores a layout`);
  }
  const large = P.getTemplate(b.large).options.page_layout;
  assert.ok(!large.some((s) => s.type === 'sermon_notes'), 'large print has no sermon notes page');
  assert.deepEqual(types(BUILTIN_TEMPLATES.find((x) => x.key === 'full')!.options.page_layout), types(DEFAULT_BULLETIN_OPTIONS.page_layout));
  // an older database: the built-in's options without a layout
  const { page_layout: _drop, ...old } = BUILTIN_TEMPLATES[1].options;
  run('UPDATE bulletin_templates SET options = ? WHERE id = ?', JSON.stringify(old), b.order);
  seedPresentation();
  const raw = JSON.parse(get<{ options: string }>('SELECT options FROM bulletin_templates WHERE id = ?', b.order)!.options);
  assert.ok(Array.isArray(raw.page_layout), 'the seed wrote the layout');
});

function makeService(date: string) {
  const { service } = svc.createService({ date, languages: ['zh', 'zh-Hant', 'en'], preacher: '陈以诺传道' });
  const song = get<{ id: number }>("SELECT id FROM songs WHERE key = 'doxology'")!.id;
  svc.addItem(service.id, { kind: 'song', ref_id: song });
  svc.addItem(service.id, { kind: 'sermon' });
  const ann = svc.addItem(service.id, { kind: 'announcements', title: { en: 'Announcements', zh: '报告' }, body: { zh: '1. 本主日崇拜后有祷告会。\n2. 周三晚上查经。' } });
  return { id: service.id, ann };
}

test('render: weekly texts per key, completed; announcements fall back to the item body; blocks the layout prints', () => {
  const s = makeService('2026-11-08');
  const tpl = P.createTemplate({
    name: { en: 'Layout test' },
    options: {
      page_layout: [
        { type: 'cover' }, { type: 'order' },
        { type: 'announcements', heading: { zh: '家讯' }, new_page: true },
        { type: 'weekly_text', key: 'pastor_note', heading: { zh: '牧者的话', en: "Pastor's note" } },
        { type: 'fixed_text', heading: { zh: '欢迎' }, text: { zh: '欢迎来到恩典堂。' } },
      ],
    },
  });
  svc.services.update(s.id, { bulletin_template_id: tpl.id });
  let r = renderService(s.id);
  assert.equal(r.bulletin.announcements_from_item, true);
  assert.equal(r.bulletin.content!.announcements.zh, '1. 本主日崇拜后有祷告会。\n2. 周三晚上查经。');
  assert.equal(r.bulletin.content!.announcements['zh-Hant'], '1. 本主日崇拜後有禱告會。\n2. 週三晚上查經。', 'completed for the service languages');
  assert.equal(r.bulletin.options.page_layout.find((x) => x.type === 'fixed_text')!.text!['zh-Hant'], '歡迎來到恩典堂。', 'fixed texts completed too');

  svc.services.update(s.id, { bulletin_content: { announcements: { zh: '1. 新的家讯。' }, pastor_note: { zh: '愿主赐福。' } } });
  r = renderService(s.id);
  assert.equal(r.bulletin.announcements_from_item, undefined, 'the weekly text wins');
  assert.equal(r.bulletin.content!.announcements.zh, '1. 新的家讯。');
  assert.equal(r.bulletin.content!.pastor_note['zh-Hant'], '願主賜福。');
  assert.deepEqual(r.bulletin.blocks, []);
});

test('booklet padding: blank pages go before the back cover (pure helper)', () => {
  const blank = (i: number) => `blank${i}`;
  // 4 pages + a back cover of 1 = 5 pages → 3 blank pages before the back cover (8 pages)
  const a = padBooklet(['p1', 'p2', 'p3', 'p4'], ['back'], blank, { strict: true });
  assert.deepEqual(a.pages, ['p1', 'p2', 'p3', 'p4', 'blank0', 'blank1', 'blank2', 'back']);
  assert.equal(a.added, 3);
  // no back cover: blanks at the end
  assert.deepEqual(padBooklet(['p1', 'p2', 'p3'], [], blank), { pages: ['p1', 'p2', 'p3', 'blank0'], added: 1 });
  // already a multiple of 4: nothing added
  assert.equal(padBooklet(['p1', 'p2', 'p3'], ['back'], blank, { strict: true }).added, 0);
  // not strict: a flow that already fills the booklet wins …
  assert.deepEqual(padBooklet(['p1', 'p2', 'p3', 'p4'], ['back'], blank, { combined: ['c1', 'c2', 'c3', 'c4'] }), { pages: ['c1', 'c2', 'c3', 'c4'], added: 0 });
  // … else the back cover gets its own last page when that needs no extra sheet
  assert.deepEqual(padBooklet(['p1', 'p2'], ['back'], blank, { combined: ['c1', 'c2'] }).pages, ['p1', 'p2', 'blank0', 'back']);
  // … and when it would, the flow is kept and blanks go at the end
  assert.deepEqual(padBooklet(['p1', 'p2', 'p3'], ['b1', 'b2'], blank, { combined: ['c1', 'c2', 'c3'] }).pages, ['c1', 'c2', 'c3', 'blank0']);
});

test('Word export follows the layout: page breaks, weekly and fixed texts, the announcements item body moves', async () => {
  const s = makeService('2026-11-15');
  const tpl = await api('POST', '/bulletin-templates', { name: { en: 'Banner booklet' }, options: BANNER_LEGACY });
  assert.equal(tpl.status, 200);
  const layout = [...tpl.json!.options.page_layout];
  layout.splice(2, 0, { type: 'weekly_text', key: 'pastor_note', heading: { zh: '牧者的话' }, new_page: true }, { type: 'fixed_text', heading: { zh: '欢迎' }, text: { zh: '欢迎来到恩典堂。' } });
  const patched = await api('PATCH', `/bulletin-templates/${tpl.json!.id}`, { options: { ...tpl.json!.options, page_layout: layout } });
  assert.equal(patched.status, 200);
  assert.deepEqual(types(patched.json!.options.page_layout).slice(0, 4), ['cover', 'order', 'weekly_text', 'fixed_text']);
  svc.services.update(s.id, { bulletin_template_id: tpl.json!.id, bulletin_content: { pastor_note: { zh: '弟兄姐妹平安。' } } });

  const res = await fetch(`${base}/api/services/${s.id}/export.docx`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  const xml = unzipEntry(Buffer.from(await res.arrayBuffer()), 'word/document.xml');
  assert.ok((xml.match(/<w:pageBreakBefore\/>/g) ?? []).length >= 3, 'page breaks become Word page breaks');
  assert.ok(xml.includes('牧者的话') && xml.includes('弟兄姐妹平安。'), 'the weekly text');
  assert.ok(xml.includes('欢迎来到恩典堂。'), 'the fixed text');
  assert.ok(xml.includes('家讯'), 'the announcements heading');
  // the item body prints once, in the announcements section (from the fallback), not under the item
  assert.equal(xml.split('本主日崇拜后有祷告会').length - 1, 1);
});

test('bulletin_content saves via PATCH /api/services/:id and shows in canon_get_service', async () => {
  const s = makeService('2026-11-22');
  const ok = await api('PATCH', `/services/${s.id}`, { bulletin_content: { announcements: { zh: '1. 欢迎新朋友。' }, pastor_note: { en: 'Grace and peace.' } } });
  assert.equal(ok.status, 200);
  const got = await api('GET', `/services/${s.id}`);
  assert.deepEqual(got.json!.bulletin_content, { announcements: { zh: '1. 欢迎新朋友。' }, pastor_note: { en: 'Grace and peace.' } });
  assert.equal((await api('PATCH', `/services/${s.id}`, { bulletin_content: { 'Bad Key!': { en: 'x' } } })).status, 400);
  const rendered = await api('GET', `/services/${s.id}/render`);
  assert.equal(rendered.json!.bulletin.content.announcements.zh, '1. 欢迎新朋友。');
  const { SERVICE_TOOLS } = await import('../server/mcp-tools/services.ts');
  const getTool = SERVICE_TOOLS.find((x) => x.name === 'canon_get_service')!;
  const out = (await (getTool.handler as (a: Json) => unknown)({ id: s.id, format: 'structured', include_text: false, include_similar: false })) as Json;
  assert.deepEqual(out.bulletin_content.pastor_note, { en: 'Grace and peace.' });
});

test('slide fonts: the first font of the template that the system has, else its default (pickFont)', async () => {
  const { pickFont } = await import('../shared/slide-fonts.ts');
  const hei = "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif";
  assert.equal(pickFont(hei, 'sc', 'windows'), 'Microsoft YaHei', 'a Mac font first: Windows takes the next one');
  assert.equal(pickFont(hei, 'sc', 'mac'), 'PingFang SC');
  assert.equal(pickFont('', 'sc', 'windows'), 'SimSun');
  assert.equal(pickFont('', 'sc', 'mac'), 'Songti SC');
  assert.equal(pickFont('', 'tc', 'mac'), 'Songti TC');
  assert.equal(pickFont("'Kaiti SC', 'STKaiti', KaiTi, serif", 'sc', 'windows'), 'KaiTi');
  assert.equal(pickFont("'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif", 'latin', 'mac'), 'Palatino');
});

test('PowerPoint for Keynote (Mac): the same slides, with fonts every Mac has', async () => {
  const s = makeService('2026-11-22');
  const xmlOf = async (q: string) => {
    const res = await fetch(`${base}/api/services/${s.id}/slides.pptx${q}`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    const zip = Buffer.from(await res.arrayBuffer());
    return { xml: unzipEntry(zip, 'ppt/slides/slide2.xml') + unzipEntry(zip, 'ppt/slides/slide1.xml'), name: res.headers.get('content-disposition') ?? '' };
  };
  const pc = await xmlOf('');
  const mac = await xmlOf('?system=mac');
  assert.match(pc.xml, /typeface="SimSun"/);
  assert.match(mac.xml, /typeface="Songti SC"/);
  assert.match(mac.xml, /typeface="Songti TC"/);
  assert.doesNotMatch(mac.xml, /SimSun|PMingLiU|Segoe UI/, 'no Windows fonts in the Mac file');
  assert.match(mac.name, /-mac\.pptx/);
});

test('sermon notes can fill the rest of a page under the section before them (0.15.4)', () => {
  const l = normaliseLayout([
    { id: 'announcements', type: 'announcements' },
    { id: 'n1', type: 'sermon_notes', fill: true },
    { id: 'n2', type: 'sermon_notes', fill: true, spare_only: true },
    { id: 'n3', type: 'sermon_notes', spare_only: true },
  ]);
  const notes = l.filter((s) => s.type === 'sermon_notes');
  assert.deepEqual(notes.map((s) => [!!s.fill, !!s.spare_only]), [[true, false], [true, false], [false, true]], 'filling wins over spare-page only');
});
