// Canon locked (0.19.0): the database is encrypted, but its keys can't be unlocked on this computer — Canon runs as
// another Windows account than the one that locked them, or the data was moved to a new computer. Instead of the
// app, a single page asks for the recovery key, on this computer only (the key is never sent over the network).
// With the right key, the keys are locked to this computer again and Canon starts as usual.
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.ts';
import { unlockWithRecovery } from './keys.ts';

const isLocal = (req: http.IncomingMessage) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') && !req.headers['x-forwarded-for'];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function page(body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Canon is locked</title>
<style>
  :root { color-scheme: light dark; --ink: #1e2430; --paper: #f3eee2; --reed: #a8893c; --danger: #a33a2a; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--paper); color: var(--ink); font: 15px/1.5 'Segoe UI', system-ui, sans-serif; }
  @media (prefers-color-scheme: dark) { body { background: #14171d; color: #ece6d8; } }
  main { max-width: 34rem; padding: 24px; }
  h1 { font: 600 26px Georgia, serif; margin: 0 0 8px; }
  .zh { opacity: .75; }
  input { width: 100%; box-sizing: border-box; font: 18px ui-monospace, Consolas, monospace; letter-spacing: .05em; padding: 10px; margin: 12px 0; text-transform: uppercase; }
  button { font: inherit; padding: 9px 18px; background: var(--reed); color: #fff; border: 0; border-radius: 6px; cursor: pointer; }
  .err { color: var(--danger); font-weight: 600; }
</style></head><body><main>${body}</main></body></html>`;
}

// the form carries a token only this page has, and a guess must come from the page itself: another web page open
// on this computer can't post guesses (and use up the tries)
const TOKEN = crypto.randomBytes(24).toString('hex');
const form = (error = '') => page(`
  <h1>Canon is locked</h1>
  <p>Canon's data is encrypted, and its keys can't be opened on this computer: Canon is running as another Windows account than before, or it was moved to a new computer.</p>
  <p class="zh">Canon 的资料已加密，但这台电脑无法打开它的密钥：Canon 可能以另一个 Windows 帐户运行，或已搬到新电脑。</p>
  <p>Enter the <b>recovery key</b> printed when the data was encrypted (eight groups of five letters and numbers). Canon then starts as usual.</p>
  <p class="zh">请输入加密时打印的<b>恢复密钥</b>（八组，每组五个字母或数字）。之后 Canon 会照常启动。</p>
  ${error ? `<p class="err">${esc(error)}</p>` : ''}
  <form method="post" action="/unlock"><input type="hidden" name="t" value="${TOKEN}"><input name="key" autocomplete="off" spellcheck="false" autofocus placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"><button>Unlock / 解锁</button></form>`);

const remote = () => page(`
  <h1>Canon is locked</h1>
  <p>Canon's data is encrypted and can't be opened on the computer it runs on. Whoever looks after that computer opens Canon there (http://localhost:${config.port}) and enters the recovery key.</p>
  <p class="zh">Canon 的资料已加密，运行它的电脑暂时无法打开。请负责那台电脑的同工在那台电脑上打开 Canon（http://localhost:${config.port}），并输入恢复密钥。</p>`);

/** Serve the locked page until the right recovery key is entered; resolves then (the keys unlocked, held in memory). */
export function serveLocked(why: string): Promise<void> {
  console.error(`Canon is locked: ${why}`);
  console.error('Open Canon on this computer and enter the recovery key, or run: npm run unlock -- <recovery key>');
  const version = (() => {
    try {
      return (JSON.parse(fs.readFileSync(path.join(config.root, 'package.json'), 'utf8')) as { version: string }).version;
    } catch {
      return '';
    }
  })();
  let tries = 0;
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url?.startsWith('/api/about')) {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ name: 'Canon', version, locked: true }));
        return;
      }
      const send = (status: number, html: string) => res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' }).end(html);
      if (!isLocal(req)) return send(423, remote());
      if (req.method !== 'POST' || req.url !== '/unlock') return send(423, form());
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 2000) req.destroy(); });
      req.on('end', () => {
        const q = new URLSearchParams(body);
        const origin = req.headers.origin;
        const site = req.headers['sec-fetch-site'];
        const ownPage = q.get('t') === TOKEN && (!origin || /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) && (!site || site === 'same-origin' || site === 'none');
        if (!ownPage) return send(403, form('Open this page again on this computer and enter the key there.'));
        if (++tries > 20) return send(429, form('Too many tries. Restart Canon to try again.'));
        const key = q.get('key') ?? '';
        try {
          unlockWithRecovery(key);
        } catch (e) {
          return send(400, form((e as Error).message));
        }
        console.log('Canon was unlocked with the recovery key; starting.');
        send(200, page('<h1>Unlocked</h1><p>Canon is starting…</p><p class="zh">已解锁，Canon 正在启动……</p><script>setTimeout(() => location.href = "/", 4000)</script>'));
        server.close();
        server.closeAllConnections();
        resolve();
      });
    });
    // `docker stop`, Ctrl+C: nothing to save while locked (removed once unlocked: Canon then stops properly)
    const quit = () => process.exit(0);
    const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'] as const;
    for (const sig of SIGNALS) process.on(sig, quit);
    server.on('close', () => { for (const sig of SIGNALS) process.off(sig, quit); });
    server.listen(config.port, config.host, () => console.error(`The locked page is at http://localhost:${config.port} (on this computer).`));
  });
}
