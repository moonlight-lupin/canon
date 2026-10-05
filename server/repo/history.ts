// Precedent: what the church did before. Similar past services (same Sunday last year, same sermon book, same
// season…), when each song was last sung, and how far a catechism / confession series has got. Pure SQL + scoring;
// used by the MCP tools (agents look at precedent before proposing a plan) and the planner's "last sung" badges.
import type { L10n, Season } from '../../shared/types.ts';
import { BOOKS, parseRef, type RefSegment } from '../../shared/bible.ts';
import { easter, seasonOf } from '../../shared/season.ts';
import { partRuns } from '../../shared/parts.ts';
import { all, get } from '../db.ts';
import { NotFound } from '../lib/table.ts';
import { checkRow, wallSql } from '../lib/walls.ts';

const DAY = 86400_000;
const ts = (d: string) => Date.parse(d + 'T00:00:00Z');
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
export const todayIso = () => new Date().toISOString().slice(0, 10);

/** Seasons whose dates move with Easter: compare them by their offset from Easter, not the calendar date. */
const EASTER_CYCLE = new Set<Season>(['lent', 'holy_week', 'easter', 'pentecost']);

const parseJson = <T>(s: unknown, fallback: T): T => {
  if (typeof s !== 'string' || !s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

/** One line from an L10n value: the distinct non-empty texts joined, e.g. "Hymn / 诗歌". */
export function brief(v: L10n | string | null | undefined): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  return [...new Set(Object.values(v).map((x) => x?.trim()).filter((x): x is string => !!x))].join(' / ');
}

// ---------------------------------------------------------------- scripture overlap

const safeRef = (ref: string | null | undefined): RefSegment[] => {
  if (!ref?.trim()) return [];
  try {
    return parseRef(ref);
  } catch {
    return [];
  }
};

const vStart = (s: RefSegment) => s.startCh * 1000 + (s.startV ?? 0);
const vEnd = (s: RefSegment) => s.endCh * 1000 + (s.endV ?? 999);

/** How two sermon references relate: shared book, overlapping chapters, overlapping verses. */
export function refOverlap(a: string | null | undefined, b: string | null | undefined) {
  const sa = safeRef(a);
  const sb = safeRef(b);
  let book: number | null = null;
  let chapters: string | null = null;
  let verses = false;
  for (const x of sa) {
    for (const y of sb) {
      if (x.book !== y.book) continue;
      book ??= x.book;
      const lo = Math.max(x.startCh, y.startCh);
      const hi = Math.min(x.endCh, y.endCh);
      if (lo <= hi) {
        chapters ??= `${BOOKS[x.book - 1].en} ${lo === hi || hi === 999 ? lo : `${lo}-${hi}`}`;
        if (Math.max(vStart(x), vStart(y)) <= Math.min(vEnd(x), vEnd(y))) verses = true;
      }
    }
  }
  return { book: book ? BOOKS[book - 1].en : null, chapters, verses };
}

// ---------------------------------------------------------------- calendar precedent

/** Days from Easter Sunday of the date's own year. */
const easterOffset = (d: string) => Math.round((ts(d) - easter(Number(d.slice(0, 4)))) / DAY);

function easterName(off: number): string {
  const named: Record<number, string> = { [-46]: 'Ash Wednesday', [-7]: 'Palm Sunday', [-3]: 'Maundy Thursday', [-2]: 'Good Friday', 0: 'Easter Day', 39: 'Ascension Day', 49: 'Pentecost' };
  if (named[off]) return named[off];
  return off < 0 ? `Easter − ${-off} days` : `Easter + ${off} days`;
}

const yearsAgo = (n: number) => (n === 1 ? 'last year' : `${n} years earlier`);

/**
 * Is `cand` at the same point of the church year as `target`, in an earlier year? Easter-cycle dates compare their
 * offset from Easter; the rest compare the calendar date (±10 days, so Christmas Eve and the Sunday after match).
 * `exact`: the very same Sunday or feast (same Easter offset, same date, or same weekday within 3 days).
 */
function timeOfYear(target: string, targetSeason: Season, cand: string): { label: string; exact: boolean } | null {
  const ty = Number(target.slice(0, 4));
  const cy = Number(cand.slice(0, 4));
  if (EASTER_CYCLE.has(targetSeason)) {
    if (cy >= ty) return null;
    const ot = easterOffset(target);
    const diff = Math.abs(ot - easterOffset(cand));
    if (diff > 10) return null;
    return diff === 0
      ? { label: `${easterName(ot)} ${yearsAgo(ty - cy)}`, exact: true }
      : { label: `same point of the Easter cycle ${yearsAgo(ty - cy)} (${easterName(easterOffset(cand))})`, exact: false };
  }
  const t = ts(target);
  const c = ts(cand);
  const n = Math.round((t - c) / (365.2425 * DAY));
  if (n < 1) return null;
  const anniversary = Date.UTC(ty - n, Number(target.slice(5, 7)) - 1, Number(target.slice(8, 10)));
  const diff = Math.abs(c - anniversary) / DAY;
  if (diff > 10) return null;
  const weekday = new Date(t).getUTCDay();
  if (diff <= 3 && weekday === new Date(c).getUTCDay()) return { label: `same ${weekday === 0 ? 'Sunday' : 'day'} ${yearsAgo(n)}`, exact: true };
  if (diff === 0) return { label: `same date ${yearsAgo(n)}`, exact: true };
  return { label: `around this date ${yearsAgo(n)}`, exact: false };
}

export const sameTimeOfYear = (target: string, targetSeason: Season, cand: string) => timeOfYear(target, targetSeason, cand)?.label ?? null;

// ---------------------------------------------------------------- outlines & rosters

interface ItemRow {
  service_id: number;
  position: number;
  kind: string;
  title: string;
  ref_id: number | null;
  scripture_ref: string | null;
  stanzas: string | null;
  hymnal_id: number | null;
  duration_min: number;
  song_title: string | null;
  text_title: string | null;
  text_parts: string | null;
  text_category: string | null;
}

export interface OutlineItem {
  kind: string;
  title: string;
  /** the hymn (with hymnal number and stanzas), the reading, or the liturgical text (with parts) */
  subtitle?: string;
  min?: number;
}

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(',');

function itemRows(serviceIds: number[]): ItemRow[] {
  if (!serviceIds.length) return [];
  return all<ItemRow>(
    `SELECT i.service_id, i.position, i.kind, i.title, i.ref_id, i.scripture_ref, i.stanzas, i.hymnal_id, i.duration_min,
            CASE WHEN i.kind = 'song' THEN so.title END AS song_title,
            CASE WHEN i.kind = 'text' THEN tx.title END AS text_title,
            CASE WHEN i.kind = 'text' THEN tx.parts END AS text_parts,
            CASE WHEN i.kind = 'text' THEN tx.category END AS text_category
     FROM service_items i
     LEFT JOIN songs so ON so.id = i.ref_id AND i.kind = 'song'
     LEFT JOIN texts tx ON tx.id = i.ref_id AND i.kind = 'text'
     WHERE i.service_id IN (${placeholders(serviceIds.length)}) ORDER BY i.service_id, i.position, i.id`,
    ...serviceIds,
  );
}

function hymnalNumbers(songIds: number[]) {
  const by = new Map<number, { hymnal_id: number; label: string }[]>();
  if (!songIds.length) return by;
  const rows = all<{ song_id: number; hymnal_id: number; abbr: string; number: string }>(
    `SELECT sh.song_id, sh.hymnal_id, h.abbr, sh.number FROM song_hymnals sh JOIN hymnals h ON h.id = sh.hymnal_id
     WHERE sh.song_id IN (${placeholders(songIds.length)}) ORDER BY h.sort, h.id`,
    ...songIds,
  );
  for (const r of rows) by.set(r.song_id, [...(by.get(r.song_id) ?? []), { hymnal_id: r.hymnal_id, label: `${r.abbr} ${r.number}` }]);
  return by;
}

function subtitleOf(it: ItemRow, numbers: Map<number, { hymnal_id: number; label: string }[]>, sermonTitle: string): string | undefined {
  const stanzas = parseJson<string[] | null>(it.stanzas, null);
  if (it.kind === 'song' && it.ref_id) {
    const refs = numbers.get(it.ref_id) ?? [];
    const num = (refs.find((r) => r.hymnal_id === it.hymnal_id) ?? refs[0])?.label;
    const vv = stanzas?.length ? ` (st. ${stanzas.join(',')})` : '';
    return `${num ? `${num} ` : ''}${brief(parseJson<L10n>(it.song_title, {}))}${vv}`.trim() || undefined;
  }
  if (it.kind === 'scripture') return it.scripture_ref ?? undefined;
  if (it.kind === 'text' && it.ref_id) {
    const title = brief(parseJson<L10n>(it.text_title, {}));
    const labels = parseJson<{ label: string }[]>(it.text_parts, []).map((p) => p.label);
    if (!labels.length || !stanzas?.length) return title || undefined;
    const runs = partRuns(stanzas, labels).join(', ');
    return `${title} ${it.text_category === 'catechism' ? 'Q' : '§'}${runs}`;
  }
  if (it.kind === 'sermon') return sermonTitle || undefined;
  return undefined;
}

/** Order of each service: kind, title, subtitle and minutes. */
export function outlines(serviceIds: number[], sermonTitles: Map<number, string> = new Map()): Map<number, OutlineItem[]> {
  const rows = itemRows(serviceIds);
  const numbers = hymnalNumbers([...new Set(rows.filter((r) => r.kind === 'song' && r.ref_id).map((r) => r.ref_id!))]);
  const out = new Map<number, OutlineItem[]>();
  for (const r of rows) {
    const o: OutlineItem = { kind: r.kind, title: brief(parseJson<L10n>(r.title, {})) };
    const sub = subtitleOf(r, numbers, sermonTitles.get(r.service_id) ?? '');
    if (sub && sub !== o.title) o.subtitle = sub;
    if (r.duration_min > 0) o.min = r.duration_min;
    out.set(r.service_id, [...(out.get(r.service_id) ?? []), o]);
  }
  return out;
}

const personName = `TRIM(IFNULL(p.preferred_name, p.first_name) || ' ' || p.last_name) ||
  CASE WHEN p.native_name IS NOT NULL THEN ' ' || p.native_name ELSE '' END`;

/** Who served, by role: "Pianist: Grace Lim; Usher: Daniel Ong, Mary Tan". Names only; declines left out. */
export function rosterSummaries(serviceIds: number[]): Map<number, string> {
  const out = new Map<number, string>();
  if (!serviceIds.length) return out;
  const rows = all<{ service_id: number; role: string; name: string }>(
    `SELECT a.service_id, r.name AS role, ${personName} AS name
     FROM assignments a JOIN roles r ON r.id = a.role_id JOIN teams t ON t.id = r.team_id JOIN people p ON p.id = a.person_id
     WHERE a.status != 'declined' AND a.service_id IN (${placeholders(serviceIds.length)})${wallSql('p.congregation_id').sql}
     ORDER BY a.service_id, t.sort, t.id, r.sort, r.id, name`,
    ...serviceIds, ...wallSql('p.congregation_id').params,
  );
  const by = new Map<number, Map<string, string[]>>();
  for (const r of rows) {
    const roles = by.get(r.service_id) ?? new Map<string, string[]>();
    const role = brief(parseJson<L10n>(r.role, {})) || 'Role';
    roles.set(role, [...(roles.get(role) ?? []), r.name]);
    by.set(r.service_id, roles);
  }
  for (const [sid, roles] of by) out.set(sid, [...roles].map(([role, names]) => `${role}: ${names.join(', ')}`).join('; '));
  return out;
}

// ---------------------------------------------------------------- similar services

export interface SimilarCriteria {
  date?: string;
  service_type?: string;
  sermon_ref?: string | null;
  title?: L10n | string | null;
  template_id?: number | null;
  song_ids?: number[];
  text_ids?: number[];
  /** liturgical season override; default from the date */
  season?: Season | null;
}

export interface SimilarService {
  id: number;
  date: string;
  title: string;
  service_type: string;
  season: Season;
  sermon_ref?: string;
  sermon_title?: string;
  preacher?: string;
  score: number;
  reasons: string[];
  outline: OutlineItem[];
  roster_summary?: string;
}

interface ServiceRow {
  id: number;
  date: string;
  title: string;
  service_type: string;
  sermon_ref: string | null;
  sermon_title: string;
  preacher: string | null;
  template_id: number | null;
  season: Season | null;
}

/** The target as criteria: a service id (its date, type, template, sermon, songs and texts) or criteria as given. */
export function targetCriteria(target: number | SimilarCriteria): SimilarCriteria & { id?: number; date: string } {
  if (typeof target !== 'number') return { ...target, date: target.date ?? todayIso() };
  const s = get<ServiceRow & { congregation_id: number | null; kind: string }>('SELECT * FROM services WHERE id = ?', target);
  if (!s) throw new NotFound(`service ${target} not found`);
  checkRow('services', s, 'read', target);
  const refs = all<{ kind: string; ref_id: number }>(`SELECT kind, ref_id FROM service_items WHERE service_id = ? AND ref_id IS NOT NULL AND kind IN ('song','text')`, target);
  return {
    id: s.id,
    date: s.date,
    service_type: s.service_type,
    sermon_ref: s.sermon_ref,
    title: parseJson<L10n>(s.title, {}),
    template_id: s.template_id,
    season: s.season,
    song_ids: refs.filter((r) => r.kind === 'song').map((r) => r.ref_id),
    text_ids: refs.filter((r) => r.kind === 'text').map((r) => r.ref_id),
  };
}

const titleKeys = (v: L10n | string | null | undefined) =>
  new Set((typeof v === 'string' ? [v] : Object.values(v ?? {})).map((x) => x?.trim().toLowerCase()).filter((x): x is string => !!x));

/**
 * Past services most like the target, best first. Only services dated before `before` (default: the target's date)
 * are considered, and never the target itself. Scores: same service type +2, same template +2, same season +2,
 * same point of the church year in an earlier year +3 (+0.5 for the very same Sunday / feast), sermon in the same book +2 / overlapping chapters +3 /
 * overlapping verses +2, same title +1, shared hymns and liturgical texts +1 each (max +4), recency up to +1.
 */
export function similarServices(
  target: number | SimilarCriteria,
  opts: { limit?: number; before?: string; outline?: boolean; roster?: boolean } = {},
): SimilarService[] {
  const t = targetCriteria(target);
  const before = opts.before ?? t.date;
  const limit = opts.limit ?? 5;
  const tSeason = t.season ?? seasonOf(t.date);
  const w = wallSql('congregation_id');
  const rows = all<ServiceRow>(`SELECT id, date, title, service_type, sermon_ref, sermon_title, preacher, template_id, season FROM services WHERE kind = 'service' AND date < ? AND id != ?${w.sql} ORDER BY date DESC`, before, t.id ?? 0, ...w.params);
  if (!rows.length) return [];

  const songSet = new Set(t.song_ids ?? []);
  const textSet = new Set(t.text_ids ?? []);
  const shared = new Map<number, { songs: number; texts: number }>();
  if (songSet.size || textSet.size) {
    const refs = all<{ service_id: number; kind: string; ref_id: number }>(
      `SELECT DISTINCT i.service_id, i.kind, i.ref_id FROM service_items i JOIN services s ON s.id = i.service_id
       WHERE s.date < ? AND i.ref_id IS NOT NULL AND i.kind IN ('song','text')`,
      before,
    );
    for (const r of refs) {
      const hit = r.kind === 'song' ? songSet.has(r.ref_id) : textSet.has(r.ref_id);
      if (!hit) continue;
      const x = shared.get(r.service_id) ?? { songs: 0, texts: 0 };
      if (r.kind === 'song') x.songs++;
      else x.texts++;
      shared.set(r.service_id, x);
    }
  }
  const tTitles = titleKeys(t.title);
  const tTime = ts(t.date);

  const scored = rows.map((s) => {
    const reasons: string[] = [];
    let score = 0;
    const season = s.season ?? seasonOf(s.date);
    if (t.service_type && s.service_type === t.service_type) score += 2;
    if (t.template_id && s.template_id === t.template_id) {
      score += 2;
      reasons.push('same template');
    }
    if (season === tSeason) {
      score += 2;
      reasons.push(`same season (${season.replace('_', ' ')})`);
    }
    const when = timeOfYear(t.date, tSeason, s.date);
    if (when) {
      // +3; the very same Sunday or feast gets a little more than the Sundays either side of it
      score += when.exact ? 3.5 : 3;
      reasons.unshift(when.label);
    }
    if (t.sermon_ref && s.sermon_ref) {
      const o = refOverlap(t.sermon_ref, s.sermon_ref);
      if (o.book) {
        score += 2;
        if (o.chapters) score += 3;
        if (o.verses) score += 2;
        reasons.push(o.verses ? `overlapping sermon text (${s.sermon_ref})` : o.chapters ? `same sermon chapter (${o.chapters})` : `same sermon book (${o.book})`);
      }
    }
    if (tTitles.size && [...titleKeys(parseJson<L10n>(s.title, {}))].some((k) => tTitles.has(k))) {
      score += 1;
      reasons.push('same title');
    }
    const sh = shared.get(s.id);
    if (sh) {
      score += Math.min(4, sh.songs + sh.texts);
      const bits = [sh.songs ? `${sh.songs} shared hymn${sh.songs > 1 ? 's' : ''}` : '', sh.texts ? `${sh.texts} shared text${sh.texts > 1 ? 's' : ''}` : ''].filter(Boolean);
      reasons.push(bits.join(', '));
    }
    if (t.service_type && s.service_type === t.service_type && !reasons.length) reasons.push(`same service type (${s.service_type})`);
    const days = Math.max(0, (tTime - ts(s.date)) / DAY);
    score += Math.max(0, 1 - days / 730);
    if (days <= 35) reasons.push('recent');
    return { s, season, score: Math.round(score * 100) / 100, reasons };
  });
  scored.sort((a, b) => b.score - a.score || (a.s.date < b.s.date ? 1 : -1));
  const top = scored.filter((x) => x.score > 0).slice(0, limit);
  const ids = top.map((x) => x.s.id);
  const sermonTitles = new Map(top.map((x) => [x.s.id, brief(parseJson<L10n>(x.s.sermon_title, {}))]));
  const outs = opts.outline === false ? new Map<number, OutlineItem[]>() : outlines(ids, sermonTitles);
  const rosters = opts.roster === false ? new Map<number, string>() : rosterSummaries(ids);
  return top.map(({ s, season, score, reasons }) => ({
    id: s.id,
    date: s.date,
    title: brief(parseJson<L10n>(s.title, {})),
    service_type: s.service_type,
    season,
    sermon_ref: s.sermon_ref ?? undefined,
    sermon_title: sermonTitles.get(s.id) || undefined,
    preacher: s.preacher ?? undefined,
    score,
    reasons,
    outline: outs.get(s.id) ?? [],
    roster_summary: rosters.get(s.id),
  }));
}

// ---------------------------------------------------------------- song usage

export interface SongUsage {
  /** date of the last service (before `before`) that sang it */
  last_used: string;
  last_service_id: number;
  /** services in the window [before − months, before) that sang it */
  times: number;
}

const monthsBack = (d: string, months: number) => {
  const [y, m, day] = d.split('-').map(Number);
  return isoDay(Date.UTC(y, m - 1 - months, day));
};

/**
 * When each song was last sung and how often in the last `months` months, counting only services dated before
 * `before` (default today). A song sung twice in one service counts once. Songs never sung are absent.
 */
export function songUsage(songIds?: number[] | null, opts: { months?: number; before?: string } = {}): Map<number, SongUsage> {
  const before = opts.before ?? todayIso();
  const from = monthsBack(before, opts.months ?? 12);
  const filter = songIds?.length ? ` AND i.ref_id IN (${placeholders(songIds.length)})` : '';
  const rows = all<{ song_id: number; service_id: number; date: string }>(
    `SELECT DISTINCT i.ref_id AS song_id, s.id AS service_id, s.date FROM service_items i JOIN services s ON s.id = i.service_id
     WHERE i.kind = 'song' AND i.ref_id IS NOT NULL AND s.date < ?${filter}
     ORDER BY s.date DESC, s.start_time DESC, s.id DESC`,
    before, ...(songIds ?? []),
  );
  const out = new Map<number, SongUsage>();
  for (const r of rows) {
    let u = out.get(r.song_id);
    if (!u) {
      u = { last_used: r.date, last_service_id: r.service_id, times: 0 };
      out.set(r.song_id, u);
    }
    if (r.date >= from) u.times++;
  }
  return out;
}

// ---------------------------------------------------------------- catechism / confession progression

export interface PartsUse {
  service_id: number;
  date: string;
  /** part labels used, e.g. ["4","5","6"], and as runs ("4–6") */
  labels: string[];
  runs: string;
  /** dated today or later (already planned) */
  planned?: boolean;
}

/**
 * The parts of a long text (catechism, confession) used per service, latest first, and the label after the last part
 * used by the latest service that selected parts (planned services included, so a series continues after them).
 */
export function textPartsHistory(textId: number, opts: { limit?: number; before?: string } = {}) {
  const t = get<{ parts: string | null }>('SELECT parts FROM texts WHERE id = ?', textId);
  if (!t) throw new NotFound(`text ${textId} not found`);
  const labels = parseJson<{ label: string }[]>(t.parts, []).map((p) => p.label);
  const rows = all<{ service_id: number; date: string; stanzas: string | null }>(
    `SELECT s.id AS service_id, s.date, i.stanzas FROM service_items i JOIN services s ON s.id = i.service_id
     WHERE i.kind = 'text' AND i.ref_id = ?${opts.before ? ' AND s.date < ?' : ''}
     ORDER BY s.date DESC, s.start_time DESC, i.position`,
    ...(opts.before ? [textId, opts.before] : [textId]),
  );
  const today = todayIso();
  const history: PartsUse[] = [];
  for (const r of rows) {
    const sel = parseJson<string[] | null>(r.stanzas, null);
    if (!sel?.length) continue;
    const used = labels.length ? sel.filter((l) => labels.includes(l)) : sel;
    if (!used.length) continue;
    history.push({ service_id: r.service_id, date: r.date, labels: used, runs: labels.length ? partRuns(used, labels).join(', ') : used.join(', '), planned: r.date >= today || undefined });
  }
  let next: string | null = null;
  const latest = history[0];
  if (latest && labels.length) {
    const last = Math.max(...latest.labels.map((l) => labels.indexOf(l)));
    next = last >= 0 && last + 1 < labels.length ? labels[last + 1] : null;
  } else if (!latest && labels.length) {
    next = labels[0];
  }
  return { history: history.slice(0, opts.limit ?? 12), next_suggested_label: next };
}
