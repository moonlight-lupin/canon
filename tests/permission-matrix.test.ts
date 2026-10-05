// Permission matrix (0.13.1): the same rules through the web app and AI agents (MCP), checked on the responses AND
// on what was saved — own congregation / another / the whole church; services and meetings; the Meetings module on
// and off; ordinary and sensitive member fields; items named directly and through a related record. Plus backups
// whose encryption key goes missing. Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-matrix-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');
process.env.CANON_PUBLIC_URL = 'http://127.0.0.1';
delete process.env.CANON_TRUST_PROXY;
const RESOURCE = 'http://127.0.0.1/mcp';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const S = await import('../server/repo/settings.ts');
const svc = await import('../server/repo/services.ts');
const reg = await import('../server/repo/registers.ts');
const grp = await import('../server/repo/groups.ts');
const { saveCongregation } = await import('../server/repo/congregations.ts');
const C = await import('../server/lib/backup-crypto.ts');
const { db, get, run } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Session = { cookie: string; csrf: string };
let server: Server;
let base = '';
const ids: Record<string, number> = {};
const web: Record<string, Session> = {};
const mcp: Record<string, string> = {};
const PW = 'correct-horse-7';

async function login(username: string): Promise<Session> {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: PW }) });
  assert.equal(r.status, 200, username);
  return { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), csrf: ((await r.json()) as Json).csrf };
}
async function call(who: Session, method: string, url: string, body?: unknown) {
  const r = await fetch(`${base}/api${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: who.cookie, 'X-CSRF-Token': who.csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => null)) as Json };
}
async function accessToken(who: Session): Promise<string> {
  const client = (await (await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT] }) })).json()) as Json;
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const form = new URLSearchParams({
    response_type: 'code', client_id: client.client_id, redirect_uri: REDIRECT, state: 'st', code_challenge: challenge, code_challenge_method: 'S256',
    scope: 'canon:read canon:write', resource: RESOURCE, csrf: who.csrf, decision: 'allow',
  });
  const a = await fetch(`${base}/oauth/authorize`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: who.cookie }, body: form });
  const code = new URL(a.headers.get('location')!).searchParams.get('code')!;
  const t = await fetch(`${base}/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: verifier, resource: RESOURCE }),
  });
  return ((await t.json()) as Json).access_token as string;
}
let rpc = 1;
async function tool(at: string, name: string, args: Json = {}) {
  const r = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Mcp-Protocol-Version': '2025-06-18', Authorization: `Bearer ${at}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpc++, method: 'tools/call', params: { name, arguments: args } }),
  });
  const res = ((await r.json()) as Json).result as Json;
  let json: Json = {};
  try {
    json = JSON.parse(res.content[0].text);
  } catch { /* plain text */ }
  return { isError: !!res.isError, json };
}
const person = (id: number) => get<Json>('SELECT * FROM people WHERE id = ?', id)!;

before(async () => {
  ids.A = saveCongregation(null, { name: { en: 'Test North' }, code: 'N' }).id;
  ids.B = saveCongregation(null, { name: { en: 'Test South' }, code: 'S' }).id;
  for (const [u, role] of [['admin', 'admin'], ['walled', 'editor'], ['secretary', 'secretary'], ['planner', 'planner']] as const) {
    createUser({ username: u, display_name: `Test ${u}`, password: PW, role });
  }
  run('UPDATE users SET congregation_id = ? WHERE username = ?', ids.A, 'walled');
  S.updateSettings({ member_fields: [{ key: 'health', label: { en: 'Health' }, type: 'text', sensitive: true }] });
  ids.pA = reg.people.insert({ first_name: 'Ada', last_name: 'North', congregation_id: ids.A, phone: '9000 0101', custom: { health: 'fictional note A' } }).id;
  ids.pB = reg.people.insert({ first_name: 'Bea', last_name: 'South', congregation_id: ids.B, phone: '9000 0202', custom: { health: 'fictional note B' } }).id;
  ids.sA = svc.createService({ date: '2037-03-01', congregation_id: ids.A }).service.id;
  ids.sB = svc.createService({ date: '2037-03-01', congregation_id: ids.B }).service.id;
  ids.sW = svc.createService({ date: '2037-03-01', congregation_id: null }).service.id;
  ids.gA = grp.groups.insert({ name: { en: 'Test North Cell' }, kind: 'cell_group', congregation_id: ids.A }).id;
  ids.meeting = svc.createService({ date: '2037-03-04', kind: 'meeting', group_id: ids.gA, title: { en: 'Cell night' } } as never).service.id;
  const cur = S.getSettings().mcp;
  S.updateSettings({
    mcp: { ...cur, enabled: true, expose_member_pii: true, modules: { members: 'write', coworkers: 'write', groups: 'write', volunteers: 'write', services: 'write', library: 'write', templates: 'write', records: 'write', contributions: 'read' } },
    backup: { ...S.getSettings().backup, dir: path.join(tmp, 'backups') },
  });
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const u of ['admin', 'walled', 'secretary', 'planner']) {
    web[u] = await login(u);
    mcp[u] = await accessToken(web[u]);
  }
});

after(async () => {
  await new Promise((r) => server.close(r));
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('congregation wall — web: another congregation\'s member, directly or through a group, and moving rows out', async () => {
  assert.equal((await call(web.walled, 'GET', `/people/${ids.pB}`)).status, 404);
  assert.equal((await call(web.walled, 'GET', `/people/${ids.pA}`)).status, 200);
  // a related id: adding the other congregation's member to our group
  assert.equal((await call(web.walled, 'POST', `/groups/${ids.gA}/members`, { person_id: ids.pB })).status, 404);
  assert.equal(get('SELECT 1 FROM group_members WHERE person_id = ?', ids.pB), undefined, 'nothing saved');
  // an administrator puts them in the group: the walled account's view of the group still leaves them out
  grp.addGroupMember(ids.gA, { person_id: ids.pB });
  const members = (await call(web.walled, 'GET', `/groups/${ids.gA}/members`)).body as Json[];
  assert.ok(!members.some((m) => m.person_id === ids.pB), 'nested list filtered');
  assert.ok(!JSON.stringify(members).includes('9000 0202'));
  // moving our own member to the other congregation
  assert.equal((await call(web.walled, 'PATCH', `/people/${ids.pA}`, { congregation_id: ids.B })).status, 403);
  assert.equal(person(ids.pA).congregation_id, ids.A);
  // an ordinary edit (the form sends the same congregation) still works
  assert.equal((await call(web.walled, 'PATCH', `/people/${ids.pA}`, { congregation_id: ids.A, preferred_name: 'Addie' })).status, 200);
});

test('congregation wall — the rota: our services and the whole church\'s, not another congregation\'s', async () => {
  const r = await call(web.walled, 'GET', '/rota?from=2037-03-01&to=2037-03-01');
  assert.equal(r.status, 200);
  assert.deepEqual((r.body.services as Json[]).map((s) => s.id).sort(), [ids.sA, ids.sW].sort());
  const all = await call(web.admin, 'GET', '/rota?from=2037-03-01&to=2037-03-01');
  assert.deepEqual((all.body.services as Json[]).map((s) => s.id).sort(), [ids.sA, ids.sB, ids.sW].sort());
});

test('congregation wall — MCP: reading, saving and services of another congregation are refused', async () => {
  const got = await tool(mcp.walled, 'canon_get_person', { id: ids.pB });
  assert.ok(got.isError, JSON.stringify(got.json));
  assert.ok(!JSON.stringify(got.json).includes('9000 0202'));
  const saved = await tool(mcp.walled, 'canon_save_person', { id: ids.pB, fields: { preferred_name: 'Changed across wall' } });
  assert.ok(saved.isError);
  assert.equal(person(ids.pB).preferred_name, null, 'not saved');
  assert.ok((await tool(mcp.walled, 'canon_get_service', { id: ids.sB })).isError);
  assert.ok(!(await tool(mcp.walled, 'canon_get_service', { id: ids.sW })).isError, 'whole-church services are readable');
  assert.ok(!(await tool(mcp.walled, 'canon_get_person', { id: ids.pA })).isError);
});

test('sensitive fields — MCP follows the role\'s own permission (secretary: contact details yes, sensitive no)', async () => {
  const got = await tool(mcp.secretary, 'canon_get_person', { id: ids.pA });
  assert.ok(!got.isError, JSON.stringify(got.json));
  assert.equal(got.json.data.phone, '9000 0101', 'contact details shown');
  assert.equal(got.json.data.custom?.health, undefined, 'sensitive field withheld');
  const w = await tool(mcp.secretary, 'canon_save_person', { id: ids.pA, fields: { custom: { health: 'changed by agent' } } });
  assert.ok(w.isError);
  assert.equal(JSON.parse(person(ids.pA).custom).health, 'fictional note A');
  // the administrator's connection sees and changes them
  assert.equal((await tool(mcp.admin, 'canon_get_person', { id: ids.pA })).json.data.custom.health, 'fictional note A');
});

test('sensitive fields — web: a role without them can\'t change or clear them (an empty box is not a request)', async () => {
  const r = await call(web.secretary, 'PATCH', `/people/${ids.pA}`, { custom: { health: '' } });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(person(ids.pA).custom).health, 'fictional note A');
  assert.equal((await call(web.secretary, 'GET', `/people/${ids.pA}`)).body.custom?.health, undefined);
});

test('meetings — MCP: a planner reads but can\'t change them; switched off, they don\'t exist for agents', async () => {
  assert.equal((await call(web.planner, 'PATCH', `/services/${ids.meeting}`, { notes: 'web change' })).status, 403);
  const upd = await tool(mcp.planner, 'canon_update_service', { id: ids.meeting, patch: { notes: 'Changed via MCP' } });
  assert.ok(upd.isError, JSON.stringify(upd.json));
  assert.equal(get<{ notes: string | null }>('SELECT notes FROM services WHERE id = ?', ids.meeting)!.notes, null, 'not saved');
  assert.ok(!(await tool(mcp.planner, 'canon_get_service', { id: ids.meeting })).isError, 'reading is allowed');
  const order = await tool(mcp.planner, 'canon_edit_order', { service_id: ids.meeting, ops: [{ op: 'add', item: { kind: 'other', title: { en: 'Agent item' } } }] });
  assert.ok(order.isError);
  assert.equal(get<{ n: number }>('SELECT COUNT(*) AS n FROM service_items WHERE service_id = ?', ids.meeting)!.n, 0);
  // the planner still changes services
  assert.ok(!(await tool(mcp.planner, 'canon_update_service', { id: ids.sW, patch: { notes: 'Planner note' } })).isError);

  S.updateSettings({ modules: { ...S.getSettings().modules, meetings: false } });
  assert.equal((await call(web.admin, 'GET', `/services/${ids.meeting}`)).status, 404);
  assert.ok((await tool(mcp.admin, 'canon_get_service', { id: ids.meeting })).isError, 'MCP hides it too');
  assert.ok((await tool(mcp.admin, 'canon_get_record', { service_id: ids.meeting })).isError, 'and its record');
  assert.ok((await tool(mcp.admin, 'canon_attendance_report', { kind: 'meeting' })).isError, 'and meeting reports');
  assert.ok(!(await tool(mcp.admin, 'canon_get_service', { id: ids.sW })).isError);
  S.updateSettings({ modules: { ...S.getSettings().modules, meetings: true } });
  assert.ok(!(await tool(mcp.admin, 'canon_get_service', { id: ids.meeting })).isError);
});

test('backups — a missing or damaged key never gives a plain backup while encryption is on', async () => {
  const dir = path.join(tmp, 'backups');
  assert.equal((await call(web.admin, 'PUT', '/backups/password', { password: 'matrix-test-pw-1' })).status, 200);
  const ok = await call(web.admin, 'POST', '/backups');
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.match(ok.body.created, /\.db\.enc$/);
  const count = () => fs.readdirSync(dir).filter((n) => n.startsWith('canon-')).length;
  const n = count();
  // damaged
  fs.writeFileSync(C.keyFile(), '{ not json');
  const bad = await call(web.admin, 'POST', '/backups');
  assert.equal(bad.status, 409);
  assert.match(bad.body.error, /damaged/);
  assert.equal(count(), n, 'no file written');
  assert.ok((await call(web.admin, 'GET', '/backups')).body.key_problem);
  // wrong lengths
  fs.writeFileSync(C.keyFile(), JSON.stringify({ salt: 'AAAA', key: 'AAAA' }));
  assert.equal((await call(web.admin, 'POST', '/backups')).status, 409);
  // missing: still refused (the setting says encrypted)
  fs.rmSync(C.keyFile());
  const missing = await call(web.admin, 'POST', '/backups');
  assert.equal(missing.status, 409);
  assert.match(missing.body.error, /missing/);
  assert.equal(count(), n);
  // setting the password again (or turning encryption off) is the way out
  assert.equal((await call(web.admin, 'PUT', '/backups/password', { password: null })).status, 200);
  const plain = await call(web.admin, 'POST', '/backups');
  assert.equal(plain.status, 200);
  assert.match(plain.body.created, /\.db$/);
});
