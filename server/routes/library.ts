// REST routes for hymnals, song hymnal numbers, text parts import (Westminster Standards). Mounted inside /api after authentication (see server/api.ts).
import express from 'express';
import { z } from 'zod';
import * as S from '../../shared/schemas.ts';
import { requireAdmin } from '../auth.ts';
import * as lib from '../repo/library.ts';
import { installLibrary, libraryStatus } from '../seed/index.ts';
import { legacyImport, rawBody } from './csv.ts';
import { h, id, str } from './helpers.ts';
import * as sc from '../repo/scores.ts';
import { BadRequest } from '../lib/table.ts';

export const libraryRoutes = express.Router();

// ---- hymnals
libraryRoutes.get('/hymnals', h(() => lib.listHymnals()));
libraryRoutes.get('/hymnals/:id', h((req) => lib.hymnals.get(id(req))));
libraryRoutes.post('/hymnals', h((req) => lib.hymnals.insert(S.HymnalInput.parse(req.body))));
libraryRoutes.patch('/hymnals/:id', h((req) => lib.hymnals.update(id(req), S.HymnalInput.partial().parse(req.body))));
libraryRoutes.delete('/hymnals/:id', h((req) => lib.hymnals.remove(id(req))));
/** Songs in a hymnal ordered by number. */
libraryRoutes.get('/hymnals/:id/songs', h((req) => lib.hymnalSongs(id(req))));
/**
 * CSV index import (numbers + titles): links existing songs by title, creates stubs for the rest.
 * Alias of POST /csv/hymnal_index/import?hymnal_id=… (server/routes/csv.ts); valid rows are imported.
 */
libraryRoutes.post('/hymnals/:id/import', rawBody, h((req) => {
  const hid = id(req);
  lib.hymnals.get(hid);
  const r = legacyImport('hymnal_index', req, { hymnal_id: String(hid) });
  return { created: r.created, linked: r.updated + r.unchanged, errors: r.errors };
}));

// ---- a song's hymnal numbers (replaces all)
libraryRoutes.put('/songs/:id/hymnals', h((req) => lib.setSongHymnals(id(req), S.SongHymnalsInput.parse(req.body))));

// ---- sheet music: scans or photos of a song's music (PNG / JPEG / WebP / PDF, up to 10 MB; the name in the query)
libraryRoutes.get('/songs/scores/counts', h(() => sc.scoreCounts()));
libraryRoutes.get('/songs/:id/scores', h((req) => sc.scoresFor(id(req))));
libraryRoutes.post('/songs/:id/scores', express.raw({ type: () => true, limit: '11mb' }), h((req) => {
  const data = req.body as Buffer;
  if (!Buffer.isBuffer(data) || !data.length) throw new BadRequest('Choose a file.');
  return sc.addScore(id(req), { name: str(req.query.name) ?? 'sheet music', mime: String(req.get('content-type') ?? '').split(';')[0].trim(), data });
}));
libraryRoutes.get('/songs/scores/:id', (req, res, next) => {
  try {
    const { score, data } = sc.scoreData(Number(req.params.id));
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${score.name.replace(/[^\w.() -]+/g, '_')}"`);
    res.type(score.mime).send(data);
  } catch (e) {
    next(e);
  }
});
libraryRoutes.post('/songs/scores/:id/move', h((req) => sc.moveScore(id(req), z.object({ by: z.union([z.literal(-1), z.literal(1)]) }).parse(req.body).by)));
libraryRoutes.delete('/songs/scores/:id', h((req) => sc.removeScore(id(req))));

// ---- Canon's bundled public-domain library (optional; chosen while setting up or later)
libraryRoutes.get('/library/bundled', h(async () => ({ ...(await libraryStatus()), standards: lib.standardsStatus() })));
libraryRoutes.post('/library/bundled', requireAdmin, h(async (req) => {
  const b = z.object({
    parts: z.array(z.enum(['songs', 'texts', 'templates'])).max(3),
    standards: z.boolean().optional(),
    restore: z.boolean().optional(),
  }).parse(req.body ?? {});
  const added = b.parts.length ? await installLibrary(b.parts, { restore: b.restore }) : { songs: 0, texts: 0, templates: 0 };
  let standards: Awaited<ReturnType<typeof lib.importStandards>> | { error: string } | null = null;
  if (b.standards) {
    try {
      standards = await lib.importStandards();
    } catch (e) {
      standards = { error: (e as Error).message }; // e.g. no internet: the rest is added all the same
    }
  }
  return { added, standards };
}));

// ---- Westminster Standards (texts in numbered parts)
libraryRoutes.get('/library/standards', h(() => lib.standardsStatus()));
libraryRoutes.post('/library/import-standards', requireAdmin, h(async (req) => {
  const b = z.object({ force: z.boolean().optional() }).parse(req.body ?? {});
  return lib.importStandards({ force: b.force });
}));
