// 0.20.1: what an AI assistant is told about a person's own expense claims, the web app's Content-Security-Policy,
// Canon's own confirmation dialog in place of the browser's, Escape closing only the dialog on top, and the
// appearance switch (light / dark / as the computer is). Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-v0201-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');
process.env.CANON_PUBLIC_URL = 'http://127.0.0.1';

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const { updateSettings, getSettings } = await import('../server/repo/settings.ts');
const { TOOLS } = await import('../server/mcp.ts');
const { db } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let server: Server;
let base = '';

before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const ROOT = path.join(import.meta.dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
function sources(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`;
    return e.isDirectory() ? sources(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

test('canon_whoami: a role without book-keeping is told it may still make its own expense claims', async () => {
  const ed = await createUser({ username: 'ed', display_name: 'Editor Example', password: 'correct-horse-7', role: 'editor' });
  const cur = getSettings().mcp;
  updateSettings({ mcp: { ...cur, enabled: true, modules: { ...cur.modules, bookkeeping: 'write' } } });
  const modules = getSettings().modules;
  updateSettings({ modules: { ...modules, bookkeeping: true } } as never);
  try {
    const whoami = TOOLS.find((t) => t.name === 'canon_whoami')!;
    const auth = { user: ed, scopes: new Set(['canon:read', 'canon:write']) };
    const full = (await whoami.handler({ brief: false }, { auth } as never)) as Json;
    assert.ok(full.tools.includes('canon_claims') && full.tools.includes('canon_draft_claim'), 'the claims tools are offered');
    assert.equal(full.modules.bookkeeping.access, 'off', 'the books themselves are not');
    assert.match(String(full.modules.bookkeeping.own), /own expense claims/, `the person's own claims are named: ${JSON.stringify(full.modules.bookkeeping)}`);
    const brief = (await whoami.handler({ brief: true }, { auth } as never)) as Json;
    assert.equal(brief.modules.bookkeeping, undefined);
    assert.equal(brief.own?.bookkeeping, 'write', `brief says so too: ${JSON.stringify(brief)}`);
  } finally {
    updateSettings({ modules } as never);
  }
});

test('the web app is served with a Content-Security-Policy: scripts only from Canon itself', async () => {
  // every response carries it (index.html is served by the same app; without a build, / is Express's own 404)
  const r = await fetch(`${base}/api/about`);
  const csp = r.headers.get('content-security-policy') ?? '';
  const dir = (name: string) => csp.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name} `)) ?? '';
  assert.equal(dir('script-src'), "script-src 'self'", csp);
  assert.equal(dir('object-src') !== '' || dir('default-src') === "default-src 'self'", true, csp);
  assert.match(dir('frame-ancestors'), /'self'/, csp);
  assert.match(dir('base-uri'), /'self'|'none'/, csp);
  // the pages with a policy of their own keep it
  const v = await fetch(`${base}/v/not-a-real-form`);
  assert.match(v.headers.get('content-security-policy') ?? '', /default-src 'none'/);
});

test('index.html loads no inline script (the policy would block it) and sets the appearance before the page shows', () => {
  const html = read('index.html');
  for (const m of html.matchAll(/<script\b([^>]*)>([^]*?)<\/script>/g)) {
    assert.match(m[1], /\bsrc=/, `an inline script in index.html: ${m[0]}`);
    assert.equal(m[2].trim(), '');
  }
  assert.match(html, /<script src="\/theme\.js"><\/script>[^]*<\/head>/, 'the appearance is set in <head>, before the first paint');
  const js = read('public/theme.js');
  assert.match(js, /canon\.theme/);
});

test('no browser pop-ups: every confirmation is Canon’s own dialog', () => {
  const offenders = sources('src').filter((p) => /\bwindow\.confirm\s*\(|(^|[^\w.])confirm\s*\(/m.test(read(p).replace(/\/\/.*$/gm, '')));
  assert.deepEqual(offenders, [], 'window.confirm (or a bare confirm()) still used');
  // confirmAction answers later (a dialog): a caller that doesn't wait for it would go ahead at once
  const sync = sources('src').flatMap((p) => read(p).split('\n').map((l, i) => ({ p, i: i + 1, l }))).filter(({ l }) => /confirmAction\(/.test(l) && !/await confirmAction\(|export (async )?function confirmAction|import /.test(l));
  assert.deepEqual(sync.map((x) => `${x.p}:${x.i}`), [], 'confirmAction used without await');
});

test('Escape closes only the dialog on top', async () => {
  const { modalStack } = await import('../src/components/modal-stack.ts');
  const closed: string[] = [];
  const a = modalStack.push(() => closed.push('a'));
  const b = modalStack.push(() => closed.push('b'));
  assert.equal(modalStack.escape(), true);
  assert.deepEqual(closed, ['b'], 'the dialog underneath stays open');
  modalStack.remove(b);
  modalStack.escape();
  assert.deepEqual(closed, ['b', 'a']);
  modalStack.remove(a);
  assert.equal(modalStack.escape(), false, 'nothing open: Escape is left to the page');
});

test('dark mode: every colour the app uses is given for dark too, and the choice follows the switch', () => {
  const css = read('src/styles.css');
  const block = (sel: RegExp) => {
    const m = css.match(sel);
    assert.ok(m, `no block ${sel}`);
    return new Set([...m![1].matchAll(/(--[\w-]+)\s*:\s*(#|rgb)/g)].map((x) => x[1]));
  };
  const light = block(/:root\s*\{([^}]*)\}/);
  const dark = block(/:root\[data-theme='dark'\]\s*\{([^}]*)\}/);
  assert.deepEqual([...light].filter((v) => !dark.has(v)), [], 'colours without a dark value');
  assert.doesNotMatch(css, /prefers-color-scheme/, 'the switch decides (theme.js follows the computer when asked to), not a media query of its own');
});
