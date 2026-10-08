// Checking for and installing new versions of Canon (0.19.4). Canon asks GitHub for the latest release (once a day
// when that is on, and when an administrator presses "Check now") and tells administrators when there is a newer one.
// On a Windows PC or a Mac, started by start-canon.bat / start-canon.command (the launcher), an administrator can
// install it from About Canon: Canon makes a backup, fetches the release (scripts/updater.mjs), and stops with
// RESTART_FOR_UPDATE; the launcher installs the new dependencies, rebuilds the web app and starts the new version
// (which upgrades the database as every new version does, keeping a copy). If preparing it fails, the launcher puts
// the previous files back and starts the previous version. In Docker, Canon only checks: the image is replaced with
// `docker compose pull`.
import fs from 'node:fs';
import path from 'node:path';
import type { Server } from 'node:http';
import { config } from '../config.ts';
import { getMeta, setMeta } from '../repo/settings.ts';
import { createBackup } from '../repo/backups.ts';
import { logChange } from '../repo/changelog.ts';
import { stop } from './control.ts';
import * as U from '../../scripts/updater.mjs';

export interface Release { version: string; name: string; url: string; notes: string; published_at: string | null; tarball: string }
interface Check { checked_at: string; latest: Release | null; error: string | null }
export interface LastUpdate { from: string; to: string; at: string; ok: boolean; error?: string | null }

const SOURCE = () => (process.env.CANON_UPDATE_SOURCE || 'https://api.github.com').replace(/\/$/, '');
const GIT_URL = () => process.env.CANON_UPDATE_GIT_URL || `https://github.com/${U.REPO}.git`;
const DAY = 24 * 3600_000;

export const currentVersion = () => {
  try {
    return (JSON.parse(fs.readFileSync(path.join(config.root, 'package.json'), 'utf8')) as { version: string }).version;
  } catch {
    return '0.0.0';
  }
};

export const isDocker = () => process.env.CANON_DOCKER === '1' || fs.existsSync('/.dockerenv');
export const installKind = (): 'docker' | 'git' | 'download' => (isDocker() ? 'docker' : U.installKind(config.root));

/** Why this Canon can't install an update itself (null: it can). */
export function whyNot(): 'docker' | 'development' | 'not_launcher' | null {
  if (isDocker()) return 'docker';
  if (process.env.NODE_ENV !== 'production') return 'development';
  // without the launcher nothing would start Canon again after it stops
  if (process.env.CANON_LAUNCHER !== '1') return 'not_launcher';
  return null;
}

export const autoCheck = () => getMeta('updates_auto') !== '0';
export const setAutoCheck = (on: boolean) => setMeta('updates_auto', on ? '1' : '0');

const lastCheck = (): Check | null => {
  try {
    return JSON.parse(getMeta('update_check') ?? 'null') as Check | null;
  } catch {
    return null;
  }
};
export const lastUpdate = (): LastUpdate | null => {
  try {
    return JSON.parse(getMeta('last_update') ?? 'null') as LastUpdate | null;
  } catch {
    return null;
  }
};

/** Ask GitHub for the latest release (published, not a pre-release). */
export async function checkNow(): Promise<Check> {
  let out: Check;
  try {
    const r = await fetch(`${SOURCE()}/repos/${U.REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Canon/${currentVersion()}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(r.status === 404 ? 'No release has been published yet.' : `GitHub answered ${r.status}.`);
    const j = (await r.json()) as { tag_name?: string; name?: string; html_url?: string; body?: string; published_at?: string; tarball_url?: string };
    if (!j.tag_name || !/^v?\d+\.\d+\.\d+/.test(j.tag_name)) throw new Error('GitHub’s answer has no version.');
    out = {
      checked_at: new Date().toISOString(), error: null,
      latest: {
        version: j.tag_name.replace(/^v/i, ''), name: (j.name ?? j.tag_name).slice(0, 200), url: j.html_url ?? `https://github.com/${U.REPO}/releases`,
        notes: (j.body ?? '').slice(0, 20_000), published_at: j.published_at ?? null,
        tarball: j.tarball_url ?? `https://codeload.github.com/${U.REPO}/tar.gz/refs/tags/${j.tag_name}`,
      },
    };
  } catch (e) {
    const msg = (e as Error).name === 'TimeoutError' ? 'GitHub did not answer (is this computer online?).' : (e as Error).message;
    // keep what the last good check found
    out = { checked_at: new Date().toISOString(), latest: lastCheck()?.latest ?? null, error: msg };
  }
  setMeta('update_check', JSON.stringify(out));
  return out;
}

let installing = false;

/** What About Canon shows administrators. */
export function updateStatus() {
  const check = lastCheck();
  const current = currentVersion();
  const latest = check?.latest ?? null;
  return {
    current, kind: installKind(), why_not: whyNot(), auto: autoCheck(), installing,
    checked_at: check?.checked_at ?? null, error: check?.error ?? null,
    latest, newer: !!latest && U.compareVersions(latest.version, current) > 0,
    last: lastUpdate(),
  };
}

let server: Server | null = null;
/** start.ts hands over the server, so that installing can stop it properly. */
export const setUpdateServer = (s: Server) => { server = s; };

/**
 * Install the latest release (an administrator, from About Canon): a backup first, then the program files, then Canon
 * stops for the launcher to prepare and start the new version. Throws (with what to do) when it can't; nothing has
 * changed then.
 */
export async function installUpdate(by: string, expected?: string) {
  const why = whyNot();
  if (why === 'docker') throw Object.assign(new Error('Canon runs in Docker: update it on the server (docker compose pull, then docker compose up -d).'), { status: 400 });
  if (why === 'development') throw Object.assign(new Error('Canon is running in development mode: update it with git.'), { status: 400 });
  if (why === 'not_launcher') throw Object.assign(new Error('Canon wasn’t started with start-canon.bat (or start-canon.command), so it can’t start itself again: update it by hand (docs/UPGRADING.md).'), { status: 400 });
  if (installing) throw Object.assign(new Error('An update is being installed already.'), { status: 409 });
  installing = true;
  try {
    const check = await checkNow();
    const latest = check.latest;
    const current = currentVersion();
    if (!latest) throw Object.assign(new Error(check.error ?? 'No release was found.'), { status: 502 });
    if (U.compareVersions(latest.version, current) <= 0) throw Object.assign(new Error(`Canon ${current} is the latest version.`), { status: 409 });
    if (expected && latest.version !== expected) throw Object.assign(new Error(`The latest version is now ${latest.version}: check again before updating.`), { status: 409 });
    const kind = U.installKind(config.root);
    if (kind === 'git') {
      const problem = U.gitProblem(config.root);
      if (problem) throw Object.assign(new Error(problem), { status: 409 });
    }
    // 1. a backup, as the update instructions ask (an update that can't make one doesn't start)
    let backup: string;
    try {
      backup = path.basename(createBackup().path);
    } catch (e) {
      throw Object.assign(new Error(`Canon couldn’t make a backup first, so it didn’t update: ${(e as Error).message}`), { status: 409 });
    }
    // 2. the program files
    const tag = `v${latest.version}`;
    const pending: U.Pending = { from: current, to: latest.version, kind, at: new Date().toISOString(), by, status: 'installing' };
    if (kind === 'git') {
      pending.git = U.applyGit(config.root, tag, GIT_URL());
    } else {
      const r = await fetch(latest.tarball, { headers: { 'User-Agent': `Canon/${current}` }, signal: AbortSignal.timeout(300_000) });
      if (!r.ok) throw Object.assign(new Error(`The release couldn’t be downloaded (GitHub answered ${r.status}).`), { status: 502 });
      const files = U.readTarGz(Buffer.from(await r.arrayBuffer()));
      const pkg = files.find((f) => f.name === 'package.json');
      const v = (JSON.parse(pkg!.data.toString('utf8')) as { version?: string }).version;
      if (v !== latest.version) throw Object.assign(new Error(`The downloaded release is ${v}, not ${latest.version}: nothing was changed.`), { status: 502 });
      pending.files = U.applyFiles(config.root, files);
    }
    U.writePending(config.root, pending);
    logChange({ entity: 'settings', entity_id: null, action: 'update', summary: `Updating Canon from ${current} to ${latest.version} (backup ${backup} made first)` });
    console.log(`Canon ${latest.version} is in place (backup ${backup}): stopping so that the launcher prepares and starts it.`);
    // 3. stop (after the answer has gone out); the launcher does the rest
    setTimeout(() => {
      if (server) stop(server, `to install Canon ${latest.version}`, U.RESTART_FOR_UPDATE);
      else process.exit(U.RESTART_FOR_UPDATE);
    }, 500);
    return { installing: true, from: current, to: latest.version, backup };
  } catch (e) {
    installing = false;
    throw e;
  }
}

/** At start: how an update the launcher prepared went (it rolls back on failure), for About Canon. */
export function noteUpdateResult() {
  const p = U.readPending(config.root);
  if (!p) return;
  const now = currentVersion();
  const ok = p.status !== 'rolled-back' && U.compareVersions(now, p.to) >= 0;
  const result: LastUpdate = { from: p.from, to: p.to, at: new Date().toISOString(), ok, error: ok ? null : (p.error ?? `Canon is still ${now}.`) };
  setMeta('last_update', JSON.stringify(result));
  logChange({ entity: 'settings', entity_id: null, action: 'update', summary: ok ? `Canon updated from ${p.from} to ${p.to}` : `The update to Canon ${p.to} failed: ${result.error}` });
  console.log(ok ? `Canon was updated from ${p.from} to ${p.to}.` : `The update to Canon ${p.to} failed, and Canon ${now} was started again: ${result.error}`);
  U.clearPending(config.root);
}

/** Once a day (when on), a minute after start: is there a newer version? */
export function startUpdateChecks() {
  if (process.env.NODE_TEST_CONTEXT) return;
  const tick = () => {
    if (!autoCheck()) return;
    const last = lastCheck();
    if (last && Date.now() - Date.parse(last.checked_at) < DAY - 60_000) return;
    void checkNow();
  };
  setTimeout(tick, 60_000).unref();
  setInterval(tick, 3600_000).unref();
}
