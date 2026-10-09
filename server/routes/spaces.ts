// REST routes for the church's spaces (0.15.4): the list (everyone signed in, for the pickers), changes
// (administrators, Settings → Spaces), clashes for one booking (the editors) and the spaces report.
import express from 'express';
import { z } from 'zod';
import * as S from '../../shared/schemas.ts';
import { requireAdmin } from '../auth.ts';
import * as sp from '../repo/spaces.ts';
import { h, id, str } from './helpers.ts';
import { churchToday } from '../lib/dates.ts';

export const spaceRoutes = express.Router();

const SpaceInput = z.object({
  name: S.L10nSchema,
  capacity: z.number().int().min(0).max(100000).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  sort: z.number().int().optional(),
});

spaceRoutes.get('/spaces', h(() => ({ spaces: sp.listSpaces(), use: sp.spaceUse() })));
spaceRoutes.post('/spaces', requireAdmin, h((req) => sp.createSpace(SpaceInput.parse(req.body))));
spaceRoutes.patch('/spaces/:id', requireAdmin, h((req) => sp.updateSpace(id(req), SpaceInput.partial().extend({ archived: z.boolean().optional() }).parse(req.body))));
spaceRoutes.delete('/spaces/:id', requireAdmin, h((req) => sp.deleteSpace(id(req))));
/** What else is booked in the same space at the same time as this service / meeting / event. */
spaceRoutes.get('/spaces/clashes', h((req) => {
  const type = z.enum(['service', 'meeting', 'event']).parse(str(req.query.type));
  return sp.clashesFor(type, Number(req.query.id));
}));
spaceRoutes.get('/spaces/report', h((req) => {
  const today = churchToday();
  const from = str(req.query.from) ?? today;
  const to = str(req.query.to) ?? new Date(Date.parse(`${from}T00:00:00Z`) + 27 * 86400_000).toISOString().slice(0, 10);
  return sp.spacesReport(from, to);
}));
