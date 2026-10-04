// REST routes for hymnals, song hymnal numbers, text parts import (Westminster Standards). Mounted inside /api after authentication (see server/api.ts).
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import * as S from '../../shared/schemas.ts';
import { requireAdmin } from '../auth.ts';
import * as lib from '../repo/library.ts';
import { legacyImport, rawBody } from './csv.ts';

export const libraryRoutes = express.Router();

type Handler = (req: Request, res: Response) => unknown;
const h = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (e) {
    next(e);
  }
};
const id = (req: Request, name = 'id') => {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw Object.assign(new Error(`Bad ${name}`), { status: 400 });
  return n;
};

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

// ---- Westminster Standards (texts in numbered parts)
libraryRoutes.get('/library/standards', h(() => lib.standardsStatus()));
libraryRoutes.post('/library/import-standards', requireAdmin, h(async (req) => {
  const b = z.object({ force: z.boolean().optional() }).parse(req.body ?? {});
  return lib.importStandards({ force: b.force });
}));
