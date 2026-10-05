// Encrypted backups (0.13): with a backup password every backup is AES-256-GCM encrypted; this computer's key restores
// its own backups, another password's backups need that password. Fictional data.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-backup-crypto-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

let B: typeof import('../server/repo/backups.ts');
let S: typeof import('../server/repo/settings.ts');
let C: typeof import('../server/lib/backup-crypto.ts');
let D: typeof import('../server/db.ts');

before(async () => {
  B = await import('../server/repo/backups.ts');
  S = await import('../server/repo/settings.ts');
  C = await import('../server/lib/backup-crypto.ts');
  D = await import('../server/db.ts');
  S.updateSettings({ backup: { dir: path.join(tmp, 'store'), auto: 'off', keep: 20 } });
});

let first = ''; // the first encrypted backup (made with the first password)
const songTitle = () => D.get<{ t: string }>("SELECT json_extract(title, '$.en') AS t FROM songs WHERE json_extract(title, '$.en') LIKE 'Crypto Song%'")?.t;

test('a backup password encrypts backups; nothing readable is left behind', () => {
  assert.throws(() => C.setBackupPassword('short'), /10 characters/);
  C.setBackupPassword('first-password-1');
  D.run("INSERT INTO songs (title, stanzas) VALUES ('{\"en\":\"Crypto Song One\"}', '[]')");
  const b = B.createBackup();
  first = b.name;
  assert.match(b.name, /\.db\.enc$/);
  const bytes = fs.readFileSync(b.path);
  assert.equal(bytes.subarray(0, 9).toString(), 'CANONENC1');
  assert.ok(!bytes.includes(Buffer.from('Crypto Song One')), 'the content is not readable');
  assert.ok(!bytes.includes(Buffer.from('SQLite format 3')));
  assert.ok(B.listBackups().some((x) => x.name === b.name), 'listed');
  assert.deepEqual(fs.readdirSync(tmp).filter((n) => n.startsWith('.backup-')), [], 'no plain temporary copy left');
  assert.ok(!fs.readFileSync(C.keyFile(), 'utf8').includes('first-password-1'), 'the password itself is not stored');
});

test('this computer restores its own encrypted backups without the password', async () => {
  const b = { name: first };
  D.run("UPDATE songs SET title = '{\"en\":\"Crypto Song Changed\"}' WHERE json_extract(title, '$.en') = 'Crypto Song One'");
  const r = await B.restoreBackup(path.join(B.backupDir(), b.name));
  assert.equal(songTitle(), 'Crypto Song One');
  assert.match(r.safety, /\.db\.enc$/, 'the safety copy is encrypted too');
  assert.deepEqual(fs.readdirSync(tmp).filter((n) => n.startsWith('.restore-')), [], 'the decrypted copy is removed');
});

test('a backup made with another password needs that password; a wrong one is refused', async () => {
  const oldPath = path.join(B.backupDir(), first);
  C.setBackupPassword('second-password-2');
  await assert.rejects(B.restoreBackup(oldPath), (e: Error & { needs_password?: boolean; status?: number }) => e.needs_password === true && e.status === 400);
  await assert.rejects(B.restoreBackup(oldPath, 'wrong-password-9'), /not right/);
  await B.restoreBackup(oldPath, 'first-password-1');
  assert.equal(songTitle(), 'Crypto Song One');
});

test('an encrypted file from another computer: saved as .db.enc and opened with its password', async () => {
  const src = B.listBackups().find((x) => x.name.endsWith('.enc'))!;
  const data = fs.readFileSync(path.join(B.backupDir(), src.name));
  const up = B.saveUpload(data);
  assert.match(up, /-upload\d*\.db\.enc$/);
  C.clearBackupPassword();
  await assert.rejects(B.withPlainBackup(up, null, (p) => B.checkBackupFile(p)), /encrypted/);
  // the newest backups were made with the second password
  assert.equal(await B.withPlainBackup(up, 'second-password-2', (p) => B.checkBackupFile(p)), null);
});

test('without a password, backups are plain copies again', () => {
  const b = B.createBackup();
  assert.match(b.name, /\.db$/);
  assert.equal(fs.readFileSync(b.path).subarray(0, 15).toString(), 'SQLite format 3');
});
