// Keeping and archiving: visitors' contact details erased after the set months; records and log entries older than
// the set years moved into one read-only file per year (services stay); archives listed, read and copied with
// backups; administrators only. Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-archive-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const svc = await import('../server/repo/services.ts');
const rec = await import('../server/repo/records.ts');
const A = await import('../server/repo/archive.ts');
const { closeDb, get, run } = await import('../server/db.ts');
const S = await import('../server/repo/settings.ts');
const { openDb } = await import('../server/lib/sqlite.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Session = { cookie: string; csrf: string };
let server: Server;
let base = '';
const as: Record<'admin' | 'editor', Session> = {} as never;
const ids: Record<string, number> = {};
const editor = { name: 'Ed', admin: false };

async function login(username: string): Promise<Session> {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'correct-horse-4' }) });
  assert.equal(r.status, 200);
  return { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), csrf: ((await r.json()) as Json).csrf };
}
async function call(who: Session, method: string, url: string, body?: unknown) {
  const r = await fetch(`${base}/api${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: who.cookie, 'X-CSRF-Token': who.csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json: Json | null = null;
  try {
    json = JSON.parse(text);
  } catch { /* file */ }
  return { status: r.status, json, text };
}

before(async () => {
  for (const role of ['admin', 'editor'] as const) createUser({ username: role, display_name: `Test ${role}`, password: 'correct-horse-4', role });
  server = createApp().listen(0, '127.0.0.1');
  // a full parallel test run is slow: idle connections stay open for the next request (no reset mid-test)
  server.keepAliveTimeout = 120_000;
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const role of ['admin', 'editor'] as const) as[role] = await login(role);
  const visitor = { name: 'Old Visitor', contact: '9000 0077', prayer: 'old prayer', about: 'A baptised Christian', source: 'Friend', notes: 'note' };
  for (const [k, date] of [['y2018', '2018-03-04'], ['y2019', '2019-05-05'], ['recent', '2026-09-27']] as const) {
    ids[k] = svc.createService({ date, title: { en: `Test ${k}` } }).service.id;
    rec.saveRecord(ids[k], { attendance: 50, visitors: [visitor], offerings: [{ fund: 'General', method: 'transfer', amount: 1000 }] }, editor);
  }
  run("INSERT INTO change_log (at, user_name, via, entity, entity_id, action, name, changes) VALUES ('2018-06-01 10:00:00', 'Someone', 'web', 'people', 1, 'update', 'Archived Person', '{}')");
  run("INSERT INTO mcp_audit (at, tool, ok) VALUES ('2018-06-02 10:00:00', 'canon_find_services', 1)");
});

after(async () => {
  await new Promise((r) => server.close(r));
  try {
    closeDb();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('visitors\' contact details, prayer requests and notes are erased after the set months; names stay', () => {
  const n = A.eraseVisitorContacts(24, new Date('2026-10-05'));
  assert.equal(n.visitors, 2, '2018 and 2019, not last week');
  const old = rec.recordFor(ids.y2018).visitors[0];
  assert.deepEqual(old, { name: 'Old Visitor', source: 'Friend' });
  assert.equal(rec.recordFor(ids.recent).visitors[0].contact, '9000 0077');
  assert.deepEqual(A.eraseVisitorContacts(0), { visitors: 0, log: 0 }, '0 = keep');
});

test('archiving: preview, then each old year in its own file; services stay; nothing archived twice', async () => {
  assert.deepEqual(A.archivableYears(5, new Date('2026-10-05')).map((y) => y.year), [2018, 2019]);
  assert.equal((await call(as.editor, 'POST', '/archives/run', { dry_run: true })).status, 403);
  const dry = await call(as.admin, 'POST', '/archives/run', { dry_run: true });
  assert.deepEqual(dry.json!.years.map((y: Json) => [y.year, y.records]), [[2018, 1], [2019, 1]]);
  assert.ok(rec.recordFor(ids.y2018).saved, 'a preview changes nothing');

  const done = await call(as.admin, 'POST', '/archives/run', {});
  assert.equal(done.status, 200, done.text);
  assert.ok(fs.existsSync(path.join(tmp, 'archives', 'canon-archive-2018.db')));
  assert.equal(rec.recordFor(ids.y2018).saved, false, 'record moved out');
  assert.ok(svc.services.get(ids.y2018), 'the service itself stays');
  assert.ok(rec.recordFor(ids.recent).saved, 'recent records stay');
  assert.equal(get<{ n: number }>("SELECT COUNT(*) AS n FROM change_log WHERE at LIKE '2018%'")!.n, 0);
  assert.ok(get<{ n: number }>("SELECT COUNT(*) AS n FROM change_log WHERE summary LIKE 'Archived 2018%'")!.n >= 1, 'the archiving itself is logged');
  assert.equal(A.archivableYears(5, new Date('2026-10-05')).length, 0);
});

test('archives can be listed, read and downloaded (administrators), and go along with backups', async () => {
  const list = await call(as.admin, 'GET', '/archives');
  assert.deepEqual(list.json!.map((a: Json) => [a.year, a.records, a.changes, a.ai]), [[2018, 1, 1, 1], [2019, 1, 0, 0]]);
  const recs = await call(as.admin, 'GET', '/archives/2018/records');
  assert.equal(recs.json![0].title.en, 'Test y2018');
  assert.equal(recs.json![0].attendance, 50);
  assert.deepEqual(recs.json![0].totals, { SGD: 1000 });
  const ch = await call(as.admin, 'GET', '/archives/2018/changes?q=Archived%20Person');
  assert.equal(ch.json!.total, 1);
  assert.equal((await call(as.editor, 'GET', '/archives')).status, 403);
  const dl = await fetch(`${base}/api/archives/2018/download`, { headers: { Cookie: as.admin.cookie } });
  assert.equal(dl.status, 200);
  assert.ok((await dl.arrayBuffer()).byteLength > 1000);
  assert.equal((await call(as.admin, 'GET', '/archives/2017/records')).status, 404);

  const backups = path.join(tmp, 'b');
  assert.equal(A.copyArchivesTo(backups), 2);
  assert.ok(fs.existsSync(path.join(backups, 'archives', 'canon-archive-2019.db')));
  assert.equal(A.copyArchivesTo(backups), 0, 'unchanged files are not copied again');
});

test('an archived record is read-only: no new record, no deleting or moving the service; an administrator can bring it back', async () => {
  const sid = ids.y2018;
  assert.equal(rec.recordFor(sid).archived_year, 2018);
  const put = await call(as.editor, 'PUT', `/services/${sid}/record`, { attendance: 99 });
  assert.equal(put.status, 409, 'no second record for an archived service');
  assert.match(put.json!.error, /2018 archive/);
  assert.equal((await call(as.editor, 'DELETE', `/services/${sid}`)).status, 409, 'the service stays');
  assert.equal((await call(as.editor, 'PATCH', `/services/${sid}`, { date: '2025-01-05' })).status, 409, 'nor moves to another year');
  assert.equal((await call(as.editor, 'PATCH', `/services/${sid}`, { sermon_ref: 'John 3:16' })).status, 200, 'other details can change');
  const row = (await call(as.editor, 'GET', '/records?from=2018-01-01&to=2018-12-31')).json!.find((r: Json) => r.service_id === sid);
  assert.equal(row.archived_year, 2018);

  // archiving again adds nothing twice
  A.runArchive(false, 5);
  assert.equal(A.listArchives().find((a) => a.year === 2018)!.records, 1);

  // the correction process: bring it back, correct it, archive again
  assert.equal((await call(as.editor, 'POST', `/archives/2018/records/${sid}/restore`, {})).status, 403);
  const back = await call(as.admin, 'POST', `/archives/2018/records/${sid}/restore`, {});
  assert.equal(back.status, 200, back.text);
  assert.equal(rec.recordFor(sid).saved, true);
  assert.equal(rec.recordFor(sid).attendance, 50);
  assert.equal(A.listArchives().find((a) => a.year === 2018)!.records, 0);
  assert.equal((await call(as.editor, 'PUT', `/services/${sid}/record`, { attendance: 51 })).status, 200, 'now it can be corrected');
  assert.ok(get<{ n: number }>("SELECT COUNT(*) AS n FROM change_log WHERE summary LIKE 'Brought the service record%'")!.n >= 1, 'logged');
  A.runArchive(false, 5);
  assert.equal(A.listArchives().find((a) => a.year === 2018)!.records, 1);
  assert.equal(rec.recordFor(sid).archived_year, 2018);
  assert.equal(A.archivedRecords(2018)[0].attendance, 51, 'the corrected record is the one archived');
});

test('a record restored from an older backup, also in an archive: the same one is not archived twice; a different one stops archiving', () => {
  const sid = ids.y2019;
  assert.equal(A.archivedRecords(2019)[0].service_id, sid);
  // as if a backup from before archiving was restored: the live record is back, the archive marker is not
  const d = openDb(A.archivePath(2019), { readonly: true });
  const archived = d.prepare('SELECT * FROM service_records WHERE service_id = ?').get(sid) as Record<string, string | number | null>;
  d.close();
  run('DELETE FROM archived_records WHERE service_id = ?', sid);
  const cols = Object.keys(archived);
  run(`INSERT INTO service_records (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...cols.map((c) => archived[c]));
  A.runArchive(false, 5);
  assert.equal(A.listArchives().find((a) => a.year === 2019)!.records, 1, 'the same record: not archived twice');
  assert.equal(rec.recordFor(sid).archived_year, 2019);

  // a different record for the same service: archiving stops and says why
  run('DELETE FROM archived_records WHERE service_id = ?', sid);
  run("INSERT INTO service_records (service_id, attendance, updated_at) VALUES (?, 7, '2026-01-01 00:00:00')", sid);
  assert.throws(() => A.runArchive(false, 5), /already has a different record/);
  assert.equal(A.listArchives().find((a) => a.year === 2019)!.records, 1, 'nothing archived');
  run('DELETE FROM service_records WHERE service_id = ?', sid);
  // archives made by 0.11.0 (no markers): linked again
  assert.equal(A.syncArchiveIndex(), 1);
  assert.equal(rec.recordFor(sid).archived_year, 2019);
});

test("erasing visitors' details also reaches archive files and the change log; archiving erases first", async () => {
  const visitor = { name: 'Late Visitor', contact: '9000 0088', prayer: 'a prayer', source: 'Friend' };
  const inArchive = (year: number, sid: number) => {
    const d = openDb(A.archivePath(year), { readonly: true });
    try {
      return (d.prepare('SELECT visitors FROM service_records WHERE service_id = ?').get(sid) as { visitors: string }).visitors;
    } finally {
      d.close();
    }
  };
  // erasing off: a 2017 record with contact details reaches the archive, and the change log keeps a copy
  S.updateSettings({ retention: { ...S.getSettings().retention, visitor_contact_months: 0 } });
  const s17 = svc.createService({ date: '2017-06-04', title: { en: 'Test 2017' } }).service.id;
  assert.equal((await call(as.editor, 'PUT', `/services/${s17}/record`, { attendance: 30, visitors: [visitor] })).status, 200);
  assert.ok(get<{ n: number }>("SELECT COUNT(*) AS n FROM change_log WHERE entity = 'service_records' AND changes LIKE '%9000 0088%'")!.n >= 1);
  A.runArchive(false, 5);
  assert.match(inArchive(2017, s17), /9000 0088/);
  // now erase: the archive file and the change log lose the details; the name stays
  S.updateSettings({ retention: { ...S.getSettings().retention, visitor_contact_months: 24 } });
  const n = A.eraseVisitorContacts(24);
  assert.ok(n.visitors >= 1 && n.log >= 1, JSON.stringify(n));
  assert.doesNotMatch(inArchive(2017, s17), /9000 0088|a prayer/);
  assert.match(inArchive(2017, s17), /Late Visitor/);
  assert.equal(get<{ n: number }>("SELECT COUNT(*) AS n FROM change_log WHERE changes LIKE '%9000 0088%'")!.n, 0, 'no copy left in the change log');

  // erasing on: archiving erases first, so the details never reach the archive
  const s16 = svc.createService({ date: '2016-03-06', title: { en: 'Test 2016' } }).service.id;
  rec.saveRecord(s16, { attendance: 20, visitors: [{ ...visitor, contact: '9000 0099' }] }, editor);
  A.runArchive(false, 5);
  assert.doesNotMatch(inArchive(2016, s16), /9000 0099/);
  assert.match(inArchive(2016, s16), /Late Visitor/);
});

test('a record archived by an older Canon (fewer columns) can be brought back and archived again', () => {
  const s15 = svc.createService({ date: '2015-05-03', title: { en: 'Test 2015' } }).service.id;
  rec.saveRecord(s15, { attendance: 15 }, editor);
  A.runArchive(false, 5);
  // as 0.11.0 left it: no revision column in the archive
  const d = openDb(A.archivePath(2015));
  d.exec('ALTER TABLE service_records DROP COLUMN revision');
  d.close();
  assert.deepEqual(A.restoreArchivedRecord(2015, s15), { restored: true, service_id: s15 });
  const back = rec.recordFor(s15);
  assert.equal(back.attendance, 15);
  assert.equal(typeof back.revision, 'number');
  A.runArchive(false, 5);
  assert.equal(rec.recordFor(s15).archived_year, 2015);
});

test("visitors' details in the change log are erased even after the record and its service were deleted", async () => {
  const visitor = { name: 'Gone Visitor', contact: '9000 0111', prayer: 'a gone prayer', about: 'Travelling', notes: 'a gone note', source: 'Walked in' };
  const s23 = svc.createService({ date: '2023-04-02', title: { en: 'Test April 2023' } }).service.id;
  assert.equal((await call(as.editor, 'PUT', `/services/${s23}/record`, { attendance: 12, visitors: [visitor] })).status, 200);
  assert.equal((await call(as.admin, 'DELETE', `/services/${s23}/record`)).status, 200);
  assert.equal((await call(as.editor, 'DELETE', `/services/${s23}`)).status, 200);
  const copies = () => get<{ n: number }>("SELECT COUNT(*) AS n FROM change_log WHERE changes LIKE '%9000 0111%' OR changes LIKE '%a gone prayer%' OR changes LIKE '%Travelling%' OR changes LIKE '%a gone note%'")!.n;
  assert.equal(copies(), 2, 'the create and the delete snapshots');
  assert.equal(get<{ date: string }>('SELECT date FROM service_tombstones WHERE id = ?', s23)?.date, '2023-04-02');
  A.eraseVisitorContacts(24, new Date('2026-10-05'));
  assert.equal(copies(), 0, 'both snapshots erased');
  assert.ok(get<{ n: number }>("SELECT COUNT(*) AS n FROM change_log WHERE changes LIKE '%Gone Visitor%'")!.n >= 1, 'the name stays');

  // a service deleted before 0.11.2 with no date to be found: its entries go once they are older than the setting
  run(`INSERT INTO change_log (at, user_name, via, entity, entity_id, action, name, changes, parent_entity, parent_id)
       VALUES ('2020-01-05 10:00:00', 'Someone', 'web', 'service_records', 990001, 'create', '#990001', ?, 'services', 990002),
              (datetime('now'), 'Someone', 'web', 'service_records', 990003, 'create', '#990003', ?, 'services', 990004)`,
  JSON.stringify({ visitors: [null, [{ name: 'Old Orphan', contact: '9000 0122' }]] }), JSON.stringify({ visitors: [null, [{ name: 'New Orphan', contact: '9000 0133' }]] }));
  A.eraseVisitorContacts(24);
  assert.equal(get<{ n: number }>("SELECT COUNT(*) AS n FROM change_log WHERE changes LIKE '%9000 0122%'")!.n, 0, 'old orphan erased');
  assert.equal(get<{ n: number }>("SELECT COUNT(*) AS n FROM change_log WHERE changes LIKE '%9000 0133%'")!.n, 1, 'a recent orphan waits for its own age');
});

test('a restored record that differs from the archived one (same id, same second) stops archiving and keeps its money', async () => {
  const B = await import('../server/repo/backups.ts');
  // restores make their safety copies in this test's folder, never the project's backups/
  S.updateSettings({ backup: { dir: path.join(tmp, 'restore-backups'), auto: 'off', keep: 20 } });
  const s13 = svc.createService({ date: '2013-09-01', title: { en: 'Test 2013' } }).service.id;
  const line = (amount: number) => [{ fund: 'General', method: 'transfer' as const, amount }];
  const first = rec.saveRecord(s13, { attendance: 13, offerings: line(5000) }, editor);
  const a = B.createBackup();
  rec.saveRecord(s13, { offerings: line(9000) }, editor);
  // the same second as the first save: a timestamp can't tell them apart
  run('UPDATE service_records SET updated_at = ? WHERE service_id = ?', first.updated_at, s13);
  const b = B.createBackup();

  await B.restoreBackup(a.path);
  A.runArchive(false, 5);
  assert.equal(A.archivedRecords(2013)[0].totals.SGD, 5000);

  await B.restoreBackup(b.path);
  assert.equal(rec.recordFor(s13).offerings[0].amount, 9000);
  assert.throws(() => A.runArchive(false, 5), /already has a different record/);
  assert.equal(rec.recordFor(s13).offerings[0].amount, 9000, 'the live record and its money stay');
  assert.equal(A.archivedRecords(2013).length, 1);
  assert.equal(A.archivedRecords(2013)[0].totals.SGD, 5000);

  // restoring A again (the very record that was archived): the same copy is just dropped
  await B.restoreBackup(a.path);
  A.runArchive(false, 5);
  assert.equal(A.archivedRecords(2013).length, 1);
  assert.equal(rec.recordFor(s13).archived_year, 2013);
});
