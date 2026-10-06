// REST routes for hymnals, song hymnal numbers, text parts import (Westminster Standards). Mounted inside /api after authentication (see server/api.ts).
import express from 'express';
import { z } from 'zod';
import * as S from '../../shared/schemas.ts';
import { requireAdmin } from '../auth.ts';
import * as lib from '../repo/library.ts';
import { installLibrary, libraryStatus } from '../seed/index.ts';
import { legacyImport, rawBody } from './csv.ts';
import { h, id } from './helpers.ts';

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
