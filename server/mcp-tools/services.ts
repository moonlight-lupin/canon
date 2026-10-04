// MCP tools for services (orders of worship) and service templates.
import { z } from 'zod';
import * as S from '../../shared/schemas.ts';
import { hasAnyText } from '../../shared/labels.ts';
import type { Lang, Service, ServiceItem } from '../../shared/types.ts';
import { tx } from '../db.ts';
import { BadRequest } from '../lib/table.ts';
import * as svc from '../repo/services.ts';
import * as vol from '../repo/volunteers.ts';
import { renderService, serviceAsText } from '../repo/render.ts';
import { getSettings } from '../repo/settings.ts';
import { listBlocks } from '../repo/presentation.ts';
import { DESTRUCTIVE, DateStr, Id, InputError, Limit, RO, WRITE, need, runBatch, type ToolDef } from './common.ts';

// ---------------------------------------------------------------- output shaping

const l10n = (v: Service['title'] | null | undefined) => (hasAnyText(v) ? v : undefined);

export function serviceSummary(s: Service & { item_count?: number; assigned_count?: number }) {
  return {
    id: s.id,
    date: s.date,
    start_time: s.start_time,
    title: s.title,
    status: s.status,
    preacher: s.preacher,
    sermon_title: l10n(s.sermon_title),
    sermon_ref: s.sermon_ref,
    theme: l10n(s.theme),
    languages: s.languages,
    template_id: s.template_id,
    item_count: s.item_count,
    assigned_count: s.assigned_count,
  };
}

const itemLine = (it: ServiceItem) => ({
  id: it.id,
  position: it.position,
  kind: it.kind,
  title: it.title,
  ref_id: it.ref_id,
  scripture_ref: it.scripture_ref,
  stanzas: it.stanzas ?? undefined,
  duration_min: it.duration_min,
});

const orderOf = (serviceId: number) => svc.items.list('service_id = ?', [serviceId], 'position, id').map(itemLine);

const parasToText = (paras: { who: string | null; text: string }[][]) =>
  paras.map((p) => p.map((l) => (l.who ? `${l.who}: ${l.text}` : l.text)).join('\n')).join('\n\n');

function serviceDetail(id: number, includeText: boolean) {
  const full = svc.getServiceFull(id);
  const r = renderService(full);
  const blockName = full.items.some((it) => it.slide_blocks?.length) ? new Map(listBlocks().map((b) => [b.id, b.name])) : new Map<number, string>();
  return {
    ...serviceSummary(full),
    end_time: r.end_time,
    notes: full.notes,
    items: full.items.map((it, i) => {
      const ri = r.items[i];
      const out: Record<string, unknown> = {
        id: it.id,
        position: it.position,
        kind: it.kind,
        title: it.title,
        subtitle: l10n(ri.subtitle),
        start: ri.start,
        duration_min: it.duration_min,
        ref_id: it.ref_id,
        scripture_ref: it.scripture_ref,
        stanzas: it.stanzas,
        hymnal_id: it.hymnal_id,
        role_id: it.role_id,
        role: ri.role_name,
        leader: ri.leader,
        notes: it.notes,
        in_bulletin: it.in_bulletin,
        on_slides: it.on_slides,
        custom_body: hasAnyText(it.body) || undefined,
        // QR codes / notes projected after the item (deleted blocks are left out)
        slide_blocks: ri.slide_blocks.length ? ri.slide_blocks.map((b) => ({ id: b.id, name: blockName.get(b.id) ?? '', kind: b.kind })) : undefined,
      };
      if (ri.song) {
        out.song = {
          id: ri.song.id,
          title: ri.song.title,
          public_domain: ri.song.public_domain,
          ccli: ri.song.ccli,
          stanzas: includeText ? ri.song.stanzas : ri.song.stanzas.map((s) => s.label),
        };
      }
      if (ri.scripture) {
        out.scripture = {
          ref: ri.scripture.ref,
          error: ri.scripture.error,
          passages: Object.fromEntries(
            Object.entries(ri.scripture.passages).map(([lang, p]) => [
              lang,
              includeText
                ? { translation: p!.translation, text: p!.verses.map((v) => `${v.verse} ${v.text}`).join(' ') }
                : { translation: p!.translation, verse_count: p!.verses.length },
            ]),
          ),
        };
      }
      if (ri.paras) {
        out.text = includeText
          ? Object.fromEntries(Object.entries(ri.paras).map(([lang, p]) => [lang, parasToText(p!)]))
          : `(${Object.keys(ri.paras).join('+')} text — pass include_text=true to read it)`;
      }
      return out;
    }),
    // Roster: names only, never contact details.
    roster: full.assignments.map((a) => ({
      assignment_id: a.id, role_id: a.role_id, role: a.role_name, person_id: a.person_id, person: a.person_name, status: a.status,
    })),
    notices: r.notices.length ? r.notices : undefined,
  };
}

const templateSummary = (t: ReturnType<typeof svc.templates.get>) => ({
  id: t.id, key: t.key, name: t.name, description: l10n(t.description),
  service_type: t.service_type, start_time: t.start_time, item_count: t.items.length,
});

/** Text search over the fields people remember a service by. */
const serviceMatches = (s: Service, q: string) =>
  JSON.stringify([s.title, s.sermon_title, s.theme, s.preacher, s.sermon_ref, s.date]).toLowerCase().includes(q);

// ---------------------------------------------------------------- order-of-service batch

const OrderOp = z.object({
  op: z.enum(['add', 'update', 'move', 'remove']),
  item_id: Id.optional().describe('update / move / remove'),
  item: S.ServiceItemInput.partial().optional().describe('add: the new item (kind required); update: only the fields to change'),
  position: z.number().int().min(0).optional().describe('add: 0-based index to insert at (omit = append); move: 0-based target index'),
});
type OrderOp = z.infer<typeof OrderOp>;

function itemOf(serviceId: number, itemId: number) {
  const it = svc.items.get(itemId);
  if (it.service_id !== serviceId) throw new BadRequest(`item ${itemId} is not in service ${serviceId}`);
  return it;
}

function applyOrderOp(serviceId: number, o: OrderOp) {
  switch (o.op) {
    case 'add': {
      const item = need(o.item, 'item', 'add');
      if (!item.kind) throw new InputError('item.kind is required for "add"');
      const it = svc.addItem(serviceId, item as Partial<ServiceItem>, o.position);
      return { op: o.op, item_id: it.id, position: it.position };
    }
    case 'update': {
      itemOf(serviceId, need(o.item_id, 'item_id', 'update'));
      const it = svc.updateItem(o.item_id!, need(o.item, 'item', 'update') as Partial<ServiceItem>);
      return { op: o.op, item_id: it.id };
    }
    case 'move': {
      itemOf(serviceId, need(o.item_id, 'item_id', 'move'));
      const to = need(o.position, 'position', 'move');
      const ids = svc.items.list('service_id = ?', [serviceId], 'position, id').map((i) => i.id);
      ids.splice(ids.indexOf(o.item_id!), 1);
      ids.splice(Math.min(to, ids.length), 0, o.item_id!);
      svc.reorderItems(serviceId, ids);
      return { op: o.op, item_id: o.item_id, position: ids.indexOf(o.item_id!) };
    }
    case 'remove': {
      itemOf(serviceId, need(o.item_id, 'item_id', 'remove'));
      svc.deleteItem(o.item_id!);
      return { op: o.op, item_id: o.item_id };
    }
  }
}

// ---------------------------------------------------------------- tools

export const SERVICE_TOOLS: ToolDef[] = [
  {
    name: 'canon_find_services', module: 'services', access: 'read', title: 'Find services', annotations: RO,
    description: 'List services (orders of worship) by date range and/or text (title, sermon, theme, preacher, reference). Without dates: most recent first; with only from: ascending. Returns summaries (id, date, title, status, preacher, sermon, item_count, assigned_count). Example: {"from":"2026-10-01","to":"2026-10-31"}.',
    input: { from: DateStr.optional(), to: DateStr.optional(), q: z.string().max(200).optional(), limit: Limit(30, 200) },
    handler: (a) => {
      const q = a.q?.trim().toLowerCase();
      const rows = svc.listServices({ from: a.from, to: a.to, limit: q ? 2000 : a.limit });
      return (q ? rows.filter((s) => serviceMatches(s, q)).slice(0, a.limit) : rows).map(serviceSummary);
    },
  },
  {
    name: 'canon_get_service', module: 'services', access: 'read', title: 'Get a service', annotations: RO,
    description: 'One service in full: items (id, position, kind, title, start time, duration, song / text / scripture refs, stanzas, leader, slide_blocks = QR codes / notes by id and name), the roster (names only) and roster warnings (unavailable, double-booked, unfilled roles). Hymn words, Bible text and liturgy only with include_text=true. format "text" returns a plain-text run sheet in lang instead. Example: {"id":12}.',
    input: {
      id: Id,
      format: z.enum(['structured', 'text']).default('structured'),
      include_text: z.boolean().default(false),
      lang: S.LangSchema.optional().describe('for format "text"; default the church\'s first language'),
    },
    handler: (a) => {
      const warnings = vol.rosterWarnings(a.id);
      if (a.format === 'text') {
        const lang = (a.lang ?? getSettings().languages[0] ?? 'en') as Lang;
        return { format: 'text', text: serviceAsText(renderService(a.id), lang), warnings };
      }
      return { ...serviceDetail(a.id, a.include_text), warnings };
    },
  },
  {
    name: 'canon_create_service', module: 'services', access: 'write', title: 'Create a service', annotations: WRITE,
    description: 'Create a service on a date, either from a template (template_id, see canon_get_templates) or as a copy of an existing service (copy_from; with_roster=true also copies the volunteer assignments). Other fields (title, preacher, sermon_title, sermon_ref, theme, languages…) override; L10n fields are {lang: text}. Returns the summary, items and any library items the template referenced but are missing. Example: {"date":"2026-10-11","template_id":1,"preacher":"Rev. Tan"}.',
    input: {
      ...S.ServiceInput.shape,
      template_id: Id.optional(),
      copy_from: Id.optional().describe('service id to duplicate'),
      with_roster: z.boolean().optional(),
    },
    handler: (a) => {
      const { template_id, copy_from, with_roster, ...input } = a;
      if (template_id && copy_from) throw new InputError('give template_id or copy_from, not both');
      if (copy_from) {
        return tx(() => {
          const copy = svc.duplicateService(copy_from, input.date, !!with_roster);
          const { date: _d, ...rest } = input;
          const s = Object.keys(rest).length ? svc.services.update(copy.id, rest) : copy;
          return { service: serviceSummary(s), items: copy.items.map(itemLine), copied_from: copy_from };
        });
      }
      const r = svc.createService(input as Partial<Service> & { date: string }, template_id);
      return { service: serviceSummary(r.service), items: r.service.items.map(itemLine), missing: r.missing.length ? r.missing : undefined };
    },
  },
  {
    name: 'canon_update_service', module: 'services', access: 'write', title: 'Update a service', annotations: { ...WRITE, idempotentHint: true },
    description: 'Change service details: date, start_time, title, preacher, sermon_title, sermon_ref, theme, languages, season, notes, and status ("draft" or "final" = ready to print / project). Only fields in patch change. bibles {lang: code} picks the Bible version per language for every reading (codes from canon_bible with no ref; {} = church default). Returns the summary. Example: {"id":12,"patch":{"status":"final"}}.',
    input: { id: Id, patch: S.ServiceInput.partial() },
    handler: (a) => serviceSummary(svc.services.update(a.id, a.patch)),
  },
  {
    name: 'canon_edit_order', module: 'services', access: 'write', title: 'Edit the order of service', annotations: DESTRUCTIVE,
    description: 'Apply a batch of item operations to one service in a single transaction, in order: add {item, position?}, update {item_id, item: fields to change}, move {item_id, position}, remove {item_id}. All or nothing: if any op fails, nothing changes and per-op errors are returned. Returns the new order. ' +
      'Item kinds: section|song|scripture|text|sermon|prayer|sacrament|offering|announcements|music|other. A song: ref_id = song id (canon_search_library), stanzas ["1","2","R"], hymnal_id picks which hymnal number shows. Liturgy: kind "text", ref_id = text id; for a catechism / confession in parts ALWAYS set stanzas to part labels, e.g. ["1","2","3"]. A reading: kind "scripture", scripture_ref "Psalm 23"; optional bibles {"en":"ESV"} overrides the service Bible version for that reading. posture "stand"|"sit"|"kneel" (null clears) prints 众立 / All stand etc. slide_blocks [block ids] projects QR codes / notes (Library → QR codes & notes, e.g. PayNow, Instagram) on one slide after the item, even when on_slides is false; canon_get_service lists the ids and names already in use; [] clears. Ask the user before removing items. ' +
      'Example: {"service_id":12,"ops":[{"op":"add","item":{"kind":"song","ref_id":40,"stanzas":["1","3"]},"position":2},{"op":"move","item_id":88,"position":0},{"op":"remove","item_id":91}]}.',
    input: { service_id: Id, ops: z.array(OrderOp).min(1).max(50) },
    handler: (a) => {
      svc.services.get(a.service_id);
      const results = runBatch(a.ops as OrderOp[], (o) => applyOrderOp(a.service_id, o));
      return { service_id: a.service_id, results, items: orderOf(a.service_id) };
    },
  },

  // ======================================================== templates
  {
    name: 'canon_get_templates', module: 'templates', access: 'read', title: 'Get service templates', annotations: RO,
    description: 'Service templates (standard orders of worship, e.g. Lord\'s Day morning, Lord\'s Supper). Without id: summaries; with id: the template with its items (kind, title, song_key / text_key, scripture_ref, duration, role). Pass a template id to canon_create_service.',
    input: { id: Id.optional() },
    handler: (a) => (a.id ? svc.templates.get(a.id) : svc.templates.list('', [], 'id').map(templateSummary)),
  },
  {
    name: 'canon_save_service_as_template', module: 'templates', access: 'write', title: 'Save service as template', annotations: WRITE,
    description: 'Save the current order of an existing service as a new reusable template. name is L10n {lang: text}. Returns the template summary.',
    input: { service_id: Id, name: S.L10nSchema },
    handler: (a) => templateSummary(svc.saveAsTemplate(a.service_id, a.name)),
  },
];
