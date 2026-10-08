// Updating Canon from inside Canon (0.19.4): putting a release's program files in place, and taking them back out if
// the new version can't be prepared. Shared by Canon (server/lib/updates.ts: an administrator presses "Update now")
// and its launcher (scripts/launcher.mjs: installs the new dependencies, rebuilds, and rolls back if that fails).
// Plain JavaScript, so that the launcher can load it without TypeScript.
//
// Two kinds of install:
// - a git clone: the release's tag is fetched from GitHub and checked out (fast-forward only; a copy with changes or
//   commits of its own is left alone, with what to do);
// - a download (the ZIP from GitHub, unpacked): the release's archive is downloaded and its files written over the
//   folder, as the update instructions say to do by hand. The files replaced are kept in .canon-update/previous/
//   until the next update, and files a release no longer has are removed (from the second in-app update on).
// Never touched: the church's data (data/, backups/), this computer's settings (canon.local.*), node_modules/ and the
// built web app (dist/: the launcher rebuilds it).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const REPO = 'moonlight-lupin/canon';
/** Canon's exit code when it stops to have an update installed: the launcher prepares the new version and starts it. */
export const RESTART_FOR_UPDATE = 75;

const KEEP = /^(data|backups|node_modules|dist|\.git|\.canon-update|_workings|\.claude)(\/|$)|^canon\.local\.(bat|sh)$/;
const MAX_ARCHIVE = 200 * 1024 * 1024;

export const stateDir = (root) => path.join(root, '.canon-update');
export const pendingFile = (root) => path.join(stateDir(root), 'pending.json');
const manifestFile = (root) => path.join(stateDir(root), 'files.json');
const previousDir = (root) => path.join(stateDir(root), 'previous');

/** "v0.19.4" or "0.19.4" → [0, 19, 4] (anything after a "-" ignored). */
export function versionParts(v) {
  return String(v ?? '').trim().replace(/^v/i, '').split('-')[0].split('.').map((n) => Number.parseInt(n, 10) || 0);
}
/** < 0 when a is older than b, 0 the same, > 0 newer. */
export function compareVersions(a, b) {
  const x = versionParts(a);
  const y = versionParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** A git clone (and git is there to update it), or a download. */
export function installKind(root) {
  return fs.existsSync(path.join(root, '.git')) ? 'git' : 'download';
}

export function readPending(root) {
  try {
    return JSON.parse(fs.readFileSync(pendingFile(root), 'utf8'));
  } catch {
    return null;
  }
}
export function writePending(root, p) {
  fs.mkdirSync(stateDir(root), { recursive: true });
  fs.writeFileSync(pendingFile(root), JSON.stringify(p, null, 2));
}
export function clearPending(root) {
  fs.rmSync(pendingFile(root), { force: true });
}

// ---------------------------------------------------------------- the release archive (.tar.gz from GitHub)

const cstr = (b) => {
  const i = b.indexOf(0);
  return b.subarray(0, i < 0 ? b.length : i).toString('utf8');
};
const octal = (b) => Number.parseInt(cstr(b).trim() || '0', 8);
const paxPath = (b) => {
  // records "<len> key=value\n"
  for (const rec of b.toString('utf8').split('\n')) {
    const m = /^\d+ path=(.*)$/.exec(rec);
    if (m) return m[1];
  }
  return null;
};

/**
 * The files in a release archive: { name (relative to Canon's folder, "/"-separated), data, mode }. GitHub's archives
 * have one folder at the top (owner-repo-commit), which is left out. Links, devices and anything that would land
 * outside the folder are refused.
 */
export function readTarGz(gz) {
  const tar = zlib.gunzipSync(gz, { maxOutputLength: MAX_ARCHIVE });
  const out = [];
  let longName = null;
  for (let off = 0; off + 512 <= tar.length;) {
    const h = tar.subarray(off, off + 512);
    if (h.every((x) => x === 0)) break;
    const size = octal(h.subarray(124, 136));
    const type = String.fromCharCode(h[156] || 48);
    const body = tar.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'g') continue; // GitHub's comment: the commit
    if (type === 'x') { longName = paxPath(body); continue; }
    if (type === 'L') { longName = cstr(body); continue; }
    const prefix = cstr(h.subarray(345, 500));
    let name = longName ?? (prefix ? `${prefix}/${cstr(h.subarray(0, 100))}` : cstr(h.subarray(0, 100)));
    longName = null;
    if (type === '5') continue; // folders are made as files are written
    if (type !== '0' && type !== '7') throw new Error(`The update archive holds something other than files (${name}): refused.`);
    name = name.replace(/\\/g, '/').split('/').slice(1).join('/'); // the archive's top folder
    if (!name) continue;
    const parts = name.split('/');
    if (path.isAbsolute(name) || /^[a-z]:/i.test(name) || parts.some((p) => p === '..' || p === '')) {
      throw new Error(`The update archive names a file outside Canon's folder (${name}): refused.`);
    }
    out.push({ name, data: Buffer.from(body), mode: octal(h.subarray(100, 108)) });
  }
  if (!out.some((f) => f.name === 'package.json')) throw new Error('The update archive is not a Canon release (no package.json).');
  return out;
}

// ---------------------------------------------------------------- a download: files written over the folder

const copyInto = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
};

/**
 * Write a release's files over the folder. What is replaced or removed is kept in .canon-update/previous/ first, and
 * what is new is listed, so that rollback() can put the folder back as it was. Returns that record (for pending.json).
 */
export function applyFiles(root, files) {
  const prev = previousDir(root);
  fs.rmSync(prev, { recursive: true, force: true });
  fs.mkdirSync(prev, { recursive: true });
  const before = (() => {
    try {
      return JSON.parse(fs.readFileSync(manifestFile(root), 'utf8'));
    } catch {
      return null;
    }
  })();
  if (before) fs.writeFileSync(path.join(stateDir(root), 'files.before.json'), JSON.stringify(before));
  else fs.rmSync(path.join(stateDir(root), 'files.before.json'), { force: true });
  const record = { added: [], removed: [] };
  const names = [];
  try {
    for (const f of files) {
      if (KEEP.test(f.name)) continue;
      names.push(f.name);
      // Windows batch files need CRLF line ends (a git checkout gives them those: .gitattributes)
      if (f.name.endsWith('.bat') && !f.data.includes('\r\n')) f.data = Buffer.from(f.data.toString('utf8').replace(/\r?\n/g, '\r\n'), 'utf8');
      const target = path.join(root, ...f.name.split('/'));
      if (fs.existsSync(target)) {
        if (fs.readFileSync(target).equals(f.data)) continue; // unchanged
        copyInto(target, path.join(prev, ...f.name.split('/')));
      } else record.added.push(f.name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(`${target}.canon-new`, f.data);
      fs.renameSync(`${target}.canon-new`, target);
      // the Mac's launcher must stay runnable
      if (process.platform !== 'win32' && f.mode & 0o111) fs.chmodSync(target, 0o755);
    }
    // files the release no longer has (known from the last in-app update's list)
    const now = new Set(names);
    for (const name of before ?? []) {
      if (now.has(name) || KEEP.test(name)) continue;
      const target = path.join(root, ...name.split('/'));
      if (!fs.existsSync(target)) continue;
      copyInto(target, path.join(prev, ...name.split('/')));
      fs.rmSync(target, { force: true });
      record.removed.push(name);
    }
  } catch (e) {
    rollbackFiles(root, record);
    throw e;
  }
  fs.writeFileSync(manifestFile(root), JSON.stringify(names));
  return record;
}

function rollbackFiles(root, record) {
  for (const name of record.added ?? []) fs.rmSync(path.join(root, ...name.split('/')), { force: true });
  const prev = previousDir(root);
  const walk = (dir) => (fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
    : []);
  for (const f of walk(prev)) copyInto(f, path.join(root, path.relative(prev, f)));
  const before = path.join(stateDir(root), 'files.before.json');
  if (fs.existsSync(before)) fs.copyFileSync(before, manifestFile(root));
  else fs.rmSync(manifestFile(root), { force: true });
}

// ---------------------------------------------------------------- a git clone: the release's tag checked out

const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();

/** Why this clone can't be updated by Canon, or null. */
export function gitProblem(root) {
  try {
    git(root, '--version');
  } catch {
    return 'Canon is a git copy, but git is not installed for the account Canon runs as: install git, or update by hand.';
  }
  try {
    if (git(root, 'status', '--porcelain', '--untracked-files=no')) return 'This copy of Canon has changes of its own (git status lists them): update it with git yourself.';
  } catch (e) {
    return `git could not read this copy of Canon: ${(e.stderr || e.message || '').toString().trim()}`;
  }
  return null;
}

/** Fetch the release's tag and move this copy to it (fast-forward only). Returns what rollback() needs. */
export function applyGit(root, tag, url) {
  const problem = gitProblem(root);
  if (problem) throw new Error(problem);
  const previous = git(root, 'rev-parse', 'HEAD');
  let branch = null;
  try {
    branch = git(root, 'symbolic-ref', '-q', '--short', 'HEAD') || null;
  } catch {
    branch = null; // a detached copy (e.g. checked out at a tag)
  }
  try {
    git(root, 'fetch', '--quiet', '--no-tags', url, `+refs/tags/${tag}:refs/tags/${tag}`);
    try {
      git(root, 'merge-base', '--is-ancestor', previous, `${tag}^{commit}`);
    } catch {
      throw new Error(`This copy of Canon has commits of its own that ${tag} doesn't have: update it with git yourself.`);
    }
    if (branch) git(root, 'merge', '--quiet', '--ff-only', `${tag}^{commit}`);
    else git(root, 'checkout', '--quiet', '--detach', `${tag}^{commit}`);
  } catch (e) {
    throw new Error((e.stderr || e.message || '').toString().trim() || `git could not fetch ${tag}.`);
  }
  return { previous, branch };
}

function rollbackGit(root, g) {
  if (g.branch) git(root, 'reset', '--quiet', '--keep', g.previous);
  else git(root, 'checkout', '--quiet', '--detach', g.previous);
}

/** Put the program files back as they were before the pending update (the launcher, when preparing it failed). */
export function rollback(root, pending = readPending(root)) {
  if (!pending) return false;
  if (pending.git) rollbackGit(root, pending.git);
  if (pending.files) rollbackFiles(root, pending.files);
  return true;
}
