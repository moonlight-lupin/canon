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

/** Build the Express app (no listen) so tests can mount it on an ephemeral port. */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Evaluated per request so the Settings → AI / MCP choice applies without a restart.
  app.set('trust proxy', () => trustProxy());

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
