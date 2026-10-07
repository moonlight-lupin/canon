// A member's personal data (PDPA, 0.13): an administrator exports everything Canon holds about a member, and erases
// it — the row stays anonymous so history counts, the change log (and its archives) forget them. Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-pdpa-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const { db, get, run, all } = await import('../server/db.ts');
const A = await import('../server/repo/archive.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Session = { cookie: string; csrf: string };
let server: Server;
let base = '';
let boss: Session;
let ed: Session;
let pid = 0;
let hh = 0;
const NAME = 'Quill Fernsby';

const call = async (who: Session, method: string, url: string, body?: unknown) => {
  const r = await fetch(`${base}/api${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: who.cookie, 'X-CSRF-Token': who.csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => null)) as Json, headers: r.headers };
};
async function login(username: string): Promise<Session> {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'correct-horse-3' }) });
  const b = (await r.json()) as Json;
  return { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), csrf: b.csrf };
}

before(async () => {
  createUser({ username: 'boss', display_name: 'Test Boss', password: 'correct-horse-3', role: 'admin' });
  createUser({ username: 'ed', display_name: 'Test Editor', password: 'correct-horse-3', role: 'editor' });
  createUser({ username: 'quill', display_name: 'Quill', password: 'correct-horse-3', role: 'viewer' });
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  boss = await login('boss');
  ed = await login('ed');

  hh = (await call(ed, 'POST', '/households', { name: 'Fernsby household', address: '1 Example Lane', phone: '+65 6000 0001' })).body.id;
  const p = await call(ed, 'POST', '/people', { first_name: 'Quill', last_name: 'Fernsby', native_name: '费秋', email: 'quill@example.org', phone: '+65 9000 0001', birth_date: '1990-02-03', status: 'member', household_id: hh, household_role: 'head', notes: 'Prefers the early service' });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  pid = p.body.id;
  run('UPDATE users SET person_id = ? WHERE username = ?', pid, 'quill');
  const team = Number(run(`INSERT INTO teams (name) VALUES ('{"en":"Ushers"}')`).lastInsertRowid);
  const role = Number(run(`INSERT INTO roles (team_id, name) VALUES (?, '{"en":"Usher"}')`, team).lastInsertRowid);
  run('INSERT INTO role_members (role_id, person_id) VALUES (?, ?)', role, pid);
  run('INSERT INTO team_members_v08 (team_id, person_id, is_leader) VALUES (?, ?, 0)', team, pid);
  run("INSERT INTO unavailability (person_id, start_date, end_date, reason) VALUES (?, '2030-01-01', '2030-01-10', 'Overseas for surgery')", pid);
  run("INSERT INTO coworkers (person_id, position, category) VALUES (?, 'Youth worker', 'ministry_staff')", pid);
  const ps = await call(ed, "POST", "/services", { date: "2026-01-04", title: { en: "Past Sunday" } });
  assert.equal(ps.status, 200, JSON.stringify(ps.body));
  const past = ps.body.service.id;
  // a preacher typed before 0.15.10 (names come from the rota now)
  run('UPDATE services SET preacher = ? WHERE id = ?', NAME, past);
  const future = (await call(ed, 'POST', '/services', { date: '2031-01-05', title: { en: "Future Sunday" } })).body.service.id;
  run("INSERT INTO assignments (service_id, role_id, person_id, status, notes) VALUES (?, ?, ?, 'confirmed', 'Will bring keys')", past, role, pid);
  run("INSERT INTO assignments (service_id, role_id, person_id, status) VALUES (?, ?, ?, 'invited')", future, role, pid);
  await call(ed, 'PATCH', `/people/${pid}`, { phone: '+65 9000 0002' });
  // an old change-log entry that mentions the name, archived
  run("INSERT INTO change_log (at, user_name, via, entity, entity_id, action, name, summary, changes) VALUES ('2018-06-01 10:00:00', 'Someone', 'web', 'people', ?, 'update', ?, NULL, '{\"email\":[\"old@example.org\",\"quill@example.org\"]}')", pid, NAME);
  run("INSERT INTO change_log (at, user_name, via, entity, entity_id, action, name, summary) VALUES ('2018-06-02 10:00:00', 'Someone', 'web', 'settings', NULL, 'update', 'Settings', ?)", `Thanked ${NAME} for the flowers`);
  A.runArchive(false, 5);
});

after(async () => {
  await new Promise((r) => server.close(r));
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('administrators only: export and erase', async () => {
  assert.equal((await call(ed, 'GET', `/people/${pid}/personal-data`)).status, 403);
  assert.equal((await call(ed, 'POST', `/people/${pid}/erase`, { confirm: `${NAME} 费秋` })).status, 403);
});

test('the export holds everything about the member, as a file', async () => {
  const r = await call(boss, 'GET', `/people/${pid}/personal-data`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition') ?? '', /attachment; filename="canon-personal-data-/);
  const d = r.body;
  assert.equal(d.person.email, 'quill@example.org');
  assert.equal(d.household.address, '1 Example Lane');
  assert.equal(d.time_away[0].reason, 'Overseas for surgery');
  assert.equal(d.staff_records[0].position, 'Youth worker');
  assert.equal(d.serving.length, 2);
  assert.equal(d.account.username, 'quill');
  assert.equal(d.account.password_hash, undefined, 'no secrets');
  assert.ok(d.changes.length >= 2);
  assert.equal(d.named_in.services.length, 1, 'typed as the preacher');
  assert.ok(get("SELECT 1 FROM member_views WHERE person_id = ? AND via = 'export'", pid), 'the export is logged');
});

test('erasing needs the name typed; then the member is an anonymous placeholder', async () => {
  assert.equal((await call(boss, 'POST', `/people/${pid}/erase`, { confirm: 'Quill' })).status, 400);
  const r = await call(boss, 'POST', `/people/${pid}/erase`, { confirm: `${NAME} 费秋` });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.future_duties_removed, 1);
  assert.equal(r.body.kept.services, 1);

  const p = get<Json>('SELECT * FROM people WHERE id = ?', pid)!;
  assert.equal(p.first_name, '(erased)');
  for (const k of ['email', 'phone', 'birth_date', 'native_name', 'notes', 'household_id']) assert.equal(p[k], null, k);
  assert.ok(p.erased_at);
  assert.equal(get('SELECT 1 FROM households WHERE id = ?', hh), undefined, 'the household left empty goes');
  assert.equal(all('SELECT * FROM assignments WHERE person_id = ?', pid).length, 1, 'past duty kept, anonymous');
  assert.equal(get<{ notes: string | null }>('SELECT notes FROM assignments WHERE person_id = ?', pid)!.notes, null);
  for (const t of ['role_members', 'team_members_v08', 'unavailability', 'coworkers']) assert.equal(all(`SELECT 1 FROM ${t} WHERE person_id = ?`, pid).length, 0, t);
  assert.equal(get<{ person_id: number | null }>("SELECT person_id FROM users WHERE username = 'quill'")!.person_id, null, 'account unlinked');

  // the change log, live and archived, forgets them
  const live = all<Json>("SELECT * FROM change_log WHERE entity = 'people' AND entity_id = ? AND summary IS NOT 'Personal data erased (PDPA request)'", pid);
  assert.ok(live.every((c) => c.changes === '{}' && !String(c.name).includes('Quill')));
  assert.equal(all("SELECT 1 FROM change_log WHERE instr(IFNULL(changes, '') || IFNULL(summary, '') || IFNULL(name, ''), 'Quill Fernsby') > 0").length, 0);
  const archived = A.archivedChanges(2018, {}) as { rows: Json[] };
  assert.ok(archived.rows.length >= 2);
  assert.ok(archived.rows.every((c) => !JSON.stringify(c).includes('Quill Fernsby') && !JSON.stringify(c).includes('quill@example.org')), JSON.stringify(archived.rows));

  // gone from the register, and can't be edited or erased again
  assert.ok(!(await call(boss, 'GET', '/people')).body.rows.some((x: Json) => x.id === pid));
  assert.equal((await call(ed, 'PATCH', `/people/${pid}`, { first_name: 'Back' })).status, 400);
  assert.equal((await call(boss, 'POST', `/people/${pid}/erase`, { confirm: '(erased)' })).status, 400);
  assert.equal((await call(boss, 'GET', `/people/${pid}/personal-data`)).status, 400);
});
