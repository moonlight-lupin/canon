// Service records over HTTP, as the web app uses them: what each role receives, and the payloads the record screen
// sends. Repository tests alone missed these (review of 5 October 2026). Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-records-http-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const svc = await import('../server/repo/services.ts');
const { db } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Session = { cookie: string; csrf: string };
let server: Server;
let base = '';
const as: Record<'admin' | 'editor' | 'viewer', Session> = {} as never;
let sid = 0;

async function login(username: string): Promise<Session> {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'correct-horse-9' }) });
  assert.equal(r.status, 200);
  return { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), csrf: ((await r.json()) as Json).csrf };
}
async function call(who: Session, method: string, url: string, body?: unknown) {
  const r = await fetch(`${base}/api${url}`, {
    method, headers: { 'Content-Type': 'application/json', Cookie: who.cookie, 'X-CSRF-Token': who.csrf }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => null)) as Json };
}

before(async () => {
  for (const role of ['admin', 'editor', 'viewer'] as const) await createUser({ username: role, display_name: `Test ${role}`, password: 'correct-horse-9', role });
  server = createApp().listen(0, '127.0.0.1');
  // a full parallel test run is slow: idle connections stay open for the next request (no reset mid-test)
  server.keepAliveTimeout = 120_000;
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const role of ['admin', 'editor', 'viewer'] as const) as[role] = await login(role);
  sid = svc.createService({ date: '2034-02-05' }).service.id;
});

after(async () => {
  await new Promise((r) => server.close(r));
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const MONEY = {
  currency: 'SGD',
  offerings: [{ fund: 'General', method: 'cash', amount: 5000 }, { fund: 'General', method: 'cash', amount: 2000, currency: 'USD' }],
  cash: { '5000': 1 }, foreign_cash: { USD: { cash: { '2000': 1 } } }, counters: ['Ann', 'Ben'],
};

test('the editor screen: full payloads save, also after verification when only attendance changes', async () => {
  let r = await call(as.editor, 'PUT', `/services/${sid}/record`, { attendance: 60, children: 5, online: null, notes: 'n', visitors: [{ name: 'Sam Example', contact: '9000 0001' }], ...MONEY });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await call(as.editor, 'POST', `/services/${sid}/record/verify`, { verified: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // what the screen sent before the fix: everything, money unchanged
  r = await call(as.editor, 'PUT', `/services/${sid}/record`, { attendance: 61, children: 5, online: null, notes: 'n', visitors: [{ name: 'Sam Example', contact: '9000 0001' }], ...MONEY });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.attendance, 61);
  assert.ok(r.body.verified_at);
});

test('verified money cannot change without reopening, for editors (403) and administrators (409)', async () => {
  const changed = { offerings: [{ fund: 'General', method: 'cash', amount: 9999 }] };
  assert.equal((await call(as.editor, 'PUT', `/services/${sid}/record`, changed)).status, 403);
  assert.equal((await call(as.admin, 'PUT', `/services/${sid}/record`, changed)).status, 409);
  const r = await call(as.admin, 'GET', `/services/${sid}/record`);
  assert.equal(r.body.offerings[0].amount, 5000);
  assert.ok(r.body.verified_at);
});

test('after verification other offerings can still be added (the cash stays locked)', async () => {
  const withTransfer = [...MONEY.offerings, { fund: 'Missions', method: 'transfer', amount: 3000 }];
  const r = await call(as.editor, 'PUT', `/services/${sid}/record`, { attendance: 61, offerings: withTransfer });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.offerings.length, 3);
  assert.ok(r.body.verified_at);
  // turning that transfer into cash is a cash change
  const asCash = [...MONEY.offerings, { fund: 'Missions', method: 'cash', amount: 3000 }];
  assert.equal((await call(as.editor, 'PUT', `/services/${sid}/record`, { offerings: asCash })).status, 403);
});

test('viewers get no money of any currency, no contact details, no offerings report', async () => {
  const list = await call(as.viewer, 'GET', '/records?from=2034-02-01&to=2034-02-28');
  assert.equal(list.status, 200);
  const row = list.body[0];
  assert.equal(row.attendance, 61);
  assert.equal(row.offering_total, null);
  assert.deepEqual(row.other_currencies, []);
  assert.ok(!JSON.stringify(list.body).includes('2000'));
  const rec = await call(as.viewer, 'GET', `/services/${sid}/record`);
  assert.deepEqual(rec.body.offerings, []);
  assert.deepEqual(rec.body.foreign_cash, {});
  assert.equal(rec.body.verified_by, null);
  assert.ok(!JSON.stringify(rec.body).includes('9000 0001'));
  assert.equal((await call(as.viewer, 'GET', '/reports/offerings?from=2034-02-01&to=2034-02-28')).status, 403);
  const vis = await call(as.viewer, 'GET', '/reports/visitors?from=2034-02-01&to=2034-02-28');
  assert.equal(vis.body.visitors[0].name, 'Sam Example');
  assert.ok(!('contact' in vis.body.visitors[0]));
  // editors do see the money
  const ed = await call(as.editor, 'GET', '/records?from=2034-02-01&to=2034-02-28');
  assert.deepEqual(ed.body[0].other_currencies, [{ currency: 'USD', total: 2000 }]);
});

test('a service with a record cannot be deleted; the record only by an administrator after reopening', async () => {
  let r = await call(as.editor, 'DELETE', `/services/${sid}`);
  assert.equal(r.status, 409);
  r = await call(as.admin, 'DELETE', `/services/${sid}`);
  assert.equal(r.status, 409);
  assert.equal((await call(as.admin, 'GET', `/services/${sid}/record`)).body.saved, true, 'record kept');
  assert.equal((await call(as.editor, 'DELETE', `/services/${sid}/record`)).status, 403);
  assert.equal((await call(as.admin, 'DELETE', `/services/${sid}/record`)).status, 409, 'verified: reopen first');
  assert.equal((await call(as.admin, 'POST', `/services/${sid}/record/verify`, { verified: false })).status, 200);
  assert.equal((await call(as.admin, 'DELETE', `/services/${sid}/record`)).status, 200);
  assert.equal((await call(as.editor, 'DELETE', `/services/${sid}`)).status, 200);
});

test('logs export as Excel for administrators, with a title block and the filters applied', async () => {
  const { readXlsx, tableRows } = await import('../server/lib/xlsx-read.ts');
  const get = (who: Session, url: string) => fetch(`${base}/api${url}`, { headers: { Cookie: who.cookie } });
  const r = await get(as.admin, '/change-log.xlsx?entity=service_records');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /spreadsheetml/);
  assert.match(r.headers.get('content-disposition') ?? '', /attachment; filename="canon-change-log-.*\.xlsx"/);
  const all = readXlsx(new Uint8Array(await r.arrayBuffer()));
  assert.match(all[0][0], /Change log$/, 'the title: church — report');
  assert.ok(all.some((row) => /^entity: service_records$/.test(row[0] ?? '') || /entity: service_records/.test(row[0] ?? '')), 'the filters');
  assert.ok(all.some((row) => /^Exported .* by Test admin/.test(row[0] ?? '')), 'when and by whom');
  const [head, ...rows] = tableRows(all);
  assert.deepEqual(head, ['Time', 'Who', 'How', 'Client', 'What', 'Record', 'Action', 'Summary', 'Changes']);
  assert.ok(rows.some((x) => x[4] === 'Service record'), 'filtered to service records');
  assert.ok(!rows.some((x) => x[4] === 'Service'), 'other kinds left out');
  const a = await get(as.admin, '/mcp/audit.xlsx');
  assert.equal(a.status, 200);
  assert.deepEqual(tableRows(readXlsx(new Uint8Array(await a.arrayBuffer())))[0].slice(0, 4), ['Time', 'User', 'Client', 'Tool']);
  assert.equal((await get(as.editor, '/change-log.xlsx')).status, 403);
  assert.equal((await get(as.viewer, '/mcp/audit.xlsx')).status, 403);
});

test('edit conflicts: a save based on an older revision is refused, even within the same second; own saves pass', async () => {
  const svcRepo = await import('../server/repo/services.ts');
  const s2 = svcRepo.createService({ date: '2034-09-03' }).service.id;
  const withVersion = async (who: Session, method: string, url: string, body: unknown, version: string) => {
    const r = await fetch(`${base}/api${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: who.cookie, 'X-CSRF-Token': who.csrf, 'X-Base-Version': version }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => null)) as Json };
  };
  // no waiting: two saves in the same second are still told apart
  const opened = String((await call(as.editor, 'GET', `/services/${s2}`)).body.revision);
  const other = await withVersion(as.admin, 'PATCH', `/services/${s2}`, { sermon_ref: 'Mark 1:1' }, opened);
  assert.equal(other.status, 200);
  assert.equal(other.body.revision, Number(opened) + 1);
  const stale = await withVersion(as.editor, 'PATCH', `/services/${s2}`, { sermon_ref: 'Mark 2:2' }, opened);
  assert.equal(stale.status, 409, 'same base revision, same second: the second save is refused');
  assert.match(stale.body.error, /changed this by Test admin/);
  assert.equal((await call(as.editor, 'GET', `/services/${s2}`)).body.sermon_ref, 'Mark 1:1', 'the first save stands');
  const fresh = await withVersion(as.editor, 'PATCH', `/services/${s2}`, { sermon_ref: 'Mark 2:2' }, String(other.body.revision));
  assert.equal(fresh.status, 200, 'saving on top of the latest revision is fine');
  assert.equal((await call(as.editor, 'PATCH', `/services/${s2}`, { theme: { en: 'x' } })).status, 200, 'no version sent (agents, imports): not checked');
  // a screen opened before 0.11.1 sends the time of the last save: still understood
  const svcNow = (await call(as.editor, 'GET', `/services/${s2}`)).body;
  assert.equal((await withVersion(as.editor, 'PATCH', `/services/${s2}`, { notes: 'old screen' }, svcNow.updated_at)).status, 200);
  // editing the order of service does not change the details' revision (no false conflict for the planner)
  const before = (await call(as.editor, 'GET', `/services/${s2}`)).body.revision;
  assert.equal((await call(as.editor, 'POST', `/services/${s2}/items`, { item: { kind: 'prayer', title: { en: 'Prayer' } } })).status, 200);
  assert.equal((await call(as.editor, 'GET', `/services/${s2}`)).body.revision, before);

  // a service record: same-second saves, and a record someone else created while this screen showed none
  const blank = await withVersion(as.editor, 'PUT', `/services/${s2}/record`, { attendance: 10 }, '0');
  assert.equal(blank.status, 200);
  assert.equal(blank.body.revision, 1);
  assert.equal((await withVersion(as.admin, 'PUT', `/services/${s2}/record`, { attendance: 9 }, '0')).status, 409, 'it was created meanwhile');
  assert.equal((await withVersion(as.admin, 'PUT', `/services/${s2}/record`, { attendance: 11 }, '1')).status, 200);
  assert.equal((await withVersion(as.editor, 'PUT', `/services/${s2}/record`, { attendance: 12 }, '1')).status, 409);
  assert.equal((await call(as.editor, 'GET', `/services/${s2}/record`)).body.attendance, 11, 'their number stands');

  // members
  const reg = await import('../server/repo/registers.ts');
  const pid = reg.people.insert({ first_name: 'Ottoline', last_name: 'Quarry' }).id;
  assert.equal((await withVersion(as.admin, 'PATCH', `/people/${pid}`, { phone: '9000 0201' }, '1')).status, 200);
  assert.equal((await withVersion(as.editor, 'PATCH', `/people/${pid}`, { phone: '9000 0202' }, '1')).status, 409);
});

test('30. the change log and AI activity exports say they hold personal data (every export now has to decide)', async () => {
  const { readXlsx } = await import('../server/lib/xlsx-read.ts');
  for (const url of ['/change-log.xlsx', '/mcp/audit.xlsx']) {
    const r = await fetch(`${base}/api${url}`, { headers: { Cookie: as.admin.cookie } });
    const rows = readXlsx(new Uint8Array(await r.arrayBuffer()));
    assert.ok(rows.some((row) => /Contains personal data/.test(row[0] ?? '')), `${url} carries the note`);
  }
});

test('18. one rule for the money: the record says what this account may do with it, and the list, the record and AI agents agree', async () => {
  const ar = await import('../server/repo/access-roles.ts');
  const { run, get } = await import('../server/db.ts');
  // a church's own role: records it may edit, offerings only read (an assistant to the treasurer)
  const role = ar.createRole({ name: { en: 'Record keeper (fictional)' }, access: { services: 'read', records: 'edit', contributions: 'read' } } as never);
  await createUser({ username: 'keeper18', display_name: 'Record Keeper', password: 'correct-horse-9', role: role.key });
  const keeper = await login('keeper18');
  const rec = await call(keeper, 'GET', `/services/${sid}/record`);
  assert.equal(rec.status, 200);
  assert.equal(rec.body.money_access, 'read', 'the page shows the money read-only, instead of letting it be typed and refused');
  assert.equal((await call(as.editor, 'GET', `/services/${sid}/record`)).body.money_access, 'edit');
  assert.equal((await call(keeper, 'PUT', `/services/${sid}/record`, { attendance: 70, offerings: [{ fund: 'General', method: 'cash', amount: 1 }] })).status, 403);

  // the leader of a meeting, on a read-only account: their meeting's money, in the list as in the record, and for AI
  const pid = Number(run("INSERT INTO people (first_name, last_name) VALUES ('Leah', 'Leader')").lastInsertRowid);
  await createUser({ username: 'leader18', display_name: 'Leah Leader', password: 'correct-horse-9', role: 'viewer' });
  run("UPDATE users SET person_id = ? WHERE username = 'leader18'", pid);
  const meeting = Number(run("INSERT INTO services (date, kind, leader_id, offering) VALUES ('2034-02-07', 'meeting', ?, 1)", pid).lastInsertRowid);
  run('INSERT INTO service_records (service_id, attendance, offerings) VALUES (?, 12, ?)', meeting, JSON.stringify([{ fund: 'General', method: 'cash', amount: 3300 }]));
  const leader = await login('leader18');
  assert.equal((await call(leader, 'GET', `/services/${meeting}/record`)).body.money_access, 'edit');
  const row = ((await call(leader, 'GET', '/records?from=2034-02-01&to=2034-02-28&kind=meeting')).body as Json[]).find((r) => r.service_id === meeting)!;
  assert.equal(row.offering_total, 3300, 'the list shows the leader their own meeting’s offering, as the record does');
  const { RECORD_TOOLS } = await import('../server/mcp-tools/records.ts');
  const { updateSettings, getSettings } = await import('../server/repo/settings.ts');
  updateSettings({ mcp: { ...getSettings().mcp, enabled: true, modules: { ...getSettings().mcp.modules, records: 'read', contributions: 'read' } } });
  const user = get<Json>("SELECT * FROM users WHERE username = 'leader18'")!;
  const ctx = { auth: { user: { ...user, role: 'viewer' }, scopes: new Set(['canon:read']) }, pii: false, levels: { records: 'read', contributions: 'off' } } as never;
  const out = (await RECORD_TOOLS.find((t) => t.name === 'canon_get_service_record')!.handler({ service_id: meeting }, ctx)) as Json;
  assert.deepEqual(out.offerings, [{ fund: 'General', method: 'cash', amount: 3300 }], 'an AI assistant sees what its person sees');
});
