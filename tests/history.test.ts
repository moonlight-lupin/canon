// Precedent: similar past services, song usage, catechism progression — the repo functions, the MCP tools that
// expose them (read-only access is enough) and the planner's REST endpoint. Fictional data only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-history-'));
process.env.CANON_DB = path.join(tmp, 'test.db');
process.env.CANON_PUBLIC_URL = 'http://127.0.0.1';
delete process.env.CANON_TRUST_PROXY;

const PUBLIC = 'http://127.0.0.1';
const RESOURCE = `${PUBLIC}/mcp`;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const { updateSettings, getSettings } = await import('../server/repo/settings.ts');
const { TOOLS } = await import('../server/mcp.ts');
const hist = await import('../server/repo/history.ts');
const svc = await import('../server/repo/services.ts');
const lib = await import('../server/repo/library.ts');
const reg = await import('../server/repo/registers.ts');
const vol = await import('../server/repo/volunteers.ts');
const { db } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Level = 'off' | 'read' | 'write';

let server: Server;
let base = '';

const ALL = { members: 'off', coworkers: 'off', groups: 'off', volunteers: 'read', services: 'read', library: 'read', templates: 'read' } as const;
function setMcp(modules: Partial<Record<keyof typeof ALL, Level>>) {
  const cur = getSettings().mcp;
  updateSettings({ mcp: { ...cur, enabled: true, modules: { ...cur.modules, ...ALL, ...modules }, expose_member_pii: false } });
}

// ---------------------------------------------------------------- fictional data

const ids: Record<string, number> = {};

function service(key: string, date: string, extra: Json = {}, songs: number[] = [], texts: [number, string[] | null][] = []) {
  const s = svc.services.insert({ date, title: { en: 'Lord\'s Day Worship', zh: '主日崇拜' }, ...extra });
  for (const id of songs) svc.addItem(s.id, { kind: 'song', ref_id: id });
  for (const [id, stanzas] of texts) svc.addItem(s.id, { kind: 'text', ref_id: id, stanzas });
  ids[key] = s.id;
  return s.id;
}

before(async () => {
  createUser({ username: 'admin', display_name: 'Pastor Admin', password: 'correct-horse-1', role: 'admin' });
  createUser({ username: 'viewer', display_name: 'Viewer Vic', password: 'correct-horse-2', role: 'viewer' });
  setMcp({});

  const hymnal = lib.hymnals.insert({ name: { en: 'Example Hymnal' }, abbr: 'EH', sort: 0 });
  const light = lib.songs.insert({ title: { en: 'Hymn of the Morning Light', zh: '晨光之歌' }, category: 'hymn', public_domain: true, stanzas: [] });
  const praise = lib.songs.insert({ title: { en: 'Praise the Maker of the Hills' }, category: 'hymn', public_domain: true, stanzas: [] });
  const quiet = lib.songs.insert({ title: { en: 'Quiet Waters Hymn' }, category: 'hymn', public_domain: true, stanzas: [] });
  lib.setSongHymnals(light.id, [{ hymnal_id: hymnal.id, number: '101' }]);
  ids.light = light.id;
  ids.praise = praise.id;
  ids.quiet = quiet.id;
  const parts = Array.from({ length: 10 }, (_, i) => ({ label: String(i + 1), body: { en: `Q${i + 1}. Example question?` } }));
  const cat = lib.texts.insert({ key: 'example-cat', category: 'catechism', title: { en: 'Example Catechism' }, body: { en: '' }, parts, public_domain: true });
  const creed = lib.texts.insert({ key: 'example-creed', category: 'creed', title: { en: 'Example Creed' }, body: { en: 'A: We believe.' }, public_domain: true });
  ids.cat = cat.id;
  ids.creed = creed.id;

  service('lastYear', '2025-12-21', { sermon_ref: 'Luke 1:26-38', preacher: 'Rev. Enoch Chen' }, [light.id], [[creed.id, null]]);
  service('random', '2026-08-16', { sermon_ref: 'Romans 5:1-11' }, [light.id], [[cat.id, ['3', '4', '5']]]);
  service('james', '2026-03-01', { sermon_ref: 'James 2:14-26' }, [praise.id, praise.id], [[cat.id, ['1', '2']]]);
  service('easter2025', '2025-04-20', { sermon_ref: 'John 20:1-18' });
  service('future', '2027-01-03', { sermon_ref: 'Luke 2:21-40' }, [light.id]);
  service('target', '2026-12-20', { sermon_ref: 'Luke 2:1-20' }, [light.id], [[creed.id, null]]);

  // who served on the same Sunday last year (fictional)
  const team = vol.teams.insert({ name: { en: 'Music' }, color: '#123456', sort: 0 } as never);
  const piano = vol.roles.insert({ team_id: team.id, name: { en: 'Pianist' }, needed: 1, sort: 0 } as never);
  const p = reg.people.insert({ first_name: 'Grace', last_name: 'Wong', status: 'member' });
  vol.assign(ids.lastYear, piano.id, p.id);

  server = createApp().listen(0, '127.0.0.1');
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

// ---------------------------------------------------------------- repo

test('similarServices: the same Sunday last year outranks a random service; future services are excluded', () => {
  const r = hist.similarServices(ids.target);
  assert.ok(r.length >= 2);
  assert.equal(r[0].id, ids.lastYear, JSON.stringify(r.map((x) => [x.date, x.score, x.reasons])));
  assert.ok(r[0].reasons.includes('same Sunday last year'), r[0].reasons.join('; '));
  assert.ok(r[0].reasons.some((x) => x.includes('same sermon book (Luke)')));
  assert.ok(r[0].reasons.some((x) => x.startsWith('same season (advent)')));
  const random = r.find((x) => x.id === ids.random)!;
  assert.ok(r[0].score > random.score + 3);
  assert.ok(!r.some((x) => x.id === ids.future || x.id === ids.target), 'no future service, never the target itself');
  // compact outline with the hymn's number, and who served
  assert.deepEqual(r[0].outline.find((o) => o.kind === 'song'), { kind: 'song', title: 'Hymn / 诗歌', subtitle: 'EH 101 Hymn of the Morning Light / 晨光之歌', min: 3 });
  assert.equal(r[0].roster_summary, 'Pianist: Grace Wong');
  assert.equal(r[0].season, 'advent');
});

test('similarServices: sermon book, chapter and verse overlap score in steps', () => {
  const score = (ref: string) => hist.similarServices({ date: '2026-09-06', sermon_ref: ref }, { limit: 10 }).find((x) => x.id === ids.james)!;
  const book = score('James 1:2-8');
  const chapter = score('James 2:1-13');
  const verses = score('James 2:18-20');
  assert.ok(book.reasons.includes('same sermon book (James)'), book.reasons.join('; '));
  assert.ok(chapter.reasons.includes('same sermon chapter (James 2)'), chapter.reasons.join('; '));
  assert.ok(verses.reasons.some((x) => x.startsWith('overlapping sermon text')));
  assert.ok(book.score < chapter.score && chapter.score < verses.score);
  // criteria without a date: only services before today
  assert.ok(!hist.similarServices({ sermon_ref: 'Luke 2' }, { limit: 20 }).some((x) => x.date >= hist.todayIso()));
});

test('similarServices: Easter matches by its place in the Easter cycle, not the calendar', () => {
  // Easter 2027 is 28 March; Easter 2025 was 20 April (23 calendar days apart)
  const r = hist.similarServices({ date: '2027-03-28' }, { limit: 10 });
  const e = r.find((x) => x.id === ids.easter2025)!;
  assert.ok(e.reasons.includes('Easter Day 2 years earlier'), e.reasons.join('; '));
  assert.equal(r[0].id, ids.easter2025);
  assert.equal(hist.sameTimeOfYear('2027-03-28', 'easter', '2026-04-12'), 'same point of the Easter cycle last year (Easter + 7 days)');
  assert.equal(hist.sameTimeOfYear('2027-03-28', 'easter', '2026-04-19'), null, 'two weeks off');
});

test('songUsage counts services once each and respects before / months', () => {
  let u = hist.songUsage([ids.light, ids.praise, ids.quiet], { before: '2026-12-20' });
  assert.deepEqual(u.get(ids.light), { last_used: '2026-08-16', last_service_id: ids.random, times: 2 });
  assert.equal(u.get(ids.praise)!.times, 1, 'sung twice in one service = once');
  assert.equal(u.has(ids.quiet), false, 'never sung');
  u = hist.songUsage([ids.light], { before: '2026-08-01' });
  assert.deepEqual(u.get(ids.light), { last_used: '2025-12-21', last_service_id: ids.lastYear, times: 1 });
  u = hist.songUsage([ids.light], { before: '2026-12-20', months: 3 });
  assert.equal(u.get(ids.light)!.times, 0);
  assert.equal(u.get(ids.light)!.last_used, '2026-08-16');
  // default: before today, so the 2027 service is never counted
  assert.ok(hist.songUsage(null).get(ids.light)!.last_used < '2027-01-01');
});

test('textPartsHistory lists the parts per service and suggests the next label', () => {
  const h = hist.textPartsHistory(ids.cat);
  assert.deepEqual(h.history.map((x) => [x.date, x.labels, x.runs]), [['2026-08-16', ['3', '4', '5'], '3–5'], ['2026-03-01', ['1', '2'], '1–2']]);
  assert.equal(h.next_suggested_label, '6');
  assert.equal(hist.textPartsHistory(ids.cat, { before: '2026-08-01' }).next_suggested_label, '3');
  assert.equal(hist.textPartsHistory(ids.creed).next_suggested_label, null, 'no parts');
  const done = service('end', '2026-11-01', {}, [], [[ids.cat, ['9', '10']]]);
  assert.equal(hist.textPartsHistory(ids.cat).next_suggested_label, null, 'series finished');
  svc.services.remove(done);
});

// ---------------------------------------------------------------- MCP (read-only access is enough)

async function accessToken(username: string, password: string): Promise<string> {
  const reg = await fetch(`${base}/oauth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT] }),
  });
  const client = (await reg.json()) as Json;
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { csrf } = (await login.json()) as Json;
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const form = new URLSearchParams({
    response_type: 'code', client_id: client.client_id, redirect_uri: REDIRECT, state: 'st',
    code_challenge: challenge, code_challenge_method: 'S256', scope: 'canon:read', resource: RESOURCE, csrf, decision: 'allow',
  });
  const a = await fetch(`${base}/oauth/authorize`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: form });
  const code = new URL(a.headers.get('location')!).searchParams.get('code')!;
  const t = await fetch(`${base}/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: verifier, resource: RESOURCE }),
  });
  return ((await t.json()) as Json).access_token as string;
}

let rpcId = 1;
async function call(at: string, name: string, args: Json = {}) {
  const r = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Mcp-Protocol-Version': '2025-06-18', Authorization: `Bearer ${at}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } }),
  });
  const res = ((await r.json()) as Json).result as Json;
  const text = res.content[0].text as string;
  let json: Json = {};
  try {
    json = JSON.parse(text);
  } catch { /* plain-text SDK error (unknown tool) */ }
  return { isError: !!res.isError, text, json };
}

test('the tool count stays at 36', () => {
  assert.equal(TOOLS.length, 36);
});

test('MCP: a read-only viewer token gets precedent through the existing tools', async () => {
  setMcp({});
  const at = await accessToken('viewer', 'correct-horse-2');

  const sim = await call(at, 'canon_find_services', { similar_to: ids.target });
  assert.equal(sim.isError, false, sim.text);
  const first = sim.json.data.similar[0];
  assert.equal(first.id, ids.lastYear);
  assert.ok(first.reasons.includes('same Sunday last year'));
  assert.ok(Array.isArray(first.outline) && first.outline.length > 0);

  const like = await call(at, 'canon_find_services', { like: { date: '2026-09-06', sermon_ref: 'James 2:1-13' }, limit: 2 });
  assert.equal(like.json.data.similar[0].id, ids.james);
  assert.equal(like.json.data.similar.length, 2);
  const both = await call(at, 'canon_find_services', { similar_to: ids.target, like: { date: '2026-01-01' } });
  assert.equal(both.isError, true);
  // the plain list still works as before
  assert.ok((await call(at, 'canon_find_services', {})).json.data.length >= 5);

  const songs = await call(at, 'canon_search_library', { type: 'songs', before: '2026-12-20' });
  const bySong = new Map((songs.json.data.songs as Json[]).map((s) => [s.id, s]));
  assert.equal(bySong.get(ids.light)!.last_used, '2026-08-16');
  assert.equal(bySong.get(ids.light)!.times_12m, 2);
  assert.equal(bySong.get(ids.quiet)!.times_12m, 0);
  assert.equal(bySong.get(ids.quiet)!.last_used, undefined);
  const least = await call(at, 'canon_search_library', { type: 'songs', sort: 'least_recent', before: '2026-12-20', limit: 100 });
  const order = (least.json.data.songs as Json[]).map((s) => s.id).filter((id) => [ids.light, ids.praise, ids.quiet].includes(id));
  assert.deepEqual(order, [ids.praise, ids.light, ids.quiet], 'longest ago first, never-sung last');
  const most = await call(at, 'canon_search_library', { type: 'songs', sort: 'most_used', before: '2026-12-20' });
  assert.equal(most.json.data.songs[0].id, ids.light);
  const noUsage = await call(at, 'canon_search_library', { type: 'songs', usage: false });
  assert.equal(noUsage.json.data.songs[0].times_12m, undefined);

  const cat = await call(at, 'canon_get_library_item', { type: 'text', id: ids.cat, parts: 'index' });
  assert.equal(cat.json.data.next_suggested_label, '6');
  assert.equal(cat.json.data.history[0].parts, '3–5');

  const detail = await call(at, 'canon_get_service', { id: ids.target, include_similar: true });
  assert.equal(detail.json.data.similar_past.length, 3);
  assert.equal(detail.json.data.similar_past[0].id, ids.lastYear);
  assert.ok(detail.json.data.similar_past[0].outline.some((l: string) => l.startsWith('song: Hymn / 诗歌 — EH 101')));
  assert.equal((await call(at, 'canon_get_service', { id: ids.target })).json.data.similar_past, undefined);
});

test('MCP: song usage and catechism history need the services module', async () => {
  setMcp({ services: 'off' });
  const at = await accessToken('admin', 'correct-horse-1');
  const songs = await call(at, 'canon_search_library', { type: 'songs' });
  assert.equal(songs.isError, false, songs.text);
  assert.ok((songs.json.data.songs as Json[]).every((s) => s.last_used === undefined && s.times_12m === undefined));
  const cat = await call(at, 'canon_get_library_item', { type: 'text', id: ids.cat, parts: 'index' });
  assert.equal(cat.json.data.history, undefined);
  assert.equal((await call(at, 'canon_find_services', { similar_to: ids.target })).isError, true, 'hidden tool');
  setMcp({});
});

// ---------------------------------------------------------------- REST for the planner

test('GET /api/songs/usage: viewers can read it; before is respected', async () => {
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'viewer', password: 'correct-horse-2' }) });
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const r = await fetch(`${base}/api/songs/usage?before=2026-08-01`, { headers: { Cookie: cookie } });
  assert.equal(r.status, 200);
  const body = (await r.json()) as Json;
  assert.deepEqual(body[ids.light], { last_used: '2025-12-21', times_12m: 1 });
  assert.equal(body[ids.quiet], undefined);
  assert.equal((await fetch(`${base}/api/songs/usage?before=yesterday`, { headers: { Cookie: cookie } })).status, 400);
  assert.equal((await fetch(`${base}/api/songs/${ids.light}`, { headers: { Cookie: cookie } })).status, 200, '/songs/:id still works');
  assert.equal((await fetch(`${base}/api/songs/usage`)).status, 401);
});
