import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { trustProxy } from './lib/public-url.ts';
import './db.ts';
import { api } from './api.ts';
import { oauthRouter } from './oauth.ts';
import { mcpRouter } from './mcp.ts';
import { visitorFormRouter } from './routes/visitor-form.ts';

/** Loopback, private and link-local addresses (IPv4 and IPv6): where a church's own proxy would be. */
const PROXY_NET = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i;

/** Build the Express app (no listen) so tests can mount it on an ephemeral port. */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Evaluated per request so the Settings → AI / MCP choice applies without a restart. Only a proxy on this computer
  // or the local network (Cloudflare Tunnel, Caddy, Docker's network) is believed about the visitor's address: an
  // address someone writes into X-Forwarded-For themselves can't dodge the sign-in limits (0.18.0 review).
  app.set('trust proxy', (addr: string) => trustProxy() && PROXY_NET.test(addr.replace(/^::ffff:/, '')));

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
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
      res.sendFile(path.join(config.distDir, 'index.html'));
    });
  }
  return app;
}
