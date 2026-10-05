// REST routes for service templates and services. Mounted inside /api after authentication.
import express from 'express';
import { z } from 'zod';
import * as S from '../../shared/schemas.ts';
import type { Lang } from '../../shared/types.ts';
import { MAX_SERVICE_LANGS } from '../../shared/languages.ts';
import { requireAdmin } from '../auth.ts';
import * as svc from '../repo/services.ts';
import * as rec from '../repo/records.ts';
import { Conflict } from '../lib/table.ts';
import { assertFresh } from '../lib/versions.ts';
import { cleanRef } from '../repo/refs.ts';
import { renderService } from '../repo/render.ts';
import { getSettings, updateSettings } from '../repo/settings.ts';
import { serviceDocx } from '../export/docx.ts';
import { freeshowProject } from '../export/freeshow.ts';
import { buildFile } from '../repo/downloads.ts';
import { h, id, sendFile, str } from './helpers.ts';

export const serviceRoutes = express.Router();

// ---------------------------------------------------------------- templates

serviceRoutes.get('/templates', h(() => svc.templates.list('', [], 'id').map(svc.withBuiltin)));
serviceRoutes.get('/templates/:id', h((req) => svc.withBuiltin(svc.templates.get(id(req)))));
serviceRoutes.post('/templates', h((req) => {
  const b = S.TemplateInput.parse(req.body);
  return svc.withBuiltin(svc.templates.insert({ description: {}, items: [], ...b, ref: cleanRef('service_template', b.ref) ?? null }));
}));
serviceRoutes.patch('/templates/:id', h((req) => {
  const tid = id(req);
  const b = S.TemplateInput.partial().parse(req.body);
  return svc.withBuiltin(svc.templates.update(tid, { ...b, ...(b.ref !== undefined ? { ref: cleanRef('service_template', b.ref, tid) } : {}) }));
}));
/** Archive / restore (editors). The church default can't be archived. */
serviceRoutes.put('/templates/:id/hidden', h((req) => svc.setServiceTemplateHidden(id(req), z.object({ hidden: z.boolean() }).parse(req.body).hidden, getSettings().default_service_template_id ?? null)));
/** Delete an archived template (administrators; never a built-in one). */
serviceRoutes.delete('/templates/:id', requireAdmin, h((req) => {
  const tid = id(req);
  svc.deleteServiceTemplate(tid);
  if (getSettings().default_service_template_id === tid) updateSettings({ default_service_template_id: null });
}));
/** The church's usual service template: New service starts from it (administrators). */
serviceRoutes.put('/templates-default', requireAdmin, h((req) => {
  const tid = z.object({ template_id: z.number().int().positive().nullable() }).parse(req.body).template_id;
  if (tid != null) {
    svc.templates.get(tid);
    svc.templates.update(tid, { hidden: false });
  }
  return { default_service_template_id: updateSettings({ default_service_template_id: tid }).default_service_template_id };
}));

// ---------------------------------------------------------------- services

serviceRoutes.get('/services', h((req) => svc.listServices({ from: str(req.query.from), to: str(req.query.to), limit: Number(req.query.limit) || undefined, congregation_id: Number(req.query.congregation) || undefined })));
// meetings of groups (fellowships, cell groups, Sunday school classes …): a lighter kind of service
serviceRoutes.get('/meetings', h((req) => svc.listServices({ kind: 'meeting', from: str(req.query.from), to: str(req.query.to), limit: Number(req.query.limit) || undefined, congregation_id: Number(req.query.congregation) || undefined, group_id: req.query.group === 'none' ? 'none' : Number(req.query.group) || undefined })));
serviceRoutes.post('/meetings', h((req) => svc.createMeeting(S.MeetingInput.parse(req.body))));
serviceRoutes.post('/services', h((req) => {
  const b = S.ServiceInput.extend({ template_id: z.number().int().nullable().optional() }).parse(req.body);
  const { template_id, ...input } = b;
  return svc.createService({ ...input, ref: cleanRef('service', input.ref) ?? null }, template_id);
}));
serviceRoutes.get('/services/:id', h((req) => svc.getServiceFull(id(req))));
serviceRoutes.patch('/services/:id', h((req) => {
  const sid = id(req);
  assertFresh(req, svc.services.get(sid), 'services', sid);
  const b = S.ServiceInput.partial().parse(req.body);
  // a service whose record is in an archive file keeps its date (the archive is filed by year)
  const year = b.date !== undefined && b.date !== svc.services.get(sid).date ? rec.archivedYear(sid) : null;
  if (year) throw new Conflict(`This service's record is in the ${year} archive, so its date can't be changed.`);
  return svc.services.update(sid, { ...b, ...(b.ref !== undefined ? { ref: cleanRef('service', b.ref, sid) } : {}) });
}));
serviceRoutes.delete('/services/:id', h((req) => {
  rec.assertServiceDeletable(id(req));
  return svc.services.remove(id(req));
}));
serviceRoutes.post('/services/:id/duplicate', h((req) => {
  const b = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), with_roster: z.boolean().optional() }).parse(req.body);
  return svc.duplicateService(id(req), b.date, b.with_roster);
}));
serviceRoutes.post('/services/:id/save-as-template', h((req) => svc.saveAsTemplate(id(req), S.L10nSchema.parse(req.body.name))));
serviceRoutes.get('/services/:id/render', h((req) => renderService(id(req))));
serviceRoutes.post('/services/:id/share', h((req) => ({ token: svc.setShare(id(req), !!req.body.enabled) })));
serviceRoutes.get('/services/:id/export.docx', h(async (req, res) => {
  const r = renderService(id(req));
  const buf = await serviceDocx(r);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="order-of-service-${r.date}.docx"`);
  res.send(buf);
}));
serviceRoutes.get('/services/:id/slides.pptx', h(async (req, res) => {
  const langs = typeof req.query.langs === 'string' && req.query.langs ? (req.query.langs.split(',').slice(0, MAX_SERVICE_LANGS) as Lang[]) : null;
  sendFile(res, await buildFile(id(req), 'slides_pptx', langs));
}));
serviceRoutes.get('/services/:id/freeshow.project', h(async (req, res) => {
  const r = renderService(id(req));
  const file = await freeshowProject(r);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="canon-${r.date}.project"`);
  res.send(JSON.stringify(file));
}));

serviceRoutes.post('/services/:id/items', h((req) => {
  const b = z.object({ item: S.ServiceItemInput, position: z.number().int().min(0).optional() }).parse(req.body);
  return svc.addItem(id(req), b.item, b.position);
}));
serviceRoutes.patch('/items/:id', h((req) => svc.updateItem(id(req), S.ServiceItemInput.partial().parse(req.body))));
serviceRoutes.delete('/items/:id', h((req) => svc.deleteItem(id(req))));
serviceRoutes.put('/services/:id/order', h((req) => svc.reorderItems(id(req), z.array(z.number().int()).parse(req.body.item_ids))));
