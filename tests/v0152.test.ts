// 0.15.2: roles archived and restored (not offered for accounts), the attendees' bulletin link (public, without the
// serving team or notes; its QR code on the bulletin and slides), sheet music for songs (stored with backups,
// gone with its song, listed per service in order), and links for others never pointing at "localhost". Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-v0152-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');
delete process.env.CANON_PUBLIC_URL;

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const svc = await import('../server/repo/services.ts');
const lib = await import('../server/repo/library.ts');
const reg = await import('../server/repo/registers.ts');
const { renderService } = await import('../server/repo/render.ts');
const { updateSettings } = await import('../server/repo/settings.ts');
const { addressForOthers, lanAddress } = await import('../server/lib/lan.ts');
const { get, db } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Session = { cookie: string; csrf: string };
let server: Server;
let base = '';
const as: Record<'admin' | 'editor' | 'viewer', Session> = {} as never;

async function login(username: string): Promise<Session> {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'correct-horse-5' }) });
  assert.equal(r.status, 200);
  return { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), csrf: ((await r.json()) as Json).csrf };
}
async function call(who: Session | null, method: string, url: string, body?: unknown, raw?: { type: string; data: Buffer }) {
  const headers: Record<string, string> = { 'Content-Type': raw ? raw.type : 'application/json' };
  if (who) Object.assign(headers, { Cookie: who.cookie, 'X-CSRF-Token': who.csrf });
  const r = await fetch(`${base}/api${url}`, { method, headers, body: raw ? new Uint8Array(raw.data) : body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => null)) as Json };
}

before(async () => {
  for (const role of ['admin', 'editor', 'viewer'] as const) createUser({ username: role, display_name: `Test ${role}`, password: 'correct-horse-5', role });
  server = createApp().listen(0, '127.0.0.1');
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

test('roles: archive one no account has; it is not offered for accounts until restored; the Administrator never', async () => {
  const made = await call(as.admin, 'POST', '/access-roles', { name: { en: 'Musician' }, access: { services: 'read', library: 'read' } });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const key = made.body.key as string;
  const p = reg.people.insert({ first_name: 'Ruth', last_name: 'Example', status: 'member' });

  assert.equal((await call(as.admin, 'PUT', '/access-roles/admin/archived', { archived: true })).status, 400);
  assert.equal((await call(as.editor, 'PUT', `/access-roles/${key}/archived`, { archived: true })).status, 403);
  // in use: give the account another role first
  const u = await call(as.admin, 'POST', '/users', { username: 'ruth', display_name: 'Ruth', password: 'correct-horse-6', role: key, person_id: p.id });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  assert.equal((await call(as.admin, 'PUT', `/access-roles/${key}/archived`, { archived: true })).status, 409);
  assert.equal((await call(as.admin, 'PATCH', `/users/${u.body.id}`, { role: 'viewer' })).status, 200);

  const arch = await call(as.admin, 'PUT', `/access-roles/${key}/archived`, { archived: true });
  assert.equal(arch.status, 200);
  assert.equal(arch.body.archived, true);
  const list = await call(as.admin, 'GET', '/access-roles');
  assert.equal(list.body.roles.find((r: Json) => r.key === key).archived, true);
  // not offered: neither for a new account nor for a change of role
  const p2 = reg.people.insert({ first_name: 'Boaz', last_name: 'Example', status: 'member' });
  assert.equal((await call(as.admin, 'POST', '/users', { username: 'boaz', display_name: 'Boaz', password: 'correct-horse-6', role: key, person_id: p2.id })).status, 400);
  assert.equal((await call(as.admin, 'PATCH', `/users/${u.body.id}`, { role: key })).status, 400);

  assert.equal((await call(as.admin, 'PUT', `/access-roles/${key}/archived`, { archived: false })).body.archived, undefined);
  assert.equal((await call(as.admin, 'PATCH', `/users/${u.body.id}`, { role: key })).status, 200);
  // a ready-made role can be archived too (when unused), and stays undeletable
  assert.equal((await call(as.admin, 'PUT', '/access-roles/keeper/archived', { archived: true })).status, 200);
  assert.equal((await call(as.admin, 'DELETE', '/access-roles/keeper')).status, 400);
  await call(as.admin, 'PUT', '/access-roles/keeper/archived', { archived: false });
});

test('bulletin link for attendees: public, no serving team or notes; QR code on the bulletin and a slide; off = gone', async () => {
  const s = svc.createService({ date: '2031-03-02', title: { en: 'Morning Worship' }, notes: 'Team: arrive 9am' }).service;
  svc.addItem(s.id, { kind: 'announcements', title: { en: 'Announcements' }, notes: 'Mic 2 for the elder', on_slides: true });
  const r = await call(as.editor, 'PUT', `/services/${s.id}/attendee-link`, { enabled: true, bulletin: true, slides: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const token = r.body.token as string;
  assert.match(r.body.url, new RegExp(`/b/${token}$`));
  // a link for others never says "localhost" (or 127.0.0.1) when the computer has a network address
  if (lanAddress()) assert.ok(!/localhost|127\.0\.0\.1/.test(r.body.url), r.body.url);
  assert.equal((await call(as.viewer, 'PUT', `/services/${s.id}/attendee-link`, { enabled: false })).status, 403);

  const pub = await call(null, 'GET', `/bulletin/${token}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.notes, null);
  assert.deepEqual(pub.body.roster, []);
  assert.ok(!JSON.stringify(pub.body).includes('Mic 2') && !JSON.stringify(pub.body).includes('arrive 9am'));
  // the team's share link is a different thing: not on until switched on
  assert.equal((await call(null, 'GET', `/share/${token}`)).status, 404);

  const rr = renderService(s.id);
  assert.ok(rr.bulletin.blocks?.some((b) => b.id === -2 && b.data.value?.endsWith(`/b/${token}`)), 'on the back page');
  // its own slide straight after the title slide (slide 2), not at the Announcements
  assert.ok(!rr.items.some((it) => it.slide_blocks.some((b) => b.id === -2)));
  assert.equal(rr.opening_blocks?.[0]?.id, -2);
  const { buildSlides } = await import('../shared/slide-model.ts');
  const deck = buildSlides(rr, rr.languages);
  assert.deepEqual([deck[0].type, deck[1].key, deck[1].blocks?.[0]?.value], ['title', 'opening', rr.opening_blocks![0].value]);
  // the FreeShow project gets it as a show of its own, first
  const { freeshowProject } = await import('../server/export/freeshow.ts');
  const fs1 = await freeshowProject(rr);
  assert.ok(fs1.project.shows[0].id.endsWith('-0'));
  // a copy of the service has no link of its own
  const copy = svc.duplicateService(s.id, '2031-03-09');
  assert.equal(get<{ a: string }>("SELECT json_extract(attendee, '$.token') AS a FROM services WHERE id = ?", copy.id)?.a ?? null, null);

  await call(as.editor, 'PUT', `/services/${s.id}/attendee-link`, { enabled: false });
  assert.equal((await call(null, 'GET', `/bulletin/${token}`)).status, 404);
  assert.ok(!renderService(s.id).bulletin.blocks?.some((b) => b.id === -2));
});

test('links for others: the public address when set', async () => {
  updateSettings({ public_url: 'https://canon.example.org' } as never);
  try {
    assert.equal(addressForOthers('http://localhost:5018'), 'https://canon.example.org');
    const s = svc.createService({ date: '2031-03-16' }).service;
    const r = await call(as.editor, 'PUT', `/services/${s.id}/attendee-link`, { enabled: true });
    assert.match(r.body.url, /^https:\/\/canon\.example\.org\/b\//);
    assert.equal((await call(as.editor, 'GET', '/link-base')).body.base, 'https://canon.example.org');
  } finally {
    updateSettings({ public_url: '' } as never);
  }
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const PDF = Buffer.from('%PDF-1.4\n% example\n');

test('sheet music: pages in order, checked by content, library edit to change; listed per service; gone with the song', async () => {
  const song = lib.songs.insert({ title: { en: 'A Morning Hymn' }, stanzas: [{ label: '1', text: { en: 'Line' } }, { label: 'R', text: { en: 'Refrain' } }, { label: '2', text: { en: 'Line' } }], category: 'hymn', public_domain: true, tags: [], refrain_after_each: false } as never);
  const up = (who: Session, name: string, type: string, data: Buffer) => call(who, 'POST', `/songs/${song.id}/scores?name=${encodeURIComponent(name)}`, undefined, { type, data });
  assert.equal((await up(as.viewer, 'p1.png', 'image/png', PNG)).status, 403);
  assert.equal((await up(as.editor, 'fake.png', 'image/png', PDF)).status, 400, 'not what its name says');
  assert.equal((await up(as.editor, 'notes.txt', 'text/plain', Buffer.from('hello'))).status, 400);
  let r = await up(as.editor, 'page 1.png', 'image/png', PNG);
  assert.equal(r.status, 200);
  r = await up(as.editor, 'page 2.pdf', 'application/pdf', PDF);
  assert.deepEqual(r.body.map((x: Json) => x.name), ['page 1.png', 'page 2.pdf']);
  const [p1, p2] = r.body as Json[];
  r = await call(as.editor, 'POST', `/songs/scores/${p2.id}/move`, { by: -1 });
  assert.deepEqual(r.body.map((x: Json) => x.id), [p2.id, p1.id]);

  // read-only accounts can open it; the file comes back as stored, never run as a page
  const f = await fetch(`${base}/api/songs/scores/${p1.id}`, { headers: { Cookie: as.viewer.cookie } });
  assert.equal(f.status, 200);
  assert.equal(f.headers.get('content-type'), 'image/png');
  assert.match(f.headers.get('content-security-policy') ?? '', /sandbox/);
  assert.ok(Buffer.from(await f.arrayBuffer()).equals(PNG));
  assert.equal((await fetch(`${base}/api/songs/scores/${p1.id}`)).status, 401, 'signed-in only');
  assert.equal((await call(as.viewer, 'GET', '/songs/scores/counts')).body[song.id], 2);

  // the service's songs in order, with the stanzas sung and their sheet music
  const s = svc.createService({ date: '2031-04-06' }).service;
  const other = lib.songs.insert({ title: { en: 'An Evening Hymn' }, stanzas: [{ label: '1', text: { en: 'Line' } }], category: 'hymn', public_domain: true, tags: [], refrain_after_each: false } as never);
  svc.addItem(s.id, { kind: 'song', ref_id: other.id });
  svc.addItem(s.id, { kind: 'song', ref_id: song.id, stanzas: ['1', '2'] });
  const list = await call(as.viewer, 'GET', `/services/${s.id}/scores`);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.songs.map((x: Json) => [x.song.id, x.scores.length]), [[other.id, 0], [song.id, 2]]);
  assert.deepEqual(list.body.songs[1].stanzas, ['1', '2']);

  // removing a page removes its file; deleting the song removes the rest
  await call(as.editor, 'DELETE', `/songs/scores/${p1.id}`);
  assert.equal(get('SELECT 1 FROM assets WHERE key = ?', `score-${p1.id}`), undefined);
  assert.ok(get('SELECT 1 FROM assets WHERE key = ?', `score-${p2.id}`));
  lib.songs.remove(song.id);
  assert.equal(get('SELECT 1 FROM assets WHERE key = ?', `score-${p2.id}`), undefined);
  assert.equal(get('SELECT 1 FROM song_scores WHERE song_id = ?', song.id), undefined);
});
