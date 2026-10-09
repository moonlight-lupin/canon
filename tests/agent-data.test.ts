// What AI agents see and what is kept about them, from the Daedalus Workshop's code study of 0.19.10: access checks
// fail closed, the activity log keeps no personal data, personal fields are marked where they are defined, a module
// switched off hides its tools and playbooks alike, and the tools' hints and outputs say what they do. Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-agent-data-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');
process.env.CANON_PUBLIC_URL = 'http://127.0.0.1';
delete process.env.CANON_TRUST_PROXY;

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const { updateSettings, getSettings } = await import('../server/repo/settings.ts');
const { TOOLS } = await import('../server/mcp.ts');
const { canRead } = await import('../server/mcp-tools/common.ts');
const { db, run } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let server: Server;
let base = '';

const ALL = { members: 'write', coworkers: 'write', volunteers: 'write', services: 'write', templates: 'write', library: 'write', groups: 'write', records: 'write', contributions: 'read', lending: 'write', equipment: 'write', bookkeeping: 'write', admin: 'read' } as const;
function setMcp(patch: Json) {
  const cur = getSettings().mcp;
  updateSettings({ mcp: { ...cur, ...patch, modules: { ...cur.modules, ...(patch.modules ?? {}) } } });
}

before(async () => {
  await createUser({ username: 'admin', display_name: 'Admin Example', password: 'correct-horse-1', role: 'admin' });
  setMcp({ enabled: true, modules: { ...ALL }, expose_member_pii: false, visitors: 'contact' });
  server = createApp().listen(0, '127.0.0.1');
  server.keepAliveTimeout = 120_000;
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------- a connection, as claude.ai makes one

let accessToken = '';
async function connect(username = 'admin', password = 'correct-horse-1') {
  const reg = (await (await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Assistant (test)', redirect_uris: [REDIRECT] }) })).json()) as Json;
  const l = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const cookie = l.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { csrf } = (await l.json()) as Json;
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const form = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', scope: 'canon:read canon:write', csrf, decision: 'allow' });
  const a = await fetch(`${base}/oauth/authorize`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: form });
  const code = new URL(a.headers.get('location')!).searchParams.get('code')!;
  const t = (await (await fetch(`${base}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: reg.client_id, code_verifier: verifier }) })).json()) as Json;
  assert.ok(t.access_token, JSON.stringify(t));
  return t.access_token as string;
}
let rpcId = 1;
async function rpc(method: string, params: Json = {}, token = accessToken) {
  const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }) });
  assert.equal(r.status, 200);
  return (await r.json()) as Json;
}
async function call(name: string, args: Json = {}, token = accessToken) {
  const res = (await rpc('tools/call', { name, arguments: args }, token)).result as Json;
  const text = (res.content as Json[]).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  let json: Json | null = null;
  try {
    json = JSON.parse(text);
  } catch { /* plain-text error from the SDK */ }
  return { isError: !!res.isError, text, json };
}

// ---------------------------------------------------------------- 5. fail closed

test('5. a tool handler run without a connection’s access (no auth, no levels) shows nothing it would have to check', async () => {
  const report = TOOLS.find((t) => t.name === 'canon_attendance_report')!;
  assert.throws(() => report.handler({ kind: 'meeting' }, {} as never), /not available/, 'meetings are refused without a connection to check');
  assert.equal(canRead({} as never, 'contributions'), false, 'no levels: no module is readable');
  const record = TOOLS.find((t) => t.name === 'canon_list_service_records')!;
  const out = (await record.handler({}, {} as never)) as Json;
  assert.ok(out.services.every((s: Json) => !('offering_total' in s)), 'no offerings without a connection to check');
});

// ---------------------------------------------------------------- 8. the AI activity log

test('8. the AI activity log keeps which fields a call used, and values only of fields marked safe (ids, dates, kinds)', async () => {
  accessToken = await connect();
  const svc = await call('canon_create_service', { date: '2031-05-04' });
  assert.equal(svc.isError, false, svc.text);
  const sid = svc.json!.data.service.id as number;
  const saved = await call('canon_save_service_record', {
    service_id: sid, attendance: 120, notes: 'Pray for the Example family (hospital)',
    add_visitors: [{ name: 'Vera Visitor', source: 'walked in', contact: 'vera@example.org +65 8000 0001' }],
  });
  assert.equal(saved.isError, false, saved.text);
  const { all } = await import('../server/db.ts');
  const row = all<Json>("SELECT args FROM mcp_audit WHERE tool = 'canon_save_service_record'")[0];
  for (const leak of ['Vera', 'vera@', '8000', 'hospital', 'walked in']) assert.ok(!row.args.includes(leak), `audit kept ${leak}: ${row.args}`);
  const args = JSON.parse(row.args);
  assert.equal(args.service_id, sid, 'ids are kept: which record the agent touched');
  assert.equal(args.attendance, 120, 'a count is kept');
  assert.ok('notes' in args && args.notes !== 'Pray for the Example family (hospital)', 'the field is named, its text withheld');
  assert.deepEqual(Object.keys(args.add_visitors[0]).sort(), ['contact', 'name', 'source']);
  const create = all<Json>("SELECT args FROM mcp_audit WHERE tool = 'canon_create_service'")[0];
  assert.equal(JSON.parse(create.args).date, '2031-05-04', 'a date is kept');
});

// ---------------------------------------------------------------- 22. rejected calls stay in the log

test('22. calls the MCP library rejects before any tool runs are still logged (fails if an SDK upgrade stops it)', async () => {
  accessToken ||= await connect();
  const { all } = await import('../server/db.ts');
  const unknown = await call('canon_no_such_tool', { id: 1 });
  assert.equal(unknown.isError, true);
  const invalid = await call('canon_get_service_record', { service_id: 'not a number' });
  assert.equal(invalid.isError, true);
  const rows = all<Json>("SELECT tool, ok, args, error FROM mcp_audit WHERE tool IN ('canon_no_such_tool', 'canon_get_service_record') AND ok = 0");
  assert.ok(rows.some((r) => r.tool === 'canon_no_such_tool'), 'an unknown tool is logged (the SDK answers it; no handler of ours runs)');
  assert.ok(rows.some((r) => r.tool === 'canon_get_service_record' && /service_id/.test(r.error ?? '')), 'arguments the SDK refuses are logged with why');
});

// ---------------------------------------------------------------- 9. personal fields, wherever they are

const SECRETS = {
  phone: '+65 8111 2233', email: 'hidden.person@example.org', address: '12 Hidden Lane', birth: '1977-07-17', note: 'Confidential pastoral note',
  hhPhone: '+65 6222 3344', hhAddress: '34 Quiet Road', hhNote: 'Household private note', cwNote: 'Coworker private note',
  diet: 'Peanut allergy (sensitive)', away: 'Surgery in hospital', visitorContact: 'visitor.contact@example.org', visitorNote: 'Visitor prayer: divorce',
};

test('9. personal values seeded through the tools never appear in any read tool’s output once personal data isn’t shared', async () => {
  accessToken ||= await connect();
  updateSettings({ member_fields: [{ key: 'dietary_needs', label: { en: 'Dietary needs' }, type: 'text', sensitive: true }] } as never);
  setMcp({ expose_member_pii: true, visitors: 'contact' });
  const hh = await call('canon_save_household', { fields: { name: 'Example household', address: SECRETS.hhAddress, phone: SECRETS.hhPhone, notes: SECRETS.hhNote } });
  assert.equal(hh.isError, false, hh.text);
  const p = await call('canon_save_person', { fields: { first_name: 'Hidden', last_name: 'Example', phone: SECRETS.phone, email: SECRETS.email, address: SECRETS.address, birth_date: SECRETS.birth, notes: SECRETS.note, household_id: hh.json!.data.id, status: 'member', custom: { dietary_needs: SECRETS.diet } } });
  assert.equal(p.isError, false, p.text);
  const pid = p.json!.data.id as number;
  assert.equal((await call('canon_save_coworker', { fields: { person_id: pid, position: 'Youth worker', category: 'ministry_staff', employment: 'part_time', notes: SECRETS.cwNote } })).isError, false);
  assert.equal((await call('canon_set_unavailability', { person_id: pid, start_date: '2031-06-01', end_date: '2031-06-14', reason: SECRETS.away })).isError, false);
  const svc = (await call('canon_create_service', { date: '2031-06-08' })).json!.data.service.id as number;
  const rec = await call('canon_save_service_record', { service_id: svc, attendance: 90, add_visitors: [{ name: 'Visiting Example', contact: SECRETS.visitorContact }] });
  assert.equal(rec.isError, false, rec.text);
  run("UPDATE service_records SET visitors = json_set(visitors, '$[0].notes', ?) WHERE service_id = ?", SECRETS.visitorNote, svc);

  // now the administrator stops sharing personal data (visitors: names only)
  setMcp({ expose_member_pii: false, visitors: 'names' });
  const list = (await rpc('tools/list')).result.tools as Json[];
  const reads = list.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name as string);
  assert.ok(reads.length >= 20, reads.join());
  const ARGS: Record<string, Json[]> = {
    canon_get_person: [{ id: pid }],
    canon_get_service: [{ id: svc, include_text: true }],
    canon_get_service_record: [{ service_id: svc }],
    canon_get_library_item: [{ type: 'song', id: 1 }],
    canon_find_people: [{}, { view: 'households' }, { q: 'Hidden' }, { household_id: hh.json!.data.id }],
    canon_get_rota: [{ from: '2031-06-01', to: '2031-06-30' }],
    canon_list_coworkers: [{}],
    canon_attendance_report: [{ from: '2031-01-01', to: '2031-12-31' }],
    canon_membership_stats: [{ from: '2031-01-01', to: '2031-12-31' }],
    canon_admin_change_log: [{}, { q: 'Hidden' }],
    canon_admin_record_views: [{}],
    canon_books_report: [{ report: 'trial_balance' }],
  };
  const outputs: string[] = [];
  for (const name of reads) for (const args of ARGS[name] ?? [{}]) outputs.push(`${name} ${JSON.stringify(args)}: ${(await call(name, args)).text}`);
  for (const out of outputs) for (const [what, secret] of Object.entries(SECRETS)) assert.ok(!out.includes(secret), `${what} leaked in ${out.slice(0, 400)}`);
  // a search can't tell whose they are either
  for (const q of ['8111', 'hidden.person', 'Hidden Lane', 'Peanut']) {
    const people = (await call('canon_find_people', { q })).json!.data.people as Json[];
    assert.equal(people.length, 0, `find_people q=${q}`);
    const log = (await call('canon_admin_change_log', { q })).json!.data;
    assert.equal((log.entries ?? log.rows ?? log).length, 0, `change log q=${q}: ${JSON.stringify(log).slice(0, 300)}`);
  }
});

test('9. without personal data shared, an agent can’t write personal fields it can’t read', async () => {
  setMcp({ expose_member_pii: false });
  const r = await call('canon_save_person', { fields: { first_name: 'Blind', last_name: 'Writer', phone: '+65 8999 0000' } });
  assert.equal(r.isError, true);
  assert.match(r.json!.error, /phone/);
  const h = await call('canon_save_household', { fields: { name: 'Blind household', address: '1 Unseen Street' } });
  assert.equal(h.isError, true);
  assert.equal((await call('canon_save_person', { fields: { first_name: 'Named', last_name: 'Only' } })).isError, false, 'names are fine');
});

// ---------------------------------------------------------------- 33. names-only search

test('33. a names-only search pages over name matches: later matches are not lost behind contact-detail matches', async () => {
  setMcp({ expose_member_pii: false });
  for (let i = 0; i < 55; i++) run('INSERT INTO people (first_name, last_name, email) VALUES (?, ?, ?)', `Person${i}`, 'Aardvark', `qqzz${i}@example.org`);
  for (const first of ['Ann', 'Ben', 'Cai']) run('INSERT INTO people (first_name, last_name) VALUES (?, ?)', first, 'Qqzzton');
  const r = (await call('canon_find_people', { q: 'qqzz', limit: 50 })).json!.data;
  assert.deepEqual(r.people.map((p: Json) => p.name).sort(), ['Ann Qqzzton', 'Ben Qqzzton', 'Cai Qqzzton']);
  assert.equal(r.total, 3);
  const page2 = (await call('canon_find_people', { q: 'qqzz', limit: 2, offset: 2 })).json!.data;
  assert.equal(page2.people.length, 1);
  assert.equal(page2.total, 3);
});

// ---------------------------------------------------------------- 11. what the tools' hints promise

test('11. a tool that creates something when called without an id doesn’t claim to be safe to repeat', () => {
  const creates = TOOLS.filter((t) => t.access === 'write' && 'id' in t.input && (t.input.id as { isOptional(): boolean }).isOptional());
  assert.ok(creates.length >= 6, creates.map((t) => t.name).join());
  for (const t of creates) assert.notEqual(t.annotations.idempotentHint, true, `${t.name}: a create without an id makes a new record each time`);
  const lookup = TOOLS.find((t) => t.name === 'canon_lending')!;
  assert.equal(lookup.annotations.openWorldHint, true, 'canon_lending {isbn} looks books up on the internet');
});

// ---------------------------------------------------------------- 10. Settings → Modules, one rule

test('10. a part of Canon switched off (Settings → Modules) is gone for agents: tools, playbooks, whoami, instructions and roster data', async () => {
  accessToken ||= await connect();
  const svc = (await call('canon_create_service', { date: '2031-07-06' })).json!.data.service.id as number;
  const modules = getSettings().modules;
  updateSettings({ modules: { ...modules, volunteers: false, lending: false } } as never);
  try {
    const tools = ((await rpc('tools/list')).result.tools as Json[]).map((t) => t.name as string);
    for (const t of ['canon_get_rota', 'canon_update_rota', 'canon_set_unavailability', 'canon_serving_report', 'canon_update_team_members', 'canon_lending', 'canon_save_book']) assert.ok(!tools.includes(t), `${t} still listed`);
    const prompts = ((await rpc('prompts/list')).result.prompts as Json[]).map((p) => p.name as string);
    assert.ok(!prompts.includes('roster_check'), 'the rota playbook is hidden with the rota');
    for (const name of prompts) {
      const text = JSON.stringify((await rpc('prompts/get', { name, arguments: { date: '2031-07-06', preacher: 'A preacher' } })).result);
      assert.doesNotMatch(text, /canon_(get_rota|update_rota|set_unavailability|serving_report|lending)/, `playbook ${name} names a tool that isn't there`);
    }
    const who = (await call('canon_whoami', {})).json!.data;
    assert.equal(who.modules.volunteers.access, 'off');
    assert.match(who.modules.volunteers.why, /Settings → Modules/);
    assert.equal(who.modules.lending.access, 'off');
    assert.doesNotMatch(who.instructions, /canon_update_rota|canon_get_rota/);
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    assert.doesNotMatch(init.result.instructions, /canon_update_rota|canon_get_rota/);
    const detail = (await call('canon_get_service', { id: svc })).json!.data;
    assert.equal(detail.roster, undefined, 'no roster while the rota is off');
    assert.equal(detail.warnings, undefined);
    const copy = await call('canon_create_service', { date: '2031-07-13', copy_from: svc, with_roster: true });
    assert.equal(copy.isError, true, 'copying the rota is refused while it is off');
    const similar = JSON.stringify((await call('canon_find_services', { similar_to: svc })).json);
    assert.doesNotMatch(similar, /roster_summary/);
  } finally {
    updateSettings({ modules } as never);
  }
});

// ---------------------------------------------------------------- 19. aggregates are numbers

test('19. the membership statistics give agents counts, not names; visitors off means no visitor words either', async () => {
  accessToken ||= await connect();
  setMcp({ expose_member_pii: false, visitors: 'off' });
  run("INSERT INTO people (first_name, last_name, status, membership_date, baptism_date) VALUES ('Newly', 'Joined', 'member', '2032-03-01', '2032-03-08')");
  run("INSERT INTO people (first_name, last_name, status, membership_date, erased_at) VALUES ('Erased', 'Placeholder', 'member', '2032-03-02', '2032-04-01')");
  const stats = (await call('canon_membership_stats', { from: '2032-01-01', to: '2032-12-31' })).json!.data;
  assert.equal(stats.joined, 1, 'a count (the erased placeholder isn’t one)');
  assert.equal(stats.baptised, 1);
  assert.doesNotMatch(JSON.stringify(stats), /Newly|Joined|Erased/);
  const svc = (await call('canon_create_service', { date: '2032-03-07' })).json!.data.service.id as number;
  run("INSERT INTO service_records (service_id, visitors) VALUES (?, ?) ON CONFLICT(service_id) DO UPDATE SET visitors = excluded.visitors", svc, JSON.stringify([{ name: 'Walk In', source: 'invited by Mary Example' }]));
  const att = JSON.stringify((await call('canon_attendance_report', { from: '2032-01-01', to: '2032-12-31' })).json);
  assert.doesNotMatch(att, /Mary Example|Walk In/, 'how visitors came is free text: not shared while visitors are off');
  setMcp({ visitors: 'names' });
});

// ---------------------------------------------------------------- 31. output size

test('31. a tool result too large for an assistant is refused with what to narrow, not sent whole', async () => {
  const { toolResult, MAX_RESULT_BYTES } = await import('../server/mcp.ts');
  const small = toolResult({ rows: [1, 2, 3] });
  assert.equal(small.isError, undefined);
  const big = toolResult({ rows: Array.from({ length: 20_000 }, (_, i) => ({ i, text: 'x'.repeat(40) })) });
  assert.equal(big.isError, true);
  const text = (big.content[0] as { text: string }).text;
  assert.ok(text.length < 2000);
  assert.match(text, /too large.*narrow/i);
  assert.ok(MAX_RESULT_BYTES >= 200_000 && MAX_RESULT_BYTES <= 1_000_000);
  accessToken ||= await connect();
  const many = await call('canon_scripture_report', { years: [1950, 2030] });
  assert.equal(many.isError, true, 'years more than 20 apart are refused, as periods are');
});

// ---------------------------------------------------------------- 23. the consent page tells the truth

async function consentRows(username: string, password: string, scope = 'canon:read canon:write') {
  const reg = (await (await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Assistant (test)', redirect_uris: [REDIRECT] }) })).json()) as Json;
  const l = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  assert.equal(l.status, 200);
  const cookie = l.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const q = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: 'c'.repeat(43), code_challenge_method: 'S256', scope });
  const html = await (await fetch(`${base}/oauth/authorize?${q}`, { headers: { Cookie: cookie } })).text();
  const rows = Object.fromEntries([...html.matchAll(/<tr><td>(.*?)<\/td><td class="l (\w+)">/g)].map((m) => [m[1].replace(/<[^>]+>.*$/, ''), m[2]]));
  return { html, rows };
}

test('23. the consent page shows what this person’s connection will really reach: their role, and the parts switched on', async () => {
  await createUser({ username: 'lib', display_name: 'Librarian Example', password: 'correct-horse-4', role: 'librarian' });
  await createUser({ username: 'ro', display_name: 'Read Only Example', password: 'correct-horse-5', role: 'viewer' });
  const modules = getSettings().modules;
  updateSettings({ modules: { ...modules, lending: true, equipment: false } } as never);
  try {
    const lib = await consentRows('lib', 'correct-horse-4');
    assert.equal(lib.rows['Lending library'], 'write', JSON.stringify(lib.rows));
    assert.equal(lib.rows['Members register'], 'off', 'a librarian’s role doesn’t read members');
    assert.equal(lib.rows['Service planner'], 'off');
    assert.equal(lib.rows['Asset register'], 'off', 'switched off in Settings → Modules');
    assert.equal(lib.rows['Administration (checklist, backups, accounts, logs)'], 'off');
    assert.match(lib.html, /Librarian/, 'the role’s own name, not an empty ()');
    const ro = await consentRows('ro', 'correct-horse-5');
    assert.ok(!Object.values(ro.rows).includes('write'), `a read-only account is never offered “Read & edit”: ${JSON.stringify(ro.rows)}`);
    assert.equal(ro.rows['Offerings and cash counts'], 'off');
    assert.match(ro.html, /Member contact details[^]*?class="l off"/, 'a role without members’ details never gets them');
  } finally {
    updateSettings({ modules } as never);
  }
});

test('23. the settings screen counts the tools agents really get, from the server’s own rule', async () => {
  const { toolCatalog } = await import('../server/mcp.ts');
  const modules = getSettings().modules;
  updateSettings({ modules: { ...modules, lending: false } } as never);
  try {
    const cat = toolCatalog();
    assert.equal(cat.find((t) => t.name === 'canon_lending')!.exposed, false, 'switched off: not exposed');
    assert.equal(cat.find((t) => t.name === 'canon_whoami')!.exposed, true, 'always offered');
  } finally {
    updateSettings({ modules } as never);
  }
});
