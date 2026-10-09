// The setup code (0.19.9): a new Canon (no accounts yet) is set up only by someone who can see where it runs. At
// start-up Canon prints a one-time code in its window and log (Docker: `docker compose logs canon`) and keeps it in
// data/run/setup-code.txt, readable by Canon's own account only; the setup form asks for it. Before, the first person
// to reach a new Canon — over the network, perhaps — became its administrator.
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.ts';
import { get } from '../db.ts';
import { sameSecret } from './safe-equal.ts';

// Crockford's base32: no I, L, O or U, so it can be read off a screen and typed without mix-ups
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let code: string | null = null;

export const setupCodeFile = () => path.join(path.dirname(config.dbPath), 'run', 'setup-code.txt');
const needsSetup = () => get<{ n: number }>('SELECT COUNT(*) n FROM users')!.n === 0;

/** As typed: upper case, no spaces or dashes, the letters that look like digits read as digits. */
const normal = (s: string) => s.toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0').replace(/[^0-9A-Z]/g, '');

function writePrivate(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.rmSync(file, { force: true });
  fs.writeFileSync(file, '', { mode: 0o600 });
  // Windows ignores the mode: only this account may read the file before the code goes in
  if (process.platform === 'win32') {
    try {
      execFileSync('icacls', [file, '/inheritance:r', '/grant:r', `${os.userInfo().username}:F`], { stdio: 'ignore', windowsHide: true });
    } catch (e) {
      console.error('Could not make the setup code file private:', (e as Error).message);
    }
  }
  fs.writeFileSync(file, `${text}\n`, { mode: 0o600 });
}

/**
 * This Canon's setup code, while it has no accounts (null once it has). Made once, and kept across restarts until
 * Canon is set up, so a code someone has already copied stays good.
 */
export function setupCode(): string | null {
  if (!needsSetup()) {
    clearSetupCode();
    return null;
  }
  if (code) return code;
  try {
    const kept = fs.readFileSync(setupCodeFile(), 'utf8').trim();
    if (/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(kept)) code = kept;
  } catch { /* none yet */ }
  if (!code) {
    const bytes = crypto.randomBytes(12);
    code = Array.from(bytes, (b) => B32[b & 31]).join('').replace(/^(.{4})(.{4})(.{4})$/, '$1-$2-$3');
    writePrivate(setupCodeFile(), code);
  }
  return code;
}

/** Is this the setup code (as typed)? */
export function checkSetupCode(typed: unknown): boolean {
  const c = setupCode();
  return !!c && typeof typed === 'string' && sameSecret(normal(typed), normal(c));
}

/** Canon is set up: the code is no longer needed (nor kept). */
export function clearSetupCode() {
  code = null;
  fs.rmSync(setupCodeFile(), { force: true });
}

/** At start-up: a new Canon says how to set it up. */
export function announceSetupCode() {
  const c = setupCode();
  if (!c) return;
  console.log('');
  console.log('  Canon is new. To set it up, open it in a browser and enter this setup code:');
  console.log('');
  console.log(`      ${c}`);
  console.log('');
  console.log(`  (It is also kept in ${setupCodeFile()} until Canon is set up.)`);
  console.log('');
}
