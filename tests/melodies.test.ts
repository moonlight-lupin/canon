// 0.21.0: a song's melody in numbered notation (jianpu): saved and cleared by the church's editors, gone with its song,
// listed with the service's sheet music, carried in library files — and outside the song tools AI assistants use (the
// melody tools are tested in oauth-mcp.test.ts). The guide's and the notation reference's examples must stay drawable
// by the pinned jpFun. Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-melodies-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const svc = await import('../server/repo/services.ts');
const lib = await import('../server/repo/library.ts');
const mel = await import('../server/repo/melodies.ts');
const { exportLibrary, importLibrary } = await import('../server/repo/library-file.ts');
const { TOOLS } = await import('../server/mcp.ts');
const S = await import('../shared/schemas.ts');
const { get, db } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Session = { cookie: string; csrf: string };
let server: Server;
let base = '';
const as: Record<'editor' | 'viewer', Session> = {} as never;

async function login(username: string): Promise<Session> {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'correct-horse-5' }) });
  assert.equal(r.status, 200);
  return { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), csrf: ((await r.json()) as Json).csrf };
}
async function call(who: Session, method: string, url: string, body?: unknown) {
  const r = await fetch(`${base}/api${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: who.cookie, 'X-CSRF-Token': who.csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => null)) as Json };
}

before(async () => {
  for (const role of ['editor', 'viewer'] as const) await createUser({ username: role, display_name: `Test ${role}`, password: 'correct-horse-5', role });
  server = createApp().listen(0, '127.0.0.1');
  server.keepAliveTimeout = 120_000;
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const k of ['editor', 'viewer'] as const) as[k] = await login(k);
});

after(async () => {
  await new Promise((r) => server.close(r));
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const TUNE = '@1(C4)\n@meter(3, 4)\nN: 1 2 3 | 5 - - |\nL: Morn- ing has come\n';
const newSong = (en: string) => lib.songs.insert({ title: { en }, stanzas: [{ label: '1', text: { en: 'A line' } }], category: 'hymn', public_domain: true, tags: [], refrain_after_each: false } as never);

test('an editor saves, changes and clears a melody; a viewer reads it but cannot change it', async () => {
  const song = newSong('A Morning Hymn');
  assert.deepEqual((await call(as.viewer, 'GET', `/songs/${song.id}/melody`)).body, { source: null });
  assert.equal((await call(as.viewer, 'PUT', `/songs/${song.id}/melody`, { source: TUNE })).status, 403);

  const saved = await call(as.editor, 'PUT', `/songs/${song.id}/melody`, { source: TUNE.replace(/\n/g, '\r\n') + '   \n' });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.source, TUNE.trimEnd(), 'line ends made plain, trailing space dropped');
  assert.deepEqual((await call(as.viewer, 'GET', '/songs/melodies/ids')).body, [song.id]);
  assert.equal((await call(as.viewer, 'GET', `/songs/${song.id}/melody`)).body.source, TUNE.trimEnd());
  // the change log names the song
  assert.ok(get("SELECT 1 FROM change_log WHERE entity = 'songs' AND entity_id = ? AND changes LIKE '%melody%'", song.id));

  assert.equal((await call(as.editor, 'PUT', `/songs/${song.id}/melody`, { source: 'x'.repeat(mel.MAX_MELODY_CHARS + 1) })).status, 400);
  assert.equal((await call(as.editor, 'PUT', '/songs/999999/melody', { source: TUNE })).status, 404);

  const cleared = await call(as.editor, 'PUT', `/songs/${song.id}/melody`, { source: '  \n' });
  assert.deepEqual(cleared.body, { source: null });
  assert.equal(get('SELECT 1 FROM song_melodies WHERE song_id = ?', song.id), undefined);
});

test('a melody goes with its song, and is listed with the service’s sheet music', async () => {
  const song = newSong('An Evening Hymn');
  const plain = newSong('A Hymn Without Music');
  mel.setMelody(song.id, TUNE);
  const s = svc.createService({ date: '2031-05-11' }).service;
  svc.addItem(s.id, { kind: 'song', ref_id: plain.id });
  svc.addItem(s.id, { kind: 'song', ref_id: song.id, stanzas: ['1'] });
  const list = await call(as.viewer, 'GET', `/services/${s.id}/scores`);
  assert.deepEqual(list.body.songs.map((x: Json) => [x.song.id, x.melody]), [[plain.id, null], [song.id, TUNE.trimEnd()]]);

  lib.songs.remove(song.id);
  assert.equal(get('SELECT 1 FROM song_melodies WHERE song_id = ?', song.id), undefined);
});

test('melodies are not part of songs for AI tools: only canon_melody / canon_save_melody (when shared) handle them', async () => {
  const song = newSong('A Hymn For Musicians');
  mel.setMelody(song.id, TUNE);
  const ctx = { auth: { user: { id: 1, role: 'admin' } }, pii: false, scores: true, levels: { library: 'write', services: 'write' } } as never;
  const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
  const item = JSON.stringify(await tool('canon_get_library_item').handler({ type: 'song', id: song.id }, ctx));
  assert.doesNotMatch(item, /melody|Morn- ing/);
  const sheet = JSON.stringify(await tool('canon_sheet_music').handler({ song_id: song.id, pictures: false }, ctx));
  assert.doesNotMatch(sheet, /melody|Morn- ing/);
  // canon_save_song's fields are SongInput, which has no melody: anything sent as one is dropped
  assert.equal('melody' in S.SongInput.partial().parse({ melody: '1 2 3' }), false);
  assert.ok(!lib.songs.get(song.id).hasOwnProperty('melody'));
});

test('library files carry melodies; importing adds one only to a song that has none', async () => {
  const song = newSong('A Carried Hymn');
  mel.setMelody(song.id, TUNE);
  const read = (b: Buffer) => JSON.parse(zlib.gunzipSync(b).toString('utf8')) as Json;
  const file = exportLibrary();
  assert.ok(read(file).songs.some((x: Json) => x.melody === TUNE.trimEnd()));
  assert.equal(read(exportLibrary({ scores: false })).songs.some((x: Json) => 'melody' in x), false, 'not without the sheet music');

  // here already: kept as it is
  mel.setMelody(song.id, '@1(D4)\nN: 5 - |');
  assert.equal(importLibrary(file).songs.melodies_added, 0);
  assert.equal(mel.melodyFor(song.id), '@1(D4)\nN: 5 - |');
  // lost here: added back from the file
  mel.setMelody(song.id, '');
  assert.equal(importLibrary(file, { dryRun: true }).songs.melodies_added, 1);
  assert.equal(mel.melodyFor(song.id), null, 'a dry run saves nothing');
  importLibrary(file);
  assert.equal(mel.melodyFor(song.id), TUNE.trimEnd());
});

test('the guide’s melody examples are drawn by the pinned jpFun without errors', async () => {
  const { compileScore, renderLayoutPagesToSvg } = await import('jpfun');
  for (const lang of ['en', 'zh', 'zh-Hant']) {
    const md = fs.readFileSync(path.join(import.meta.dirname, '..', 'docs', 'guide', `${lang}.md`), 'utf8');
    const examples = [...md.matchAll(/```jianpu\n([\s\S]*?)```/g)].map((m) => m[1]);
    assert.ok(examples.length, `${lang}.md has a melody example`);
    for (const src of examples) {
      const r = compileScore(src);
      assert.deepEqual(r.diagnostics.map((d) => d.message), [], `${lang}.md example`);
      assert.match(renderLayoutPagesToSvg(r.layout)[0], /^<svg/);
    }
  }
});

test('Canon’s words for jpFun’s problems: the details are found in jpFun’s own messages', async () => {
  const { compileScore } = await import('jpfun');
  const { jianpuHint, fillHint, JIANPU_HINTS } = await import('../shared/jianpu-messages.ts');
  const problems = (src: string) => {
    try {
      const r = compileScore(src);
      return [...r.diagnostics, ...r.layout.diagnostics];
    } catch (e) {
      return [e as { code: string; message: string }];
    }
  };
  // a mistake each, and what Canon should say (when jpFun changes a message, this shows which hint lost its details)
  const cases: [string, string, RegExp][] = [
    ['@meter(4)\nN: 1', 'E_MISSING_REQUIRED_ARG', /^@meter is missing a value it needs \(den\)/],
    ['@metre(4, 4)\nN: 1', 'W_UNKNOWN_FUNCTION', /^There is no @metre:/],
    ['@meter(4, 4\nN: 1', 'E_UNTERMINATED_CALL', /^@meter\( is not closed/],
    ['@1(H4)\nN: 1', 'W_KEY_TONALITY', /^The key “H4” .* so C4 is used/],
    ['@meter(3, 4)\nN: 1 2 3 | 1 2 3 4 |', 'W_METER_MISMATCH', /^This bar has 4 beats, but the time signature is 3\/4\.$/],
    ['L: abc', 'E_LYRICS_WITHOUT_VOICE_NOTES', /^An L: line/],
  ];
  for (const [src, code, said] of cases) {
    const d = problems(src).find((x) => x.code === code);
    assert.ok(d, `${JSON.stringify(src)} gives ${code}`);
    const h = jianpuHint(d.code, d.message);
    assert.ok(h);
    assert.match(fillHint(h.template, h.vars), said);
  }
  assert.equal(jianpuHint('E_SOMETHING_NEW', 'x'), null, 'other codes keep jpFun’s message');
  for (const t of Object.values(JIANPU_HINTS)) assert.ok(/^[\x20-\x7e’“”…]+$/.test(t), `English: ${t}`);
});

test('the notation reference for agents: the same in docs and the skill, and its examples are drawn without problems', async () => {
  const { compileScore } = await import('jpfun');
  const root = path.join(import.meta.dirname, '..');
  const doc = fs.readFileSync(path.join(root, 'docs', 'JIANPU-NOTATION.md'), 'utf8');
  assert.equal(fs.readFileSync(path.join(root, 'skills', 'canon', 'references', 'jianpu.md'), 'utf8'), doc, 'skills/canon/references/jianpu.md is a copy of docs/JIANPU-NOTATION.md');
  const examples = [...doc.matchAll(/```jianpu\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.ok(examples.length >= 2);
  for (const src of examples) {
    const r = compileScore(src);
    assert.deepEqual([...r.diagnostics, ...r.layout.diagnostics].map((d) => d.message), [], src.slice(0, 40));
  }
});
