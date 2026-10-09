// The church's spaces (0.15.4): administrators keep the list; services, meetings and calendar events are booked in
// one; overlapping bookings of a space are clashes (warned, never refused); a space in use is archived, not deleted;
// the report counts use, clashes and what is coming. Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-spaces-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const svc = await import('../server/repo/services.ts');
const sp = await import('../server/repo/spaces.ts');
const cal = await import('../server/repo/calendar.ts');
const { db } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Session = { cookie: string; csrf: string };
let server: Server;
let base = '';
const as: Record<'admin' | 'editor' | 'viewer', Session> = {} as never;

async function login(username: string): Promise<Session> {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'correct-horse-7' }) });
  assert.equal(r.status, 200);
  return { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), csrf: ((await r.json()) as Json).csrf };
}
async function call(who: Session, method: string, url: string, body?: unknown) {
  const r = await fetch(`${base}/api${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: who.cookie, 'X-CSRF-Token': who.csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => null)) as Json };
}

before(async () => {
  for (const role of ['admin', 'editor', 'viewer'] as const) await createUser({ username: role, display_name: `Test ${role}`, password: 'correct-horse-7', role });
  server = createApp().listen(0, '127.0.0.1');
  // a full parallel test run is slow: idle connections stay open for the next request (no reset mid-test)
  server.keepAliveTimeout = 120_000;
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const k of ['admin', 'editor', 'viewer'] as const) as[k] = await login(k);
});

after(async () => {
  await new Promise((r) => server.close(r));
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('spaces: administrators keep the list; everyone signed in reads it', async () => {
  assert.equal((await call(as.editor, 'POST', '/spaces', { name: { en: 'Hall' } })).status, 403);
  assert.equal((await call(as.admin, 'POST', '/spaces', { name: {} })).status, 400);
  const hall = await call(as.admin, 'POST', '/spaces', { name: { en: 'Fellowship hall', zh: '团契厅' }, capacity: 120 });
  assert.equal(hall.status, 200, JSON.stringify(hall.body));
  const room = await call(as.admin, 'POST', '/spaces', { name: { en: 'Room 2' } });
  const list = await call(as.viewer, 'GET', '/spaces');
  assert.deepEqual(list.body.spaces.map((s: Json) => s.name.en), ['Fellowship hall', 'Room 2']);
  assert.equal((await call(as.admin, 'DELETE', `/spaces/${room.body.id}`)).status, 200, 'unused: deleted');
});

test('bookings: overlapping use of a space is a clash (warned, not refused); other spaces and other times are not', async () => {
  const hall = sp.createSpace({ name: { en: 'Main hall' } });
  const other = sp.createSpace({ name: { en: 'Library room' } });
  // a service 10:00 with 90 minutes of items, a meeting at 11:00 (an hour), one at 12:00 (after), an event all day
  const s1 = svc.createService({ date: '2031-05-04', start_time: '10:00', space_id: hall.id } as never).service;
  svc.addItem(s1.id, { kind: 'other', title: { en: 'Part one' }, duration_min: 60 });
  svc.addItem(s1.id, { kind: 'other', title: { en: 'Part two' }, duration_min: 30 });
  const m1 = svc.createMeeting({ date: '2031-05-04', start_time: '11:00', title: { en: 'Choir practice' }, space_id: hall.id } as never);
  const m2 = svc.createMeeting({ date: '2031-05-04', start_time: '12:00', title: { en: 'Lunch' }, space_id: hall.id } as never);
  const m3 = svc.createMeeting({ date: '2031-05-04', start_time: '10:30', title: { en: 'Reading group' }, space_id: other.id } as never);
  const ev = cal.events.insert({ title: { en: 'Working bee' }, date: '2031-05-03', end_date: '2031-05-05', space_id: hall.id } as never);

  const forService = sp.clashesFor('service', s1.id);
  assert.deepEqual(forService.map((b) => `${b.type}:${b.id}`).sort(), [`event:${ev.id}`, `meeting:${m1.id}`].sort(), 'the meeting at 11:00 and the all-day event');
  assert.ok(sp.clashesFor('meeting', m2.id).every((b) => b.type === 'event'), 'after the service ends: only the event');
  assert.deepEqual(sp.clashesFor('meeting', m3.id), [], 'another space');

  // the editors ask over HTTP; saving still works
  const r = await call(as.editor, 'GET', `/spaces/clashes?type=service&id=${s1.id}`);
  assert.equal(r.body.length, 2);
  assert.equal((await call(as.editor, 'PATCH', `/services/${s1.id}`, { space_id: hall.id })).status, 200);

  // the report: use per space, every clash, and the calendar shows the space
  const rep = sp.spacesReport('2031-05-01', '2031-05-31');
  const h = rep.spaces.find((s) => s.id === hall.id)!;
  assert.deepEqual([h.services, h.meetings, h.events], [1, 2, 1]);
  assert.equal(rep.clashes.length, 4, 'service–meeting, and the event with each of the three');
  const items = cal.calendarItems({ from: '2031-05-04', to: '2031-05-04' });
  assert.equal(items.find((i) => i.type === 'meeting' && i.id === m1.id)?.space?.en, 'Main hall');

  // in use: archived, not deleted
  assert.equal((await call(as.admin, 'DELETE', `/spaces/${hall.id}`)).status, 409);
  assert.equal((await call(as.admin, 'PATCH', `/spaces/${hall.id}`, { archived: true })).body.archived, true);
  assert.equal(svc.services.get(s1.id).space_id, hall.id, 'bookings keep an archived space');
});
