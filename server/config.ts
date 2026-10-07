import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

/**
 * Runtime configuration from environment variables.
 *  CANON_PORT         port to listen on (default 3000)
 *  CANON_HOST         interface to bind (default 0.0.0.0 so the office LAN can reach it)
 *  CANON_DB           SQLite file (default data/canon.db)
 *  CANON_PUBLIC_URL   public https origin (e.g. https://canon.example.org) — required for claude.ai OAuth;
 *                     it must be exactly what clients use. No path, no trailing slash.
 *  CANON_TRUST_PROXY  "1" to honour X-Forwarded-* headers (behind Caddy / Cloudflare Tunnel)
 *  CANON_TEST_COPY    "1" for a test copy of the church's data: no e-mail is sent, Google Drive is left alone
 */
export const config = {
  root,
  port: Number(process.env.CANON_PORT ?? 3000),
  host: process.env.CANON_HOST ?? '0.0.0.0',
  dbPath: path.resolve(root, process.env.CANON_DB ?? 'data/canon.db'),
  publicUrl: (process.env.CANON_PUBLIC_URL ?? '').replace(/\/+$/, ''),
  trustProxy: process.env.CANON_TRUST_PROXY === '1',
  testCopy: process.env.CANON_TEST_COPY === '1',
  isProd: process.env.NODE_ENV === 'production',
  distDir: path.join(root, 'dist'),
};
