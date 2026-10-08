// Canon's launcher (0.19.4), started by start-canon.bat (Windows, also as the background task) and
// start-canon.command (Mac). It:
// - prepares Canon: checks Node.js, installs dependencies and rebuilds the web app when they changed
//   (scripts/startup-check.mjs), and imports the Bible on the very first start;
// - starts Canon, and starts it again if it stops by itself (an error): after 10 seconds, at most 10 times in a row
//   (in the background it never gives up: it waits five minutes and begins again);
// - when Canon stops to have an update installed (exit code 75, server/lib/updates.ts), prepares the new version and
//   starts it — and if preparing it fails, puts the previous version's files back and starts that (scripts/updater.mjs);
// - stops for good when Canon is stopped on purpose (exit code 0: the tray icon's Exit) or with Ctrl+C / the window
//   closed.
// It replaces the loop that used to be in start-canon.bat: an update may replace start-canon.bat while it runs, and
// Windows reads a batch file line by line as it goes, so the batch file only hands over to this launcher, on one line.
// Plain JavaScript (not TypeScript), like startup-check.mjs.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESTART_FOR_UPDATE, readPending, rollback, writePending } from './updater.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const background = !!process.env.CANON_BACKGROUND;
const port = process.env.CANON_PORT || '3000';
const dbFile = path.resolve(root, process.env.CANON_DB || path.join('data', 'canon.db'));
const logDir = path.join(path.dirname(dbFile), 'logs');
const mac = process.platform === 'darwin';
// for tests only: a stand-in for Canon, and for the preparing step
const serverArgs = process.env.CANON_LAUNCHER_SERVER ? [process.env.CANON_LAUNCHER_SERVER] : ['--disable-warning=ExperimentalWarning', 'server/index.ts'];
const checkArgs = process.env.CANON_LAUNCHER_CHECK ? [process.env.CANON_LAUNCHER_CHECK] : ['scripts/startup-check.mjs'];

const note = (line) => {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'launcher.log'), `${new Date().toISOString()} ${line}\n`);
  } catch { /* the log is a help, not a must */ }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- stopping for good: Ctrl+C, the window closed

let stopping = false;
let child = null;
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) {
  process.on(sig, () => {
    stopping = true;
    // on Windows the console sends Ctrl+C to Canon too; elsewhere pass it on
    if (child && process.platform !== 'win32') child.kill(sig === 'SIGBREAK' ? 'SIGTERM' : sig);
    if (!child) process.exit(0);
  });
}

// the Mac stays awake (and Canon reachable) while the launcher runs; the screen may still sleep
if (mac) {
  try {
    spawn('caffeinate', ['-is', '-w', String(process.pid)], { stdio: 'ignore', detached: true }).unref();
  } catch { /* no caffeinate: nothing to do */ }
}

// ---------------------------------------------------------------- preparing

/** startup-check (Node.js, dependencies, the web app) and, the first time, the Bible. */
function prepare() {
  const r = spawnSync(process.execPath, checkArgs, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) return false;
  if (!fs.existsSync(dbFile) && !process.env.CANON_LAUNCHER_CHECK) {
    const b = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/import-bible.ts'], { cwd: root, stdio: 'inherit' });
    if (b.status !== 0) return false;
  }
  return true;
}

/** Prepare; after an update that can't be prepared, put the previous version back and prepare that. */
function prepareOrRollBack() {
  if (prepare()) return true;
  const p = readPending(root);
  if (!p || p.status !== 'installing') return false;
  console.error(`\nCanon ${p.to} could not be prepared: going back to Canon ${p.from}.`);
  note(`Canon ${p.to} could not be prepared (see above); going back to ${p.from}`);
  try {
    rollback(root, p);
    writePending(root, { ...p, status: 'rolled-back', error: 'Its dependencies could not be installed or its web app built (see the Canon window, or data/logs).' });
  } catch (e) {
    console.error(`Going back failed too: ${e.message}`);
    note(`going back failed: ${e.message}`);
    return false;
  }
  return prepare();
}

function lanAddress() {
  const r = spawnSync(process.execPath, ['scripts/lan-address.mjs'], { cwd: root, encoding: 'utf8' });
  const first = (r.stdout || '').split(/\r?\n/).find(Boolean);
  if (first) return first;
  if (mac) {
    const n = spawnSync('scutil', ['--get', 'LocalHostName'], { encoding: 'utf8' });
    if (n.stdout?.trim()) return `${n.stdout.trim()}.local`;
  }
  return process.env.COMPUTERNAME || os.hostname();
}

function welcome() {
  const here = mac ? 'this Mac' : 'this PC';
  console.log(`\nCanon is starting. Open http://localhost:${port} on ${here},`);
  console.log(`or http://${lanAddress()}:${port} from other computers on the office network.`);
  if (!background) console.log('Keep this window open while Canon is in use.');
  console.log('');
}

// ---------------------------------------------------------------- running

function runCanon() {
  return new Promise((resolve) => {
    child = spawn(process.execPath, serverArgs, {
      cwd: root, stdio: 'inherit',
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'production', CANON_LAUNCHER: '1' },
    });
    child.on('error', (e) => { console.error(e.message); child = null; resolve(1); });
    child.on('exit', (code, signal) => { child = null; resolve(code ?? (signal ? 130 : 1)); });
  });
}

async function main() {
  if (!prepareOrRollBack()) {
    console.error('\nSomething went wrong - see the messages above. Your data has not been changed.');
    note('Canon could not be prepared (see the messages in its window)');
    return 1;
  }
  welcome();
  let restarts = 0;
  for (;;) {
    const code = await runCanon();
    if (stopping || code === 0) {
      console.log('\nCanon has stopped.');
      return 0;
    }
    if (code === RESTART_FOR_UPDATE) {
      console.log('\nInstalling the update: preparing the new version…');
      note('Canon stopped to have an update installed');
      restarts = 0;
      if (!prepareOrRollBack()) {
        console.error('\nSomething went wrong - see the messages above. Your data has not been changed.');
        note('the update could not be prepared, nor the previous version');
        return 1;
      }
      continue;
    }
    restarts++;
    if (restarts > 10) {
      if (!background) {
        console.error('\nCanon stopped unexpectedly 10 times, so it was not started again. See data/logs for why.');
        return 1;
      }
      // in the background nobody would see that it gave up: wait five minutes and begin again
      note('Canon stopped unexpectedly 10 times; trying again in 5 minutes');
      await sleep(300_000);
      restarts = 0;
      continue;
    }
    console.error('\nCanon stopped unexpectedly. Starting it again in 10 seconds (see data/logs for why)...');
    note('Canon stopped unexpectedly and was started again');
    await sleep(Number(process.env.CANON_LAUNCHER_PAUSE || 10_000));
    if (stopping) return 0;
  }
}

process.exit(await main());
