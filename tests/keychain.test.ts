// Encryption keys in the macOS keychain (0.19.0), with the real `security` command — on macOS only (CI runs it on a
// Mac). A throwaway keychain file (CANON_KEYCHAIN) keeps the test away from the login keychain of whoever runs it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mac = process.platform === 'darwin';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-keychain-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');
delete process.env.CANON_KEY_PROTECT;
delete process.env.CANON_KEY_FILE;
const K = await import('../server/lib/keys.ts');
const { openDb } = await import('../server/lib/sqlite.ts');

const keychain = path.join(tmp, 'canon-test.keychain-db');
const security = (...args: string[]) => execFileSync('security', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
// the item's name, as Canon makes it: "Canon (<the database's path, hashed>)"
const service = `Canon (${crypto.createHash('sha256').update(path.resolve(process.env.CANON_DB!)).digest('hex').slice(0, 12)})`;
const inKeychain = (name: string) => {
  try {
    return security('find-generic-password', '-s', service, '-a', name, '-w', keychain).trim();
  } catch {
    return null;
  }
};

after(() => {
  if (mac) {
    try {
      security('delete-keychain', keychain);
    } catch { /* already gone */ }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('macOS: the keys go into the keychain (never into keys.json, never on a command line), unlock again, and a lost keychain item opens with the recovery key', { skip: !mac && 'macOS only' }, () => {
  security('create-keychain', '-p', 'throwaway-test-keychain', keychain);
  security('unlock-keychain', '-p', 'throwaway-test-keychain', keychain);
  security('set-keychain-settings', keychain); // no lock after a timeout during the test
  process.env.CANON_KEYCHAIN = keychain;

  // made: in the keychain, and keys.json says only where they are
  const keys = K.createKeys();
  assert.equal(K.keyProtection(), 'keychain');
  const file = fs.readFileSync(K.keysFile(), 'utf8');
  assert.deepEqual(JSON.parse(file).machine, { db: 'keychain', backup: 'keychain' });
  assert.ok(!file.includes(keys.db.toString('hex')) && !file.includes(keys.db.toString('base64')));
  assert.equal(inKeychain('db'), keys.db.toString('hex'));
  assert.equal(inKeychain('backup'), keys.backup.toString('hex'));

  // Canon started again: unlocked from the keychain, and the database opens with the key
  K.forgetKeys();
  const again = K.loadKeys()!;
  assert.ok(again.db.equals(keys.db) && again.backup.equals(keys.backup));
  const d = openDb(process.env.CANON_DB!, { key: again.db });
  d.exec("CREATE TABLE t (x TEXT); INSERT INTO t VALUES ('kept')");
  d.close();

  // on another Mac (the keychain item isn't there): locked, until the recovery key puts it back
  const recovery = K.makeRecoveryKey().key;
  security('delete-generic-password', '-s', service, '-a', 'db', keychain);
  assert.equal(inKeychain('db'), null);
  K.forgetKeys();
  assert.throws(() => K.loadKeys(), (e: Error) => e instanceof K.KeysLockedError);
  const back = K.unlockWithRecovery(recovery);
  assert.ok(back.db.equals(keys.db));
  assert.equal(inKeychain('db'), keys.db.toString('hex'), 'back in the keychain');
  K.forgetKeys();
  const e = openDb(process.env.CANON_DB!, { key: K.loadKeys()!.db, readonly: true });
  assert.equal((e.prepare('SELECT x FROM t').get() as { x: string }).x, 'kept');
  e.close();
});
