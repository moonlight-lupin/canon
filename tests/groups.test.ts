// Groups & team rosters over MCP: module exposure, PII redaction, audit (argument keys only), team-member rules.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-groups-'));
process.env.CANON_DB = path.join(tmp, 'test.db');
process.env.CANON_PUBLIC_URL = 'http://127.0.0.1';
delete process.env.CANON_TRUST_PROXY;

const PUBLIC = 'http://127.0.0.1';
const RESOURCE = `${PUBLIC}/mcp`;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const { updateSettings, getSettings } = await import('../server/repo/settings.ts');
const reg = await import('../server/repo/registers.ts');
const vol = await import('../server/repo/volunteers.ts');
const { all, db } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Level = 'off' | 'read' | 'write';

let server: Server;
let base = '';
let at = '';

function setMcp(patch: { modules?: Record<string, Level>; expose_member_pii?: boolean }) {
  const cur = getSettings().mcp;
  updateSettings({ mcp: { ...cur, enabled: true, ...patch, modules: { ...cur.modules, ...(patch.modules ?? {}) } } });
}

async function accessToken() {
  const rr = await fetch(`${base}/oauth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT] }),
  });
  const client = (await rr.json()) as Json;
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'correct-horse-1' }) });
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { csrf } = (await login.json()) as Json;
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const form = new URLSearchParams({
    response_type: 'code', client_id: client.client_id, redirect_uri: REDIRECT, state: 's', code_challenge: challenge,
    code_challenge_method: 'S256', scope: 'canon:read canon:write', resource: RESOURCE, csrf, decision: 'allow',
  });
  const r = await fetch(`${base}/oauth/authorize`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: form });
  const code = new URL(r.headers.get('location')!).searchParams.get('code')!;
  const t = await fetch(`${base}/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: verifier, resource: RESOURCE }),
  });
  return ((await t.json()) as Json).access_token as string;
}

let rpcId = 1;
async function mcp(method: string, params: Json = {}) {
  const r = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Mcp-Protocol-Version': '2025-06-18', Authorization: `Bearer ${at}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
  });
  assert.equal(r.status, 200);
  return (await r.json()) as Json;
}
const toolNames = async () => ((await mcp('tools/list')).result.tools as Json[]).map((t) => t.name as string);
async function call(name: string, args: Json = {}) {
  const res = (await mcp('tools/call', { name, arguments: args })).result as Json;
  const text = res.content[0].text as string;
  let json: Json | null = null;
  try {
    json = JSON.parse(text);
  } catch { /* plain-text SDK error */ }
  return { isError: !!res.isError, text, json };
}

const GROUP_READ = ['canon_find_groups'];
const GROUP_WRITE = ['canon_save_group', 'canon_update_group_members'];
const TEAM_READ = ['canon_get_rota'];
const TEAM_WRITE = ['canon_update_team_members'];

let tan: { id: number };
let lim: { id: number };

before(async () => {
  createUser({ username: 'admin', display_name: 'Pastor Admin', password: 'correct-horse-1', role: 'admin' });
  setMcp({ modules: { members: 'off', coworkers: 'off', groups: 'off', volunteers: 'write' }, expose_member_pii: false });
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  at = await accessToken();
  tan = reg.people.insert({ first_name: 'David', last_name: 'Tan', native_name: '陈大卫', phone: '+60 12 777 1234', email: 'david.tan@example.org', status: 'member' });
  lim = reg.people.insert({ first_name: 'Peter', last_name: 'Lim', native_name: '林彼得', phone: '+60 12 888 9876', status: 'member' });
});

after(async () => {
  await new Promise((r) => server.close(r));
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('groups module off hides every group tool; read hides writes', async () => {
  let names = await toolNames();
  for (const n of [...GROUP_READ, ...GROUP_WRITE]) assert.ok(!names.includes(n), `${n} hidden when off`);
  const hidden = await call('canon_find_groups', {});
  assert.equal(hidden.isError, true, 'hidden tool behaves as unknown');

  setMcp({ modules: { groups: 'read' } });
  names = await toolNames();
  for (const n of GROUP_READ) assert.ok(names.includes(n), n);
  for (const n of GROUP_WRITE) assert.ok(!names.includes(n), `${n} hidden when read`);

  setMcp({ modules: { groups: 'write' } });
  names = await toolNames();
  for (const n of [...GROUP_READ, ...GROUP_WRITE]) assert.ok(names.includes(n), n);
  const listed = (await mcp('tools/list')).result.tools as Json[];
  assert.equal(listed.find((t) => t.name === 'canon_update_group_members')!.annotations.destructiveHint, true);
  assert.equal(listed.find((t) => t.name === 'canon_save_group')!.annotations.destructiveHint, false);
  assert.equal(listed.find((t) => t.name === 'canon_find_groups')!.annotations.readOnlyHint, true);
});

test('team roster tools follow the volunteers module', async () => {
  setMcp({ modules: { volunteers: 'off' } });
  let names = await toolNames();
  for (const n of [...TEAM_READ, ...TEAM_WRITE]) assert.ok(!names.includes(n), n);
  setMcp({ modules: { volunteers: 'read' } });
  names = await toolNames();
  assert.ok(names.includes('canon_get_rota'));
  for (const n of TEAM_WRITE) assert.ok(!names.includes(n), n);
  setMcp({ modules: { volunteers: 'write' } });
  names = await toolNames();
  for (const n of [...TEAM_READ, ...TEAM_WRITE]) assert.ok(names.includes(n), n);
  const listed = (await mcp('tools/list')).result.tools as Json[];
  assert.equal(listed.find((t) => t.name === 'canon_update_team_members')!.annotations.destructiveHint, true);
});

test('committee CRUD over MCP; batch membership edits; names and roles only without PII', async () => {
  const g = await call('canon_save_group', { fields: { name: { en: 'Session', zh: '堂会' }, kind: 'committee', meeting: 'Monthly' } });
  assert.equal(g.isError, false, g.text);
  const gid = g.json!.data.id;
  const noKind = await call('canon_save_group', { fields: { name: { en: 'X' } } });
  assert.equal(noKind.isError, true, 'create needs kind');

  const added = await call('canon_update_group_members', {
    group_id: gid,
    ops: [
      { op: 'add', person_id: tan.id, role: 'Moderator', start_date: '2025-01-01' },
      { op: 'add', person_id: lim.id, role: 'Member' },
    ],
  });
  assert.equal(added.isError, false, added.text);
  assert.equal(added.json!.data.group.members.length, 2);
  const limMember = added.json!.data.results[1].member_id;

  // atomicity: the valid role change is rolled back because the duplicate add fails
  const dup = await call('canon_update_group_members', {
    group_id: gid,
    ops: [{ op: 'update', person_id: lim.id, role: 'Treasurer' }, { op: 'add', person_id: lim.id }],
  });
  assert.equal(dup.isError, true);
  assert.equal(dup.json!.errors.length, 1);
  assert.equal(dup.json!.errors[0].index, 1);
  assert.match(dup.json!.errors[0].error, /already/);
  assert.equal(all<Json>('SELECT role FROM group_members WHERE id = ?', limMember)[0].role, 'Member', 'nothing applied');

  const u = await call('canon_update_group_members', { group_id: gid, ops: [{ op: 'update', member_id: limMember, role: 'Clerk' }] });
  assert.equal(u.json!.data.results[0].role, 'Clerk');

  const list = await call('canon_find_groups', { kind: 'committee' });
  assert.equal(list.json!.data.length, 1);
  assert.equal(list.json!.data[0].member_count, 2);
  assert.equal(list.json!.data[0].leaders[0].name, 'David Tan 陈大卫');

  const detail = await call('canon_find_groups', { id: gid });
  assert.equal(detail.json!.data.members[0].role, 'Moderator');
  assert.equal(detail.json!.data.members[1].name, 'Peter Lim 林彼得');
  for (const leak of ['777', '888', 'david.tan@']) assert.ok(!detail.text.includes(leak), `leaked ${leak}`);
  for (const leak of ['777', '888', 'david.tan@']) assert.ok(!u.text.includes(leak), `batch result leaked ${leak}`);

  setMcp({ expose_member_pii: true });
  const withPii = await call('canon_find_groups', { id: gid });
  assert.ok(withPii.text.includes('david.tan@example.org'));
  setMcp({ expose_member_pii: false });

  const upd = await call('canon_save_group', { id: gid, fields: { active: false } });
  assert.equal(upd.json!.data.active, false);
  assert.equal((await call('canon_find_groups', {})).json!.data.length, 0);
  assert.equal((await call('canon_find_groups', { include_inactive: true })).json!.data.length, 1);

  const rm = await call('canon_update_group_members', { group_id: gid, ops: [{ op: 'remove', person_id: lim.id }] });
  assert.equal(rm.isError, false, rm.text);
  assert.equal(rm.json!.data.group.members.length, 1);
  const wrongGroup = await call('canon_update_group_members', { group_id: gid, ops: [{ op: 'remove', member_id: 999999 }] });
  assert.equal(wrongGroup.isError, true);
});

test('team members: auto-join on qualification, cascade, leaders, team without roles', async () => {
  const av = vol.teams.insert({ name: { en: 'AV', zh: '影音' }, color: '#333333' });
  const sound = vol.roles.insert({ team_id: av.id, name: { en: 'Sound', zh: '音控' }, needed: 1 });
  vol.setRoleMembers(sound.id, [tan.id]);
  let rota = await call('canon_get_rota', {});
  let team = rota.json!.data.teams.find((t: Json) => t.id === av.id);
  assert.deepEqual(team.members.map((m: Json) => m.person_id), [tan.id]);
  assert.deepEqual(team.roles[0].qualified.map((m: Json) => m.person_id), [tan.id]);

  const blocked = await call('canon_update_team_members', { team_id: av.id, ops: [{ op: 'remove', person_id: tan.id }] });
  assert.equal(blocked.isError, true);
  assert.match(blocked.json!.errors[0].error, /Still qualified for 1 role/);
  const cascaded = await call('canon_update_team_members', { team_id: av.id, ops: [{ op: 'remove', person_id: tan.id, cascade: true }] });
  assert.deepEqual(cascaded.json!.data.results[0].removed_qualifications, [sound.id]);
  assert.equal(all('SELECT 1 FROM role_members WHERE role_id = ?', sound.id).length, 0);

  const choir = vol.teams.insert({ name: { en: 'Choir', zh: '诗班' } });
  const r = await call('canon_update_team_members', {
    team_id: choir.id,
    ops: [{ op: 'add', person_id: tan.id }, { op: 'add', person_id: lim.id }, { op: 'set_leader', person_id: lim.id }],
  });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.json!.data.members.length, 2);
  assert.equal(r.json!.data.members[0].person_id, lim.id, 'leaders first');
  assert.equal(r.json!.data.members[0].is_leader, true);
  rota = await call('canon_get_rota', {});
  team = rota.json!.data.teams.find((t: Json) => t.id === choir.id);
  assert.equal(team.roles.length, 0);
  assert.equal(team.members.length, 2);

  // set_leader on someone not in the team fails the whole batch
  const bad = await call('canon_update_team_members', { team_id: choir.id, ops: [{ op: 'remove', person_id: tan.id }, { op: 'set_leader', person_id: 999999 }] });
  assert.equal(bad.isError, true);
  assert.equal(all('SELECT 1 FROM group_members gm JOIN teams t ON t.group_id = gm.group_id WHERE t.id = ? AND gm.person_id = ?', choir.id, tan.id).length, 1, 'remove rolled back');
  const plain = await call('canon_update_team_members', { team_id: choir.id, ops: [{ op: 'remove', person_id: tan.id }] });
  assert.equal(plain.isError, false, plain.text);
});

test('audit stores argument keys and op types only for groups, values for volunteers', async () => {
  const rows = all<Json>('SELECT * FROM mcp_audit');
  const groupRows = rows.filter((r) => r.module === 'groups');
  assert.ok(groupRows.length >= 8);
  const blob = JSON.stringify(groupRows);
  for (const leak of ['Session', '堂会', 'Moderator', 'Clerk', '2025-01-01', 'Monthly']) assert.ok(!blob.includes(leak), `audit leaked ${leak}`);
  const batch = groupRows.filter((r) => r.tool === 'canon_update_group_members');
  assert.equal(batch.length, 5, 'one row per batch call');
  assert.deepEqual(JSON.parse(batch[0].args), ['group_id', 'ops[add,add]', 'ops[].person_id', 'ops[].role', 'ops[].start_date']);
  assert.deepEqual(JSON.parse(batch[1].args), ['group_id', 'ops[update,add]', 'ops[].person_id', 'ops[].role']);
  assert.equal(batch[1].ok, 0);
  const create = groupRows.find((r) => r.tool === 'canon_save_group')!;
  assert.deepEqual(JSON.parse(create.args).sort(), ['fields.kind', 'fields.meeting', 'fields.name.en', 'fields.name.zh']);
  // the hidden call made while the module was off is audited as unknown/sensitive (keys only)
  assert.ok(rows.some((r) => r.tool === 'canon_find_groups' && r.ok === 0));
  const team = rows.filter((r) => r.tool === 'canon_update_team_members');
  assert.equal(team[0].module, 'volunteers');
  assert.match(team.map((r) => r.args).join(), /"cascade":true/, 'non-register modules keep argument values');
});

test('serving teams: a team is a group; names stay in step; made and deleted only from Volunteers', async () => {
  const grp = await import('../server/repo/groups.ts');
  const vol = await import('../server/repo/volunteers.ts');
  const tid = grp.createTeam({ name: { en: 'Ushers Zt' }, color: '#123456' });
  const gid = grp.teamGroupId(tid);
  const g = grp.groups.get(gid);
  assert.equal(g.kind, 'serving_team');
  assert.deepEqual(g.name, { en: 'Ushers Zt' });
  grp.updateTeam(tid, { name: { en: 'Ushers & Welcome Zt' } });
  assert.deepEqual(grp.groups.get(gid).name, { en: 'Ushers & Welcome Zt' }, 'renaming the team renames its group');
  grp.updateGroup(gid, { name: { en: 'Welcome Team Zt' } });
  assert.deepEqual(vol.teams.get(tid).name, { en: 'Welcome Team Zt' }, 'renaming the group renames its team');
  assert.throws(() => grp.createGroup({ name: { en: 'X' }, kind: 'serving_team' }), /Volunteers/);
  assert.throws(() => grp.updateGroup(gid, { kind: 'committee' }), /serving team/);
  assert.throws(() => grp.deleteGroup(gid), /Volunteers/);
  // the roster is the group's members; a leader role makes a team leader
  const p = reg.people.insert({ first_name: 'Roster', last_name: 'Zt', status: 'member' });
  grp.addTeamMember(tid, p.id, true);
  assert.equal(grp.membersOf(gid)[0].role, 'Leader');
  assert.equal(grp.teamMembers(tid)[0].is_leader, true);
  grp.deleteTeam(tid);
  assert.equal(grp.groups.find(gid), undefined, 'deleting the team deletes its group');
});
