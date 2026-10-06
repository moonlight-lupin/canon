// Bulletin page layout: the ordered list of sections a bulletin template prints (cover, order of service, full
// texts, weekly announcements, a pastor's note, fixed texts, serving tables, QR codes …), with page breaks and a
// back-cover group. Pure functions shared by the server (render, Word export, validation) and the web client
// (bulletin pages, template editor, planner).
//
// Only TYPES are imported from presentation.ts; presentation.ts imports the functions here (one-way at runtime).
import type { L10n } from './types.ts';
import type { BulletinBackPage, BulletinOptions } from './presentation.ts';

export type BulletinSectionType =
  | 'cover'
  | 'order'
  | 'full_texts'
  | 'announcements'
  | 'weekly_text'
  | 'fixed_text'
  | 'serving_this_week'
  | 'serving_next_week'
  | 'sermon_notes'
  | 'blocks'
  | 'note'
  | 'ccli_contact'
  | 'service_notes'
  | 'page_break';

/** Every section type, in the order the "Add section" menu lists them. */
export const SECTION_TYPES: BulletinSectionType[] = [
  'cover', 'order', 'full_texts', 'announcements', 'weekly_text', 'fixed_text', 'serving_this_week', 'serving_next_week',
  'note', 'blocks', 'sermon_notes', 'ccli_contact', 'service_notes', 'page_break',
];

/** Sections that make sense only once in a layout (a second copy is dropped). */
const SINGLE: BulletinSectionType[] = ['cover', 'order', 'full_texts', 'announcements', 'ccli_contact', 'service_notes'];

export interface BulletinSection {
  /** stable id within the layout (drag and drop, React keys) */
  id: string;
  type: BulletinSectionType;
  /** start this section on a new page */
  new_page?: boolean;
  /** keep the whole section on one page when it fits (else it may flow over pages) */
  keep_together?: boolean;
  /** part of the back cover: printed on the last page; folded booklets add their spare pages before it */
  last_page?: boolean;
  /** announcements / weekly_text / fixed_text / service_notes: the heading ({} = the built-in one, if any) */
  heading?: L10n;
  /** weekly_text: the key its words are saved under in service.bulletin_content, e.g. "pastor_note" */
  key?: string;
  /** fixed_text / note: the words (the same every week) */
  text?: L10n;
  /** serving_this_week / serving_next_week: role names, one table column each; [] this week = the whole roster as a list */
  roles?: string[];
  /** blocks: bulletin block ids (Library → QR codes & notes), printed in this order */
  blocks?: number[];
  /** announcements: also print the service's Notes box after the announcements */
  service_notes?: boolean;
  /** sermon_notes: only on a spare page of a folded booklet, when the service has a sermon */
  spare_only?: boolean;
  /** sermon_notes: the rest of the page after the section before it (e.g. under the announcements), not a page of its own */
  fill?: boolean;
  /** ccli_contact: print the copyright / CCLI notices, the church address and contact */
  ccli?: boolean;
  contact?: boolean;
}

/** Key of the weekly announcements in service.bulletin_content. */
export const ANNOUNCEMENTS_KEY = 'announcements';
export const SECTION_KEY_RE = /^[a-z0-9_-]{1,40}$/;
export const MAX_SECTIONS = 40;

const ID_RE = /^[\w-]{1,40}$/;
const LANG_KEY = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

/** A language-keyed text from untrusted input (non-empty strings, clamped). */
function l10n(v: unknown, max = 500): L10n {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: L10n = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (LANG_KEY.test(k) && typeof x === 'string' && x.trim()) out[k] = x.slice(0, max);
  }
  return out;
}
const anyText = (v: L10n | undefined) => !!v && Object.values(v).some((x) => !!x?.trim());
const names = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string').map((x) => x.trim().slice(0, 80)).filter(Boolean))].slice(0, 12) : [];
const ids = (v: unknown): number[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is number => Number.isInteger(x) && (x as number) > 0))].slice(0, 12) : [];

/** Fill in, clamp and de-duplicate a layout from untrusted input. Back-cover sections are moved to the end. */
export function normaliseLayout(input: unknown): BulletinSection[] {
  if (!Array.isArray(input)) return [];
  const used = new Set<string>();
  const seen = new Set<BulletinSectionType>();
  const out: BulletinSection[] = [];
  for (const raw of input.slice(0, MAX_SECTIONS * 2)) {
    if (!raw || typeof raw !== 'object') continue;
    const v = raw as Record<string, unknown>;
    const type = v.type as BulletinSectionType;
    if (!SECTION_TYPES.includes(type)) continue;
    if (SINGLE.includes(type)) {
      if (seen.has(type)) continue;
      seen.add(type);
    }
    let id = typeof v.id === 'string' && ID_RE.test(v.id) && !used.has(v.id) ? v.id : '';
    for (let n = 1; !id; n++) if (!used.has(`${type}-${n}`)) id = `${type}-${n}`;
    used.add(id);
    const s: BulletinSection = { id, type };
    if (v.new_page === true && type !== 'page_break') s.new_page = true;
    if (v.keep_together === true && type !== 'page_break') s.keep_together = true;
    if (v.last_page === true) s.last_page = true;
    switch (type) {
      case 'announcements':
        s.heading = l10n(v.heading);
        if (v.service_notes === true) s.service_notes = true;
        break;
      case 'service_notes':
        s.heading = l10n(v.heading);
        break;
      case 'weekly_text':
        s.key = typeof v.key === 'string' && SECTION_KEY_RE.test(v.key) ? v.key : `text_${id.replace(/[^a-z0-9_-]/gi, '').toLowerCase().slice(0, 30) || 'x'}`;
        s.heading = l10n(v.heading);
        break;
      case 'fixed_text':
        s.heading = l10n(v.heading);
        s.text = l10n(v.text, 4000);
        break;
      case 'note':
        s.text = l10n(v.text);
        break;
      case 'serving_this_week':
      case 'serving_next_week':
        s.roles = names(v.roles);
        break;
      case 'blocks':
        s.blocks = ids(v.blocks);
        break;
      case 'sermon_notes':
        if (v.fill === true) s.fill = true;
        else if (v.spare_only === true) s.spare_only = true;
        break;
      case 'ccli_contact':
        s.ccli = v.ccli !== false;
        s.contact = v.contact !== false;
        break;
    }
    out.push(s);
    if (out.length >= MAX_SECTIONS) break;
  }
  // the back cover is one group at the end (stable order)
  return [...out.filter((s) => !s.last_page), ...out.filter((s) => s.last_page)];
}

/** The template fields that existed before page layouts. */
export type LegacyBulletinFields = Pick<BulletinOptions, 'cover' | 'full_text_section' | 'announcements_section' | 'announcements_heading' | 'sections' | 'back_page'>;

const hasBack = (bp: BulletinBackPage) => bp.this_week_roles.length > 0 || bp.next_week_roles.length > 0 || anyText(bp.note) || bp.blocks.length > 0;

/**
 * The layout that prints exactly what a template printed before page layouts existed:
 * cover (or banner) → order → [page break, full texts] → [page break, announcements] → [sermon notes on a spare page]
 * → back cover (service notes, roster, serving tables, note, blocks, notices and contact). The back cover starts a
 * page of its own when the template designed one, used a banner or a separate announcements page.
 */
export function legacyLayout(o: LegacyBulletinFields): BulletinSection[] {
  const out: BulletinSection[] = [{ id: 'cover', type: 'cover' }, { id: 'order', type: 'order' }];
  let n = 0;
  const brk = (last?: boolean): BulletinSection => ({ id: `break-${++n}`, type: 'page_break', ...(last ? { last_page: true } : {}) });
  const separateAnn = o.announcements_section === 'separate';
  if (o.full_text_section === 'separate') out.push(brk(), { id: 'full_texts', type: 'full_texts' });
  if (separateAnn) {
    out.push(brk(), { id: 'announcements', type: 'announcements', heading: { ...o.announcements_heading }, ...(o.sections.notes ? { service_notes: true } : {}) });
  }
  if (o.sections.sermon_notes) out.push({ id: 'sermon_notes', type: 'sermon_notes', spare_only: true });
  const bp = o.back_page;
  const back: BulletinSection[] = [];
  if (o.sections.notes && !separateAnn) back.push({ id: 'service_notes', type: 'service_notes', heading: {} });
  if (o.sections.roster) back.push({ id: 'roster', type: 'serving_this_week', roles: [] });
  if (bp.this_week_roles.length) back.push({ id: 'serving_this_week', type: 'serving_this_week', roles: [...bp.this_week_roles] });
  if (bp.next_week_roles.length) back.push({ id: 'serving_next_week', type: 'serving_next_week', roles: [...bp.next_week_roles] });
  if (anyText(bp.note)) back.push({ id: 'note', type: 'note', text: { ...bp.note } });
  if (bp.blocks.length) back.push({ id: 'blocks', type: 'blocks', blocks: [...bp.blocks] });
  if (o.sections.ccli || o.sections.contact) back.push({ id: 'ccli_contact', type: 'ccli_contact', ccli: o.sections.ccli, contact: o.sections.contact });
  if (back.length) {
    if (o.cover === 'banner' || separateAnn || hasBack(bp)) out.push(brk(true));
    out.push(...back.map((s) => ({ ...s, last_page: true })));
  }
  return out;
}

/** The old option fields as the layout implies them (kept readable for older clients and tools for one release). */
export function legacyFromLayout(layout: BulletinSection[]): Omit<LegacyBulletinFields, 'cover'> {
  const find = (t: BulletinSectionType, f: (s: BulletinSection) => boolean = () => true) => layout.find((s) => s.type === t && f(s));
  const ann = find('announcements');
  const cc = find('ccli_contact');
  return {
    full_text_section: find('full_texts') ? 'separate' : 'inline',
    announcements_section: ann ? 'separate' : 'inline',
    announcements_heading: { ...(ann?.heading ?? {}) },
    sections: {
      roster: !!find('serving_this_week', (s) => !s.roles?.length),
      notes: !!find('service_notes') || !!ann?.service_notes,
      ccli: !!cc?.ccli,
      sermon_notes: !!find('sermon_notes'),
      contact: !!cc?.contact,
    },
    back_page: {
      this_week_roles: [...(find('serving_this_week', (s) => !!s.roles?.length)?.roles ?? [])],
      next_week_roles: [...(find('serving_next_week')?.roles ?? [])],
      note: { ...(find('note')?.text ?? {}) },
      blocks: [...(find('blocks')?.blocks ?? [])],
    },
  };
}

export const hasSection = (layout: BulletinSection[] | undefined, type: BulletinSectionType) => !!layout?.some((s) => s.type === type);

/** The sections filled in per service (announcements first), one entry per key. */
export function weeklySections(layout: BulletinSection[] | undefined): { key: string; heading: L10n; announcements: boolean }[] {
  const out: { key: string; heading: L10n; announcements: boolean }[] = [];
  const ann = layout?.find((s) => s.type === 'announcements');
  if (ann) out.push({ key: ANNOUNCEMENTS_KEY, heading: ann.heading ?? {}, announcements: true });
  for (const s of layout ?? []) {
    if (s.type === 'weekly_text' && s.key && !out.some((x) => x.key === s.key)) out.push({ key: s.key, heading: s.heading ?? {}, announcements: false });
  }
  return out;
}

/** The blocks a layout prints (Library → QR codes & notes). */
export const layoutBlockIds = (layout: BulletinSection[] | undefined): number[] => [...new Set((layout ?? []).flatMap((s) => (s.type === 'blocks' ? s.blocks ?? [] : [])))];

/**
 * Pages of a folded booklet: the page count is made a multiple of 4 with blank pages, which go BEFORE the back
 * cover (the last-page group) so that it lands on the back of the booklet.
 *  - `main`: pages before the back cover; `back`: the back cover's pages (may be empty);
 *  - `combined`: the same content paginated as one flow (the back cover follows straight on), used when the
 *    back cover does not have to start a page of its own (`strict` = false): if that flow already fills the
 *    booklet, or putting the back cover on its own would need more sheets, the flow wins and blanks go at the end.
 * Returns the pages and how many blank pages were added.
 */
export function padBooklet<T>(main: T[], back: T[], blank: (i: number) => T, opts: { strict?: boolean; combined?: T[] } = {}): { pages: T[]; added: number } {
  const up4 = (n: number) => Math.ceil(n / 4) * 4;
  const blanks = (n: number) => Array.from({ length: n }, (_, i) => blank(i));
  if (!back.length) return { pages: [...main, ...blanks(up4(main.length) - main.length)], added: up4(main.length) - main.length };
  const n = main.length + back.length;
  if (opts.strict || !opts.combined) return { pages: [...main, ...blanks(up4(n) - n), ...back], added: up4(n) - n };
  const c = opts.combined;
  if (c.length % 4 === 0) return { pages: c, added: 0 };
  if (n <= up4(c.length)) return { pages: [...main, ...blanks(up4(c.length) - n), ...back], added: up4(c.length) - n };
  return { pages: [...c, ...blanks(up4(c.length) - c.length)], added: up4(c.length) - c.length };
}

/** A new section of a type, with a fresh id (used by the template editor). */
export function newSection(type: BulletinSectionType, extra: Partial<BulletinSection> = {}): BulletinSection {
  const id = `${type}-${Math.random().toString(36).slice(2, 8)}`;
  const s: BulletinSection = { id, type };
  if (type === 'announcements' || type === 'service_notes' || type === 'fixed_text' || type === 'weekly_text') s.heading = {};
  if (type === 'weekly_text') s.key = `text_${id.slice(-6)}`;
  if (type === 'fixed_text' || type === 'note') s.text = {};
  if (type === 'serving_this_week' || type === 'serving_next_week') s.roles = [];
  if (type === 'blocks') s.blocks = [];
  if (type === 'ccli_contact') Object.assign(s, { ccli: true, contact: true });
  return { ...s, ...extra };
}
