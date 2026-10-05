// Run by start-canon.bat before Canon starts, so that updating Canon is: replace the files, double-click start.
// - refuses a Node.js that is too old (with what to do), before anything else runs;
// - installs dependencies when package-lock.json changed since they were last installed;
// - rebuilds the web app when its source changed since the last build.
// Plain JavaScript (not TypeScript) so that it can still explain itself on an old Node.js.
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// ---------------------------------------------------------------- Node.js version
const want = (pkg.engines?.node ?? '>=24').replace(/^>=\s*/, '').split('.').map(Number);
const have = process.versions.node.split('.').map(Number);
const older = have[0] !== want[0] ? have[0] < want[0] : (have[1] ?? 0) < (want[1] ?? 0);
if (older) {
  console.error(`\nCanon ${pkg.version} needs Node.js ${want.join('.')} or newer; this computer has ${process.versions.node}.`);
  console.error('Install the current "LTS" version from https://nodejs.org, then start Canon again. Your data has not been touched.\n');
  process.exit(1);
}

// ---------------------------------------------------------------- fingerprints
const hashFiles = (files) => {
  const h = createHash('sha256');
  for (const f of files.sort()) {
    h.update(path.relative(root, f).replaceAll('\\', '/'));
    h.update(fs.readFileSync(f));
  }
  return h.digest('hex').slice(0, 16);
};
const walk = (dir) => fs.existsSync(dir)
  ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
  : [];
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : null);
const run = (cmd) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd: root, stdio: 'inherit' });
};

// dependencies: package-lock.json is what npm installs from
const lock = path.join(root, 'package-lock.json');
const depsStamp = path.join(root, 'node_modules', '.canon-installed');
const deps = hashFiles([lock, path.join(root, 'package.json')].filter((f) => fs.existsSync(f)));
if (read(depsStamp) !== deps) {
  console.log(fs.existsSync(path.join(root, 'node_modules')) ? 'Canon was updated: installing its new dependencies…' : 'First start: installing Canon\'s dependencies…');
  run('npm install --no-audit --no-fund');
  fs.mkdirSync(path.dirname(depsStamp), { recursive: true });
  fs.writeFileSync(depsStamp, deps);
}

// the web app: everything vite builds from
const buildStamp = path.join(root, 'dist', '.canon-build');
const sources = [
  ...walk(path.join(root, 'src')), ...walk(path.join(root, 'shared')), ...walk(path.join(root, 'public')),
  ...['docs/guide/en.md', 'docs/guide/zh.md', 'index.html', 'vite.config.ts', 'package.json', 'package-lock.json', 'tsconfig.json']
    .map((f) => path.join(root, f)).filter((f) => fs.existsSync(f)),
].filter((f) => !/\.generated\.|zh-Hant\.md$/.test(f)); // made by the build itself (npm run i18n)
const build = `${pkg.version} ${hashFiles(sources)}`;
if (read(buildStamp) !== build) {
  console.log(fs.existsSync(path.join(root, 'dist')) ? `Canon was updated (now ${pkg.version}): rebuilding the web app…` : 'First start: building the web app…');
  run('npm run build');
  fs.mkdirSync(path.dirname(buildStamp), { recursive: true });
  fs.writeFileSync(buildStamp, build);
}
