// 0.20.2: wrong passwords make the address that typed them wait, not the account's owner signing in from elsewhere;
// guesses from many addresses still make the account wait; an administrator can let a waiting account in. And the
// appearance switch on members' own pages. Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Request } from 'express';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-v0202-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const { createApp } = await import('../server/app.ts');
const { authenticate, createUser, listUsers, ACCOUNT_MAX_FAILED } = await import('../server/auth.ts');
const { db } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let server: Server;
let base = '';
const RIGHT = 'correct-horse-9';
/** A sign-in from this address (no cookies: a browser that never signed in to the account). */
const from = (ip: string) => ({ ip, headers: {} }) as unknown as Request;
/** Settings → User accounts says the account itself is waiting. */
const accountWaits = (username: string) => !!(listUsers().find((u) => u.username === username) as { locked?: unknown } | undefined)?.locked;
const signedIn = (r: unknown) => !!r && typeof r === 'object' && 'user' in r;

before(async () => {
  server = createApp().listen(0, '127.0.0.1');
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

test('wrong passwords from one address make that address wait; the owner still signs in from another', async () => {
  await createUser({ username: 'ruth', display_name: 'Ruth Example', password: RIGHT, role: 'editor' });
  for (let i = 0; i < 8; i++) {
    const r = await authenticate('ruth', `wrong-guess-${i}`, from('203.0.113.5'));
    assert.ok(r === null || 'locked' in r, JSON.stringify(r));
  }
  assert.deepEqual(await authenticate('ruth', RIGHT, from('203.0.113.5')), { locked: true }, 'the guessing address waits, even with the right password');
  assert.ok(signedIn(await authenticate('ruth', RIGHT, from('198.51.100.7'))), 'the owner, elsewhere, is not held up');
  assert.equal(accountWaits('ruth'), false, 'the account itself is not waiting');
});

test(`guesses from many addresses still make the whole account wait (${ACCOUNT_MAX_FAILED} in an hour)`, async () => {
  await createUser({ username: 'boaz', display_name: 'Boaz Example', password: RIGHT, role: 'editor' });
  for (let i = 0; i < ACCOUNT_MAX_FAILED; i++) assert.equal(await authenticate('boaz', `wrong-guess-${i}`, from(`203.0.113.${10 + i}`)), null);
  assert.deepEqual(await authenticate('boaz', RIGHT, from('192.0.2.1')), { locked: true }, 'a new address waits too');
  assert.equal(accountWaits('boaz'), true, 'Settings → User accounts says it is waiting');
});

test('an administrator lets a waiting account in at once', async () => {
  const naomi = await createUser({ username: 'naomi', display_name: 'Naomi Example', password: RIGHT, role: 'editor' });
  await createUser({ username: 'admin', display_name: 'Admin Example', password: RIGHT, role: 'admin' });
  for (let i = 0; i < ACCOUNT_MAX_FAILED; i++) await authenticate('naomi', `wrong-guess-${i}`, from(`203.0.113.${40 + i}`));
  assert.deepEqual(await authenticate('naomi', RIGHT, from('192.0.2.2')), { locked: true });
  const l = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: RIGHT }) });
  const csrf = ((await l.json()) as Json).csrf;
  const cookie = l.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const r = await fetch(`${base}/api/users/${naomi.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf }, body: JSON.stringify({ let_in: true }) });
  assert.equal(r.status, 200, await r.text());
  assert.equal(accountWaits('naomi'), false);
  assert.ok(signedIn(await authenticate('naomi', RIGHT, from('203.0.113.40'))), 'even from an address that guessed');
});

test('members’ own pages (lending library, my claims, the bulletin link) have the appearance switch', () => {
  const read = (p: string) => fs.readFileSync(path.join(import.meta.dirname, '..', p), 'utf8');
  for (const p of ['src/pages/self/SelfService.tsx', 'src/pages/self/Claims.tsx', 'src/outputs/Share.tsx']) assert.match(read(p), /<ThemeSwitch compact \/>/, p);
  assert.match(read('src/components/Layout.tsx'), /<ThemeSwitch \/>/);
});
