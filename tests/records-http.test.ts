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
  for (const role of ['admin', 'editor', 'viewer'] as const) createUser({ username: role, display_name: `Test ${role}`, password: 'correct-horse-9', role });
  server = createApp().listen(0, '127.0.0.1');
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
