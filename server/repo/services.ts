// Services (orders of worship), their items, templates and sharing.
import crypto from 'node:crypto';
import type { ItemKind, L10n, Service, ServiceFull, ServiceItem, Template, TemplateItem } from '../../shared/types.ts';
import { all, get, run, tx } from '../db.ts';
import { table, BadRequest, NotFound } from '../lib/table.ts';
import { songs, texts } from './library.ts';
import { roleByName, roles, serviceAssignments } from './volunteers.ts';
import { getSettings } from './settings.ts';

export const services = table<Service>({
  name: 'services',
  cols: [
    'date', 'start_time', 'title', 'service_type', 'preacher', 'sermon_title', 'sermon_ref', 'theme', 'languages',
    'status', 'notes', 'share_token', 'template_id', 'season', 'cover', 'slide_theme_id', 'bulletin_template_id', 'bibles', 'bulletin_content',
  ],
  json: ['title', 'sermon_title', 'theme', 'languages', 'cover', 'bibles', 'bulletin_content'],
  touch: true,
});

export const items = table<ServiceItem>({
  name: 'service_items',
  cols: [
    'service_id', 'position', 'kind', 'title', 'ref_id', 'scripture_ref', 'stanzas', 'hymnal_id', 'bulletin_text', 'posture', 'bibles', 'slide_blocks', 'body', 'duration_min', 'role_id',
    'leader', 'notes', 'in_bulletin', 'on_slides', 'slide_bg',
  ],
  json: ['title', 'stanzas', 'body', 'bibles', 'slide_blocks'],
  bool: ['in_bulletin', 'on_slides'],
});

export const templates = table<Template>({
  name: 'templates',
  cols: ['key', 'name', 'description', 'service_type', 'start_time', 'items'],
  json: ['name', 'description', 'items'],
});

/** Default bilingual labels for new items of each kind. */
export const KIND_LABEL: Record<ItemKind, L10n> = {
  section: { en: 'Section', zh: '段落' },
  song: { en: 'Hymn', zh: '诗歌' },
  scripture: { en: 'Scripture Reading', zh: '读经' },
  text: { en: 'Liturgy', zh: '礼文' },
  sermon: { en: 'Sermon', zh: '讲道' },
  prayer: { en: 'Prayer', zh: '祷告' },
  sacrament: { en: 'Sacrament', zh: '圣礼' },
  offering: { en: 'Offering', zh: '奉献' },
  announcements: { en: 'Announcements', zh: '报告' },
  music: { en: 'Music', zh: '音乐' },
  other: { en: 'Item', zh: '项目' },
};

const SLIDE_KINDS: ItemKind[] = ['song', 'scripture', 'text', 'sermon', 'section'];

export interface ServiceQuery {
  from?: string;
  to?: string;
  limit?: number;
}

export function listServices(q: ServiceQuery = {}) {
  const rows = all<Record<string, unknown>>(
    `SELECT s.*, (SELECT COUNT(*) FROM service_items i WHERE i.service_id = s.id) AS item_count,
            (SELECT COUNT(*) FROM assignments a WHERE a.service_id = s.id AND a.status != 'declined') AS assigned_count
     FROM services s WHERE (? IS NULL OR s.date >= ?) AND (? IS NULL OR s.date <= ?)
     ORDER BY s.date ${q.from && !q.to ? 'ASC' : 'DESC'}, s.start_time LIMIT ?`,
    q.from ?? null, q.from ?? null, q.to ?? null, q.to ?? null, q.limit ?? 200,
  );
  return rows.map((r) => ({ ...services.decode(r)!, item_count: r.item_count as number, assigned_count: r.assigned_count as number }));
}

export function getServiceFull(id: number): ServiceFull {
  const s = services.get(id);
  return {
    ...s,
    items: items.list('service_id = ?', [id], 'position, id'),
    assignments: serviceAssignments(id),
  };
}

function nextPosition(serviceId: number) {
  return (get<{ p: number | null }>('SELECT MAX(position) p FROM service_items WHERE service_id = ?', serviceId)?.p ?? -1) + 1;
}

function renumber(serviceId: number) {
  const ids = all<{ id: number }>('SELECT id FROM service_items WHERE service_id = ? ORDER BY position, id', serviceId);
  ids.forEach((r, i) => run('UPDATE service_items SET position = ? WHERE id = ?', i, r.id));
}

function touch(serviceId: number) {
  run(`UPDATE services SET updated_at = datetime('now') WHERE id = ?`, serviceId);
}

/** Fill in sensible defaults (title from the library item, slide flag) for a new item. */
function itemDefaults(input: Partial<ServiceItem>): Partial<ServiceItem> {
  const kind = input.kind ?? 'other';
  let title = input.title && Object.values(input.title).some((v) => v?.trim()) ? input.title : undefined;
  const text = kind === 'text' && input.ref_id ? texts.find(input.ref_id) : undefined;
  if (!title && text) title = text.title;
  if (!title) title = KIND_LABEL[kind];
  // A long text (catechism, confession) without an explicit selection starts with its first three parts,
  // never all 107 questions; the planner then lets the user pick the range.
  const parts = text?.parts ?? [];
  const stanzas = input.stanzas == null && parts.length > 12 ? parts.slice(0, 3).map((p) => p.label) : input.stanzas;
  return {
    duration_min: kind === 'section' ? 0 : 3,
    in_bulletin: true,
    on_slides: SLIDE_KINDS.includes(kind),
    body: {},
    ...input,
    stanzas: stanzas ?? null,
    kind,
    title,
  };
}

function validateRefs(input: Partial<ServiceItem>) {
  if (input.ref_id == null) return;
  if (input.kind === 'song' && !songs.find(input.ref_id)) throw new BadRequest(`song ${input.ref_id} not found`);
  if (input.kind === 'text' && !texts.find(input.ref_id)) throw new BadRequest(`text ${input.ref_id} not found`);
  if (input.role_id != null && !roles.find(input.role_id)) throw new BadRequest(`role ${input.role_id} not found`);
}

/** A slide background must be a picture from Library → QR codes & notes that has an image uploaded. */
function validateBackground(input: Partial<ServiceItem>) {
  if (input.slide_bg == null) return;
  const ok = get<{ n: number }>("SELECT COUNT(*) AS n FROM bulletin_blocks b JOIN assets a ON a.key = 'bulletin-block-' || b.id WHERE b.id = ? AND b.kind = 'image'", input.slide_bg);
  if (!ok?.n) throw new BadRequest(`slide_bg ${input.slide_bg} is not a picture in Library → QR codes & notes (upload one there first)`);
}

export function addItem(serviceId: number, input: Partial<ServiceItem>, position?: number): ServiceItem {
  services.get(serviceId);
  validateRefs(input);
  validateBackground(input);
  return tx(() => {
    const pos = position ?? nextPosition(serviceId);
    run('UPDATE service_items SET position = position + 1 WHERE service_id = ? AND position >= ?', serviceId, pos);
    const it = items.insert({ ...itemDefaults(input), service_id: serviceId, position: pos });
    renumber(serviceId);
    touch(serviceId);
    return items.get(it.id);
  });
}

export function updateItem(itemId: number, patch: Partial<ServiceItem>): ServiceItem {
  const cur = items.get(itemId);
  validateRefs({ ...cur, ...patch });
  if (patch.slide_bg !== undefined) validateBackground(patch);
  const { service_id: _s, position: _p, id: _i, ...rest } = patch as ServiceItem;
  const out = items.update(itemId, rest);
  touch(cur.service_id);
  return out;
}

export function deleteItem(itemId: number) {
  const cur = items.get(itemId);
  tx(() => {
    items.remove(itemId);
    renumber(cur.service_id);
    touch(cur.service_id);
  });
}

export function reorderItems(serviceId: number, itemIds: number[]) {
  const existing = all<{ id: number }>('SELECT id FROM service_items WHERE service_id = ?', serviceId).map((r) => r.id);
  if (existing.length !== itemIds.length || !existing.every((id) => itemIds.includes(id))) {
    throw new BadRequest('itemIds must list every item of the service exactly once');
  }
  tx(() => {
    itemIds.forEach((id, i) => run('UPDATE service_items SET position = ? WHERE id = ?', i, id));
    touch(serviceId);
  });
  return items.list('service_id = ?', [serviceId], 'position');
}

/** Convert template items into concrete service items (resolve library keys and role names). */
export function materialise(tItems: TemplateItem[]) {
  const missing: string[] = [];
  // QR codes / notes on slides are stored by block name in a template; a name that no longer exists is skipped
  const blockIds = tItems.some((t) => t.slide_blocks?.length || t.slide_bg) ? blockIdsByName() : new Map<string, number>();
  const out = tItems.map((t) => {
    let ref_id: number | null = null;
    if (t.song_key) {
      ref_id = get<{ id: number }>('SELECT id FROM songs WHERE key = ?', t.song_key)?.id ?? null;
      if (!ref_id) missing.push(`song "${t.song_key}"`);
    }
    if (t.text_key) {
      ref_id = get<{ id: number }>('SELECT id FROM texts WHERE key = ?', t.text_key)?.id ?? null;
      if (!ref_id) missing.push(`text "${t.text_key}"`);
    }
    const role = t.role ? roleByName(t.role) : undefined;
    return itemDefaults({
      kind: t.kind,
      title: t.title,
      ref_id,
      scripture_ref: t.scripture_ref ?? null,
      body: t.body ?? {},
      duration_min: t.duration_min,
      role_id: role?.id ?? null,
      leader: t.leader ?? null,
      notes: t.notes ?? null,
      ...(t.in_bulletin !== undefined ? { in_bulletin: t.in_bulletin } : {}),
      ...(t.on_slides !== undefined ? { on_slides: t.on_slides } : {}),
      ...(t.posture ? { posture: t.posture } : {}),
      ...(t.bulletin_text ? { bulletin_text: t.bulletin_text } : {}),
      ...(t.slide_blocks?.length ? { slide_blocks: [...new Set(t.slide_blocks.map((n) => blockIds.get(n.trim().toLowerCase())).filter((x): x is number => !!x))] } : {}),
      ...(t.slide_bg && blockIds.get(t.slide_bg.trim().toLowerCase()) ? { slide_bg: blockIds.get(t.slide_bg.trim().toLowerCase())! } : {}),
    });
  });
  return { items: out, missing };
}

/** Bulletin block ids by name (case-insensitive; the first block wins when two share a name). */
function blockIdsByName(): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of all<{ id: number; name: string }>('SELECT id, name FROM bulletin_blocks ORDER BY sort, id')) {
    const k = b.name.trim().toLowerCase();
    if (!m.has(k)) m.set(k, b.id);
  }
  return m;
}

export function createService(input: Partial<Service> & { date: string }, templateId?: number | null) {
  const settings = getSettings();
  const tpl = templateId ? templates.get(templateId) : undefined;
  return tx(() => {
    const svc = services.insert({
      start_time: tpl?.start_time ?? settings.default_start_time,
      title: tpl?.name ?? { en: "Lord's Day Worship", zh: '主日崇拜' },
      service_type: tpl?.service_type ?? 'lords_day',
      languages: settings.default_languages,
      sermon_title: {},
      theme: {},
      ...input,
      template_id: tpl?.id ?? null,
    });
    let missing: string[] = [];
    if (tpl) {
      const m = materialise(tpl.items);
      missing = m.missing;
      m.items.forEach((it, i) => items.insert({ ...it, service_id: svc.id, position: i }));
    }
    return { service: getServiceFull(svc.id), missing };
  });
}

/** Copy a service (items and optionally the roster) to a new date. */
export function duplicateService(id: number, date: string, withRoster = false) {
  const src = getServiceFull(id);
  return tx(() => {
    const { id: _id, items: its, assignments: as, share_token: _t, created_at: _c, updated_at: _u, ...rest } = src;
    const svc = services.insert({ ...rest, date, status: 'draft', share_token: null });
    for (const it of its) {
      const { id: _iid, service_id: _sid, ...r } = it;
      items.insert({ ...r, service_id: svc.id });
    }
    if (withRoster) {
      for (const a of as) {
        run('INSERT INTO assignments (service_id, role_id, person_id, status) VALUES (?,?,?,?)', svc.id, a.role_id, a.person_id, 'scheduled');
      }
    }
    return getServiceFull(svc.id);
  });
}

export function setShare(id: number, enabled: boolean) {
  const token = enabled ? services.get(id).share_token ?? crypto.randomBytes(18).toString('base64url') : null;
  run('UPDATE services SET share_token = ? WHERE id = ?', token, id);
  return token;
}

export function serviceByShareToken(token: string) {
  const r = get<{ id: number }>('SELECT id FROM services WHERE share_token = ?', token);
  if (!r) throw new NotFound('Share link not found or disabled');
  return getServiceFull(r.id);
}

/** Save the current order of a service as a reusable template. */
export function saveAsTemplate(serviceId: number, name: L10n) {
  const svc = getServiceFull(serviceId);
  const blockNames = new Map(all<{ id: number; name: string }>('SELECT id, name FROM bulletin_blocks').map((b) => [b.id, b.name]));
  const tItems: TemplateItem[] = svc.items.map((it) => {
    const t: TemplateItem = { kind: it.kind, title: it.title, duration_min: it.duration_min, in_bulletin: it.in_bulletin, on_slides: it.on_slides };
    if (it.kind === 'song' && it.ref_id) t.song_key = ensureKey('songs', it.ref_id);
    if (it.kind === 'text' && it.ref_id) t.text_key = ensureKey('texts', it.ref_id);
    if (it.scripture_ref) t.scripture_ref = it.scripture_ref;
    if (it.body && (it.body.en || it.body.zh)) t.body = it.body;
    if (it.role_id) t.role = roles.find(it.role_id)?.name.en;
    if (it.leader) t.leader = it.leader;
    if (it.notes) t.notes = it.notes;
    if (it.posture) t.posture = it.posture;
    if (it.bulletin_text) t.bulletin_text = it.bulletin_text;
    const blocks = (it.slide_blocks ?? []).map((id) => blockNames.get(id)).filter((n): n is string => !!n);
    if (blocks.length) t.slide_blocks = blocks;
    if (it.slide_bg && blockNames.get(it.slide_bg)) t.slide_bg = blockNames.get(it.slide_bg);
    return t;
  });
  return templates.insert({
    name,
    description: {},
    service_type: svc.service_type,
    start_time: svc.start_time,
    items: tItems,
  });
}

/** Library items referenced by templates need a stable key; generate one if missing. */
function ensureKey(tableName: 'songs' | 'texts', id: number): string {
  const r = get<{ key: string | null; title: string }>(`SELECT key, title FROM ${tableName} WHERE id = ?`, id);
  if (!r) throw new NotFound(`${tableName} ${id} not found`);
  if (r.key) return r.key;
  const title = (JSON.parse(r.title) as L10n).en ?? 'item';
  const key = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}-${id}`;
  run(`UPDATE ${tableName} SET key = ? WHERE id = ?`, key, id);
  return key;
}

/** Start/end clock times for each item from the service start time and durations. */
export function itemTimes(svc: Pick<Service, 'start_time'>, its: Pick<ServiceItem, 'duration_min'>[]) {
  const [h, m] = svc.start_time.split(':').map(Number);
  let t = h * 60 + m;
  return its.map((it) => {
    const start = t;
    t += it.duration_min;
    return { start: fmt(start), end: fmt(t) };
  });
}
const fmt = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min % 60)).padStart(2, '0')}`;
