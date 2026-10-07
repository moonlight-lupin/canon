// Stopping Canon properly (0.18.0): the Windows tray icon's Exit, Ctrl+C in the window, and `docker stop` all end the
// same way. Requests already running are allowed to finish, the database is checkpointed and closed, and Canon exits
// with 0, so the launcher (start-canon.bat, the Windows task) treats it as stopped on purpose, not as a crash.
//
// The tray asks over HTTP: POST /control/stop on this computer only (127.0.0.1 / ::1), carrying the token that
// Canon writes at start-up to data/run/control-<port>.json. Only the account running Canon (and administrators) can
// read that file, so nobody on the network, and no web page, can stop Canon.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { config } from '../config.ts';
import { db } from '../db.ts';

export const controlFile = (port = config.port) => path.join(config.root, 'data', 'run', `control-${port}.json`);
const token = crypto.randomBytes(32).toString('hex');
let stopping = false;

/** Write the token for the tray (readable by this account only). */
export function writeControlFile() {
  const file = controlFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, port: config.port, token, started: new Date().toISOString() }), { mode: 0o600 });
}

const isLocal = (req: IncomingMessage) => {
  const a = req.socket.remoteAddress ?? '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
};

/**
 * Handles POST /control/stop before the app sees it; returns false for every other request. A request that came
 * through a proxy (X-Forwarded-For) is refused: the proxy is local, the person behind it isn't.
 */
export function handleControl(server: Server, req: IncomingMessage, res: ServerResponse): boolean {
  if (req.url !== '/control/stop') return false;
  const given = String(req.headers['x-canon-control'] ?? '');
  const ok = req.method === 'POST' && isLocal(req) && !req.headers['x-forwarded-for'] &&
    given.length === token.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token));
  if (!ok) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not Found');
    return true;
  }
  res.writeHead(202, { 'Content-Type': 'application/json' }).end('{"stopping":true}');
  stop(server, 'from the tray icon');
  return true;
}

/** Stop Canon: no new requests, a few seconds for running ones, then the database is closed and Canon exits. */
export function stop(server: Server, why: string) {
  if (stopping) return;
  stopping = true;
  console.log(`Canon is stopping (${why}).`);
  server.close();
  server.closeIdleConnections();
  const finish = () => {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      db.close();
    } catch (e) {
      console.error('Closing the database:', (e as Error).message);
    }
    try {
      fs.rmSync(controlFile(), { force: true });
    } catch { /* already gone */ }
    console.log('Canon has stopped.');
    process.exit(0);
  };
  // requests still running get 5 seconds (an upload, a backup download); then they're cut off
  const timer = setTimeout(() => { server.closeAllConnections(); finish(); }, 5000);
  server.on('close', () => { clearTimeout(timer); finish(); });
}
