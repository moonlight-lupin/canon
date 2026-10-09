// Custom member fields: definitions (keys kept, types, choices), values checked per type, sensitive fields hidden
// from read-only accounts and AI agents, values kept when a field is removed, and CSV export / import. Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-member-fields-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const reg = await import('../server/repo/registers.ts');
const { db } = await import('../server/db.ts');
const MF = await import('../shared/member-fields.ts');
const { TOOLS } = await import('../server/mcp.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Session = { cookie: string; csrf: string };
let server: Server;
let base = '';
const as: Record<'admin' | 'editor' | 'viewer', Session> = {} as never;
let pid = 0;

async function login(username: string): Promise<Session> {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'correct-horse-8' }) });
  assert.equal(r.status, 200);
  return { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), csrf: ((await r.json()) as Json).csrf };
}
async function call(who: Session, method: string, url: string, body?: unknown, type = 'application/json') {
  const r = await fetch(`${base}/api${url}`, { method, headers: { 'Content-Type': type, Cookie: who.cookie, 'X-CSRF-Token': who.csrf }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await r.text();
  let json: Json | null = null;
  try {
    json = JSON.parse(text);
  } catch { /* csv */ }
  return { status: r.status, json, text };
}

before(async () => {
  for (const role of ['admin', 'editor', 'viewer'] as const) await createUser({ username: role, display_name: `Test ${role}`, password: 'correct-horse-8', role });
  server = createApp().listen(0, '127.0.0.1');
  // a full parallel test run is slow: idle connections stay open for the next request (no reset mid-test)
  server.keepAliveTimeout = 120_000;
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const role of ['admin', 'editor', 'viewer'] as const) as[role] = await login(role);
  pid = reg.people.insert({ first_name: 'Field', last_name: 'Tester', status: 'member' }).id;
});

after(async () => {
  await new Promise((r) => server.close(r));
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('values are checked per type; choices match any language and are kept in the first', () => {
  const defs: import('../shared/member-fields.ts').MemberField[] = [
    { key: 'leader', label: { en: 'Leader?' }, type: 'yesno' },
    { key: 'since', label: { en: 'Since' }, type: 'date' },
    { key: 'via', label: { en: 'Joined via' }, type: 'choice', options: [{ en: 'Alpha course', zh: '启发课程' }] },
  ];
  assert.deepEqual(MF.cleanCustomValues({ leader: '是', since: '2020-01-02', via: '启发课程', stray: 'x' }, defs).values, { leader: 'yes', since: '2020-01-02', via: 'Alpha course' });
  const bad = MF.cleanCustomValues({ leader: 'maybe', since: '2/1/2020', via: 'Nope' }, defs);
  assert.equal(bad.errors.length, 3);
  assert.equal(MF.fieldKey({ en: 'Cell group leader?' }, []), 'cell_group_leader');
  assert.equal(MF.fieldKey({ en: 'Cell group leader?' }, ['cell_group_leader']), 'cell_group_leader_2');
});

test('administrators define fields; keys stay; editors fill them in; wrong values are refused', async () => {
  assert.equal((await call(as.editor, 'PUT', '/member-fields', [])).status, 403);
  let r = await call(as.admin, 'PUT', '/member-fields', [
    { label: { en: 'Cell group leader?', zh: '小组组长？' }, type: 'yesno' },
    { label: { en: 'Dietary needs' }, type: 'text', sensitive: true },
    { label: { en: 'Joined via' }, type: 'choice', options: [{ en: 'Alpha course' }, { en: 'Friend' }] },
    { label: {}, type: 'text' },
  ]);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json!.map((f: Json) => f.key), ['cell_group_leader', 'dietary_needs', 'joined_via'], 'empty labels dropped');
  // renaming keeps the key
  r = await call(as.admin, 'PUT', '/member-fields', r.json!.map((f: Json) => (f.key === 'joined_via' ? { ...f, label: { en: 'How they joined' } } : f)));
  assert.equal(r.json!.find((f: Json) => f.label.en === 'How they joined').key, 'joined_via');

  assert.equal((await call(as.editor, 'PATCH', `/people/${pid}`, { custom: { cell_group_leader: 'perhaps' } })).status, 400);
  const ok = await call(as.editor, 'PATCH', `/people/${pid}`, { custom: { cell_group_leader: 'yes', dietary_needs: 'No peanuts', joined_via: 'friend' } });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual(ok.json!.custom, { cell_group_leader: 'yes', dietary_needs: 'No peanuts', joined_via: 'Friend' });
});

test('sensitive fields: hidden from read-only accounts and from AI agents without personal data', async () => {
  for (const url of ['/people?limit=100', '/households']) {
    const l = await call(as.viewer, 'GET', url);
    assert.ok(!l.text.includes('peanuts'), `${url}: list rows never carry sensitive values`);
  }
  const list = await call(as.editor, 'GET', '/people?limit=100');
  assert.equal(list.json!.rows.find((x: Json) => x.id === pid).custom.joined_via, 'Friend', 'list rows carry the values, decoded');
  const v = await call(as.viewer, 'GET', `/people/${pid}`);
  assert.deepEqual(v.json!.custom, { cell_group_leader: 'yes', joined_via: 'Friend' });
  assert.ok(!v.text.includes('peanuts'));
  const tool = TOOLS.find((t) => t.name === 'canon_get_person')!;
  const ctx = (pii: boolean) => ({ auth: { user: { id: 1, display_name: 'T', role: 'editor' }, scopes: new Set(['canon:read']) }, pii }) as never;
  assert.equal(((await tool.handler({ id: pid }, ctx(false))) as Json).custom.dietary_needs, undefined);
  assert.equal(((await tool.handler({ id: pid }, ctx(true))) as Json).custom.dietary_needs, 'No peanuts');
  const save = TOOLS.find((t) => t.name === 'canon_save_person')!;
  await assert.rejects(async () => save.handler({ id: pid, fields: { custom: { dietary_needs: 'x' } } }, ctx(false)), /Sensitive member fields/);
});

test('a removed field keeps its values; CSV export and import carry the fields', async () => {
  const defs = (await call(as.admin, 'GET', '/settings')).json!.member_fields as Json[];
  await call(as.admin, 'PUT', '/member-fields', defs.filter((d) => d.key !== 'dietary_needs'));
  await call(as.editor, 'PATCH', `/people/${pid}`, { custom: { cell_group_leader: 'no' } });
  assert.equal(reg.people.get(pid).custom?.dietary_needs, 'No peanuts', 'kept in the data');
  assert.ok(!(await call(as.viewer, 'GET', `/people/${pid}`)).text.includes('peanuts'), 'never to read-only accounts while the field is gone');
  await call(as.admin, 'PUT', '/member-fields', defs);
  assert.equal((await call(as.editor, 'GET', `/people/${pid}`)).json!.custom.dietary_needs, 'No peanuts', 'back with the field');

  const csv = await call(as.admin, 'GET', '/csv/members/export.csv');
  const head = csv.text.replace(/^﻿/, '').split(/\r?\n/)[0];
  assert.ok(head.includes('custom_cell_group_leader') && head.includes('custom_joined_via'));
  const file = `id,first_name,custom_cell_group_leader,custom_joined_via\n${pid},Field,yes,Alpha course\n`;
  const imp = await call(as.editor, 'POST', '/csv/members/import', file, 'text/csv');
  assert.equal(imp.status, 200, imp.text);
  assert.deepEqual([reg.people.get(pid).custom?.cell_group_leader, reg.people.get(pid).custom?.joined_via], ['yes', 'Alpha course']);
  const badFile = `id,first_name,custom_cell_group_leader\n${pid},Field,sometimes\n`;
  const bad = await call(as.editor, 'POST', '/csv/members/import?dry_run=1', badFile, 'text/csv');
  assert.equal(bad.json!.counts.error, 1);
});
