// Encryption (0.19.0), a Canon from before it: the database is plain until an administrator presses Encrypt now.
// Then the database is encrypted in place, the recovery key is shown once, and the plain copies Canon holds are
// encrypted too (the copies kept before upgrades and the archived years with the database key, backups and their
// archive copies in the backup format, the plain originals removed). Files Canon didn't make are left alone, named.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-encmig-'));
process.env.CANON_DB = path.join(tmp, 'data', 'canon.db');
process.env.CANON_ENCRYPT = '0';
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
const data = path.dirname(process.env.CANON_DB!);
const backups = path.join(tmp, 'backups');
const MARKER = 'Philippa Fictional-Elder';
const plainIn = (file: string) => fs.readFileSync(file).includes(Buffer.from(MARKER));

async function call(method: string, url: string, body?: unknown) {
  const r = await fetch(`${base}/api${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: admin.cookie, 'X-CSRF-Token': admin.csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => null)) as Json };
}

before(async () => {
  await seed();
  updateSettings({ backup: { ...getSettings().backup, dir: backups } });
  createUser({ username: 'admin', display_name: 'Test admin', password: 'correct-horse-7', role: 'admin' });
  D.run('INSERT INTO people (first_name, last_name) VALUES (?, ?)', 'Philippa', 'Fictional-Elder');
  server = createApp().listen(0, '127.0.0.1');
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

test('Encrypt now: the database, then every plain copy Canon holds; files Canon didn’t make are left alone and named', async () => {
  // a Canon as it was: plain database, a plain backup, a copy from before an upgrade, an archived year with its copy
  assert.equal(D.dbEncrypted(), false);
  const ed = { name: 'Test', admin: true, money: true };
  const s = svc.createService({ date: '2016-05-01' }).service;
  asActor({ user_id: null, user_name: 'Test', via: 'web' }, () => R.saveRecord(s.id, { attendance: 31, counters: [MARKER] }, ed));
  A.runArchive(false, 5);
  const plainBackup = B.createBackup();
  assert.match(plainBackup.name, /\.db$/);
  const pre = path.join(data, 'pre-upgrade', 'canon-v33-before-v35-20261008-120000.db');
  fs.mkdirSync(path.dirname(pre), { recursive: true });
  D.db.exec(`VACUUM INTO '${pre.replace(/'/g, "''")}'`);
  const mine = path.join(backups, 'canon-before-move-20261007.db');
  fs.copyFileSync(plainBackup.path, mine);
  D.db.pragma('wal_checkpoint(TRUNCATE)');
  for (const f of [process.env.CANON_DB!, plainBackup.path, pre, A.archivePath(2016), mine]) assert.equal(plainIn(f), true, `plain before: ${f}`);

  // the banner's status names what is plain
  const st = (await call('GET', '/security/encryption')).body;
  assert.equal(st.encrypted, false);
  assert.ok(st.plain_copies.includes(plainBackup.name) && st.plain_copies.includes(path.basename(pre)) && st.plain_copies.includes('canon-archive-2016.db'));
  assert.ok(st.others.some((f: string) => f.endsWith('canon-before-move-20261007.db')));

  const r = await call('POST', '/security/encryption/encrypt');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.recovery.key, /^([0-9A-Z]{5}-){7}[0-9A-Z]{5}$/);
  assert.equal(r.body.failed.length, 0, JSON.stringify(r.body.failed));
  assert.ok(r.body.others.some((f: string) => f.endsWith('canon-before-move-20261007.db')), 'named, not touched');

  // the database: encrypted, with everything in it
  assert.equal(D.dbEncrypted(), true);
  assert.equal(D.get<{ n: number }>("SELECT COUNT(*) n FROM people WHERE first_name = 'Philippa'")!.n, 1);
  D.db.pragma('wal_checkpoint(TRUNCATE)');
  assert.equal(plainIn(process.env.CANON_DB!), false);
  const keys = K.loadKeys()!;
  // the copy from before an upgrade and the archived year: with the database key
  assert.equal(plainIn(pre), false);
  const p = openDb(pre, { key: keys.db, readonly: true });
  assert.equal((p.prepare("SELECT COUNT(*) n FROM people WHERE first_name = 'Philippa'").get() as { n: number }).n, 1);
  p.close();
  assert.equal(plainIn(A.archivePath(2016)), false);
  assert.equal(A.archivedRecords(2016)[0].attendance, 31);
  // backups: the plain ones replaced by encrypted ones (the safety backup made first too)
  const files = fs.readdirSync(backups).filter((n) => /^canon-\d/.test(n));
  assert.ok(files.length >= 2 && files.every((n) => n.endsWith('.db.enc')), files.join(', '));
  for (const n of files) assert.equal(BF.isBackupV2(path.join(backups, n)), true, n);
  assert.ok(fs.readdirSync(path.join(backups, 'archives')).every((n) => n.endsWith('.enc')));
  // the church's own file is as it was
  assert.equal(plainIn(mine), true);

  // a converted backup restores
  D.run("UPDATE people SET last_name = 'Changed' WHERE first_name = 'Philippa'");
  await B.restoreBackup(path.join(backups, `${plainBackup.name}.enc`));
  assert.equal(D.get<{ last_name: string }>("SELECT last_name FROM people WHERE first_name = 'Philippa'")!.last_name, 'Fictional-Elder');
  assert.equal(D.dbEncrypted(), true);

  // the old plain backup's own file (the church's) still restores into the encrypted database
  await B.restoreBackup(mine);
  assert.equal(D.dbEncrypted(), true);
  D.db.pragma('wal_checkpoint(TRUNCATE)');
  assert.equal(plainIn(process.env.CANON_DB!), false);

  // once is enough
  assert.equal((await call('POST', '/security/encryption/encrypt')).status, 409);
  assert.deepEqual((await call('GET', '/security/encryption')).body.plain_copies, []);
});
