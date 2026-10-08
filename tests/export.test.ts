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
  // a full parallel test run is slow: idle connections stay open for the next request (no reset mid-test)
  server.keepAliveTimeout = 120_000;
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
  assert.ok(files.has('songs.xlsx') && files.has('members.xlsx') && files.has('README.txt'), [...files.keys()].join(', '));
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

test('sample data (0.15.8): a fictional church in, then exactly that out again', async () => {
  const sd = await import('../server/repo/sample-data.ts');
  const reg = await import('../server/repo/registers.ts');
  const svc = await import('../server/repo/services.ts');
  const vol = await import('../server/repo/volunteers.ts');
  const grp = await import('../server/repo/groups.ts');
  // a real member, on a team, and the church's next service with one place already filled by them
  const real = reg.people.insert({ first_name: 'Real', last_name: 'Member', status: 'member' } as never) as { id: number };
  const teamId = grp.createTeam({ name: { en: 'Sample test team' } } as never) as number;
  const role = vol.roles.insert({ team_id: teamId, name: { en: 'Usher' }, needed: 2 } as never) as { id: number };
  vol.roles.insert({ team_id: teamId, name: { en: 'Reader' }, needed: 1 } as never);
  vol.setRoleMembers(role.id, [real.id]);
  const sunday = (svc.createService({ date: '2031-03-02' }) as { service: { id: number } }).service;
  vol.assign(sunday.id, role.id, real.id);
  const before = get<{ n: number }>('SELECT COUNT(*) n FROM people')!.n;

  // editors may not; administrators may
  const denied = await fetch(`${base}/api/sample-data`, { method: 'POST', headers: { Cookie: as.editor.cookie, 'x-csrf-token': as.editor.csrf, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(denied.status, 403);
  assert.deepEqual(sd.sampleDataStatus(), { present: false });

  const st = sd.addSampleData({ today: '2031-02-28' }) as Json;
  assert.equal(st.present, true);
  assert.ok(st.people >= 35 && st.households >= 12 && st.groups >= 10, JSON.stringify(st));
  const tan = get<Json>("SELECT * FROM people WHERE first_name = 'Grace' AND last_name = 'Tan'")!;
  assert.equal(tan.native_name, '林美玲', 'her own Chinese name, not a translation');
  assert.equal(tan.household_role, 'spouse');
  assert.ok(tan.birth_date);
  assert.ok(get("SELECT 1 FROM groups WHERE json_extract(name, '$.zh') = '东区小组'"));
  // the next service and a copy a week later: only sample people fill empty places; the real member stays
  const next = get<{ id: number }>("SELECT id FROM services WHERE date = '2031-03-09'")!;
  assert.ok(next, 'a copy a week later');
  const onSunday = get<{ n: number }>('SELECT COUNT(*) n FROM assignments WHERE service_id = ?', sunday.id)!.n;
  assert.ok(onSunday > 1);
  assert.ok(get('SELECT 1 FROM assignments WHERE service_id = ? AND person_id = ?', sunday.id, real.id));
  assert.throws(() => sd.addSampleData(), /already there/);

  // someone real joins a sample group: the group stays when the sample data goes
  const council = get<{ id: number }>("SELECT id FROM groups WHERE json_extract(name, '$.en') = 'Church Council'")!;
  grp.addGroupMember(council.id, { person_id: real.id });

  const r = await fetch(`${base}/api/sample-data`, { method: 'DELETE', headers: { Cookie: as.admin.cookie, 'x-csrf-token': as.admin.csrf } });
  assert.equal(r.status, 200);
  assert.equal(get<{ n: number }>('SELECT COUNT(*) n FROM people')!.n, before);
  assert.ok(get('SELECT 1 FROM services WHERE id = ?', sunday.id), 'the real service stays');
  assert.ok(!get("SELECT 1 FROM services WHERE date = '2031-03-09'"), 'the copy goes');
  assert.equal(get<{ n: number }>('SELECT COUNT(*) n FROM assignments WHERE service_id = ?', sunday.id)!.n, 1, 'the real rota as it was');
  assert.ok(get('SELECT 1 FROM groups WHERE id = ?', council.id), 'a group someone real joined stays');
  assert.ok(!get("SELECT 1 FROM groups WHERE json_extract(name, '$.zh') = '东区小组'"));
  assert.deepEqual(sd.sampleDataStatus(), { present: false });
});

test('lists export as Excel with a title block, and the same file imports back unchanged (0.17.2)', async () => {
  const { readXlsx } = await import('../server/lib/xlsx-read.ts');
  const r = await fetch(`${base}/api/csv/songs/export.xlsx?lang=en`, { headers: { Cookie: as.admin.cookie } });
  assert.equal(r.status, 200);
  const bytes = new Uint8Array(await r.arrayBuffer());
  const rows = readXlsx(bytes);
  assert.match(rows[0][0], /songs/i);
  assert.ok(rows.some((x) => /^Exported .* by /.test(x[0] ?? '')));
  const back = await fetch(`${base}/api/csv/songs/import?dry_run=1&lang=en`, { method: 'POST', headers: { Cookie: as.admin.cookie, 'x-csrf-token': as.admin.csrf, 'Content-Type': 'application/octet-stream' }, body: bytes as unknown as BodyInit });
  const p = await back.json() as Json;
  assert.equal(p.fatal ?? null, null, JSON.stringify(p).slice(0, 300));
  assert.equal(p.encoding, 'xlsx');
  assert.equal(p.counts.error, 0);
  assert.equal(p.counts.create, 0, 'nothing new: the same songs');
  const tpl = await fetch(`${base}/api/csv/members/template.xlsx?lang=en`, { headers: { Cookie: as.admin.cookie } });
  assert.equal(tpl.status, 200);
});

test('removing sample data keeps what gained real records and never removes a reused number (review F3, F4)', async () => {
  const sd = await import('../server/repo/sample-data.ts');
  const reg = await import('../server/repo/registers.ts');
  const svc = await import('../server/repo/services.ts');
  const R = await import('../server/repo/records.ts');
  // the church's next service, so the sample copies it a week later and fills its rota
  const sunday = (svc.createService({ date: '2032-03-07' }) as { service: { id: number } }).service;
  const st = sd.addSampleData({ today: '2032-03-05' }) as Json;
  assert.equal(st.present, true);
  const copy = get<{ id: number }>("SELECT id FROM services WHERE date = '2032-03-14'")!;
  assert.ok(copy, 'the copied service');
  // F3: the copied service gets a real, verified cash count
  const who = { name: 'Ad Min', admin: true, money: true };
  R.saveRecord(copy.id, { attendance: 80, offerings: [{ fund: 'General', method: 'cash', amount: 5000 }], cash: { '5000': 1 }, counters: ['Ann', 'Ben'] } as never, who);
  R.setVerified(copy.id, true, who);
  assert.ok(R.recordFor(copy.id).verified_at);
  // F4: the newest sample person is deleted, and a real member is added — SQLite may give them the same number
  const last = get<{ id: number }>('SELECT MAX(id) id FROM people')!.id;
  reg.people.remove(last);
  const real = reg.people.insert({ first_name: 'Real', last_name: 'Newcomer', status: 'member' } as never) as { id: number };
  assert.equal(real.id, last, 'the number was reused (the case the review found)');

  const r = await fetch(`${base}/api/sample-data`, { method: 'DELETE', headers: { Cookie: as.admin.cookie, 'x-csrf-token': as.admin.csrf } });
  assert.equal(r.status, 200);
  const out = await r.json() as Json;
  assert.ok(get('SELECT 1 FROM people WHERE id = ?', real.id), 'the real member stays');
  assert.ok(get('SELECT 1 FROM services WHERE id = ?', copy.id), 'the service with a verified record stays');
  assert.ok(R.recordFor(copy.id).verified_at, 'and its verified record');
  assert.ok(out.kept.some((k: Json) => k.what === 'service' && k.why.includes('has a service record')));
  assert.ok(!get("SELECT 1 FROM people WHERE notes LIKE 'Sample person (fictional)%'"), 'the sample people go');
  assert.ok(get('SELECT 1 FROM services WHERE id = ?', sunday.id));
});

test('sample data marks its own rows: a real service, household or person that takes a deleted sample row’s number stays (0.19.1 review, A)', async () => {
  const sd = await import('../server/repo/sample-data.ts');
  const reg = await import('../server/repo/registers.ts');
  const svc = await import('../server/repo/services.ts');
  svc.createService({ date: '2038-03-28' });
  sd.addSampleData({ today: '2038-03-26' });
  // the copied sample service is deleted normally, before it has a record; a genuine service then takes its number
  const copy = get<{ id: number }>("SELECT id FROM services WHERE date = '2038-04-04'")!;
  assert.ok(copy, 'the copied sample service');
  const del = await fetch(`${base}/api/services/${copy.id}`, { method: 'DELETE', headers: { Cookie: as.admin.cookie, 'x-csrf-token': as.admin.csrf } });
  assert.equal(del.status, 200);
  const genuine = (svc.createService({ date: '2038-04-04', title: { en: 'Genuine planned service' } }) as { service: { id: number } }).service;
  assert.equal(genuine.id, copy.id, 'the number was reused (the case the review found)');
  // a sample household deleted and a real one with the same name takes its number
  const lastHh = get<{ id: number; name: string }>('SELECT id, name FROM households ORDER BY id DESC LIMIT 1')!;
  reg.households.remove(lastHh.id);
  const realHh = reg.households.insert({ name: lastHh.name } as never) as { id: number };
  assert.equal(realHh.id, lastHh.id);
  // a real person whose notes happen to carry the sample's wording, on a reused number
  const lastP = get<{ id: number }>('SELECT MAX(id) id FROM people')!.id;
  reg.people.remove(lastP);
  const realP = reg.people.insert({ first_name: 'Real', last_name: 'Copier', notes: sd.SAMPLE_NOTE, status: 'member' } as never) as { id: number };
  assert.equal(realP.id, lastP);

  const r = await fetch(`${base}/api/sample-data`, { method: 'DELETE', headers: { Cookie: as.admin.cookie, 'x-csrf-token': as.admin.csrf } });
  assert.equal(r.status, 200);
  assert.equal(get<{ title: string }>('SELECT title FROM services WHERE id = ?', genuine.id)?.title, JSON.stringify({ en: 'Genuine planned service' }), 'the genuine service and its plan stay');
  assert.ok(get('SELECT 1 FROM households WHERE id = ?', realHh.id), 'the real household stays');
  assert.ok(get('SELECT 1 FROM people WHERE id = ?', realP.id), 'the real person stays');
  assert.equal(get<{ n: number }>('SELECT COUNT(*) n FROM people WHERE sample_batch IS NOT NULL')!.n, 0, 'every sample person went');
});
