// Settings → Export data (0.15.6): every part as CSV, everything as a zip, and the library file — exported, and
// imported again adding only what is missing (Bibles only with the church's permission). Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-export-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const lib = await import('../server/repo/library.ts');
const sc = await import('../server/repo/scores.ts');
const { createBlock, listBlocks } = await import('../server/repo/presentation.ts');
const { exportLibrary, importLibrary } = await import('../server/repo/library-file.ts');
const { zip } = await import('../server/lib/zip.ts');
const { db, get, run } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Session = { cookie: string; csrf: string };
let server: Server;
let base = '';
const as: Record<'admin' | 'editor', Session> = {} as never;

async function login(username: string): Promise<Session> {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'correct-horse-8' }) });
  assert.equal(r.status, 200);
  return { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), csrf: ((await r.json()) as Json).csrf };
}

/** Read a zip back: names and contents (central directory → local entries, deflated). */
function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const lNameLen = buf.readUInt16LE(local + 26);
    const data = zlib.inflateRawSync(buf.subarray(local + 30 + lNameLen, local + 30 + lNameLen + size));
    assert.equal(zlib.crc32(data) >>> 0, buf.readUInt32LE(p + 16), `crc of ${name}`);
    out.set(name, data);
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

before(async () => {
  createUser({ username: 'admin', display_name: 'Test admin', password: 'correct-horse-8', role: 'admin' });
  createUser({ username: 'editor', display_name: 'Test editor', password: 'correct-horse-8', role: 'editor' });
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  as.admin = await login('admin');
  as.editor = await login('editor');
});

after(async () => {
  await new Promise((r) => server.close(r));
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('zip: names (Chinese too) and contents come back as written', () => {
  const z = zip([{ name: 'members.csv', data: 'a,b\n1,2\n' }, { name: '说明.txt', data: Buffer.from('诗歌'.repeat(500)) }]);
  const back = unzip(z);
  assert.equal(back.get('members.csv')!.toString(), 'a,b\n1,2\n');
  assert.equal(back.get('说明.txt')!.toString(), '诗歌'.repeat(500));
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(30, 3)]);

test('library file: export, then import adds back only what is missing; a dry run changes nothing', () => {
  const h = lib.hymnals.insert({ name: { en: 'Test Hymnal' }, abbr: 'TH', sort: 1 } as never);
  const s = lib.songs.insert({ key: 'example-hymn', title: { en: 'An Example Hymn', zh: '示例诗歌' }, stanzas: [{ label: '1', text: { en: 'Line one' } }], category: 'hymn', public_domain: true, tags: ['test'], refrain_after_each: false } as never);
  lib.setSongHymnals(s.id, [{ hymnal_id: h.id, number: '45' }]);
  sc.addScore(s.id, { name: 'p1.png', mime: 'image/png', data: PNG });
  lib.texts.insert({ key: 'example-prayer', category: 'prayer', title: { en: 'An Example Prayer' }, body: { en: 'Amen.' }, tags: [], public_domain: true } as never);
  createBlock({ name: 'Example website', kind: 'qr', data: { value: 'https://example.org/', caption: { en: 'Visit' } } } as never);
  // an uploaded Bible (fictional code)
  run("INSERT INTO bible_translations (code, lang, name, license, source, rights) VALUES ('TST', 'en', 'Test Version', 'Used with permission', 'upload', '{}')");
  run("INSERT INTO bible_verses (translation, book, chapter, verse, text) VALUES ('TST', 1, 1, 1, 'In the beginning (test).')");

  const file = exportLibrary({ bibles: true });
  const parsed = JSON.parse(zlib.gunzipSync(file).toString());
  assert.equal(parsed.format, 'canon-library');
  assert.deepEqual(parsed.songs.find((x: Json) => x.key === 'example-hymn').numbers, [{ abbr: 'TH', number: '45' }]);
  assert.equal(parsed.bibles.length, 1);

  // the same Canon: everything is already here
  const same = importLibrary(file, { dryRun: true });
  assert.equal(same.songs.added, 0);
  assert.equal(same.texts.added, 0);

  // take it all away, then import
  lib.songs.remove(s.id);
  run("DELETE FROM texts WHERE key = 'example-prayer'");
  for (const b of listBlocks().filter((x) => x.name === 'Example website')) run('DELETE FROM bulletin_blocks WHERE id = ?', b.id);
  run("DELETE FROM bible_verses WHERE translation = 'TST'");
  run("DELETE FROM bible_translations WHERE code = 'TST'");
  const dry = importLibrary(file, { dryRun: true, biblePermission: true });
  assert.equal(dry.songs.added, 1);
  assert.equal(get("SELECT 1 FROM songs WHERE key = 'example-hymn'"), undefined, 'a dry run saves nothing');

  const r = importLibrary(file);
  assert.equal(r.songs.added, 1);
  assert.equal(r.songs.sheet_music_added, 1);
  assert.equal(r.texts.added, 1);
  assert.equal(r.blocks.added, 1);
  assert.equal(r.bibles.skipped, 1, 'Bibles only with permission');
  const back = get<{ id: number }>("SELECT id FROM songs WHERE key = 'example-hymn'")!;
  assert.deepEqual(lib.songs.get(back.id).stanzas, [{ label: '1', text: { en: 'Line one' } }]);
  assert.ok(sc.scoreData(sc.scoresFor(back.id)[0].id).data.equals(PNG));
  assert.equal(get<{ n: string }>('SELECT sh.number AS n FROM song_hymnals sh WHERE sh.song_id = ?', back.id)?.n, '45');
  assert.equal(importLibrary(file, { biblePermission: true }).bibles.added, 1);
  assert.equal(get<{ t: string }>("SELECT text AS t FROM bible_verses WHERE translation = 'TST'")?.t, 'In the beginning (test).');
  assert.throws(() => importLibrary(Buffer.from('not a library')), /not a Canon library file/);
});

test('Export data: administrators only; everything comes as one zip', async () => {
  assert.equal((await fetch(`${base}/api/export`, { headers: { Cookie: as.editor.cookie } })).status, 403);
  const list = await (await fetch(`${base}/api/export`, { headers: { Cookie: as.admin.cookie } })).json() as Json;
  assert.ok(list.csv.some((p: Json) => p.key === 'songs'));
  const r = await fetch(`${base}/api/export/all.zip`, { headers: { Cookie: as.admin.cookie } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/zip');
  const files = unzip(Buffer.from(await r.arrayBuffer()));
  assert.ok(files.has('songs.csv') && files.has('members.csv') && files.has('README.txt'));
  assert.ok([...files.keys()].some((n) => n.endsWith('.canonlib')));
  assert.equal((await fetch(`${base}/api/export/library.canonlib`, { headers: { Cookie: as.editor.cookie } })).status, 403);
});

test('library sections (0.15.7): one hymnal, songs in no hymnal, texts, one Bible, QR codes & notes, slide backgrounds', async () => {
  const { saveBackground, backgroundByName } = await import('../server/repo/backgrounds.ts');
  const read = (b: Buffer) => JSON.parse(zlib.gunzipSync(b).toString()) as Json;
  const h1 = lib.hymnals.insert({ name: { en: 'Section Hymnal One' }, abbr: 'S1', sort: 5 } as never);
  const h2 = lib.hymnals.insert({ name: { en: 'Section Hymnal Two' }, abbr: 'S2', sort: 6 } as never);
  const a = lib.songs.insert({ key: 'sec-a', title: { en: 'Section Song A' }, stanzas: [], category: 'hymn', public_domain: true, tags: [], refrain_after_each: false } as never);
  const b = lib.songs.insert({ key: 'sec-b', title: { en: 'Section Song B' }, stanzas: [], category: 'hymn', public_domain: true, tags: [], refrain_after_each: false } as never);
  lib.songs.insert({ key: 'sec-c', title: { en: 'Section Song C' }, stanzas: [], category: 'hymn', public_domain: true, tags: [], refrain_after_each: false } as never);
  lib.setSongHymnals(a.id, [{ hymnal_id: h1.id, number: '1' }]);
  lib.setSongHymnals(b.id, [{ hymnal_id: h2.id, number: '2' }]);

  const one = read(exportLibrary({ sections: ['songs'], hymnal: h1.id }));
  assert.deepEqual(one.songs.map((s: Json) => s.key), ['sec-a']);
  assert.deepEqual(one.hymnals.map((h: Json) => h.abbr), ['S1']);
  assert.deepEqual(one.texts, [], 'only the songs');
  assert.equal(one.blocks, undefined);
  assert.ok(read(exportLibrary({ sections: ['songs'], hymnal: 'none' })).songs.some((s: Json) => s.key === 'sec-c'));
  assert.ok(!read(exportLibrary({ sections: ['songs'], hymnal: 'none' })).songs.some((s: Json) => s.key === 'sec-a'));
  assert.equal(read(exportLibrary({ sections: ['texts'] })).songs.length, 0);

  // slide backgrounds travel by name and come back
  const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
  saveBackground(null, 'Bread and cup (test)', 'image/jpeg', JPEG);
  const bgFile = exportLibrary({ sections: ['backgrounds'] });
  assert.deepEqual(read(bgFile).backgrounds.map((x: Json) => x.name), ['Bread and cup (test)']);
  run('DELETE FROM slide_backgrounds WHERE id = ?', backgroundByName('Bread and cup (test)')!);
  assert.equal(importLibrary(bgFile).backgrounds.added, 1);
  assert.ok(backgroundByName('Bread and cup (test)'));

  // over HTTP: a hymnal's file has its name in the file name
  const r = await fetch(`${base}/api/export/library.canonlib?section=songs&hymnal=${h1.id}`, { headers: { Cookie: as.admin.cookie } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition') ?? '', /canon-hymns-S1-/);
  const list = await (await fetch(`${base}/api/export`, { headers: { Cookie: as.admin.cookie } })).json() as Json;
  assert.ok(list.hymnals.some((h: Json) => h.abbr === 'S1'));
});
