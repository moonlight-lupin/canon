// REST routes for design assets: the church logo (upload / serve / remove).
// Season colours and cover options are plain settings and service fields (PATCH /settings, /services/:id).
//
// Logo formats: PNG, JPEG and WebP, checked by their magic bytes. SVG is no longer taken (0.19.11, Daedalus Workshop
// study of 0.19.10): it can carry script, and the pattern check that let "plainly static" SVGs through was no parser.
// An SVG logo uploaded before keeps showing (the app only shows the logo through <img>, where SVG can't run script);
// it is served as an attachment with a sandboxing Content-Security-Policy, so opened on its own it runs nothing.
import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { get, run } from '../db.ts';
import { requireAdmin } from '../auth.ts';

/** Mounted before authentication: e.g. GET /assets/logo for the login and share pages. */
export const publicDesignRoutes = express.Router();

/** Mounted after authentication. */
export const designRoutes = express.Router();

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
type ImageType = (typeof TYPES)[number];

interface Asset { mime: string; data: Uint8Array; updated_at: string }

let cached: { version: string; mime: string; data: Buffer } | null | undefined;
function logo() {
  if (cached !== undefined) return cached;
  const row = get<Asset>('SELECT mime, data, updated_at FROM assets WHERE key = ?', 'logo');
  if (!row) return (cached = null);
  const data = Buffer.from(row.data);
  cached = { version: crypto.createHash('sha256').update(data).digest('base64url').slice(0, 16), mime: row.mime, data };
  return cached;
}

/** Forget the cached logo (tests that put one in the database directly). */
export const forgetLogo = () => {
  cached = undefined;
};

const fail = (status: number, message: string) => Object.assign(new Error(message), { status });

/** Does the file really look like the declared raster format? (also used for bulletin block pictures) */
export function magicOk(type: ImageType, b: Buffer): boolean {
  if (type === 'image/png') return b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === 'image/jpeg') return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  return b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP';
}

// ---------------------------------------------------------------- public

publicDesignRoutes.get('/assets/logo/info', (_req, res) => {
  const l = logo();
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ version: l?.version ?? null, mime: l?.mime ?? null, bytes: l?.data.length ?? 0 });
});

publicDesignRoutes.get('/assets/logo', (req, res) => {
  const l = logo();
  if (!l) {
    res.status(404).json({ error: 'No logo uploaded' });
    return;
  }
  const etag = `"${l.version}"`;
  res.setHeader('ETag', etag);
  // A versioned URL (?v=<hash>) never changes; the plain URL is revalidated each time.
  res.setHeader('Cache-Control', req.query.v === l.version ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // an SVG from before 0.19.11: shown through <img> as before, but never opened as a page of its own
  if (l.mime === 'image/svg+xml') res.setHeader('Content-Disposition', 'attachment; filename="logo.svg"');
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }
  res.type(l.mime).send(l.data);
});

// ---------------------------------------------------------------- admin

const rawImage = express.raw({ type: [...TYPES], limit: MAX_BYTES });
/** express.raw with friendly errors (too large → 413). */
function readImage(req: Request, res: Response, next: NextFunction) {
  rawImage(req, res, (err?: unknown) => {
    if (err) {
      const e = err as { type?: string; status?: number };
      return next(e.type === 'entity.too.large' ? fail(413, 'The logo must be 2 MB or smaller') : err);
    }
    next();
  });
}

designRoutes.put('/assets/logo', requireAdmin, readImage, (req, res, next) => {
  try {
    const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() as ImageType;
    if (!TYPES.includes(type) || !Buffer.isBuffer(req.body)) throw fail(415, 'Upload a PNG, JPEG or WebP image');
    const data = req.body as Buffer;
    if (!data.length) throw fail(400, 'The file is empty');
    if (!magicOk(type, data)) throw fail(415, 'The file does not match its image type');
    run(
      `INSERT INTO assets (key, mime, data, updated_at) VALUES ('logo', ?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at`,
      type, data,
    );
    cached = undefined;
    const l = logo()!;
    res.json({ version: l.version, mime: l.mime, bytes: l.data.length });
  } catch (e) {
    next(e);
  }
});

designRoutes.delete('/assets/logo', requireAdmin, (_req, res) => {
  run('DELETE FROM assets WHERE key = ?', 'logo');
  cached = undefined;
  res.json({ ok: true });
});
