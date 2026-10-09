// REST routes for the asset register (0.15, optional module "equipment"; switched off = 404, shared/modules.ts).
// Mounted inside /api after authentication; reading needs the role's Asset register access, changes need edit.
import express from 'express';
import { z } from 'zod';
import { all } from '../db.ts';
import * as E from '../repo/equipment.ts';
import { qrSvg } from '../repo/presentation.ts';
import { BadRequest } from '../lib/table.ts';
import { h, id, str } from './helpers.ts';
import { sendXlsx } from '../lib/xlsx-export.ts';
import { uiLang } from './csv.ts';
import { addressForOthers } from '../lib/lan.ts';
import { churchToday } from '../lib/dates.ts';

export const equipmentRoutes = express.Router();

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().max(max).nullable().optional();
const ItemInput = z.object({
  number: z.string().max(30).optional(),
  name: z.string().min(1).max(200),
  category: text(100),
  make_model: text(200),
  serial_no: text(100),
  location: text(200),
  custodian_id: z.number().int().nullable().optional(),
  bought_on: date.nullable().optional(),
  price: z.number().nullable().optional(),
  supplier: text(200),
  warranty_until: date.nullable().optional(),
  condition: z.enum(['good', 'fair', 'poor', 'broken']).optional(),
  status: z.enum(['in_use', 'stored', 'out_of_service']).optional(),
  maintenance_every_months: z.number().int().nullable().optional(),
  next_maintenance_on: date.nullable().optional(),
  notes: text(4000),
});

equipmentRoutes.get('/equipment/items', h((req) => E.listItems({
  q: str(req.query.q), category: str(req.query.category), location: str(req.query.location), status: str(req.query.status), due: req.query.due === '1',
})));
equipmentRoutes.get('/equipment/lists', h(() => E.itemLists()));
equipmentRoutes.get('/equipment/summary', h(() => E.equipmentCounts()));
equipmentRoutes.get('/equipment/people', h((req) => E.custodians(str(req.query.q) ?? '')));
equipmentRoutes.get('/equipment/scan', h((req) => E.findItem(str(req.query.q) ?? '')));
equipmentRoutes.get('/equipment/items/:id', h((req) => E.getItem(id(req))));
equipmentRoutes.post('/equipment/items', h((req) => E.getItem(E.saveItem(null, ItemInput.parse(req.body)).id)));
equipmentRoutes.patch('/equipment/items/:id', h((req) => {
  E.saveItem(id(req), ItemInput.partial().parse(req.body));
  return E.getItem(id(req));
}));
equipmentRoutes.delete('/equipment/items/:id', h((req) => {
  E.deleteItem(id(req));
  return { deleted: true };
}));

// ---- maintenance
equipmentRoutes.post('/equipment/items/:id/maintenance', h((req) => {
  E.addMaintenance(id(req), z.object({ done_on: date.nullable().optional(), what: z.string().min(1).max(500), cost: z.number().nullable().optional(), done_by: text(200), notes: text(2000) }).parse(req.body));
  return E.getItem(id(req));
}));
equipmentRoutes.delete('/equipment/maintenance/:id', h((req) => {
  E.removeMaintenance(id(req));
  return { deleted: true };
}));

// ---- photos and receipts (PNG / JPEG / WebP / PDF, up to 10 MB; the name and kind in the query)
equipmentRoutes.post('/equipment/items/:id/files', express.raw({ type: () => true, limit: '11mb' }), h((req) => {
  const kind = str(req.query.kind) ?? 'photo';
  if (!E.FILE_KINDS.includes(kind as E.FileKind)) throw new BadRequest('Unknown kind of file.');
  const data = req.body as Buffer;
  if (!Buffer.isBuffer(data) || !data.length) throw new BadRequest('Choose a file.');
  E.addFile(id(req), { kind: kind as E.FileKind, name: str(req.query.name) ?? 'file', mime: String(req.get('content-type') ?? '').split(';')[0].trim(), data });
  return E.getItem(id(req));
}));
equipmentRoutes.get('/equipment/files/:id', (req, res, next) => {
  try {
    const { file, data } = E.fileData(Number(req.params.id));
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    const inline = req.query.download !== '1';
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${file.name.replace(/[^\w.() -]+/g, '_')}"`);
    res.type(file.mime).send(data);
  } catch (e) {
    next(e);
  }
});
equipmentRoutes.delete('/equipment/files/:id', h((req) => {
  E.removeFile(id(req));
  return { deleted: true };
}));

// ---- labels and the register as a spreadsheet
equipmentRoutes.get('/equipment/labels', h(async (req) => {
  const ids = (str(req.query.items) ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
  const given = str(req.query.base) ?? '';
  if (!/^https?:\/\/[^\s/?#]+$/.test(given)) throw new BadRequest('Bad address for the labels.');
  const origin = addressForOthers(given);
  const rows = ids.length
    ? all<{ id: number; number: string; name: string; location: string | null }>(`SELECT id, number, name, location FROM equipment WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY number`, ...ids)
    : [];
  return { base: origin, labels: await Promise.all(rows.map(async (r) => ({ ...r, qr: await qrSvg(`${origin}/equipment/item/${encodeURIComponent(r.number)}`) }))) };
}));
equipmentRoutes.get('/equipment/maintenance-due.xlsx', h((req, res) => {
  const rows = E.listItems({ due: true });
  sendXlsx(req, res, uiLang(req), {
    file: `maintenance-due-${churchToday()}`, title: 'Maintenance due', pii: true, // who looks after each item
    header: ['number', 'name', 'location', 'looked_after_by', 'next_maintenance_on', 'every_months'],
    rows: rows.map((r) => [r.number, r.name, r.location, r.custodian, r.next_maintenance_on, r.maintenance_every_months]),
  });
}));
