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
const { db, get, run } = await import('../server/db.ts');

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
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('visitors\' contact details, prayer requests and notes are erased after the set months; names stay', () => {
  const n = A.eraseVisitorContacts(24, new Date('2026-10-05'));
  assert.equal(n, 2, '2018 and 2019, not last week');
  const old = rec.recordFor(ids.y2018).visitors[0];
  assert.deepEqual(old, { name: 'Old Visitor', source: 'Friend' });
  assert.equal(rec.recordFor(ids.recent).visitors[0].contact, '9000 0077');
  assert.equal(A.eraseVisitorContacts(0), 0, '0 = keep');
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
