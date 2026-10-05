// Encrypted backups (0.13). When the church sets a backup password (Settings → Backups), every backup — and the
// archive files copied with it — is encrypted with AES-256-GCM using a key made from that password (scrypt).
//
// The key is kept next to the database in data/backup-key.json (not in the database, so never inside a backup), so
// scheduled backups need no one to type the password, and backups restore on this computer without it. Each file
// carries its own salt: on another computer the password alone restores it. Without the password an encrypted
// backup can't be read — by anyone, including the church.
//
// That encryption is wanted is recorded separately, in the database (settings.backup.encrypted): if the key file is
// then missing, damaged or unreadable, backups STOP with a message saying so — they never fall back to plain copies.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.ts';

const MAGIC = Buffer.from('CANONENC1');
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const keyFile = () => path.join(path.dirname(config.dbPath), 'backup-key.json');

const derive = (password: string, salt: Buffer) => crypto.scryptSync(password, salt, 32, SCRYPT);

export class BackupKeyError extends Error {
  status = 409;
}
const keyProblem = (why: string) => new BackupKeyError(`Backups are set to be encrypted, but ${why}. No backup was made. Set the backup password again in Settings → Backups (or turn encryption off there).`);

/**
 * This computer's backup key, or null when there is no key file. A key file that exists but can't be read or is not a
 * valid key throws (BackupKeyError): it never counts as "not encrypted".
 */
export function backupKey(): { salt: Buffer; key: Buffer } | null {
  let text: string;
  try {
    text = fs.readFileSync(keyFile(), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw keyProblem(`the backup key file (${keyFile()}) can't be read (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`);
  }
  try {
    const j = JSON.parse(text) as { salt?: unknown; key?: unknown };
    const salt = typeof j.salt === 'string' ? Buffer.from(j.salt, 'base64') : Buffer.alloc(0);
    const key = typeof j.key === 'string' ? Buffer.from(j.key, 'base64') : Buffer.alloc(0);
    if (salt.length !== 16 || key.length !== 32) throw new Error('bad length');
    return { salt, key };
  } catch {
    throw keyProblem(`the backup key file (${keyFile()}) is damaged`);
  }
}

/**
 * The key to encrypt a new backup with: null = make a plain copy (encryption is off and there is no key file).
 * `wanted` is the church's setting (settings.backup.encrypted); a key file on its own also means encryption is on.
 */
export function keyForBackup(wanted: boolean | undefined): { salt: Buffer; key: Buffer } | null {
  const k = backupKey();
  if (!k && wanted) throw keyProblem(`this computer's backup key file (${keyFile()}) is missing`);
  return k;
}

/** The key file, for status screens: never throws. */
export function backupKeyState(wanted: boolean | undefined): { encrypted: boolean; problem: string | null } {
  try {
    const k = keyForBackup(wanted);
    return { encrypted: !!k, problem: null };
  } catch (e) {
    return { encrypted: true, problem: (e as Error).message };
  }
}

/** Turn encryption on (or change the password): later backups use the new key. */
export function setBackupPassword(password: string) {
  if (password.length < 10) throw Object.assign(new Error('Choose a backup password of at least 10 characters.'), { status: 400 });
  const salt = crypto.randomBytes(16);
  fs.writeFileSync(keyFile(), JSON.stringify({ salt: salt.toString('base64'), key: derive(password, salt).toString('base64'), set_at: new Date().toISOString() }), { mode: 0o600 });
}

/** Turn encryption off: later backups are plain copies again (encrypted ones still need their password). */
export const clearBackupPassword = () => fs.rmSync(keyFile(), { force: true });

export function isEncrypted(file: string): boolean {
  const fd = fs.openSync(file, 'r');
  try {
    const b = Buffer.alloc(MAGIC.length);
    fs.readSync(fd, b, 0, MAGIC.length, 0);
    return b.equals(MAGIC);
  } finally {
    fs.closeSync(fd);
  }
}

/** Encrypt a file: MAGIC | salt (16) | iv (12) | ciphertext | tag (16). */
export function encryptFile(src: string, dest: string, k = backupKey()) {
  if (!k) throw new Error('Backups are not encrypted.');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k.key, iv);
  const body = Buffer.concat([c.update(fs.readFileSync(src)), c.final()]);
  fs.writeFileSync(dest, Buffer.concat([MAGIC, k.salt, iv, body, c.getAuthTag()]));
}

/**
 * Decrypt a file to `dest`. The key: from the password if given, else this computer's key when the file was made
 * with it. Throws (status 400, needs_password) when the password is missing or wrong.
 */
export function decryptFile(src: string, dest: string, password?: string | null) {
  const all = fs.readFileSync(src);
  if (!all.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not an encrypted backup.');
  const salt = all.subarray(MAGIC.length, MAGIC.length + 16);
  const iv = all.subarray(MAGIC.length + 16, MAGIC.length + 28);
  const tag = all.subarray(all.length - 16);
  const body = all.subarray(MAGIC.length + 28, all.length - 16);
  let own: { salt: Buffer; key: Buffer } | null = null;
  try {
    own = backupKey();
  } catch {
    own = null; // a damaged key file: the password still opens it
  }
  const key = password ? derive(password, salt) : own && own.salt.equals(salt) ? own.key : null;
  const need = (msg: string) => Object.assign(new Error(msg), { status: 400, needs_password: true });
  if (!key) throw need('This backup is encrypted with another backup password. Enter that password to restore it.');
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    fs.writeFileSync(dest, Buffer.concat([d.update(body), d.final()]));
  } catch {
    throw need(password ? 'That backup password is not right.' : 'This backup can’t be opened with this computer’s backup key. Enter its backup password.');
  }
}
