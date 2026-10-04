// REST routes for design assets: the church logo (upload / serve / remove).
// Season colours and cover options are plain settings and service fields (PATCH /settings, /services/:id).
//
// Logo formats: PNG, JPEG and WebP are checked by their magic bytes. SVG is accepted only when it is
// plainly static: anything that can run script or load other resources (script, foreignObject, event
// handler attributes, external href/src, javascript:/data:text URLs, DOCTYPE/ENTITY, CSS @import / url()
// to other files, iframes/embeds) is rejected rather than "cleaned". As defence in depth the logo is
// always served with a sandboxing Content-Security-Policy, and the app only ever shows it through <img>,
// where SVG cannot run script anyway.
import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { get, run } from '../db.ts';
import { requireAdmin } from '../auth.ts';

/** Mounted before authentication: e.g. GET /assets/logo for the login and share pages. */
export const publicDesignRoutes = express.Router();

/** Mounted after authentication. */
export const designRoutes = express.Router();

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const;
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

const fail = (status: number, message: string) => Object.assign(new Error(message), { status });

/** Does the file really look like the declared raster format? (also used for bulletin block pictures) */
export function magicOk(type: ImageType, b: Buffer): boolean {
  if (type === 'image/png') return b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === 'image/jpeg') return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (type === 'image/webp') return b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP';
  return true;
}

/** Why an SVG is not acceptable as a static logo (null = fine). */
export function svgProblem(text: string): string | null {
  const s = text.replace(/^﻿/, '');
  if (!/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(s)) return 'not an SVG document';
  if (/<!DOCTYPE|<!ENTITY/i.test(s)) return 'DOCTYPE/ENTITY declarations are not allowed';
  if (/<\s*(script|foreignObject|iframe|embed|object|handler|listener|set\b|animate\w*)/i.test(s)) return 'scripts, animations and embedded content are not allowed';
  if (/\son[a-z]+\s*=/i.test(s)) return 'event handler attributes are not allowed';
  if (/(javascript|vbscript)\s*:/i.test(s) || /data:\s*(text|application)\//i.test(s)) return 'script URLs are not allowed';
  // Only same-document references (#id) and inline raster images may be linked.
  for (const m of s.matchAll(/\b(?:xlink:)?href\s*=\s*(["'])(.*?)\1/gis)) {
    const v = m[2].trim();
    if (!v.startsWith('#') && !/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(v)) return 'external links are not allowed';
  }
  if (/@import/i.test(s)) return 'CSS imports are not allowed';
  for (const m of s.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
    if (!m[2].trim().startsWith('#')) return 'external resources are not allowed';
  }
  return null;
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
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
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
    if (!TYPES.includes(type) || !Buffer.isBuffer(req.body)) throw fail(415, 'Upload a PNG, JPEG, WebP or SVG image');
    const data = req.body as Buffer;
    if (!data.length) throw fail(400, 'The file is empty');
    if (!magicOk(type, data)) throw fail(415, 'The file does not match its image type');
    if (type === 'image/svg+xml') {
      const problem = svgProblem(data.toString('utf8'));
      if (problem) throw fail(415, `This SVG can't be used as a logo: ${problem}. Export it as PNG instead.`);
    }
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
