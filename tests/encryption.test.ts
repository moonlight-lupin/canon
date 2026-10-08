// Encryption (0.19.0), a new Canon: the database is encrypted from its first start (keys made before anything is
// written), the recovery key is made once and shown once (a new one needs the administrator's password), backups
// are encrypted with their own key and restore here by themselves and elsewhere with the recovery key, archived
// years are encrypted too, and keys that can't be unlocked on this computer are opened with the recovery key.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-enc-'));
process.env.CANON_DB = path.join(tmp, 'data', 'canon.db');
process.env.CANON_ENCRYPT = '1';
process.env.CANON_KEY_PROTECT = 'file';

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const { seed } = await import('../server/seed/index.ts');
const { updateSettings, getSettings } = await import('../server/repo/settings.ts');
const D = await import('../server/db.ts');
const K = await import('../server/lib/keys.ts');
const BF = await import('../server/lib/backup-file.ts');
const B = await import('../server/repo/backups.ts');
const A = await import('../server/repo/archive.ts');
const svc = await import('../server/repo/services.ts');
const R = await import('../server/repo/records.ts');
const { asActor } = await import('../server/lib/actor.ts');
const { openDb } = await import('../server/lib/sqlite.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let server: Server;
let base = '';
let admin = { cookie: '', csrf: '' };
const backups = path.join(tmp, 'backups');

async function call(method: string, url: string, body?: unknown) {
  const r = await fetch(`${base}/api${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: admin.cookie, 'X-CSRF-Token': admin.csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => null)) as Json };
}
const MARKER = 'Zebediah Fictional-Member';
const plainIn = (file: string) => fs.readFileSync(file).includes(Buffer.from(MARKER));

before(async () => {
  await seed();
  updateSettings({ backup: { ...getSettings().backup, dir: backups } });
  createUser({ username: 'admin', display_name: 'Test admin', password: 'correct-horse-7', role: 'admin' });
  D.run('INSERT INTO people (first_name, last_name) VALUES (?, ?)', 'Zebediah', 'Fictional-Member');
  server = createApp().listen(0, '127.0.0.1');
  // slow steps (encrypting, backups) under a full parallel test run: idle connections stay open for the next request
  server.keepAliveTimeout = 120_000;
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'correct-horse-7' }) });
  admin = { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), csrf: ((await r.json()) as Json).csrf };
});
after(() => {
  server.close();
  try {
    D.closeDb();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

let recovery = '';

test('a new Canon is encrypted from its first start: nothing readable in the file, nor in its write-ahead log', () => {
  assert.equal(D.dbEncrypted(), true);
  D.db.pragma('wal_checkpoint(TRUNCATE)');
  assert.equal(plainIn(process.env.CANON_DB!), false);
  assert.notEqual(fs.readFileSync(process.env.CANON_DB!).subarray(0, 15).toString(), 'SQLite format 3');
  assert.throws(() => openDb(process.env.CANON_DB!).prepare('SELECT * FROM people').all(), /not a database/, 'without the key it is not a database');
  const keyFile = fs.readFileSync(K.keysFile(), 'utf8');
  assert.ok(!keyFile.includes(K.loadKeys()!.db.toString('hex')), 'the key file holds no hex key');
});

test('the recovery key: made once and shown once (QR code too); a new one needs the password; the old one stops working', async () => {
  let st = (await call('GET', '/security/encryption')).body;
  assert.equal(st.encrypted, true);
  assert.equal(st.recovery, null, 'none until it is made (onboarding)');
  const first = (await call('POST', '/security/recovery-key', {})).body;
  assert.match(first.key, /^([0-9A-Z]{5}-){7}[0-9A-Z]{5}$/);
  assert.match(first.qr, /^data:image\/png;base64,/);
  st = (await call('GET', '/security/encryption')).body;
  assert.equal(st.recovery.id, first.id);
  assert.ok(!JSON.stringify(st).includes(first.key), 'never shown again');
  assert.ok(!fs.readFileSync(K.keysFile(), 'utf8').includes(first.key), 'never stored');
  assert.equal((await call('POST', '/security/recovery-key', {})).status, 400, 'a new one needs the password');
  assert.equal((await call('POST', '/security/recovery-key', { password: 'wrong-password' })).status, 403);
  const second = (await call('POST', '/security/recovery-key', { password: 'correct-horse-7' })).body;
  assert.notEqual(second.key, first.key);
  assert.equal(K.checkRecoveryKey(first.key), false);
  assert.equal(K.checkRecoveryKey(second.key), true);
  recovery = second.key;
});

test('backups: encrypted with their own key; restore here by themselves, and on another computer with the recovery key', async () => {
  const b = B.createBackup();
  assert.match(b.name, /\.db\.enc$/);
  assert.equal(BF.isBackupV2(b.path), true);
  assert.equal(plainIn(b.path), false);
  const { header } = BF.readHeader(b.path);
  assert.equal(header.recovery!.id, K.recoveryInfo()!.id, 'it names the recovery key that opens it');
  // not with the database's own key: a separate key
  const scratch = path.join(tmp, 'peek.db');
  const keys = K.loadKeys()!;
  assert.ok(!keys.db.equals(keys.backup));
  assert.equal(BF.unwrapBackupFile(b.path, scratch, keys).equals(keys.backup), true);
  assert.throws(() => openDb(scratch, { key: keys.db, readonly: true }), /not a database/);
  fs.rmSync(scratch, { force: true });
  // another computer: its own keys don't open it; the recovery key does
  const other = { db: crypto.randomBytes(32), backup: crypto.randomBytes(32) };
  assert.throws(() => BF.unwrapBackupFile(b.path, scratch, other), (e: Error & { needs_recovery?: boolean }) => !!e.needs_recovery);
  assert.throws(() => BF.unwrapBackupFile(b.path, scratch, other, 'AAAAA-AAAAA-AAAAA-AAAAA-AAAAA-AAAAA-AAAAA-AAAAA'), /not the recovery key/);
  assert.equal(BF.unwrapBackupFile(b.path, scratch, other, recovery).equals(keys.backup), true);
  fs.rmSync(scratch, { force: true });
  // restored here: the data as it was, the database still encrypted
  D.run("UPDATE people SET last_name = 'Changed' WHERE first_name = 'Zebediah'");
  await B.restoreBackup(b.path);
  assert.equal(D.get<{ last_name: string }>("SELECT last_name FROM people WHERE first_name = 'Zebediah'")!.last_name, 'Fictional-Member');
  assert.equal(D.dbEncrypted(), true);
  D.db.pragma('wal_checkpoint(TRUNCATE)');
  assert.equal(plainIn(process.env.CANON_DB!), false);
  // the safety backup made before restoring is encrypted too
  assert.ok(B.listBackups().every((x) => x.name.endsWith('.db.enc')));
});

test('a backup made under an earlier recovery key still restores with that one', async () => {
  const older = recovery;
  const b = B.createBackup();
  const newer = (await call('POST', '/security/recovery-key', { password: 'correct-horse-7' })).body.key;
  const other = { db: crypto.randomBytes(32), backup: crypto.randomBytes(32) };
  const scratch = path.join(tmp, 'peek2.db');
  assert.throws(() => BF.unwrapBackupFile(b.path, scratch, other, newer), /not the recovery key/);
  assert.ok(BF.unwrapBackupFile(b.path, scratch, other, older));
  fs.rmSync(scratch, { force: true });
  recovery = newer;
});

test('archived years are encrypted with the database, and so are their copies with backups', () => {
  const ed = { name: 'Test', admin: true, money: true };
  const s = svc.createService({ date: '2016-03-06' }).service;
  asActor({ user_id: null, user_name: 'Test', via: 'web' }, () => R.saveRecord(s.id, { attendance: 44, counters: ['Zebediah Fictional-Member'] }, ed));
  A.runArchive(false, 5);
  const file = A.archivePath(2016);
  assert.equal(plainIn(file), false);
  assert.equal(A.archivedRecords(2016)[0].attendance, 44, 'read with the database key');
  assert.equal(A.copyArchivesTo(backups), 1);
  const copy = path.join(backups, 'archives', 'canon-archive-2016.db.enc');
  assert.equal(BF.isBackupV2(copy), true);
  assert.equal(plainIn(copy), false);
});

test('keys this computer can no longer unlock open with the recovery key, and are locked to it again', () => {
  const k = JSON.parse(fs.readFileSync(K.keysFile(), 'utf8'));
  const before = K.loadKeys()!;
  k.machine.db = Buffer.from('another computer').toString('base64');
  fs.writeFileSync(K.keysFile(), JSON.stringify(k));
  K.forgetKeys();
  assert.throws(() => K.loadKeys(), (e: Error) => e instanceof K.KeysLockedError);
  assert.throws(() => K.unlockWithRecovery('AAAAA-AAAAA-AAAAA-AAAAA-AAAAA-AAAAA-AAAAA-AAAAA'), /not the recovery key/);
  const keys = K.unlockWithRecovery(recovery.toLowerCase());
  assert.ok(keys.db.equals(before.db));
  K.forgetKeys();
  assert.ok(K.loadKeys()!.db.equals(before.db), 'unlocks by itself again');
});
