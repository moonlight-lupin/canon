import express from 'express';
import fs from 'node:fs';
import { config } from './config.ts';
import { trustProxy } from './lib/public-url.ts';
import './db.ts';
import { api } from './api.ts';
import { oauthRouter } from './oauth.ts';
import { mcpRouter } from './mcp.ts';
import { visitorFormRouter } from './routes/visitor-form.ts';

/** Loopback, private and link-local addresses (IPv4 and IPv6): where a church's own proxy would be. */
const PROXY_NET = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i;

/**
 * The web app's Content-Security-Policy (0.20.1). Scripts only from Canon itself — never inline or from elsewhere —
 * so text that slipped into a page as HTML can't run. Styles may be inline (slide themes and print layouts are
 * <style> elements); pictures may be data: (QR codes, signatures) or blob: (a receipt fetched with a sign-in token);
 * nothing is loaded from other sites (fetch() of a data: address is refused too: Canon never needs one). Another site
 * can't frame Canon (clickjacking). A route with a policy of its own
 * (the visitor form, the sign-in consent page, uploaded files) sets it after this one and replaces it.
 */
export const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "frame-src 'self' blob:",
  "worker-src 'self' blob:",
  // a PDF receipt opened in a tab of its own (a blob: from the member's claim page) is a plugin document in Chrome,
  // and inherits this policy: 'none' could leave it blank. Canon embeds no <object> or <embed> of its own.
  "object-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

/** Build the Express app (no listen) so tests can mount it on an ephemeral port. */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Evaluated per request so the Settings → AI / MCP choice applies without a restart. Only a proxy on this computer
  // or the local network (Cloudflare Tunnel, Caddy, Docker's network) is believed about the visitor's address: an
  // address someone writes into X-Forwarded-For themselves can't dodge the sign-in limits (0.18.0 review).
  app.set('trust proxy', (addr: string) => trustProxy() && PROXY_NET.test(addr.replace(/^::ffff:/, '')));

  app.use((req, res, next) => {
    // every "too many" says when to try again (0.19.9 review): each limit sets its own Retry-After; one that doesn't
    // gets a minute
    const writeHead = res.writeHead;
    res.writeHead = function (this: typeof res, ...args: Parameters<typeof writeHead>) {
      if (this.statusCode === 429 || args[0] === 429) {
        if (!this.getHeader('Retry-After')) this.setHeader('Retry-After', '60');
      }
      return writeHead.apply(this, args);
    } as typeof writeHead;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', APP_CSP);
    // the API's answers carry members' data: never kept in a browser's cache on a shared office PC (a route that
    // serves something cacheable, e.g. a picture, sets its own)
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // OAuth 2.1 authorization server + MCP endpoint (for claude.ai and other agents)
  app.use(oauthRouter);
  app.use('/mcp', mcpRouter);

  app.use('/api', express.json({ limit: '2mb' }), api);
  // the public visitor form (/v/<token>): no sign-in, its own small HTML page
  app.use(visitorFormRouter);

  // Web app (production build). In development Vite serves the client and proxies here.
  if (fs.existsSync(config.distDir)) {
    app.use(express.static(config.distDir, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/|mcp|oauth\/|\.well-known\/|v\/).*/, (_req, res) => {
      // by root, not an absolute path: send refuses a path with a dot-folder in it (an install under .something)
      res.sendFile('index.html', { root: config.distDir });
    });
  }
  return app;
}
