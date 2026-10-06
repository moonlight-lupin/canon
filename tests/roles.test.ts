// Roles and permissions (0.13): every route belongs to a part of Canon; each ready-made role gets what it says; a
// church can add and change roles; members' details, sensitive fields and money follow the role; AI connections
// follow the same role. Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-roles-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const { api } = await import('../server/api.ts');
const svc = await import('../server/repo/services.ts');
const reg = await import('../server/repo/registers.ts');
const S = await import('../server/repo/settings.ts');
const P = await import('../shared/permissions.ts');
const { effectiveAccess, piiFor } = await import('../server/mcp.ts');
const { db } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Session = { cookie: string; csrf: string };
let server: Server;
let base = '';
const as: Record<string, Session> = {};
const ids: Record<string, number> = {};
const ROLES = ['admin', 'editor', 'viewer', 'planner', 'treasurer', 'secretary', 'pastor'];

async function login(username: string): Promise<Session> {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'correct-horse-5' }) });
  assert.equal(r.status, 200, username);
  return { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), csrf: ((await r.json()) as Json).csrf };
}
async function call(who: Session, method: string, url: string, body?: unknown) {
  const r = await fetch(`${base}/api${url}`, {
    method, headers: { 'Content-Type': 'application/json', Cookie: who.cookie, 'X-CSRF-Token': who.csrf }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => null)) as Json };
}

before(async () => {
  for (const role of ROLES) createUser({ username: role, display_name: `Test ${role}`, password: 'correct-horse-5', role });
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const role of ROLES) as[role] = await login(role);
  ids.service = svc.createService({ date: '2036-02-03' }).service.id;
  ids.person = reg.people.insert({ first_name: 'Philippa', last_name: 'Grange', phone: '9000 0400', notes: 'pastoral note' }).id;
  S.updateSettings({ member_fields: [{ key: 'health', label: { en: 'Health' }, type: 'text', sensitive: true }] });
  reg.people.update(ids.person, { custom: { health: 'test sensitive value' } });
  const g = await call(as.admin, 'POST', '/groups', { name: { en: 'Test Roles Cell' }, kind: 'cell_group' });
  ids.meeting = (await call(as.admin, 'POST', '/meetings', { group_id: g.body.id, date: '2036-02-06' })).body.id;
});

after(async () => {
  await new Promise((r) => server.close(r));
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('every API route belongs to a part of Canon (or is knowingly for administrators only)', () => {
  const paths = new Set<string>();
  const walk = (stack: Json[]) => {
    for (const l of stack) {
      if (l.route) paths.add(String(l.route.path).replace(/:[a-z_]+/g, '12'));
      else if (l.handle?.stack) walk(l.handle.stack);
    }
  };
  walk(api.stack as unknown as Json[]);
  // before sign-in, or administrators only by the default (fail closed)
  const PUBLIC = /^\/(login|logout|setup|share|bulletin|upload|dl|assets)(\/|$)/;
  const unruled = [...paths].filter((p) => !PUBLIC.test(p) && !P.hasRule(p));
  assert.deepEqual(unruled, [], `routes without a rule (administrators only by default): ${unruled.join(', ')}`);
});

test('the ready-made roles: who may change what', async () => {
  const patchSvc = (r: string) => call(as[r], 'PATCH', `/services/${ids.service}`, { notes: `by ${r}` });
  const patchPerson = (r: string) => call(as[r], 'PATCH', `/people/${ids.person}`, { preferred_name: `P ${r}` });
  const patchMeeting = (r: string) => call(as[r], 'PATCH', `/services/${ids.meeting}`, { place: `by ${r}` });
  const expect: Record<string, [number, number, number]> = {
    // [service, person, meeting]
    admin: [200, 200, 200], editor: [200, 200, 200], pastor: [200, 200, 200], planner: [200, 403, 403],
    treasurer: [403, 403, 403], secretary: [403, 200, 200], viewer: [403, 403, 403],
  };
  for (const [r, [s, p, m]] of Object.entries(expect)) {
    assert.equal((await patchSvc(r)).status, s, `${r} service`);
    assert.equal((await patchPerson(r)).status, p, `${r} person`);
    assert.equal((await patchMeeting(r)).status, m, `${r} meeting (a meeting is under Meetings, not Services)`);
  }
  // everyone signed in reads their own profile and the settings
  for (const r of ROLES) assert.equal((await call(as[r], 'GET', '/me')).body.user.role_def.key, r);
  // settings and accounts: administrators only
  assert.equal((await call(as.editor, 'GET', '/users')).status, 403);
  assert.equal((await call(as.pastor, 'GET', '/access-roles')).status, 403);
});

test('members\' details and sensitive fields follow the role', async () => {
  const seen = async (r: string) => (await call(as[r], 'GET', `/people/${ids.person}`)).body;
  const pastor = await seen('pastor');
  assert.equal(pastor.phone, '9000 0400');
  assert.equal(pastor.custom.health, 'test sensitive value');
  const secretary = await seen('secretary');
  assert.equal(secretary.phone, '9000 0400', 'the secretary sees contact details');
  assert.equal(secretary.notes, 'pastoral note');
  assert.equal(secretary.custom.health, undefined, '… but not fields marked sensitive');
  const planner = await seen('planner');
  assert.equal(planner.phone, undefined, 'the planner sees names');
  assert.equal(planner.notes, undefined);
  const list = (await call(as.treasurer, 'GET', '/people?q=Grange')).body;
  assert.equal((list.rows ?? list)[0].phone, undefined);
});

test('money follows the Offerings permission; reopening a count follows its own power', async () => {
  const MONEY = { offerings: [{ fund: 'General', method: 'cash', amount: 5000 }], cash: { '5000': 1 }, counters: ['Ann', 'Ben'] };
  assert.equal((await call(as.secretary, 'PUT', `/services/${ids.service}/record`, { attendance: 80, ...MONEY })).status, 403, 'records yes, money no');
  assert.equal((await call(as.secretary, 'PUT', `/services/${ids.service}/record`, { attendance: 80 })).status, 200);
  assert.equal((await call(as.treasurer, 'PUT', `/services/${ids.service}/record`, MONEY)).status, 200);
  assert.equal((await call(as.secretary, 'GET', `/services/${ids.service}/record`)).body.offerings.length, 0, 'no money shown without Offerings');
  assert.equal((await call(as.planner, 'GET', '/reports/offerings')).status, 403);
  assert.equal((await call(as.treasurer, 'POST', `/services/${ids.service}/record/verify`, { verified: true })).status, 200);
  assert.equal((await call(as.editor, 'POST', `/services/${ids.service}/record/verify`, { verified: false })).status, 403, 'editors don\'t reopen');
  assert.equal((await call(as.treasurer, 'POST', `/services/${ids.service}/record/verify`, { verified: false })).status, 200, 'the treasurer reopens');
});

test('a church adds, changes and removes its own roles (administrators)', async () => {
  const made = await call(as.admin, 'POST', '/access-roles', { name: { en: 'Worship leader' }, access: { services: 'edit', library: 'edit' }, member_details: false });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const key = made.body.key;
  assert.equal(key, 'worship-leader');
  assert.equal(made.body.access.members, 'none', 'anything not given: no access');
  createUser({ username: 'wl', display_name: 'Test wl', password: 'correct-horse-5', role: key });
  const wl = await login('wl');
  assert.equal((await call(wl, 'PATCH', `/services/${ids.service}`, { notes: 'wl' })).status, 200);
  assert.equal((await call(wl, 'GET', '/people')).status, 403, 'no access to members');
  // a change applies straight away
  assert.equal((await call(as.admin, 'PATCH', `/access-roles/${key}`, { access: { members: 'read' } })).status, 200);
  assert.equal((await call(wl, 'GET', '/people')).status, 200);
  assert.equal((await call(as.admin, 'POST', '/access-roles', { name: { en: 'Bad' }, access: { contributions: 'read' } })).status, 400, 'offerings need records');
  assert.equal((await call(as.admin, 'PATCH', '/access-roles/admin', { access: { members: 'none' } })).status, 400, 'the Administrator keeps everything');
  assert.equal((await call(as.admin, 'DELETE', '/access-roles/viewer')).status, 400, 'ready-made roles stay');
  assert.equal((await call(as.admin, 'DELETE', `/access-roles/${key}`)).status, 409, 'in use');
  assert.equal((await call(as.admin, 'POST', '/users', { username: 'x1', display_name: 'X', password: 'correct-horse-5', role: 'no-such-role' })).status, 400);
});

test('AI connections follow the same role', () => {
  const cfg = { ...S.getSettings().mcp, enabled: true, expose_member_pii: true, modules: { ...S.getSettings().mcp.modules, members: 'write', records: 'write', contributions: 'read', services: 'write' } };
  const scopes = new Set(['canon:read', 'canon:write']);
  assert.equal(effectiveAccess('services', cfg as never, scopes, 'planner'), 'write');
  assert.equal(effectiveAccess('members', cfg as never, scopes, 'planner'), 'read');
  assert.equal(effectiveAccess('contributions', cfg as never, scopes, 'planner'), 'off', 'no offerings for the planner');
  assert.equal(effectiveAccess('contributions', cfg as never, scopes, 'treasurer'), 'read');
  assert.equal(piiFor(cfg as never, 'secretary'), true);
  assert.equal(piiFor(cfg as never, 'planner'), false);
});

test('an account limited to one congregation sees it and the whole church — not the others', async () => {
  const en = (await call(as.admin, 'POST', '/congregations', { name: { en: 'Test English' }, code: 'EN', languages: ['en'] })).body.id;
  const zh = (await call(as.admin, 'POST', '/congregations', { name: { en: 'Test Chinese' }, code: 'ZH', languages: ['zh'] })).body.id;
  const sEn = svc.createService({ date: '2036-03-02', congregation_id: en }).service.id;
  const sZh = svc.createService({ date: '2036-03-02', congregation_id: zh }).service.id;
  const sAll = svc.createService({ date: '2036-03-03' }).service.id;
  const pEn = reg.people.insert({ first_name: 'Ellery', last_name: 'Holt', congregation_id: en }).id;
  const pZh = reg.people.insert({ first_name: 'Zhou', last_name: 'Wen', congregation_id: zh }).id;
  const gZh = (await call(as.admin, 'POST', '/groups', { name: { en: 'Test ZH Cell' }, kind: 'cell_group', congregation_id: zh })).body.id;
  createUser({ username: 'walled', display_name: 'Test walled', password: 'correct-horse-5', role: 'editor' });
  const walledId = (await call(as.admin, 'GET', '/users')).body.find((u: Json) => u.username === 'walled').id;
  assert.equal((await call(as.admin, 'PATCH', `/users/${walledId}`, { congregation_id: en })).status, 200);
  const w = await login('walled');

  const listed = ((await call(w, 'GET', '/services?from=2036-03-01&to=2036-03-31')).body as Json[]).map((s) => s.id);
  assert.ok(listed.includes(sEn) && listed.includes(sAll) && !listed.includes(sZh), JSON.stringify(listed));
  assert.equal((await call(w, 'GET', `/services/${sZh}`)).status, 404);
  assert.equal((await call(w, 'PATCH', `/services/${sZh}`, { notes: 'x' })).status, 404);
  assert.equal((await call(w, 'PUT', `/services/${sZh}/record`, { attendance: 1 })).status, 404);
  assert.equal((await call(w, 'GET', `/services/${sAll}`)).status, 200, 'the whole church\'s');
  const people = ((await call(w, 'GET', '/people')).body.rows as Json[]).map((p) => p.id);
  assert.ok(people.includes(pEn) && !people.includes(pZh));
  assert.equal((await call(w, 'GET', `/people/${pZh}`)).status, 404);
  assert.equal((await call(w, 'GET', `/groups/${gZh}`)).status, 404);
  assert.ok(!((await call(w, 'GET', '/groups')).body as Json[]).some((g) => g.id === gZh));
  // what they create belongs to their congregation
  const made = await call(w, 'POST', '/services', { date: '2036-03-09', congregation_id: zh });
  assert.equal(made.body.service.congregation_id, en);
  // reports and the calendar: theirs and the whole church's
  const cal = ((await call(w, 'GET', '/calendar?from=2036-03-01&to=2036-03-31')).body as Json[]).map((i) => i.id);
  assert.ok(cal.includes(sEn) && cal.includes(sAll) && !cal.includes(sZh));
  assert.equal((await call(w, 'GET', '/reports/attendance?from=2036-01-01&to=2036-12-31')).body.period.congregation_id, en);
  // administrators are never walled
  const adminId = (await call(as.admin, 'GET', '/users')).body.find((u: Json) => u.username === 'admin').id;
  await call(as.admin, 'PATCH', `/users/${adminId}`, { congregation_id: en });
  assert.equal((await call(as.admin, 'GET', `/services/${sZh}`)).status, 200);
});

test('approvals from counters\' own accounts are told apart from signatures on one device', async () => {
  assert.equal((await call(as.admin, 'PUT', '/offering-settings', { currency: 'SGD', funds: ['General'], signing: 'screen', min_counters: 2, own_accounts: true })).status, 200);
  createUser({ username: 'counter2', display_name: 'Test counter two', password: 'correct-horse-5', role: 'treasurer' });
  const c2 = await login('counter2');
  const sid = svc.createService({ date: '2036-04-05' }).service.id;
  const MONEY = { offerings: [{ fund: 'General', method: 'cash', amount: 5000 }], cash: { '5000': 1 } };
  assert.equal((await call(as.treasurer, 'PUT', `/services/${sid}/record`, MONEY)).status, 200);
  const ink = 'data:image/png;base64,iVBORw0KGgo=';
  // two drawn signatures on one device: not enough when counters must approve from their own accounts
  await call(as.treasurer, 'POST', `/services/${sid}/record/sign`, { name: 'Ann', image: ink });
  await call(as.treasurer, 'POST', `/services/${sid}/record/sign`, { name: 'Ben', image: ink });
  assert.equal((await call(as.treasurer, 'POST', `/services/${sid}/record/finish`, {})).status, 400);
  // the same account approving twice is still one person
  const a1 = await call(as.treasurer, 'POST', `/services/${sid}/record/approve`, {});
  assert.equal(a1.status, 200, JSON.stringify(a1.body));
  await call(as.treasurer, 'POST', `/services/${sid}/record/approve`, {});
  const finish1 = await call(as.treasurer, 'POST', `/services/${sid}/record/finish`, {});
  assert.equal(finish1.status, 400);
  assert.match(finish1.body.error, /own accounts .*\(1 so far\)/);
  // a second account: two people
  assert.equal((await call(c2, 'POST', `/services/${sid}/record/approve`, {})).status, 200);
  const done = await call(as.treasurer, 'POST', `/services/${sid}/record/finish`, {});
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const sigs = done.body.signatures as Json[];
  assert.deepEqual(sigs.filter((g) => g.via === 'account').map((g) => g.name).sort(), ['Test counter two', 'Test treasurer']);
  assert.ok(sigs.filter((g) => g.via === 'account').every((g) => g.account_id && g.image === ''));
  // roles without the Offerings permission can't approve
  const sid2 = svc.createService({ date: '2036-04-12' }).service.id;
  await call(as.treasurer, 'PUT', `/services/${sid2}/record`, MONEY);
  assert.equal((await call(as.secretary, 'POST', `/services/${sid2}/record/approve`, {})).status, 403);
  await call(as.admin, 'PUT', '/offering-settings', { currency: 'SGD', funds: ['General'], signing: 'paper', min_counters: 2, own_accounts: false });
});

test('approved, dated versions of the bulletin and slides: kept exactly, and Canon says when the service changed', async () => {
  const sid = svc.createService({ date: '2036-05-03', title: { en: 'Test Approved Service' } }).service.id;
  await call(as.planner, 'PATCH', `/services/${sid}`, { theme: { en: 'Grace before' } });
  assert.equal((await call(as.viewer, 'POST', `/services/${sid}/approvals`, {})).status, 403);
  const a = await call(as.pastor, 'POST', `/services/${sid}/approvals`, { note: 'checked' });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.current, true);
  assert.equal(a.body.approved_by, 'Test pastor');
  // the service changes: the approval is no longer current, and still shows what was approved
  await call(as.planner, 'PATCH', `/services/${sid}`, { theme: { en: 'Grace after' } });
  const list = (await call(as.viewer, 'GET', `/services/${sid}/approvals`)).body as Json[];
  assert.equal(list.length, 1);
  assert.equal(list[0].current, false);
  const kept = (await call(as.viewer, 'GET', `/services/${sid}/approvals/${list[0].id}`)).body;
  assert.equal(kept.snapshot.render.theme.en, 'Grace before');
  assert.ok(kept.snapshot.render.bulletin && 'slide_css' in kept.snapshot);
  assert.equal((await call(as.viewer, 'GET', `/services/${sid}/approvals/999999`)).status, 404);
  // approving again makes the newest current
  await call(as.planner, 'POST', `/services/${sid}/approvals`, {});
  assert.equal(((await call(as.viewer, 'GET', `/services/${sid}/approvals`)).body as Json[])[0].current, true);
});

test('optional parts of Canon can be switched off: hidden, refused, no AI tools — and back on with nothing lost', async () => {
  const { allowedTools } = await import('../server/mcp.ts');
  assert.equal((await call(as.editor, 'PUT', '/modules', { meetings: false })).status, 403, 'administrators only');
  assert.equal((await call(as.admin, 'PUT', '/modules', { meetings: false, volunteers: false, visitor_form: false })).status, 200);
  assert.equal((await call(as.editor, 'GET', '/meetings')).status, 404);
  assert.equal((await call(as.editor, 'GET', '/calendar?from=2036-01-01&to=2036-01-31')).status, 404);
  assert.equal((await call(as.editor, 'GET', `/services/${ids.meeting}`)).status, 404, 'a meeting through its service address too');
  assert.equal((await call(as.editor, 'GET', `/services/${ids.service}`)).status, 200, 'services stay');
  assert.equal((await call(as.editor, 'GET', '/rota?from=2036-01-01&to=2036-01-31')).status, 404);
  assert.equal((await call(as.editor, 'GET', '/teams')).status, 200, 'other pages still read the teams');
  assert.equal((await call(as.editor, 'POST', '/teams', { name: { en: 'Test team' } })).status, 404);
  assert.equal((await call(as.editor, 'GET', `/services/${ids.service}/visitor-form`)).status, 404);
  const cfg = { ...S.getSettings().mcp, enabled: true, modules: { ...S.getSettings().mcp.modules, volunteers: 'write', services: 'write' } };
  const tools = allowedTools(cfg as never, new Set(['canon:read', 'canon:write']), 'admin').map((t) => t.name);
  assert.ok(!tools.includes('canon_get_rota') && !tools.includes('canon_get_calendar') && tools.includes('canon_get_service'));
  // back on: everything is there again
  await call(as.admin, 'PUT', '/modules', { meetings: true, volunteers: true, visitor_form: true });
  assert.equal((await call(as.editor, 'GET', `/services/${ids.meeting}`)).status, 200);
  assert.equal((await call(as.editor, 'GET', '/rota?from=2036-01-01&to=2036-01-31')).status, 200);
});
