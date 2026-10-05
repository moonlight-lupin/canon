// Meetings (0.12): a lighter kind of service linked to a group. New meetings copy the group's previous one; the
// offering is on or off per meeting; services and meetings stay apart in lists, the rota and reports; a meeting
// without an offering has no money in its record or the offerings report. Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-meetings-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const svc = await import('../server/repo/services.ts');
const reg = await import('../server/repo/registers.ts');
const { db } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Session = { cookie: string; csrf: string };
let server: Server;
let base = '';
const as: Record<'admin' | 'editor' | 'viewer', Session> = {} as never;
const ids: Record<string, number> = {};

async function login(username: string): Promise<Session> {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'correct-horse-7' }) });
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
  for (const role of ['admin', 'editor', 'viewer'] as const) createUser({ username: role, display_name: `Test ${role}`, password: 'correct-horse-7', role });
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const role of ['admin', 'editor', 'viewer'] as const) as[role] = await login(role);
  ids.service = svc.createService({ date: '2035-03-04' }).service.id;
  const g = await call(as.editor, 'POST', '/groups', { name: { en: 'Test Riverside Fellowship' }, kind: 'fellowship', pattern: { time: '19:45', place: 'Fellowship hall' } });
  assert.equal(g.status, 200, JSON.stringify(g.body));
  ids.group = g.body.id;
  ids.leader = reg.people.insert({ first_name: 'Linnea', last_name: 'Moorcroft' }).id;
  ids.member = reg.people.insert({ first_name: 'Tobin', last_name: 'Ashgrove' }).id;
});

after(async () => {
  await new Promise((r) => server.close(r));
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('a group marks who leads it: leader roles by default, then the mark itself', async () => {
  const lead = await call(as.editor, 'POST', `/groups/${ids.group}/members`, { person_id: ids.leader, role: 'Leader' });
  const mem = await call(as.editor, 'POST', `/groups/${ids.group}/members`, { person_id: ids.member, role: 'Member' });
  assert.equal(lead.body.leads, true);
  assert.equal(mem.body.leads, false);
  assert.equal((await call(as.editor, 'PATCH', `/group-members/${mem.body.id}`, { leads: true })).body.leads, true);
  assert.equal((await call(as.editor, 'PATCH', `/group-members/${mem.body.id}`, { leads: false })).body.leads, false);
  // a Sunday school class, with its pupils' ages
  const ss = await call(as.editor, 'POST', '/groups', { name: { en: 'Test Primary Class' }, kind: 'sunday_school', age_min: 6, age_max: 8 });
  assert.equal(ss.status, 200);
  assert.deepEqual([ss.body.kind, ss.body.age_min, ss.body.age_max], ['sunday_school', 6, 8]);
  const teacher = await call(as.editor, 'POST', `/groups/${ss.body.id}/members`, { person_id: ids.member, role: 'Teacher' });
  assert.equal(teacher.body.leads, true, 'a teacher leads a class');
});

test('a new meeting copies the group\'s previous one; the first takes the group\'s pattern and no offering', async () => {
  const first = await call(as.editor, 'POST', '/meetings', { group_id: ids.group, date: '2035-03-07' });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  ids.m1 = first.body.id;
  assert.equal(first.body.kind, 'meeting');
  assert.equal(first.body.title.en, 'Test Riverside Fellowship');
  assert.equal(first.body.start_time, '19:45');
  assert.equal(first.body.place, 'Fellowship hall');
  assert.equal(first.body.offering, false);
  const upd = await call(as.editor, 'PATCH', `/services/${ids.m1}`, { place: 'Linnea\'s home', leader_id: ids.leader, offering: true, topic: { en: 'Prayer' } });
  assert.equal(upd.status, 200);
  const second = await call(as.editor, 'POST', '/meetings', { group_id: ids.group, date: '2035-03-14' });
  ids.m2 = second.body.id;
  assert.deepEqual([second.body.place, second.body.leader_id, second.body.offering, second.body.start_time], ['Linnea\'s home', ids.leader, true, '19:45']);
  assert.deepEqual(second.body.topic, {}, 'the topic is each meeting\'s own');
  // duplicating carries the offering choice too
  const third = await call(as.editor, 'POST', `/services/${ids.m2}/duplicate`, { date: '2035-03-21' });
  assert.equal(third.body.offering, true);
  assert.equal(third.body.kind, 'meeting');
  ids.m3 = third.body.id;
  assert.equal((await call(as.editor, 'PATCH', `/services/${ids.m3}`, { offering: false })).status, 200);
  assert.equal((await call(as.viewer, 'POST', '/meetings', { group_id: ids.group, date: '2035-03-28' })).status, 403);
});

test('a one-off meeting belongs to no group: it needs a title, copies nothing, and has its own leader', async () => {
  assert.equal((await call(as.editor, 'POST', '/meetings', { date: '2035-04-02' })).status, 400, 'no group and no title');
  const one = await call(as.editor, 'POST', '/meetings', { date: '2035-04-02', title: { en: 'Test Prayer Night' }, leader_id: ids.member });
  assert.equal(one.status, 200, JSON.stringify(one.body));
  assert.deepEqual([one.body.group_id, one.body.leader_id, one.body.offering, one.body.place], [null, ids.member, false, null]);
  ids.oneOff = one.body.id;
  // a leader outside the register: a name only
  assert.equal((await call(as.editor, 'PATCH', `/services/${ids.oneOff}`, { leader_id: null, chair: 'Visiting Speaker' })).body.chair, 'Visiting Speaker');
  const list = (await call(as.editor, 'GET', '/meetings?from=2035-01-01&group=none')).body as Json[];
  assert.deepEqual(list.map((m) => m.id), [ids.oneOff]);
  const all = (await call(as.editor, 'GET', '/meetings?from=2035-01-01')).body as Json[];
  assert.equal(all.find((m) => m.id === ids.m2)!.leader_name, 'Linnea Moorcroft');
});

test('services and meetings stay apart: lists, the rota and the next service', async () => {
  const services = (await call(as.editor, 'GET', '/services?from=2035-01-01')).body as Json[];
  assert.ok(services.some((s) => s.id === ids.service));
  assert.ok(!services.some((s) => s.kind === 'meeting'), 'no meetings among services');
  const meetings = (await call(as.editor, 'GET', `/meetings?from=2035-01-01&group=${ids.group}`)).body as Json[];
  assert.deepEqual(meetings.map((m) => m.id), [ids.m1, ids.m2, ids.m3]);
  assert.equal(meetings[0].group_name.en, 'Test Riverside Fellowship');
  const rota = (await call(as.editor, 'GET', '/rota?from=2035-03-01&to=2035-03-31')).body;
  assert.ok(!rota.services.some((s: Json) => [ids.m1, ids.m2, ids.m3].includes(s.id)), 'meetings are not on the rota');
});

test('a meeting\'s record: the offering when one is taken, none when not; reports keep them apart', async () => {
  // with an offering
  const withMoney = await call(as.editor, 'PUT', `/services/${ids.m2}/record`, { attendance: 14, offerings: [{ fund: 'General', method: 'transfer', amount: 3000 }] });
  assert.equal(withMoney.status, 200, JSON.stringify(withMoney.body));
  // without: headcount and visitors only; offering lines are refused
  assert.equal((await call(as.editor, 'PUT', `/services/${ids.m3}/record`, { attendance: 11, visitors: [{ name: 'Test Newcomer' }] })).status, 200);
  const refused = await call(as.editor, 'PUT', `/services/${ids.m3}/record`, { offerings: [{ fund: 'General', method: 'cash', amount: 500 }] });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /No offering is taken/);
  // a Sunday service with a bigger number
  await call(as.editor, 'PUT', `/services/${ids.service}/record`, { attendance: 120, offerings: [{ fund: 'General', method: 'transfer', amount: 90000 }] });

  const list = (k: string) => call(as.editor, 'GET', `/records?from=2035-01-01&to=2035-12-31&kind=${k}`);
  const meetingRows = (await list('meeting')).body as Json[];
  assert.deepEqual(meetingRows.map((r) => r.service_id).sort(), [ids.m1, ids.m2, ids.m3, ids.oneOff].sort(), 'one-off meetings too');
  assert.equal(meetingRows.find((r) => r.service_id === ids.m3)!.offering_total, null, 'no offering: no money shown');
  assert.equal(meetingRows.find((r) => r.service_id === ids.m2)!.offering_total, 3000);
  assert.ok(!((await list('service')).body as Json[]).some((r) => r.kind === 'meeting'));

  const att = (q: string) => call(as.editor, 'GET', `/reports/attendance?from=2035-01-01&to=2035-12-31${q}`);
  assert.equal((await att('')).body.summary.average, 120, 'services only by default: meetings don\'t lower the Sunday average');
  const m = (await att(`&kind=meeting&group=${ids.group}`)).body;
  assert.equal(m.summary.average, (14 + 11) / 2);
  assert.equal(m.period.kind, 'meeting');
  const off = (q: string) => call(as.editor, 'GET', `/reports/offerings?from=2035-01-01&to=2035-12-31${q}`);
  assert.equal((await off('&kind=meeting')).body.services.length, 1, 'only the meeting that takes an offering');
  assert.equal((await off('')).body.services.length, 1, 'services only by default');
});

test('a read-only account linked to a leader records the meetings they lead — and nothing else', async () => {
  const { createUser: mk } = await import('../server/auth.ts');
  const leaderUser = mk({ username: 'lead', display_name: 'Test lead', password: 'correct-horse-7', role: 'viewer' });
  mk({ username: 'plain', display_name: 'Test plain', password: 'correct-horse-7', role: 'viewer' });
  // only administrators link accounts to members
  assert.equal((await call(as.editor, 'PATCH', `/users/${leaderUser.id}`, { person_id: ids.leader })).status, 403);
  assert.equal((await call(as.admin, 'PATCH', `/users/${leaderUser.id}`, { person_id: ids.leader })).status, 200);
  const lead = await login('lead');
  const plain = await login('plain');
  const me = (await call(lead, 'GET', '/me')).body;
  assert.equal(me.user.person_id, ids.leader);
  assert.deepEqual(me.user.leads, [ids.group]);

  // their group's meeting: the record in full, saved, verified; the details; the next meeting
  const visitor = { name: 'Test Guest', contact: '9000 0300' };
  const saved = await call(lead, 'PUT', `/services/${ids.m2}/record`, { attendance: 15, visitors: [visitor] });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const full = (await call(lead, 'GET', `/services/${ids.m2}/record`)).body;
  assert.equal(full.visitors[0].contact, '9000 0300', 'they follow visitors up');
  assert.equal(full.offerings[0].amount, 3000, 'and count the offering');
  assert.equal((await call(plain, 'GET', `/services/${ids.m2}/record`)).body.visitors[0].contact, undefined, 'other read-only accounts still don\'t');
  assert.equal((await call(lead, 'PATCH', `/services/${ids.m2}`, { place: 'Riverside room' })).status, 200);
  const next = await call(lead, 'POST', `/services/${ids.m2}/duplicate`, { date: '2035-05-02' });
  assert.equal(next.status, 200);
  assert.equal((await call(lead, 'POST', '/meetings', { group_id: ids.group, date: '2035-05-09' })).status, 200);

  // not: who leads it or which group, deleting, reopening a count, a one-off they don't lead, services, other groups
  assert.equal((await call(lead, 'PATCH', `/services/${ids.m2}`, { leader_id: ids.member })).status, 403);
  assert.equal((await call(lead, 'PATCH', `/services/${ids.m2}`, { group_id: null })).status, 403);
  assert.equal((await call(lead, 'DELETE', `/services/${next.body.id}`)).status, 403);
  assert.equal((await call(lead, 'POST', `/services/${ids.m2}/record/verify`, { verified: false })).status, 403);
  assert.equal((await call(lead, 'PUT', `/services/${ids.oneOff}/record`, { attendance: 3 })).status, 403);
  assert.equal((await call(lead, 'PUT', `/services/${ids.service}/record`, { attendance: 3 })).status, 403, 'never a service');
  assert.equal((await call(lead, 'PATCH', `/services/${ids.service}`, { notes: 'x' })).status, 403);
  assert.equal((await call(lead, 'POST', '/meetings', { date: '2035-05-09', title: { en: 'Test own one-off' } })).status, 403, 'no one-offs');
  assert.equal((await call(lead, 'PATCH', `/people/${ids.member}`, { phone: '1' })).status, 403);
  const other = await call(as.editor, 'POST', '/groups', { name: { en: 'Test Other Cell' }, kind: 'cell_group' });
  const otherMeeting = (await call(as.editor, 'POST', '/meetings', { group_id: other.body.id, date: '2035-05-03' })).body;
  assert.equal((await call(lead, 'PUT', `/services/${otherMeeting.id}/record`, { attendance: 3 })).status, 403);
  assert.equal((await call(lead, 'POST', '/meetings', { group_id: other.body.id, date: '2035-05-10' })).status, 403);

  // a meeting they lead themselves, with no group
  const own = (await call(as.editor, 'POST', '/meetings', { date: '2035-05-04', title: { en: 'Test Prayer Walk' }, leader_id: ids.leader })).body;
  assert.equal((await call(lead, 'PUT', `/services/${own.id}/record`, { attendance: 6 })).status, 200);

  // an unlinked read-only account records nothing; a leader whose term ended neither
  assert.equal((await call(plain, 'PUT', `/services/${ids.m2}/record`, { attendance: 1 })).status, 403);
  const gm = (await call(as.editor, 'GET', `/groups/${ids.group}/members`)).body as Json[];
  const mine = gm.find((m) => m.person_id === ids.leader)!;
  assert.equal((await call(as.editor, 'PATCH', `/group-members/${mine.id}`, { start_date: '2020-01-01', end_date: '2025-12-31' })).status, 200);
  // m2 names them as its own leader too, so it stays theirs; a group meeting led by nobody in particular doesn't
  assert.equal((await call(lead, 'PUT', `/services/${ids.m2}/record`, { attendance: 16 })).status, 200, 'their own meeting');
  const groupOnly = (await call(as.editor, 'POST', '/meetings', { group_id: ids.group, date: '2035-05-16', leader_id: null })).body;
  assert.equal(groupOnly.leader_id, null);
  assert.equal((await call(lead, 'PUT', `/services/${groupOnly.id}/record`, { attendance: 16 })).status, 403, 'term ended');
  assert.equal((await call(lead, 'PUT', `/services/${own.id}/record`, { attendance: 7 })).status, 200, 'still leads their own meeting');
});

test('meeting patterns give the right dates: weekly, fortnightly (keeping the rhythm), nth and last weekday of the month', async () => {
  const { meetingDates } = await import('../shared/meeting-pattern.ts');
  assert.deepEqual(meetingDates({ every: 'week', weekday: 5 }, '2026-10-05', '2026-10-31'), ['2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30']);
  assert.deepEqual(meetingDates({ every: '2weeks', weekday: 5 }, '2026-10-12', '2026-11-30', '2026-10-09'), ['2026-10-23', '2026-11-06', '2026-11-20']);
  assert.deepEqual(meetingDates({ every: 'month', weekday: 0, nth: 1 }, '2026-10-05', '2027-01-31'), ['2026-11-01', '2026-12-06', '2027-01-03']);
  assert.deepEqual(meetingDates({ every: 'month', weekday: 5, nth: 5 }, '2026-10-01', '2026-12-31'), ['2026-10-30', '2026-11-27', '2026-12-25']);
  assert.deepEqual(meetingDates({ every: 'month', weekday: 6 }, '2026-10-01', '2026-12-31'), [], 'monthly needs which week');
  assert.deepEqual(meetingDates({}, '2026-10-01', '2026-12-31'), []);
});

test('a group with a meeting pattern gets its meetings created ahead, once, with the pattern\'s time and place', async () => {
  const g = await call(as.editor, 'POST', '/groups', { name: { en: 'Test Thursday Cell' }, kind: 'cell_group', pattern: { every: 'week', weekday: 4, time: '20:15', place: 'Block 12 #03-04', ahead_weeks: 3 } });
  assert.equal(g.status, 200, JSON.stringify(g.body));
  const made = svc.createAllMeetingsAhead('2036-01-05');
  const list = (await call(as.editor, 'GET', `/meetings?from=2036-01-01&group=${g.body.id}`)).body as Json[];
  assert.deepEqual(list.map((m) => m.date), ['2036-01-10', '2036-01-17', '2036-01-24']);
  assert.ok(made >= 3);
  assert.deepEqual([list[0].start_time, list[0].place, list[0].offering], ['20:15', 'Block 12 #03-04', false]);
  assert.equal(svc.createMeetingsAhead(g.body.id, undefined, '2036-01-05').length, 0, 'nothing twice');
  // the button: editors only; groups without a pattern make nothing
  assert.equal((await call(as.viewer, 'POST', `/groups/${g.body.id}/meetings-ahead`, {})).status, 403);
  assert.equal((await call(as.editor, 'POST', `/groups/${ids.group}/meetings-ahead`, {})).body.created, 0);
});

test('the church calendar: services, meetings and events together; events over several days; editors add events', async () => {
  assert.equal((await call(as.viewer, 'POST', '/events', { title: { en: 'Test Camp' }, date: '2035-03-08' })).status, 403);
  assert.equal((await call(as.editor, 'POST', '/events', { title: { en: 'Test Camp' }, date: '2035-03-08', end_date: '2035-03-06' })).status, 400, 'ends before it starts');
  assert.equal((await call(as.editor, 'POST', '/events', { title: {}, date: '2035-03-08' })).status, 400, 'a title is needed');
  const camp = await call(as.editor, 'POST', '/events', { title: { en: 'Test Camp' }, date: '2035-03-02', end_date: '2035-03-05', place: 'Test Hills' });
  assert.equal(camp.status, 200, JSON.stringify(camp.body));
  const items = (await call(as.viewer, 'GET', '/calendar?from=2035-03-04&to=2035-03-10')).body as Json[];
  const kinds = items.map((i) => `${i.type}:${i.id}`);
  assert.ok(kinds.includes(`service:${ids.service}`), 'the service');
  assert.ok(kinds.includes(`meeting:${ids.m1}`), 'a meeting');
  assert.ok(kinds.includes(`event:${camp.body.id}`), 'the camp, which started before the period');
  assert.deepEqual(items.map((i) => i.date), [...items.map((i) => i.date)].sort(), 'in date order');
  const groupOnly = (await call(as.viewer, 'GET', `/calendar?from=2035-03-01&to=2035-03-31&group=${ids.group}`)).body as Json[];
  assert.ok(groupOnly.every((i) => i.group_id === ids.group) && groupOnly.length >= 3);
  assert.equal((await call(as.editor, 'PATCH', `/events/${camp.body.id}`, { end_date: '2035-03-01' })).status, 400);
  assert.equal((await call(as.editor, 'DELETE', `/events/${camp.body.id}`)).status, 200);
  assert.equal((await call(as.viewer, 'GET', '/calendar?from=bad&to=2035-03-01')).status, 400);
});

test('agents: canon_get_calendar lists services, meetings and events; reports take kind and group', async () => {
  const { TOOLS } = await import('../server/mcp.ts');
  const tool = TOOLS.find((x) => x.name === 'canon_get_calendar')!;
  assert.equal(tool.module, 'services');
  assert.equal(tool.access, 'read');
  const out = await tool.handler({ from: '2035-03-01', to: '2035-03-31' }, {} as never) as { items: Json[] };
  assert.ok(out.items.some((i) => i.type === 'service') && out.items.some((i) => i.type === 'meeting'));
  const rep = TOOLS.find((x) => x.name === 'canon_attendance_report')!;
  const r = await rep.handler({ from: '2035-01-01', to: '2035-12-31', kind: 'meeting', group_id: ids.group }, {} as never) as Json;
  assert.equal(r.period.kind, 'meeting');
  assert.equal(r.period.group_id, ids.group);
});
