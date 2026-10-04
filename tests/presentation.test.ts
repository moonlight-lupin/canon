// Slide themes & bulletin templates: the CSS scoper, template / theme resolution order, render's per-item
// bulletin decisions, built-in protection and the REST routes (CSS endpoint, background upload).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-presentation-'));
process.env.CANON_DB = path.join(tmp, 'test.db');
delete process.env.CANON_PUBLIC_URL;

const { scopeCss, compileThemeCss, bulletinDecision, firstStanza, normaliseBulletinOptions, DEFAULT_THEME_VARS, DEFAULT_BULLETIN_OPTIONS } =
  await import('../shared/presentation.ts');
const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const { seed } = await import('../server/seed/index.ts');
const { seedPresentation } = await import('../server/seed/presentation.ts');
const P = await import('../server/repo/presentation.ts');
const svc = await import('../server/repo/services.ts');
const { renderService } = await import('../server/repo/render.ts');
const { updateSettings } = await import('../server/repo/settings.ts');
const { get, db } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let server: Server;
let base = '';
let cookie = '';
let csrf = '';

async function api(method: string, p: string, body?: unknown, type = 'application/json') {
  const headers: Record<string, string> = { Cookie: cookie };
  if (method !== 'GET') headers['X-CSRF-Token'] = csrf;
  if (body !== undefined) headers['Content-Type'] = type;
  const r = await fetch(`${base}/api${p}`, { method, headers, body: body === undefined ? undefined : Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body) });
  const text = await r.text();
  let json: Json | null = null;
  try {
    json = JSON.parse(text);
  } catch { /* css or binary */ }
  return { status: r.status, json, text, type: r.headers.get('content-type') ?? '' };
}

before(async () => {
  await seed();
  createUser({ username: 'admin', display_name: 'Admin', password: 'correct-horse-1', role: 'admin' });
  server = createApp().listen(0, '127.0.0.1');
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

// ---------------------------------------------------------------- CSS scoper

const S = '.slide-stage[data-theme="7"]';

test('scoper prefixes every selector, including comma lists, :root and @media', () => {
  const out = scopeCss(`.slide-lyrics, .slide-title:is(.a, .b) { color: red; }
:root { --slide-scale: 1.2 }
.slide-stage .slide { padding: 0 }
@media (max-width: 800px) { .slide, .slide-text { font-size: 1.2em } }
@supports (display: grid) { .slide-who { color: gold } }
@keyframes glow { from { opacity: 0 } to { opacity: 1 } }`, '7');
  assert.match(out, new RegExp(`^${S.replace(/[.[\]"]/g, '\\$&')} \\.slide-lyrics,\\n`));
  assert.ok(out.includes(`${S} .slide-title:is(.a, .b) {`), 'comma inside :is() is not split');
  assert.ok(out.includes(`${S} { --slide-scale: 1.2 }`), ':root maps to the stage');
  assert.ok(out.includes(`${S} .slide { padding: 0 }`), '.slide-stage is replaced, not doubled');
  assert.ok(out.includes(`@media (max-width: 800px) {\n  ${S} .slide,\n  ${S} .slide-text { font-size: 1.2em }\n}`), 'selectors inside @media are scoped');
  assert.ok(out.includes(`${S} .slide-who { color: gold }`), '@supports is scoped');
  assert.ok(out.includes('@keyframes glow { from { opacity: 0 } to { opacity: 1 } }'), '@keyframes kept as is');
  // every selector line starts with the scope
  const sels = out.split('\n').filter((l) => /\{\s*$|,$/.test(l) && !l.trim().startsWith('@') && !l.includes('keyframes'));
  for (const l of sels) assert.ok(l.trim().startsWith(S), `scoped: ${l}`);
});

test('scoper keeps allowed urls, strings and comments safe', () => {
  const out = scopeCss(`/* a { b } comment */
.slide { background: url(/api/assets/slide-theme-7-bg?v=abc) center / cover; }
.slide-title::after { content: "a \\" { b"; }
.slide-sub { background-image: url("data:image/png;base64,iVBORw0KGgo="); }`, '7');
  assert.ok(out.includes('url(/api/assets/slide-theme-7-bg?v=abc)'));
  assert.ok(out.includes('content: "a \\" { b"'), 'braces inside strings are not rules');
  assert.ok(out.includes('data:image/png;base64'));
});

test('scoper rejects unsafe or broken CSS with a line number', () => {
  const bad: [string, RegExp][] = [
    ['@import url(/api/assets/x.css);', /@import/],
    ['.a { background: url(https://evil.example/x.png) }', /url\(\)/],
    ['.a { background: url(//evil.example/x.png) }', /url\(\)/],
    ['@font-face { font-family: X; src: url("https://fonts.example/x.woff2") }', /url\(\)/],
    ['@font-face { font-family: X; src: url(data:font/woff2;base64,AAAA) }', /url\(\)/],
    ['.a { width: expression(alert(1)) }', /expression/],
    ['.a { behavior: url(/api/assets/x.htc) }', /behavior/],
    ['.a { color: red }\n</style><script>alert(1)</script>', /^Line 2: /],
    ['.a { content: "</style>" }', /<\/style/],
    ['.a { b\\61 ckground: red }', /Backslash/],
    ['.a { background: image-set("https://x/y.png" 1x) }', /image-set/],
    ['.a { color: red', /not closed/],
    ['.a { color: red } }', /Unexpected "\}"/],
    ['.a, { color: red }', /empty entry/],
    ['.a { .b { color: red } }', /Nested/],
    ['@page { margin: 0 }', /not supported/],
    ['/* never closed', /comment/],
    ['.a { content: "open }', /quotes/],
  ];
  for (const [css, re] of bad) {
    assert.throws(() => scopeCss(css, '7'), (e: Error) => {
      assert.match(e.message, /^Line \d+: /, css);
      assert.match(e.message, re, css);
      return true;
    }, css);
  }
});

test('compiled theme CSS carries the variables and the scoped custom CSS', () => {
  const css = compileThemeCss('7', { ...DEFAULT_THEME_VARS, bg: '#000000', scale: 1.2, footer_number: true, font_sc: "'Kaiti SC', KaiTi, serif", accent_from_season: true }, '.slide-lyrics { font-size: 1.1em }', '/api/assets/slide-theme-7-bg?v=x');
  assert.ok(css.startsWith(`${S} {`));
  for (const want of ['--slide-bg: #000000;', '--slide-scale: 1.2;', '--slide-show-number: flex;', "--slide-font-sc: 'Kaiti SC', KaiTi, serif;", '--slide-bg-image: url("/api/assets/slide-theme-7-bg?v=x");']) {
    assert.ok(css.includes(want), want);
  }
  assert.ok(css.includes(`${S} .slide.seasonal { --slide-accent: var(--s-season); }`), 'season accent');
  assert.ok(css.includes(`${S} .slide-lyrics { font-size: 1.1em }`));
  assert.throws(() => compileThemeCss('7', { ...DEFAULT_THEME_VARS, font_latin: 'Arial; } body { x: url(http://e)' }, '', null), /font list/);
});

// ---------------------------------------------------------------- bulletin decisions

test('per-item decision: item override beats the template; first stanza only from the template', () => {
  const order = normaliseBulletinOptions({ print: { song: 'title', scripture: 'reference', text: 'full', other: 'title' } });
  assert.equal(bulletinDecision('song', null, order), false);
  assert.equal(bulletinDecision('scripture', null, order), false);
  assert.equal(bulletinDecision('text', null, order), true);
  assert.equal(bulletinDecision('prayer', null, order), false);
  assert.equal(bulletinDecision('song', 'full', order), true);
  assert.equal(bulletinDecision('text', 'title', order), false);
  const first = normaliseBulletinOptions({ print: { song: 'first_stanza' } });
  assert.equal(bulletinDecision('song', null, first), 'first_stanza');
  assert.equal(bulletinDecision('song', 'full', first), true);
  assert.equal(bulletinDecision('song', 'title', first), false);
  assert.equal(bulletinDecision('scripture', null, DEFAULT_BULLETIN_OPTIONS), true);
  assert.deepEqual(firstStanza([{ label: '1' }, { label: 'R' }, { label: '2' }]).map((s) => s.label), ['1', 'R']);
  assert.deepEqual(firstStanza([{ label: '1' }, { label: '2' }]).map((s) => s.label), ['1']);
});

// ---------------------------------------------------------------- seeding & resolution

test('built-ins are seeded once, by key', () => {
  const b = P.builtins();
  assert.deepEqual(Object.keys(b.slide).sort(), ['contrast', 'ink', 'papyrus', 'season']);
  assert.deepEqual(Object.keys(b.bulletin).sort(), ['full', 'large', 'order']);
  const n = get<{ n: number }>('SELECT COUNT(*) n FROM slide_themes')!.n;
  assert.equal(seedPresentation(), 0);
  assert.equal(get<{ n: number }>('SELECT COUNT(*) n FROM slide_themes')!.n, n);
});

function makeService() {
  const song = get<{ id: number }>("SELECT id FROM songs WHERE key = 'doxology'")!.id;
  const creed = get<{ id: number }>("SELECT id FROM texts WHERE key = 'apostles-creed'")!.id;
  const { service } = svc.createService({ date: '2026-11-01' });
  const items = {
    song: svc.addItem(service.id, { kind: 'song', ref_id: song }),
    reading: svc.addItem(service.id, { kind: 'scripture', scripture_ref: 'Psalm 23:1-3' }),
    creed: svc.addItem(service.id, { kind: 'text', ref_id: creed }),
    prayer: svc.addItem(service.id, { kind: 'prayer', body: { en: 'L: Let us pray.\nC: Amen.' } }),
  };
  return { id: service.id, items };
}

test('bulletin template resolution: service → church default → "Full words booklet"', () => {
  const b = P.builtins().bulletin;
  const s = makeService();
  updateSettings({ default_bulletin_template_id: null });
  assert.equal(renderService(s.id).bulletin.template_id, b.full);
  updateSettings({ default_bulletin_template_id: b.large });
  assert.equal(renderService(s.id).bulletin.template_id, b.large);
  assert.equal(renderService(s.id).bulletin.options.languages, 'primary');
  svc.services.update(s.id, { bulletin_template_id: b.order });
  assert.equal(renderService(s.id).bulletin.template_id, b.order);
  // a deleted custom template falls back to the church default
  const custom = P.duplicateTemplate(b.order);
  svc.services.update(s.id, { bulletin_template_id: custom.id });
  assert.equal(renderService(s.id).bulletin.template_id, custom.id);
  P.deleteTemplate(custom.id);
  assert.equal(renderService(s.id).bulletin.template_id, b.large);
  updateSettings({ default_bulletin_template_id: null });
});

test('slide theme resolution: service → church default → legacy dark/light → Ink', () => {
  const b = P.builtins().slide;
  const s = makeService();
  updateSettings({ default_slide_theme_id: null, slide_theme: 'dark' });
  assert.equal(renderService(s.id).slide_theme_id, b.ink);
  updateSettings({ slide_theme: 'light' });
  assert.equal(renderService(s.id).slide_theme_id, b.papyrus, 'old light setting maps to Papyrus');
  updateSettings({ default_slide_theme_id: b.contrast });
  assert.equal(renderService(s.id).slide_theme_id, b.contrast);
  svc.services.update(s.id, { slide_theme_id: b.season });
  assert.equal(renderService(s.id).slide_theme_id, b.season);
  updateSettings({ default_slide_theme_id: null, slide_theme: 'dark' });
});

test('render puts the per-item decision on every item', () => {
  const b = P.builtins().bulletin;
  const s = makeService();
  svc.services.update(s.id, { bulletin_template_id: b.order });
  const byId = (r: ReturnType<typeof renderService>, id: number) => r.items.find((i) => i.id === id)!;
  let r = renderService(s.id);
  assert.equal(byId(r, s.items.song.id).bulletin_full, false, 'hymn: title only');
  assert.equal(byId(r, s.items.reading.id).bulletin_full, false, 'reading: reference only');
  assert.equal(byId(r, s.items.creed.id).bulletin_full, true, 'creed: full');
  assert.equal(byId(r, s.items.prayer.id).bulletin_full, false, 'prayer: title only');
  assert.ok(byId(r, s.items.song.id).song?.stanzas.length, 'slides still get the words');

  svc.updateItem(s.items.song.id, { bulletin_text: 'full' });
  svc.updateItem(s.items.creed.id, { bulletin_text: 'title' });
  r = renderService(s.id);
  assert.equal(byId(r, s.items.song.id).bulletin_full, true, 'item override: full text');
  assert.equal(byId(r, s.items.song.id).bulletin_text, 'full');
  assert.equal(byId(r, s.items.creed.id).bulletin_full, false, 'item override: title only');

  const first = P.createTemplate({ name: { en: 'First verses' }, options: { print: { song: 'first_stanza' } } });
  svc.services.update(s.id, { bulletin_template_id: first.id });
  svc.updateItem(s.items.song.id, { bulletin_text: null });
  r = renderService(s.id);
  assert.equal(byId(r, s.items.song.id).bulletin_full, 'first_stanza');
  assert.equal(byId(r, s.items.reading.id).bulletin_full, true);
});

// ---------------------------------------------------------------- REST

test('themes: built-ins are read-only, duplicates are editable, bad CSS is a 400 with a line number', async () => {
  const b = P.builtins().slide;
  const list = await api('GET', '/slide-themes');
  assert.equal(list.status, 200);
  assert.equal((list.json as unknown as Json[]).find((t) => t.id === b.ink)?.builtin, 'ink');

  assert.equal((await api('PATCH', `/slide-themes/${b.ink}`, { css: '.slide{}' })).status, 400);
  assert.equal((await api('DELETE', `/slide-themes/${b.ink}`)).status, 400);

  const dup = await api('POST', `/slide-themes/${b.ink}/duplicate`);
  assert.equal(dup.status, 200);
  const id = dup.json!.id as number;
  assert.match(dup.json!.name.en, /\(copy\)/);

  const bad = await api('PATCH', `/slide-themes/${id}`, { css: '.ok { color: red }\n.a { background: url(https://evil.example/x.png) }' });
  assert.equal(bad.status, 400);
  assert.match(bad.json!.error, /Line 2/);

  const good = await api('PATCH', `/slide-themes/${id}`, { css: '.slide-lyrics { font-size: 1.3em }', vars: { bg: '#102030', scale: 1.2, bg_image: 'forged' } });
  assert.equal(good.status, 200);
  assert.equal(good.json!.vars.bg_image, null, 'clients cannot set the picture version');

  const css = await api('GET', `/slide-themes/${id}/css`);
  assert.match(css.type, /text\/css/);
  assert.ok(css.text.includes(`.slide-stage[data-theme="${id}"] .slide-lyrics { font-size: 1.3em }`));
  assert.ok(css.text.includes('--slide-bg: #102030;'));

  // background picture: PNG accepted, SVG / mismatched bytes refused, served back with a version
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  assert.equal((await api('PUT', `/slide-themes/${id}/background`, Buffer.from('<svg/>'), 'image/svg+xml')).status, 415);
  assert.equal((await api('PUT', `/slide-themes/${id}/background`, Buffer.from('not a png at all'), 'image/png')).status, 415);
  const up = await api('PUT', `/slide-themes/${id}/background`, png, 'image/png');
  assert.equal(up.status, 200);
  const v = up.json!.vars.bg_image as string;
  assert.ok(v);
  const css2 = await api('GET', `/slide-themes/${id}/css`);
  assert.ok(css2.text.includes(`url("/api/assets/slide-theme-${id}-bg?v=${v}")`));
  const img = await fetch(`${base}/api/assets/slide-theme-${id}-bg?v=${v}`, { headers: { Cookie: cookie } });
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await fetch(`${base}/api/assets/slide-theme-${id}-bg`)).status, 401, 'pictures need a session');

  // church default (admin) and delete resets it
  const def = await api('PUT', '/presentation/defaults', { slide_theme_id: id });
  assert.equal(def.json!.default_slide_theme_id, id);
  assert.equal((await api('DELETE', `/slide-themes/${id}`)).status, 200);
  assert.equal(get('SELECT 1 FROM assets WHERE key = ?', `slide-theme-${id}-bg`), undefined, 'picture removed with the theme');
  assert.equal(P.resolveSlideThemeId(null), b.ink);
});

test('templates: CRUD over REST, built-ins protected', async () => {
  const b = P.builtins().bulletin;
  assert.equal((await api('PATCH', `/bulletin-templates/${b.full}`, { name: { en: 'x' } })).status, 400);
  const created = await api('POST', '/bulletin-templates', { name: { en: 'Youth service', zh: '青年崇拜' }, options: { paper: 'a5', print: { song: 'first_stanza' }, sections: { roster: false } } });
  assert.equal(created.status, 200);
  assert.equal(created.json!.options.paper, 'a5');
  assert.equal(created.json!.options.print.song, 'first_stanza');
  assert.equal(created.json!.options.print.scripture, 'full', 'missing fields take defaults');
  assert.equal(created.json!.options.sections.roster, false);
  const id = created.json!.id as number;
  const patched = await api('PATCH', `/bulletin-templates/${id}`, { options: { print: { song: 'bogus' } } });
  assert.equal(patched.json!.options.print.song, 'first_stanza', 'unknown values keep the current choice');
  assert.equal((await api('DELETE', `/bulletin-templates/${id}`)).status, 200);
});

// ---------------------------------------------------------------- v0.4: bulletin options, posture, honorifics, blocks

const { hymnLine, bracketL10n, normaliseBlockData, qrPresetValue } = await import('../shared/presentation.ts');
const { postureLabel, roleMatches, servingOnLabel } = await import('../shared/labels.ts');
const { personDisplay } = await import('../shared/people-names.ts');
const { people } = await import('../server/repo/registers.ts');
const vol = await import('../server/repo/volunteers.ts');
const { blockImageProblem } = await import('../server/routes/presentation.ts');
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('bulletin options: new fields default to the old behaviour; old templates keep working', () => {
  const old = { paper: 'a5', layout: 'stacked', font_pt: 10, cover: 'cross', languages: 'primary', print: { song: 'title' }, sections: { roster: false }, show_leaders: false, show_times: true };
  const o = normaliseBulletinOptions(old);
  assert.equal(o.paper, 'a5');
  assert.equal(o.order_style, 'list');
  assert.equal(o.show_posture, false);
  assert.equal(o.hymn_number, 'abbr');
  assert.equal(o.sermon_brackets, false);
  assert.equal(o.full_text_section, 'inline');
  assert.equal(o.announcements_section, 'inline');
  assert.deepEqual(o.announcements_heading, {});
  assert.deepEqual(o.banner, { bg: '#141414', fg: '#ffffff' });
  assert.deepEqual(o.back_page, { this_week_roles: [], next_week_roles: [], note: {}, blocks: [] });
  assert.deepEqual(normaliseBulletinOptions({}), DEFAULT_BULLETIN_OPTIONS);
  // a stored template without the new keys, normalised against itself (PATCH), keeps the defaults
  const base = { ...DEFAULT_BULLETIN_OPTIONS } as Record<string, unknown>;
  for (const k of ['order_style', 'show_posture', 'hymn_number', 'back_page', 'banner']) delete base[k];
  assert.equal(normaliseBulletinOptions({ show_times: true }, base as never).order_style, 'list');

  const rec = normaliseBulletinOptions({
    cover: 'banner', banner: { bg: '#000000', fg: 'white' }, order_style: 'table', show_posture: true, hymn_number: 'number',
    sermon_brackets: true, full_text_section: 'separate', announcements_section: 'separate', announcements_heading: { zh: '家讯', 'not a language': 'x', en: 42 },
    back_page: { this_week_roles: ['Usher', ' Welcome ', 'Usher', 3], next_week_roles: ['Preacher'], note: { zh: '敬请留下参加祷告会！' }, blocks: [3, 3, -1, 1.5, 'x', 7] },
  });
  assert.equal(rec.cover, 'banner');
  assert.deepEqual(rec.banner, { bg: '#000000', fg: '#ffffff' }, 'a bad colour keeps the default');
  assert.equal(rec.order_style, 'table');
  assert.equal(rec.hymn_number, 'number');
  assert.deepEqual(rec.announcements_heading, { zh: '家讯' });
  assert.deepEqual(rec.back_page.this_week_roles, ['Usher', 'Welcome']);
  assert.deepEqual(rec.back_page.blocks, [3, 7]);
  assert.equal(normaliseBulletinOptions({ hymn_number: 'roman', order_style: 'grid' }, rec).hymn_number, 'number', 'unknown values keep the current choice');
});

test('hymn numbers, 【】 titles, posture labels, role matching', () => {
  const song = { title: { en: 'Glory to God', zh: '荣耀归于真神' }, number: { abbr: 'HP', number: '2' } };
  const sub = { en: 'HP 2 · Glory to God', zh: 'HP 2 · 荣耀归于真神' };
  assert.deepEqual(hymnLine(song, sub, ['zh'], 'abbr'), sub);
  assert.equal(hymnLine(song, sub, ['zh'], 'number').zh, '2 荣耀归于真神');
  assert.equal(hymnLine(song, sub, ['zh'], 'none').zh, '荣耀归于真神');
  assert.equal(hymnLine({ title: song.title }, sub, ['en'], 'number').en, 'Glory to God', 'no number → title only');
  assert.equal(bracketL10n({ zh: '教会的分争' }, undefined, ['zh']).zh, '【教会的分争】');
  assert.equal(bracketL10n({ en: 'One Church' }, undefined, ['en']).en, '“One Church”');
  assert.equal(bracketL10n({ zh: '威斯敏斯特大教理问答 第78问' }, { zh: '威斯敏斯特大教理问答' }, ['zh']).zh, '【威斯敏斯特大教理问答】第78问');
  assert.equal(postureLabel('stand', 'zh'), '众立');
  assert.equal(postureLabel('sit', 'zh-Hant'), '眾坐');
  assert.equal(postureLabel('kneel', 'en'), 'Kneel');
  assert.equal(postureLabel('stand', 'ms'), 'All stand', 'other languages fall back to English');
  assert.equal(servingOnLabel('2026-10-11', 'zh'), '10月11日 服事人员');
  assert.equal(servingOnLabel('2026-10-11', 'en'), 'Serving on 11 Oct');
  assert.ok(roleMatches({ en: 'Usher', zh: '招待员' }, 'Ushers'));
  assert.ok(roleMatches({ en: 'Usher', zh: '招待员' }, '招待员'));
  assert.ok(!roleMatches({ en: 'Usher' }, 'Preacher'));
});

test('personDisplay: Chinese name + title after it; English title before the name', () => {
  const p = { first_name: 'Yi Nuo', last_name: 'Chen', preferred_name: null, native_name: '陈以诺', honorific: { en: 'Ps.', zh: '传道' } };
  assert.equal(personDisplay(p, 'zh'), '陈以诺传道');
  assert.equal(personDisplay(p, 'zh-Hant'), '陈以诺传道', 'the other Chinese script is a fallback');
  assert.equal(personDisplay(p, 'en'), 'Ps. Yi Nuo Chen');
  assert.equal(personDisplay({ ...p, preferred_name: 'Daniel' }, 'en'), 'Ps. Daniel Chen');
  assert.equal(personDisplay({ ...p, honorific: null }, 'zh'), '陈以诺');
  assert.equal(personDisplay({ ...p, native_name: null, honorific: { zh: '弟兄' } }, 'zh'), 'Yi Nuo Chen 弟兄', 'Latin name + space');
  assert.equal(personDisplay({ ...p, honorific: { zh: '传道' } }, 'en'), 'Yi Nuo Chen', 'no English title → none');
});

test('render: posture, honorific names and the next service roster (same service type first)', () => {
  const role = vol.roles.list('', [], 'sort, id')[0];
  const lu = people.insert({ first_name: 'Yi Nuo', last_name: 'Chen', native_name: '陈以诺', honorific: { en: 'Ps.', zh: '传道' }, status: 'member' });
  const xu = people.insert({ first_name: 'En Ci', last_name: 'Wang', native_name: '王恩慈', honorific: { en: 'Sis.', zh: '姐妹' }, status: 'member' });
  const a = svc.createService({ date: '2026-12-06', languages: ['zh', 'en'] }).service;
  const other = svc.createService({ date: '2026-12-13', service_type: 'prayer_meeting' }).service;
  const c = svc.createService({ date: '2026-12-20' }).service;
  vol.assign(a.id, role.id, xu.id);
  vol.assign(other.id, role.id, xu.id);
  vol.assign(c.id, role.id, lu.id);
  const it = svc.addItem(a.id, { kind: 'prayer', role_id: role.id, posture: 'stand' });
  const r = renderService(a.id);
  const item = r.items.find((x) => x.id === it.id)!;
  assert.equal(item.posture, 'stand');
  assert.equal(item.leader_l10n?.zh, '王恩慈姐妹');
  assert.equal(item.leader_l10n?.en, 'Sis. En Ci Wang');
  const row = r.roster.find((x) => x.role.en === role.name.en)!;
  assert.equal(row.people_l10n?.[0].zh, '王恩慈姐妹');
  assert.equal(r.next_roster?.service_id, c.id, 'skips the prayer meeting: same service type first');
  assert.equal(r.next_roster?.date, '2026-12-20');
  const nr = r.next_roster!.roles.find((x) => x.role.en === role.name.en)!;
  assert.equal(nr.people[0].zh, '陈以诺传道');
  assert.ok(r.role_names?.length);
  // the prayer meeting has no later service of its type, so it takes the next one of any type
  assert.equal(renderService(other.id).next_roster?.service_id, c.id);
  // a banner template wins over the service's cover ornament
  svc.services.update(a.id, { cover: { style: 'cross' } });
  const banner = P.createTemplate({ name: { en: 'Banner' }, options: { cover: 'banner' } });
  svc.services.update(a.id, { bulletin_template_id: banner.id });
  assert.equal(renderService(a.id).cover.style, 'banner');
});

test('bulletin blocks: QR codes as SVG / PNG, presets, picture validation, Word export', async () => {
  assert.equal(qrPresetValue('instagram', '@gracechurch.example'), 'https://www.instagram.com/gracechurch.example/');
  assert.equal(qrPresetValue('whatsapp', '+65 9123 4567'), 'https://wa.me/6591234567');
  assert.equal(qrPresetValue('website', 'example.org'), 'https://example.org');
  assert.deepEqual(normaliseBlockData('qr', { value: ' https://x.org ', caption: { zh: '教会网站' }, image: 'forged', bold: true }), { value: 'https://x.org', caption: { zh: '教会网站' } });

  const qr = await api('POST', '/bulletin-blocks', { kind: 'qr', name: 'Website', data: { value: 'https://example.org', caption: { zh: '教会网站' } } });
  assert.equal(qr.status, 200);
  const svg = await api('GET', `/bulletin-blocks/${qr.json!.id}/qr.svg`);
  assert.equal(svg.status, 200);
  assert.match(svg.type, /image\/svg\+xml/);
  assert.match(svg.text, /<svg[\s\S]*<path/);
  const png = await fetch(`${base}/api/bulletin-blocks/${qr.json!.id}/qr.png?download=1`, { headers: { Cookie: cookie } });
  assert.equal(png.headers.get('content-type'), 'image/png');
  assert.match(png.headers.get('content-disposition') ?? '', /attachment; filename="Website\.png"/);
  assert.ok(Buffer.from(await png.arrayBuffer()).subarray(0, 8).equals(PNG_1PX.subarray(0, 8)));
  const preview = await api('GET', `/bulletin-blocks/qr.svg?text=${encodeURIComponent('https://www.instagram.com/x/')}`);
  assert.match(preview.type, /image\/svg\+xml/);
  assert.equal((await api('GET', '/bulletin-blocks/qr.svg?text=')).status, 400, 'empty text');
  assert.equal((await fetch(`${base}/api/bulletin-blocks/${qr.json!.id}/qr.svg`)).status, 401, 'needs a session');

  // picture blocks: raster only, magic bytes checked, 2 MB at most; only picture blocks take uploads
  assert.equal(blockImageProblem('image/svg+xml', Buffer.from('<svg/>'))?.status, 415);
  assert.equal(blockImageProblem('image/png', Buffer.from('not a png'))?.status, 415);
  assert.equal(blockImageProblem('image/png', Buffer.alloc(0))?.status, 400);
  assert.equal(blockImageProblem('image/png', Buffer.concat([PNG_1PX, Buffer.alloc(2 * 1024 * 1024)]))?.status, 413);
  assert.equal(blockImageProblem('image/png', PNG_1PX), null);
  const img = await api('POST', '/bulletin-blocks', { kind: 'image', name: 'PayNow', data: { caption: { zh: '扫描奉献\nUEN T00SS0000X' } } });
  const id = img.json!.id as number;
  assert.equal((await api('PUT', `/bulletin-blocks/${id}/image`, Buffer.from('<svg/>'), 'image/svg+xml')).status, 415);
  assert.equal((await api('PUT', `/bulletin-blocks/${id}/image`, Buffer.from('nope'), 'image/png')).status, 415);
  assert.equal((await api('PUT', `/bulletin-blocks/${qr.json!.id}/image`, PNG_1PX, 'image/png')).status, 400, 'not a picture block');
  const up = await api('PUT', `/bulletin-blocks/${id}/image`, PNG_1PX, 'image/png');
  assert.equal(up.status, 200);
  const v = up.json!.data.image as string;
  assert.ok(v);
  const served = await fetch(`${base}/api/assets/bulletin-block-${id}?v=${v}`, { headers: { Cookie: cookie } });
  assert.equal(served.headers.get('content-type'), 'image/png');
  const patched = await api('PATCH', `/bulletin-blocks/${id}`, { data: { caption: { zh: '扫描奉献' }, image: 'forged' } });
  assert.equal(patched.json!.data.image, v, 'clients cannot set the picture version');
  assert.equal((await api('PATCH', `/bulletin-blocks/${id}`, { kind: 'qr' })).status, 400, 'type is fixed');
  const note = await api('POST', '/bulletin-blocks', { kind: 'text', name: 'Prayer meeting', data: { text: { zh: '敬请留下参加祷告会！' } } });
  assert.equal(note.json!.data.bold, true);
  assert.equal(note.json!.data.align, 'center');

  // the Word export embeds the QR code and the picture on the back page
  const s = makeService();
  svc.updateItem(s.items.prayer.id, { posture: 'kneel' });
  const tpl = P.createTemplate({
    name: { en: 'Banner booklet' },
    options: { cover: 'banner', order_style: 'table', show_posture: true, hymn_number: 'number', sermon_brackets: true, full_text_section: 'separate', announcements_section: 'separate', back_page: { this_week_roles: ['Usher'], next_week_roles: ['Preacher'], note: { en: 'Stay for prayer' }, blocks: [id, qr.json!.id, note.json!.id] } },
  });
  svc.services.update(s.id, { bulletin_template_id: tpl.id });
  const docx = await fetch(`${base}/api/services/${s.id}/export.docx`, { headers: { Cookie: cookie } });
  assert.equal(docx.status, 200);
  const bytes = Buffer.from(await docx.arrayBuffer());
  assert.equal(bytes.subarray(0, 2).toString(), 'PK');
  assert.ok(bytes.includes(Buffer.from('word/media/')), 'images embedded');

  assert.equal((await api('DELETE', `/bulletin-blocks/${id}`)).status, 200);
  assert.equal(get('SELECT 1 FROM assets WHERE key = ?', `bulletin-block-${id}`), undefined, 'picture removed with the block');
});

// ---------------------------------------------------------------- v0.6: QR codes & notes on slides

const { buildSlides, slideText } = await import('../src/outputs/slideModel.ts');
const { freeshowProject } = await import('../server/export/freeshow.ts');

test('slides: QR codes & notes after an item — render, deleted blocks, templates by name, slide model, FreeShow', async () => {
  const insta = P.createBlock({ kind: 'qr', name: 'Instagram', data: { value: 'https://www.instagram.com/x/', caption: { zh: '关注我们' } } });
  const pay = P.createBlock({ kind: 'image', name: 'PayNow', data: { caption: { en: 'Scan to give\nUEN T00SS0000X', zh: '扫描奉献\nUEN T00SS0000X' } } });
  const version = P.setBlockImage(pay.id, 'image/png', PNG_1PX).data.image;
  const gone = P.createBlock({ kind: 'text', name: 'Old note', data: { text: { en: 'Gone' } } });

  const s = makeService();
  svc.services.update(s.id, { languages: ['en', 'zh-Hant'] });
  // an offering is not on the slides by default: it shows only its QR slide
  const offering = svc.addItem(s.id, { kind: 'offering', title: { en: 'Offering', zh: '奉献' }, slide_blocks: [insta.id, pay.id, gone.id] });
  assert.equal(offering.on_slides, false);
  P.deleteBlock(gone.id);

  // render: ids resolved in order, deleted blocks left out, captions completed for the service languages
  let r = renderService(s.id);
  const it = r.items.find((x) => x.id === offering.id)!;
  assert.deepEqual(it.slide_blocks.map((b) => b.id), [insta.id, pay.id], 'deleted block skipped');
  assert.equal(it.slide_blocks[0].kind, 'qr');
  assert.equal(it.slide_blocks[0].value, 'https://www.instagram.com/x/');
  assert.equal(it.slide_blocks[0].caption['zh-Hant'], '關注我們', 'Traditional filled in from Simplified');
  assert.equal(it.slide_blocks[1].has_image, true);
  assert.equal(it.slide_blocks[1].v, version, 'the picture version busts the cache');
  assert.deepEqual(r.items.find((x) => x.id === s.items.song.id)!.slide_blocks, []);

  // slide model: the blocks slide is the offering's only slide, titled with the item
  let slides = buildSlides(r, r.languages);
  const mine = slides.filter((x) => x.itemId === offering.id);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].type, 'blocks');
  assert.equal(mine[0].big?.en, 'Offering');
  assert.equal(mine[0].blocks?.length, 2);
  assert.match(slideText(mine[0], r.languages), /Scan to give/);

  // on an item that has slides of its own it comes last, with the item title as the small heading
  svc.updateItem(s.items.song.id, { slide_blocks: [insta.id] });
  r = renderService(s.id);
  slides = buildSlides(r, r.languages);
  const song = slides.filter((x) => x.itemId === s.items.song.id);
  assert.ok(song.length > 1);
  assert.equal(song.at(-1)!.type, 'blocks');
  assert.equal(song.at(-1)!.big, undefined);
  assert.ok(song.at(-1)!.heading);
  assert.ok(song.slice(0, -1).every((x) => x.type === 'lyrics'));

  // a QR block without an address is not drawn; nothing left = no slide
  const empty = P.createBlock({ kind: 'qr', name: 'Empty', data: {} });
  svc.updateItem(offering.id, { slide_blocks: [empty.id] });
  assert.equal(buildSlides(renderService(s.id), ['en']).filter((x) => x.itemId === offering.id).length, 0);
  svc.updateItem(offering.id, { slide_blocks: [insta.id, pay.id] });

  // FreeShow: the codes and pictures as media items with the captions underneath (the offering gets a show of its own)
  const fs = await freeshowProject(renderService(s.id));
  const show = fs.shows[`canon-${s.id}-${offering.id}`];
  assert.ok(show, 'offering show exported');
  const words = JSON.stringify(show.slides);
  assert.match(words, /UEN T00SS0000X/);
  assert.equal(words.match(/UEN T00SS0000X/g)!.length, 1, 'a line shared by two languages is shown once');

  // templates store block names; a service made from one gets the ids (missing names ignored)
  const tpl = svc.templates.insert({
    name: { en: 'With QR' }, description: {}, service_type: 'lords_day', start_time: '10:00',
    items: [{ kind: 'offering', title: { en: 'Offering' }, duration_min: 3, slide_blocks: ['paynow', 'Instagram', 'No such block'] }],
  });
  const made = svc.createService({ date: '2026-11-15' }, tpl.id).service;
  assert.deepEqual(made.items[0].slide_blocks, [pay.id, insta.id], 'names matched case-insensitively, missing ones ignored');
  const saved = svc.saveAsTemplate(made.id, { en: 'Saved' });
  assert.deepEqual(saved.items[0].slide_blocks, ['PayNow', 'Instagram'], 'saving as a template stores names');

  // REST: the planner patches the ids; a signed-in user (and the presenter window) can load the QR code
  const patched = await api('PATCH', `/items/${s.items.prayer.id}`, { slide_blocks: [insta.id] });
  assert.equal(patched.status, 200);
  assert.deepEqual(patched.json!.slide_blocks, [insta.id]);
  assert.equal((await api('GET', `/bulletin-blocks/${insta.id}/qr.svg?v=1`)).status, 200);
});

test('FreeShow: QR codes and pictures are embedded as media items (data: URIs); notes stay text', async () => {
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const qr = P.createBlock({ kind: 'qr', name: 'FS Give', data: { value: 'https://give.example.org/fs', caption: { en: 'Give online', zh: '网上奉献' } } });
  const pic = P.createBlock({ kind: 'image', name: 'FS PayNow', data: { caption: { en: 'PayNow UEN T00SS0000X' } } });
  P.setBlockImage(pic.id, 'image/png', PNG_1PX);
  const noPic = P.createBlock({ kind: 'image', name: 'FS No picture', data: { caption: { en: 'Picture still to come' } } });
  const note = P.createBlock({ kind: 'text', name: 'FS Note', data: { text: { en: 'Cheques to "Grace Church"' }, bold: true } });

  const s = makeService();
  svc.services.update(s.id, { languages: ['en', 'zh'] });
  const offering = svc.addItem(s.id, { kind: 'offering', title: { en: 'Offering', zh: '奉献' }, slide_blocks: [qr.id, pic.id, noPic.id, note.id] });
  const notesOnly = svc.addItem(s.id, { kind: 'offering', title: { en: 'Notices' }, slide_blocks: [note.id] });

  const file = await freeshowProject(renderService(s.id));
  const slidesOf = (itemId: number) => Object.values(file.shows[`canon-${s.id}-${itemId}`].slides);

  // the offering's blocks slide: two media items (QR code, picture), captions under them, the rest as text
  const [blk] = slidesOf(offering.id);
  const media = blk.items.filter((i) => i.type === 'media');
  assert.equal(media.length, 2, 'the QR code and the uploaded picture are media items');
  for (const m of media) {
    assert.match(m.src!, /^data:image\/png;base64,/);
    assert.equal(m.fit, 'contain');
    const bytes = Buffer.from(m.src!.split(',')[1], 'base64');
    assert.deepEqual(bytes.subarray(0, 8), PNG_SIG, 'PNG signature');
    const geo = Object.fromEntries([...m.style.matchAll(/(top|left|height|width):(\d+)px/g)].map((x) => [x[1], Number(x[2])]));
    assert.ok(geo.left >= 0 && geo.top >= 0 && geo.left + geo.width <= 1920 && geo.top + geo.height <= 1080, `fits the 1920x1080 slide: ${m.style}`);
  }
  assert.ok(Buffer.from(media[0].src!.split(',')[1], 'base64').length > 200, 'a real QR code, not the 1px picture');
  assert.deepEqual(Buffer.from(media[1].src!.split(',')[1], 'base64'), PNG_1PX, 'the uploaded picture as stored');
  const text = JSON.stringify(blk.items.filter((i) => i.type !== 'media'));
  for (const w of ['Offering', 'Give online', '网上奉献', 'PayNow UEN T00SS0000X', 'Picture still to come', 'Cheques to']) assert.ok(text.includes(w), w);
  assert.doesNotMatch(text, /give\.example\.org/, 'the address is not spelled out under a drawn code');
  assert.equal(blk.notes, '');

  // only notes: still a plain text slide
  const [plain] = slidesOf(notesOnly.id);
  assert.equal(plain.items.length, 1);
  assert.equal(plain.items[0].type, undefined);
  assert.match(JSON.stringify(plain.items[0].lines), /Cheques to/);

  // the REST download carries the same embedded PNG
  const res = await api('GET', `/services/${s.id}/freeshow.project`);
  assert.equal(res.status, 200);
  assert.match(JSON.stringify(res.json), /data:image\/png;base64,iVBORw0KGgo/);
});
