// REST routes for the church calendar and its events. Mounted inside /api after authentication.
import express from 'express';
import { z } from 'zod';
import * as S from '../../shared/schemas.ts';
import * as cal from '../repo/calendar.ts';
import { h, id, str } from './helpers.ts';

export const calendarRoutes = express.Router();

calendarRoutes.get('/calendar', h((req) => cal.calendarItems({
  from: str(req.query.from) ?? '', to: str(req.query.to) ?? '',
  congregation_id: Number(req.query.congregation) || undefined, group_id: Number(req.query.group) || undefined,
})));

const EventInput = z.object({
  title: S.L10nSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  start_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  place: z.string().max(200).nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
  congregation_id: z.number().int().nullable().optional(),
  group_id: z.number().int().nullable().optional(),
});

calendarRoutes.get('/events/:id', h((req) => cal.events.get(id(req))));
calendarRoutes.post('/events', h((req) => {
  const b = EventInput.parse(req.body);
  if (!Object.values(b.title).some((v) => v?.trim())) throw Object.assign(new Error('Give the event a title.'), { status: 400 });
  cal.checkEvent(b);
  return cal.events.insert(b);
}));
calendarRoutes.patch('/events/:id', h((req) => {
  const b = EventInput.partial().parse(req.body);
  cal.checkEvent({ ...cal.events.get(id(req)), ...b });
  return cal.events.update(id(req), b);
}));
calendarRoutes.delete('/events/:id', h((req) => {
  cal.events.remove(id(req));
  return { deleted: true };
}));
