// Services (orders of worship), their items, templates and sharing.
import crypto from 'node:crypto';
import type { ItemKind, L10n, MeetingPattern, Service, ServiceFull, ServiceItem, Template, TemplateItem } from '../../shared/types.ts';
import { meetingDates, patternReady } from '../../shared/meeting-pattern.ts';
import { all, get, run, tx } from '../db.ts';
import { table, BadRequest, NotFound } from '../lib/table.ts';
import { SEED_TEMPLATES } from '../seed/templates.ts';
import { songs, texts } from './library.ts';
import { roleByName, roles, serviceAssignments } from './volunteers.ts';
import { getSettings } from './settings.ts';
import { listCongregations } from './congregations.ts';
import { backgroundByName } from './backgrounds.ts';
import { inWall, wallSql } from '../lib/walls.ts';

export const services = table<Service>({
  name: 'services',
  cols: [
    'date', 'start_time', 'title', 'service_type', 'preacher', 'sermon_title', 'sermon_ref', 'theme', 'languages',
    'status', 'notes', 'share_token', 'template_id', 'season', 'cover', 'slide_theme_id', 'bulletin_template_id', 'bibles', 'bulletin_content',
    'congregation_id', 'ref', 'visitor_form', 'attendee', 'space_id', 'kind', 'group_id', 'place', 'chair', 'leader_id', 'topic', 'offering',
  ],
  json: ['title', 'sermon_title', 'theme', 'languages', 'cover', 'bibles', 'bulletin_content', 'visitor_form', 'attendee', 'topic'],
  bool: ['offering'],
  touch: true,
  revision: true,
  guard: { own: 'services' },
});

export const items = table<ServiceItem>({
  name: 'service_items',
  cols: [
    'service_id', 'position', 'kind', 'title', 'ref_id', 'scripture_ref', 'stanzas', 'hymnal_id', 'bulletin_text', 'posture', 'bibles', 'slide_blocks', 'body', 'duration_min', 'role_id',
    'leader', 'notes', 'in_bulletin', 'on_slides', 'slide_background_id',
  ],
  json: ['title', 'stanzas', 'body', 'bibles', 'slide_blocks'],
  bool: ['in_bulletin', 'on_slides'],
  log: { parent: (r) => ({ entity: 'services', id: Number(r.service_id) }) },
  guard: { refs: { service_id: 'services' } },
});

export const templates = table<Template>({
  name: 'templates',
  bool: ['hidden'],
  cols: ['key', 'name', 'description', 'service_type', 'start_time', 'items', 'congregation_id', 'hidden', 'ref', 'slide_theme_id', 'bulletin_template_id'],
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
  /** only this congregation's services */
  congregation_id?: number | null;
  /** services (the default) or meetings */
  kind?: 'service' | 'meeting';
  /** meetings of one group; 'none': one-off meetings */
  group_id?: number | 'none' | null;
}

export function listServices(q: ServiceQuery = {}) {
  const rows = all<Record<string, unknown>>(
    `SELECT s.*, (SELECT COUNT(*) FROM service_items i WHERE i.service_id = s.id) AS item_count,
            (SELECT COUNT(*) FROM assignments a WHERE a.service_id = s.id AND a.status != 'declined') AS assigned_count,
            g.name AS group_name, g.color AS group_color,
            r.attendance AS attendance, (r.id IS NOT NULL) AS recorded,
            CASE WHEN p.id IS NOT NULL THEN TRIM(IFNULL(p.preferred_name, p.first_name) || ' ' || p.last_name) END AS leader_name
     FROM services s LEFT JOIN groups g ON g.id = s.group_id LEFT JOIN service_records r ON r.service_id = s.id
     LEFT JOIN people p ON p.id = s.leader_id
     WHERE s.kind = ? AND (? IS NULL OR s.date >= ?) AND (? IS NULL OR s.date <= ?) AND (? IS NULL OR s.congregation_id = ?)
       AND (? IS NULL OR s.group_id = ?) ${q.group_id === 'none' ? 'AND s.group_id IS NULL' : ''}${wallSql('s.congregation_id').sql}
     ORDER BY s.date ${q.from && !q.to ? 'ASC' : 'DESC'}, s.start_time LIMIT ?`,
    q.kind ?? 'service', q.from ?? null, q.from ?? null, q.to ?? null, q.to ?? null, q.congregation_id ?? null, q.congregation_id ?? null,
    typeof q.group_id === 'number' ? q.group_id : null, typeof q.group_id === 'number' ? q.group_id : null, ...wallSql('s.congregation_id').params, q.limit ?? 200,
  );
  return rows.map((r) => ({
    ...services.decode(r)!, item_count: r.item_count as number, assigned_count: r.assigned_count as number,
    group_name: r.group_name ? JSON.parse(String(r.group_name)) as L10n : null, group_color: (r.group_color as string | null) ?? null,
    attendance: (r.attendance as number | null) ?? null, recorded: !!r.recorded, leader_name: (r.leader_name as string | null) ?? null,
  }));
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

/** A slide background must be a picture in Library → Slide backgrounds. */
function validateBackground(input: Partial<ServiceItem>) {
  if (input.slide_background_id == null) return;
  if (!get('SELECT 1 FROM slide_backgrounds WHERE id = ?', input.slide_background_id)) {
    throw new BadRequest(`slide_background_id ${input.slide_background_id} is not in Library → Slide backgrounds (add the picture there first)`);
  }
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
  if (patch.slide_background_id !== undefined) validateBackground(patch);
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
  const blockIds = tItems.some((t) => t.slide_blocks?.length) ? blockIdsByName() : new Map<string, number>();
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
      // the template's stanzas / catechism questions (only with the song or text they belong to)
      ...(ref_id && t.stanzas?.length ? { stanzas: t.stanzas } : {}),
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
      ...(t.slide_bg && backgroundByName(t.slide_bg) ? { slide_background_id: backgroundByName(t.slide_bg)! } : {}),
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
  input = inWall(input);
  const settings = getSettings();
  const tpl = templateId ? templates.get(templateId) : undefined;
  // the congregation: as given, else the template's; its languages are the starting point
  const congregationId = input.congregation_id !== undefined ? input.congregation_id : (tpl?.congregation_id ?? null);
  const cong = congregationId ? listCongregations().find((c) => c.id === congregationId) : undefined;
  const langs = cong?.languages.filter((l) => settings.languages.includes(l)) ?? [];
  return tx(() => {
    const svc = services.insert({
      start_time: tpl?.start_time ?? settings.default_start_time,
      title: tpl?.name ?? { en: "Lord's Day Worship", zh: '主日崇拜' },
      service_type: tpl?.service_type ?? 'lords_day',
      languages: langs.length ? langs : settings.default_languages,
      congregation_id: congregationId,
      sermon_title: {},
      theme: {},
      // the template's slide and bulletin templates, unless the service chooses its own
      slide_theme_id: tpl?.slide_theme_id ?? null,
      bulletin_template_id: tpl?.bulletin_template_id ?? null,
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

/**
 * A new meeting. Of a group: what isn't given is copied from the group's previous meeting (time, place, leader, title,
 * languages, offering or not), so after the first one a meeting is mostly just a date; the very first takes the
 * group's meeting pattern and name, without an offering. A one-off meeting (no group) needs a title of its own.
 */
export function createMeeting(input: Partial<Service> & { date: string }) {
  input = inWall(input);
  const settings = getSettings();
  const g = input.group_id
    ? get<{ id: number; name: string; congregation_id: number | null; pattern: string }>('SELECT id, name, congregation_id, pattern FROM groups WHERE id = ?', input.group_id)
    : undefined;
  if (input.group_id && !g) throw new NotFound('That group does not exist.');
  if (!g && !Object.values(input.title ?? {}).some((v) => String(v ?? '').trim())) throw new BadRequest('Give the meeting a title (it belongs to no group).');
  const prevRow = g ? get<{ id: number }>("SELECT id FROM services WHERE kind = 'meeting' AND group_id = ? ORDER BY date DESC, start_time DESC LIMIT 1", g.id) : undefined;
  const prev = prevRow ? services.get(prevRow.id) : null;
  const pattern = JSON.parse(g?.pattern || '{}') as { time?: string; place?: string };
  const congregationId = input.congregation_id !== undefined ? input.congregation_id : (g?.congregation_id ?? null);
  const cong = congregationId ? listCongregations().find((c) => c.id === congregationId) : undefined;
  const langs = cong?.languages.filter((l) => settings.languages.includes(l)) ?? [];
  const svc = services.insert({
    kind: 'meeting',
    service_type: 'meeting',
    group_id: g?.id ?? null,
    congregation_id: congregationId,
    start_time: prev?.start_time ?? pattern.time ?? '20:00',
    title: prev?.title ?? (g ? JSON.parse(g.name) : {}),
    place: prev?.place ?? pattern.place ?? null,
    space_id: prev?.space_id ?? null,
    leader_id: prev?.leader_id ?? null,
    chair: prev?.chair ?? null,
    offering: prev?.offering ?? false,
    languages: prev?.languages ?? (langs.length ? langs : settings.default_languages),
    sermon_title: {},
    theme: {},
    topic: {},
    ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
    status: 'final',
  });
  return getServiceFull(svc.id);
}

/**
 * Create a group's meetings ahead from its meeting pattern: every date in the next `weeks` weeks (the group's
 * setting, else 4) that has no meeting of the group yet. Each copies the group's previous meeting, with the time and
 * place of the pattern when it gives them. Returns the meetings made.
 */
export function createMeetingsAhead(groupId: number, weeks?: number, today = new Date().toISOString().slice(0, 10)) {
  const g = get<{ id: number; active: number; pattern: string }>('SELECT id, active, pattern FROM groups WHERE id = ?', groupId);
  if (!g) throw new NotFound('That group does not exist.');
  const pattern = JSON.parse(g.pattern || '{}') as MeetingPattern;
  if (!g.active || !patternReady(pattern)) return [];
  const span = weeks ?? (pattern.ahead_weeks || 4);
  const to = new Date(`${today}T12:00:00Z`);
  to.setUTCDate(to.getUTCDate() + span * 7);
  const last = get<{ date: string }>("SELECT MAX(date) AS date FROM services WHERE kind = 'meeting' AND group_id = ?", g.id)?.date ?? null;
  const have = new Set(all<{ date: string }>("SELECT date FROM services WHERE kind = 'meeting' AND group_id = ? AND date >= ?", g.id, today).map((r) => r.date));
  const made: ServiceFull[] = [];
  for (const date of meetingDates(pattern, today, to.toISOString().slice(0, 10), last)) {
    if (have.has(date)) continue;
    made.push(createMeeting({ group_id: g.id, date, ...(pattern.time ? { start_time: pattern.time } : {}), ...(pattern.place ? { place: pattern.place } : {}) }));
  }
  return made;
}

/** Every active group that creates its meetings ahead (daily). Returns how many meetings were made. */
export function createAllMeetingsAhead(today?: string): number {
  if (getSettings().modules.meetings === false) return 0;
  const ids = all<{ id: number; pattern: string }>("SELECT id, pattern FROM groups WHERE active = 1 AND kind != 'serving_team'")
    .filter((g) => ((JSON.parse(g.pattern || '{}') as MeetingPattern).ahead_weeks ?? 0) > 0).map((g) => g.id);
  return ids.reduce((n, id) => n + createMeetingsAhead(id, undefined, today).length, 0);
}

/** Copy a service (items and optionally the roster) to a new date. */
export function duplicateService(id: number, date: string, withRoster = false) {
  const src = getServiceFull(id);
  return tx(() => {
    // a copy gets no share link, reference or visitor form of its own (they are unique to the original)
    const { id: _id, items: its, assignments: as, share_token: _t, created_at: _c, updated_at: _u, ref: _r, visitor_form: _vf, attendee: _at, ...rest } = src;
    const svc = services.insert({ ...rest, date, status: 'draft', share_token: null, ref: null, visitor_form: {}, attendee: {} });
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
    if ((t.song_key || t.text_key) && it.stanzas?.length) t.stanzas = it.stanzas;
    if (it.scripture_ref) t.scripture_ref = it.scripture_ref;
    if (it.body && (it.body.en || it.body.zh)) t.body = it.body;
    if (it.role_id) t.role = roles.find(it.role_id)?.name.en;
    if (it.leader) t.leader = it.leader;
    if (it.notes) t.notes = it.notes;
    if (it.posture) t.posture = it.posture;
    if (it.bulletin_text) t.bulletin_text = it.bulletin_text;
    const blocks = (it.slide_blocks ?? []).map((id) => blockNames.get(id)).filter((n): n is string => !!n);
    if (blocks.length) t.slide_blocks = blocks;
    if (it.slide_background_id) {
      const bg = get<{ name: string }>('SELECT name FROM slide_backgrounds WHERE id = ?', it.slide_background_id);
      if (bg) t.slide_bg = bg.name;
    }
    return t;
  });
  return templates.insert({
    name,
    description: {},
    service_type: svc.service_type,
    start_time: svc.start_time,
    items: tItems,
    congregation_id: svc.congregation_id ?? null,
    slide_theme_id: svc.slide_theme_id ?? null,
    bulletin_template_id: svc.bulletin_template_id ?? null,
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

// ---------------------------------------------------------------- archiving service templates

/** Keys of Canon's own service templates (seeded at start-up): they can be archived, never deleted. */
const SEED_KEYS = new Set(SEED_TEMPLATES.map((t) => t.key));
export const isBuiltinTemplate = (t: Pick<Template, 'key'>) => !!t.key && SEED_KEYS.has(t.key);
export const withBuiltin = (t: Template): Template => ({ ...t, builtin: isBuiltinTemplate(t) });

/** Archive or restore a service template. The church default cannot be archived. */
export function setServiceTemplateHidden(id: number, hidden: boolean, defaultId: number | null): Template {
  const t = templates.get(id);
  if (hidden && defaultId === id) throw new BadRequest("This is the church default, so it can't be archived. Set another template as the church default first.");
  templates.update(id, { hidden });
  return withBuiltin({ ...t, hidden });
}

/** Delete an archived service template (administrators); built-in templates can't be deleted. */
export function deleteServiceTemplate(id: number) {
  const t = templates.get(id);
  if (isBuiltinTemplate(t)) throw new BadRequest("Built-in templates can't be deleted. Archive it instead.");
  if (!t.hidden) throw new BadRequest('Archive the template first; archived templates can then be deleted.');
  templates.remove(id);
}
