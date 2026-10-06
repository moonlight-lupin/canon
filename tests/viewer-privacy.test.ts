// Read-only (viewer) accounts: no members' contact details, notes or reasons for absence, and only the birthday
// (day and month) — on every member route and in services; their searches match names only; AI connections approved
// by a viewer never receive personal data. Editors still see everything. Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-viewer-privacy-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const reg = await import('../server/repo/registers.ts');
const svc = await import('../server/repo/services.ts');
const vol = await import('../server/repo/volunteers.ts');
const { db, run } = await import('../server/db.ts');
const { scrubForViewer } = await import('../server/lib/viewer-scrub.ts');
const { piiFor } = await import('../server/mcp.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Session = { cookie: string; csrf: string };
let server: Server;
let base = '';
const as: Record<'editor' | 'viewer', Session> = {} as never;
const ids: Record<string, number> = {};
const PHONE = '9000 0042';
const EMAIL = 'test.person@example.org';

async function login(username: string): Promise<Session> {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'correct-horse-3' }) });
  assert.equal(r.status, 200);
  return { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), csrf: ((await r.json()) as Json).csrf };
}
const get = async (who: Session, url: string) => {
  const r = await fetch(`${base}/api${url}`, { headers: { Cookie: who.cookie } });
  return { status: r.status, text: await r.text() };
};

before(async () => {
  for (const role of ['editor', 'viewer'] as const) createUser({ username: role, display_name: `Test ${role}`, password: 'correct-horse-3', role });
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const role of ['editor', 'viewer'] as const) as[role] = await login(role);

  const hh = reg.households.insert({ name: 'Test Household', address: '1 Test Lane', phone: PHONE, notes: 'household note' });
  const soon = new Date(Date.now() + 2 * 86400_000);
  const bday = `1985-${String(soon.getUTCMonth() + 1).padStart(2, '0')}-${String(soon.getUTCDate()).padStart(2, '0')}`;
  ids.person = reg.people.insert({
    first_name: 'Test', last_name: 'Person', phone: PHONE, email: EMAIL, address: '1 Test Lane', notes: 'pastoral note',
    birth_date: bday, status: 'member', household_id: hh.id,
  }).id;
  ids.bday = Number(bday.slice(5, 7));
  run('INSERT INTO teams (name) VALUES (?)', JSON.stringify({ en: 'Test Team' }));
  const team = db.prepare('SELECT MAX(id) AS id FROM teams').get() as { id: number };
  run('INSERT INTO roles (team_id, name) VALUES (?, ?)', team.id, JSON.stringify({ en: 'Test Role' }));
  const role = db.prepare('SELECT MAX(id) AS id FROM roles').get() as { id: number };
  ids.service = svc.createService({ date: new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10) }).service.id;
  vol.assign(ids.service, role.id, ids.person);
  vol.unavailability.insert({ person_id: ids.person, start_date: '2030-01-01', end_date: '2030-01-10', reason: 'private reason' });
});

after(async () => {
  await new Promise((r) => server.close(r));
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const SECRETS = [PHONE, EMAIL, '1 Test Lane', 'pastoral note', 'household note', 'private reason'];

test('the filter itself: contact everywhere, notes and birth year on member routes only', () => {
  const p = { name: 'X', phone: '1', email: 'e', address: 'a', notes: 'n', reason: 'r', birth_date: '1990-04-05', nested: [{ phone: '2', ok: 1 }] };
  assert.deepEqual(scrubForViewer(p, true), { name: 'X', birth_date: null, birthday: '04-05', nested: [{ ok: 1 }] });
  assert.deepEqual(scrubForViewer({ notes: 'service note', email: 'e' }, false), { notes: 'service note' });
});

test('viewers: no contact details, notes, reasons or birth years on any member route or service', async () => {
  for (const url of ['/people?limit=100', `/people/${ids.person}`, '/households', '/dashboard', '/unavailability', `/services/${ids.service}`, '/rota', '/teams']) {
    const r = await get(as.viewer, url);
    assert.equal(r.status, 200, url);
    for (const s of SECRETS) assert.ok(!r.text.includes(s), `${url} leaks "${s}"`);
    assert.ok(!r.text.includes('1985-'), `${url} leaks the birth year`);
  }
  const person = JSON.parse((await get(as.viewer, `/people/${ids.person}`)).text);
  assert.equal(person.first_name, 'Test', 'names stay');
  assert.equal(person.birth_date, null);
  assert.match(person.birthday, /^\d{2}-\d{2}$/, 'the birthday (day and month) stays');
});

test('viewers search names only; editors still see and search everything', async () => {
  assert.equal(JSON.parse((await get(as.viewer, `/people?q=${encodeURIComponent('9000 0042')}`)).text).rows.length, 0, 'no match by phone');
  assert.equal(JSON.parse((await get(as.viewer, '/people?q=Person')).text).rows.length, 1, 'match by name');
  assert.equal(JSON.parse((await get(as.editor, `/people?q=${encodeURIComponent('9000 0042')}`)).text).rows.length, 1);
  const ed = await get(as.editor, `/people/${ids.person}`);
  for (const s of [PHONE, EMAIL, 'pastoral note']) assert.ok(ed.text.includes(s), `editor sees "${s}"`);
});

test('AI connections approved by a read-only account never get personal data', () => {
  const cfg = { enabled: true, modules: { members: 'read' } as never, expose_member_pii: true, visitors: 'contact' as const, sheet_music: false };
  assert.equal(piiFor(cfg, 'viewer'), false);
  assert.equal(piiFor(cfg, 'editor'), true);
  assert.equal(piiFor({ ...cfg, expose_member_pii: false }, 'admin'), false);
  // 0.15.1: contact details only while the Members register is on
  assert.equal(piiFor({ ...cfg, modules: { members: 'off' } as never }, 'admin'), false);
});
