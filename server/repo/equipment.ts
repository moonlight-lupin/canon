// The asset register (0.15, optional module "equipment"): the church's equipment and property — what each item is,
// where it is and who looks after it, when it was bought and for how much, its condition, photos and receipts, and
// its maintenance (a log, and the next service due). Items are numbered E0001 … with QR labels.
import { all, get, run, tx, type SqlValue } from '../db.ts';
import { BadRequest, Conflict, NotFound, table } from '../lib/table.ts';
import { addDays, localToday, nextNumber } from './lending.ts';

export type Condition = 'good' | 'fair' | 'poor' | 'broken';
export type ItemStatus = 'in_use' | 'stored' | 'out_of_service';
export const CONDITIONS: Condition[] = ['good', 'fair', 'poor', 'broken'];
export const ITEM_STATUSES: ItemStatus[] = ['in_use', 'stored', 'out_of_service'];
export type FileKind = 'photo' | 'receipt' | 'warranty' | 'other';
export const FILE_KINDS: FileKind[] = ['photo', 'receipt', 'warranty', 'other'];

export interface Item {
  id: number;
  number: string;
  name: string;
  category: string | null;
  make_model: string | null;
  serial_no: string | null;
  location: string | null;
  custodian_id: number | null;
  bought_on: string | null;
  price: number | null;
  supplier: string | null;
  warranty_until: string | null;
  condition: Condition;
  status: ItemStatus;
  maintenance_every_months: number | null;
  next_maintenance_on: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
export interface Maintenance { id: number; equipment_id: number; done_on: string; what: string; cost: number | null; done_by: string | null; notes: string | null; created_at: string }
export interface ItemFile { id: number; equipment_id: number; kind: FileKind; name: string; mime: string; size: number; created_at: string }

export const items = table<Item>({
  name: 'equipment',
  cols: ['number', 'name', 'category', 'make_model', 'serial_no', 'location', 'custodian_id', 'bought_on', 'price', 'supplier', 'warranty_until', 'condition', 'status', 'maintenance_every_months', 'next_maintenance_on', 'notes'],
  touch: true,
  guard: { refs: { custodian_id: 'people' } },
});
export const maintenance = table<Maintenance>({
  name: 'equipment_maintenance',
  cols: ['equipment_id', 'done_on', 'what', 'cost', 'done_by', 'notes'],
  log: { parent: (r) => ({ entity: 'equipment', id: Number(r.equipment_id) }) },
});
export const files = table<ItemFile>({
  name: 'equipment_files',
  cols: ['equipment_id', 'kind', 'name', 'mime', 'size'],
  log: { parent: (r) => ({ entity: 'equipment', id: Number(r.equipment_id) }) },
});

const PERSON_NAME = `TRIM(IFNULL(p.preferred_name, p.first_name) || ' ' || p.last_name) || CASE WHEN p.native_name IS NOT NULL THEN ' ' || p.native_name ELSE '' END`;
/** Maintenance shows as due this many days ahead. */
export const DUE_AHEAD_DAYS = 14;

export const addMonths = (date: string, months: number) => {
  const d = new Date(`${date}T12:00:00`);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return d.toLocaleDateString('en-CA');
};

export interface ItemRow extends Item {
  custodian: string | null;
  photo_id: number | null;
  maintenance_due: boolean;
}

export function listItems(q: { q?: string; category?: string; location?: string; status?: string; due?: boolean } = {}): ItemRow[] {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (q.q?.trim()) {
    const like = `%${q.q.trim().replace(/[%_]/g, (c) => `\\${c}`)}%`;
    where.push(`(e.number LIKE ? ESCAPE '\\' OR e.name LIKE ? ESCAPE '\\' OR e.make_model LIKE ? ESCAPE '\\' OR e.serial_no LIKE ? ESCAPE '\\' OR e.location LIKE ? ESCAPE '\\' OR e.category LIKE ? ESCAPE '\\' OR (${PERSON_NAME}) LIKE ? ESCAPE '\\')`);
    params.push(like, like, like, like, like, like, like);
  }
  for (const k of ['category', 'location'] as const) {
    if (q[k]?.trim()) {
      where.push(`e.${k} = ?`);
      params.push(q[k]!.trim());
    }
  }
  if (q.status && ITEM_STATUSES.includes(q.status as ItemStatus)) {
    where.push('e.status = ?');
    params.push(q.status);
  }
  const soon = addDays(localToday(), DUE_AHEAD_DAYS);
  if (q.due) {
    where.push("e.next_maintenance_on IS NOT NULL AND e.next_maintenance_on <= ? AND e.status <> 'out_of_service'");
    params.push(soon);
  }
  return all<Record<string, unknown>>(
    `SELECT e.*, ${PERSON_NAME} AS custodian,
       (SELECT f.id FROM equipment_files f WHERE f.equipment_id = e.id AND f.kind = 'photo' ORDER BY f.id LIMIT 1) AS photo_id
     FROM equipment e LEFT JOIN people p ON p.id = e.custodian_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${q.due ? 'e.next_maintenance_on, ' : ''}e.number COLLATE NOCASE`,
    ...params,
  ).map((r) => ({
    ...(items.decode(r) as Item), custodian: (r.custodian as string | null) ?? null, photo_id: (r.photo_id as number | null) ?? null,
    maintenance_due: !!r.next_maintenance_on && String(r.next_maintenance_on) <= soon && r.status !== 'out_of_service',
  }));
}

/** Categories and locations in use (filters and the form's suggestions). */
export function itemLists() {
  const of = (col: string) => all<{ v: string }>(`SELECT DISTINCT ${col} AS v FROM equipment WHERE ${col} IS NOT NULL AND ${col} <> '' ORDER BY ${col} COLLATE NOCASE`).map((r) => r.v);
  return { categories: of('category'), locations: of('location') };
}

export function getItem(id: number) {
  const item = items.get(id);
  const custodian = item.custodian_id ? get<{ name: string }>(`SELECT ${PERSON_NAME} AS name FROM people p WHERE id = ?`, item.custodian_id)?.name ?? null : null;
  return {
    ...item, custodian,
    maintenance: maintenance.list('equipment_id = ?', [id], 'done_on DESC, id DESC'),
    files: files.list('equipment_id = ?', [id], 'kind, id'),
  };
}

export function findItem(scanned: string) {
  const s = scanned.trim();
  const m = s.match(/\/equipment\/item\/([^/?#\s]+)/i);
  const number = decodeURIComponent(m ? m[1] : s).trim();
  const r = get<{ id: number }>('SELECT id FROM equipment WHERE number = ?', number);
  if (!r) throw new NotFound(`No item is numbered ${number}.`);
  return getItem(r.id);
}

export type ItemInput = Partial<Omit<Item, 'id' | 'created_at' | 'updated_at'>>;

function checkItem(i: ItemInput) {
  if (i.name !== undefined && !i.name?.trim()) throw new BadRequest('Give the item a name.');
  if (i.condition !== undefined && !CONDITIONS.includes(i.condition)) throw new BadRequest('Unknown condition.');
  if (i.status !== undefined && !ITEM_STATUSES.includes(i.status)) throw new BadRequest('Unknown status.');
  if (i.price != null && (!Number.isFinite(i.price) || i.price < 0)) throw new BadRequest('The price looks wrong.');
  if (i.maintenance_every_months != null && (!Number.isInteger(i.maintenance_every_months) || i.maintenance_every_months < 1 || i.maintenance_every_months > 120)) {
    throw new BadRequest('Maintenance every 1 to 120 months.');
  }
  if (i.custodian_id != null) {
    const p = get<{ erased_at: string | null }>('SELECT erased_at FROM people WHERE id = ?', i.custodian_id);
    if (!p || p.erased_at) throw new BadRequest('Choose who looks after it from the member register.');
  }
}

export function saveItem(id: number | null, input: ItemInput): Item {
  checkItem(input);
  const data = { ...input, name: input.name?.trim() };
  if (data.number !== undefined || !id) {
    const n = data.number?.trim() || (id ? '' : nextNumber('equipment', 'E'));
    if (!n) throw new BadRequest('An item needs a number.');
    if (get('SELECT 1 FROM equipment WHERE number = ? AND id IS NOT ?', n, id)) throw new Conflict(`Number ${n} is already used.`);
    data.number = n;
  }
  return id ? items.update(id, data) : items.insert({ condition: 'good', status: 'in_use', ...data });
}

export function deleteItem(id: number) {
  items.get(id);
  tx(() => {
    for (const f of files.list('equipment_id = ?', [id])) run('DELETE FROM assets WHERE key = ?', `equip-file-${f.id}`);
    items.remove(id);
  });
}

/** Record maintenance; with a regular interval, the next one is due that many months later. */
export function addMaintenance(itemId: number, m: { done_on?: string | null; what: string; cost?: number | null; done_by?: string | null; notes?: string | null }) {
  const item = items.get(itemId);
  if (!m.what?.trim()) throw new BadRequest('Say what was done.');
  if (m.cost != null && (!Number.isFinite(m.cost) || m.cost < 0)) throw new BadRequest('The cost looks wrong.');
  const done = m.done_on || localToday();
  return tx(() => {
    const row = maintenance.insert({ equipment_id: itemId, done_on: done, what: m.what.trim(), cost: m.cost ?? null, done_by: m.done_by ?? null, notes: m.notes ?? null });
    if (item.maintenance_every_months) {
      const next = addMonths(done, item.maintenance_every_months);
      if (!item.next_maintenance_on || next > item.next_maintenance_on || done >= item.next_maintenance_on) items.update(itemId, { next_maintenance_on: next });
    }
    return row;
  });
}

export function removeMaintenance(id: number) {
  maintenance.get(id);
  maintenance.remove(id);
}

// ---------------------------------------------------------------- photos and receipts

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MIME: Record<string, (b: Buffer) => boolean> = {
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8,
  'image/webp': (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP',
  'application/pdf': (b) => b.subarray(0, 5).toString() === '%PDF-',
};

/** A photo or PDF someone uploaded: the kind it says it is, at most 10 MB. Returns a safe file name. (Also claims' receipts.) */
export function checkUpload(mime: string, data: Buffer, fileName: string): string {
  const check = MIME[mime];
  if (!check) throw new BadRequest('Photos (PNG, JPEG, WebP) and PDF files only.');
  if (data.length > MAX_FILE_BYTES) throw Object.assign(new Error('The file is larger than 10 MB.'), { status: 413 });
  if (!check(data)) throw new BadRequest('The file is not what its name says.');
  return (fileName || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120);
}

export function addFile(itemId: number, f: { kind: FileKind; name: string; mime: string; data: Buffer }): ItemFile {
  items.get(itemId);
  if (!FILE_KINDS.includes(f.kind)) throw new BadRequest('Unknown kind of file.');
  const name = checkUpload(f.mime, f.data, f.name);
  return tx(() => {
    const row = files.insert({ equipment_id: itemId, kind: f.kind, name, mime: f.mime, size: f.data.length });
    run("INSERT INTO assets (key, mime, data, updated_at) VALUES (?, ?, ?, datetime('now'))", `equip-file-${row.id}`, f.mime, f.data);
    return row;
  });
}

export function fileData(id: number) {
  const f = files.get(id);
  const a = get<{ mime: string; data: Uint8Array }>('SELECT mime, data FROM assets WHERE key = ?', `equip-file-${id}`);
  if (!a) throw new NotFound('The file is missing.');
  return { file: f, data: Buffer.from(a.data) };
}

export function removeFile(id: number) {
  files.get(id);
  tx(() => {
    run('DELETE FROM assets WHERE key = ?', `equip-file-${id}`);
    files.remove(id);
  });
}

/** People who can look after items (names only: an asset keeper needs no access to members' details). */
export function custodians(q: string, limit = 20) {
  const like = `%${q.trim().replace(/[%_]/g, (c) => `\\${c}`)}%`;
  return all<{ id: number; name: string; status: string }>(
    `SELECT p.id, ${PERSON_NAME} AS name, p.status FROM people p
     WHERE p.erased_at IS NULL AND (p.first_name LIKE ? ESCAPE '\\' OR p.last_name LIKE ? ESCAPE '\\' OR p.preferred_name LIKE ? ESCAPE '\\' OR p.native_name LIKE ? ESCAPE '\\'
       OR (IFNULL(p.preferred_name, p.first_name) || ' ' || p.last_name) LIKE ? ESCAPE '\\')
     ORDER BY p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE LIMIT ?`,
    like, like, like, like, like, limit,
  );
}

/** The dashboard's numbers. */
export function equipmentCounts() {
  const soon = addDays(localToday(), DUE_AHEAD_DAYS);
  return {
    items: get<{ n: number }>('SELECT COUNT(*) n FROM equipment')!.n,
    maintenance_due: get<{ n: number }>("SELECT COUNT(*) n FROM equipment WHERE next_maintenance_on IS NOT NULL AND next_maintenance_on <= ? AND status <> 'out_of_service'", soon)!.n,
  };
}

export const custodianOf = (personId: number) => all<{ id: number; number: string; name: string }>('SELECT id, number, name FROM equipment WHERE custodian_id = ? ORDER BY number', personId);
