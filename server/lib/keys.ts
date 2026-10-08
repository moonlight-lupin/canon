// Canon's encryption keys (0.19.0). Two random 32-byte keys, kept in keys.json next to the database:
//   - the database key: the live database, the copies kept before an upgrade, and the archived years;
//   - the backup key: backups, which leave this computer (USB drives, Google Drive) — a separate key, so a backup
//     copied off-site and the live database never share one secret.
// Neither is in keys.json as it is. Each is locked to this computer:
//   - Windows: DPAPI, with the Windows account Canon runs as (another account, or the file copied elsewhere, can't);
//   - macOS: the login keychain;
//   - elsewhere (Linux, Docker): with a secret kept outside the data folder (CANON_KEY_FILE, e.g. a Docker secret)
//     when there is one, else the file's own permissions (readable by Canon's user only).
// And each is also locked with the church's RECOVERY KEY: a code shown once (QR code and words to print) that Canon
// never stores. With it, the database opens on another computer or after a Windows account is lost, and any backup
// restores anywhere: each backup carries its backup key locked with the recovery key current when it was made.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.ts';

export type Protection = 'dpapi' | 'keychain' | 'secret' | 'file';
interface Wrapped { db: string; backup: string }
interface KeyFile {
  version: 1;
  protection: Protection;
  /** the keys, locked to this computer */
  machine: Wrapped;
  /** the keys, locked with the recovery key (null until one is made) */
  recovery: (Wrapped & { id: string; made_at: string }) | null;
  /** tells whether keys unlocked here are the right ones (a damaged or foreign key file fails it) */
  check: string;
  created_at: string;
}
export interface Keys { db: Buffer; backup: Buffer }

export const keysFile = () => path.join(path.dirname(config.dbPath), 'keys.json');
export const keysExist = () => fs.existsSync(keysFile());

/** The keys can't be unlocked on this computer (another Windows account, a new computer): the recovery key opens them. */
export class KeysLockedError extends Error {
  status = 423;
}

// ---------------------------------------------------------------- AES-256-GCM, for locking a key with another key

function seal(key: Buffer, data: Buffer, aad: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const body = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}
function open(key: Buffer, sealed: string, aad: string): Buffer {
  const b = Buffer.from(sealed, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]);
}

const checkOf = (k: Keys) => crypto.createHmac('sha256', Buffer.concat([k.db, k.backup])).update('canon-keys-check').digest('hex').slice(0, 32);
const verified = (f: KeyFile, k: Keys): Keys => {
  if (k.db.length !== 32 || k.backup.length !== 32 || checkOf(k) !== f.check) throw new Error('the keys unlocked here are not this Canon’s');
  return k;
};

// ---------------------------------------------------------------- locking to this computer

const SERVICE = () => `Canon (${crypto.createHash('sha256').update(path.resolve(config.dbPath)).digest('hex').slice(0, 12)})`;

/** Windows DPAPI through PowerShell (always there on Windows): each line of input is base64, each line of output too. */
function dpapi(op: 'Protect' | 'Unprotect', items: string[]): string[] {
  const script = [
    'Add-Type -AssemblyName System.Security',
    "$e = [Text.Encoding]::UTF8.GetBytes('Canon key')",
    '$lines = [Console]::In.ReadToEnd().Split("`n") | Where-Object { $_.Trim() }',
    `foreach ($l in $lines) { [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${op}([Convert]::FromBase64String($l.Trim()), $e, 'CurrentUser')) }`,
  ].join('; ');
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input: items.join('\n'), encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/** A secret kept outside the data folder (CANON_KEY_FILE): any file of at least 32 bytes, hashed into a key. */
function secretKey(): Buffer | null {
  const f = process.env.CANON_KEY_FILE;
  if (!f) return null;
  const raw = fs.readFileSync(f);
  if (raw.length < 32) throw new Error(`CANON_KEY_FILE (${f}) must hold at least 32 bytes.`);
  return crypto.createHash('sha256').update(raw).digest();
}

/** How keys are locked on this computer: CANON_KEY_PROTECT overrides (tests use "file"). */
function protectionHere(): Protection {
  const forced = process.env.CANON_KEY_PROTECT as Protection | undefined;
  if (forced) return forced;
  if (process.env.CANON_KEY_FILE) return 'secret';
  if (process.platform === 'win32') return 'dpapi';
  if (process.platform === 'darwin') return 'keychain';
  return 'file';
}

function lockToMachine(p: Protection, keys: Keys): Wrapped {
  if (p === 'dpapi') {
    const [db, backup] = dpapi('Protect', [keys.db.toString('base64'), keys.backup.toString('base64')]);
    return { db, backup };
  }
  if (p === 'keychain') {
    for (const [name, k] of [['db', keys.db], ['backup', keys.backup]] as const) {
      execFileSync('security', ['add-generic-password', '-U', '-s', SERVICE(), '-a', name, '-w', k.toString('hex')], { stdio: 'ignore' });
    }
    return { db: 'keychain', backup: 'keychain' };
  }
  if (p === 'secret') {
    const s = secretKey()!;
    return { db: seal(s, keys.db, 'canon-db'), backup: seal(s, keys.backup, 'canon-backup') };
  }
  return { db: keys.db.toString('base64'), backup: keys.backup.toString('base64') };
}

function unlockOnMachine(f: KeyFile): Keys {
  try {
    if (f.protection === 'dpapi') {
      const [db, backup] = dpapi('Unprotect', [f.machine.db, f.machine.backup]);
      return verified(f, { db: Buffer.from(db, 'base64'), backup: Buffer.from(backup, 'base64') });
    }
    if (f.protection === 'keychain') {
      const read = (name: string) => Buffer.from(execFileSync('security', ['find-generic-password', '-s', SERVICE(), '-a', name, '-w'], { encoding: 'utf8' }).trim(), 'hex');
      return verified(f, { db: read('db'), backup: read('backup') });
    }
    if (f.protection === 'secret') {
      const s = secretKey();
      if (!s) throw new Error('CANON_KEY_FILE is not set');
      return verified(f, { db: open(s, f.machine.db, 'canon-db'), backup: open(s, f.machine.backup, 'canon-backup') });
    }
    return verified(f, { db: Buffer.from(f.machine.db, 'base64'), backup: Buffer.from(f.machine.backup, 'base64') });
  } catch (e) {
    throw new KeysLockedError(`Canon's encryption keys can't be unlocked on this computer (${f.protection}: ${(e as Error).message.split('\n')[0]}). Enter the recovery key to open the database.`);
  }
}

// ---------------------------------------------------------------- the key file

function readFile(): KeyFile {
  return JSON.parse(fs.readFileSync(keysFile(), 'utf8')) as KeyFile;
}
function writeFile(f: KeyFile) {
  const file = keysFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(f, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

let cached: Keys | null = null;

/** The keys (unlocked once, then kept in memory), or null when this Canon isn't encrypted. Throws KeysLockedError. */
export function loadKeys(): Keys | null {
  if (cached) return cached;
  if (!keysExist()) return null;
  cached = unlockOnMachine(readFile());
  return cached;
}

/** New random keys, locked to this computer (no recovery key yet). Refuses to replace keys that exist. */
export function createKeys(): Keys {
  if (keysExist()) throw new Error('Encryption keys exist already.');
  const keys = { db: crypto.randomBytes(32), backup: crypto.randomBytes(32) };
  const protection = protectionHere();
  let machine: Wrapped;
  let used = protection;
  try {
    machine = lockToMachine(protection, keys);
  } catch (e) {
    // no DPAPI or keychain to be had: the file's permissions, said so in Settings → Security & privacy
    console.error(`Encryption: could not use ${protection} (${(e as Error).message.split('\n')[0]}); the keys are protected by the file's permissions.`);
    used = 'file';
    machine = lockToMachine('file', keys);
  }
  writeFile({ version: 1, protection: used, machine, recovery: null, check: checkOf(keys), created_at: new Date().toISOString() });
  cached = keys;
  return keys;
}

// ---------------------------------------------------------------- the recovery key

// Crockford's base32: no I, L, O or U, so it can be read aloud and typed without mix-ups
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const toB32 = (b: Buffer) => {
  let bits = 0;
  let v = 0;
  let out = '';
  for (const x of b) {
    v = (v << 8) | x;
    bits += 8;
    while (bits >= 5) {
      out += B32[(v >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(v << (5 - bits)) & 31];
  return out;
};
const fromB32 = (s: string) => {
  const clean = s.toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0').replace(/[^0-9A-Z]/g, '');
  let bits = 0;
  let v = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) continue;
    v = (v << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((v >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};

/** 25 random bytes = 40 characters, shown in eight groups of five. */
const RECOVERY_BYTES = 25;
const formatRecovery = (b: Buffer) => toB32(b).match(/.{5}/g)!.join('-');
const recoveryWrapKey = (r: Buffer) => Buffer.from(crypto.hkdfSync('sha256', r, 'canon-recovery-v1', 'wrap', 32));
const recoveryId = (w: Buffer) => crypto.createHmac('sha256', w).update('id').digest('hex').slice(0, 8).toUpperCase().replace(/(.{4})/, '$1-');

/** What the church has: whether a recovery key exists, when it was made and its ID (printed on the sheet). */
export function recoveryInfo(): { id: string; made_at: string } | null {
  if (!keysExist()) return null;
  const r = readFile().recovery;
  return r ? { id: r.id, made_at: r.made_at } : null;
}
export const keyProtection = (): Protection | null => (keysExist() ? readFile().protection : null);

/**
 * A new recovery key: the keys are locked with it, and it is returned to be shown ONCE (Canon doesn't keep it). A
 * recovery key made before stops opening the database; backups made before keep needing the one current then.
 */
export function makeRecoveryKey(): { key: string; id: string; made_at: string } {
  const keys = loadKeys();
  if (!keys) throw new Error('This Canon is not encrypted.');
  const r = crypto.randomBytes(RECOVERY_BYTES);
  const w = recoveryWrapKey(r);
  const id = recoveryId(w);
  const made_at = new Date().toISOString();
  const f = readFile();
  writeFile({ ...f, recovery: { id, made_at, db: seal(w, keys.db, 'canon-db'), backup: seal(w, keys.backup, 'canon-backup') } });
  return { key: formatRecovery(r), id, made_at };
}

/** The key that a recovery key (as typed) locks with: null when it can't be one. */
export function recoveryWrap(typed: string): { w: Buffer; id: string } | null {
  const r = fromB32(typed);
  if (r.length !== RECOVERY_BYTES) return null;
  const w = recoveryWrapKey(r);
  return { w, id: recoveryId(w) };
}

/** Check a recovery key against the one on file (a wrong one fails the authentication tag). */
export function checkRecoveryKey(typed: string): boolean {
  const rw = recoveryWrap(typed);
  const rec = keysExist() ? readFile().recovery : null;
  if (!rw || !rec) return false;
  try {
    open(rw.w, rec.db, 'canon-db');
    return true;
  } catch {
    return false;
  }
}

/**
 * Open the keys with the recovery key (this computer can't unlock them: another Windows account, a new computer),
 * then lock them to this computer again, so the next start needs no one.
 */
export function unlockWithRecovery(typed: string): Keys {
  const rw = recoveryWrap(typed);
  const f = readFile();
  if (!rw || !f.recovery) throw new KeysLockedError('That is not the recovery key.');
  let keys: Keys;
  try {
    keys = verified(f, { db: open(rw.w, f.recovery.db, 'canon-db'), backup: open(rw.w, f.recovery.backup, 'canon-backup') });
  } catch {
    throw new KeysLockedError('That is not the recovery key (or not this Canon’s current one).');
  }
  const protection = protectionHere();
  let used = protection;
  let machine: Wrapped;
  try {
    machine = lockToMachine(protection, keys);
  } catch {
    used = 'file';
    machine = lockToMachine('file', keys);
  }
  writeFile({ ...f, protection: used, machine });
  cached = keys;
  return keys;
}

/** For a backup's header: its backup key locked with the current recovery key (null when there is no recovery key). */
export function backupKeyForRecovery(): { id: string; sealed: string } | null {
  const rec = keysExist() ? readFile().recovery : null;
  return rec ? { id: rec.id, sealed: rec.backup } : null;
}
/** A backup key from a backup's header, with the recovery key typed in. */
export function openBackupKey(sealed: string, typed: string): Buffer | null {
  const rw = recoveryWrap(typed);
  if (!rw) return null;
  try {
    return open(rw.w, sealed, 'canon-backup');
  } catch {
    return null;
  }
}

/** Tests: forget the keys held in memory. */
export const forgetKeys = () => { cached = null; };
/** Which computer user the keys are locked to (shown in Settings). */
export const machineAccount = () => `${os.userInfo().username}@${os.hostname()}`;
