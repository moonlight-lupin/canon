// Reports (Records → Reports, and the MCP report tools): read-only summaries over a period and, optionally, one
// congregation. Nothing here writes. Money is only computed in offeringsReport, which callers gate.
import { BOOKS, CHAPTERS, parseRef } from '../../shared/bible.ts';
import { foreignCurrencies, type OfferingLine, type OfferingMethod, type ServiceRecord, type Visitor } from '../../shared/records.ts';
import {
  AGE_BANDS, VISITOR_STATUSES, ageBand, average, median, monthsBetween, yearEarlier,
  type AttendanceReport, type MembershipReport, type OfferingsReport, type Period, type ServiceRef, type ScripturePassage, type ScriptureReport, type ServingReport, type SongsReport, type VisitorsReport,
} from '../../shared/reports.ts';
import type { L10n } from '../../shared/types.ts';
import { all, type SqlValue } from '../db.ts';
import { BadRequest } from '../lib/table.ts';
import { getSettings } from './settings.ts';
import { currentWall } from '../lib/walls.ts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const todayIso = () => new Date().toISOString().slice(0, 10);

/** A checked period: defaults to the last 12 months; at most 20 years. */
export function period(q: { from?: string; to?: string; congregation_id?: number; kind?: string; group_id?: number }): Period {
  const to = q.to && DATE.test(q.to) ? q.to : todayIso();
  const from = q.from && DATE.test(q.from) ? q.from : yearEarlier(to);
  if (from > to) throw new BadRequest('The start of the period is after its end.');
  if (Number(to.slice(0, 4)) - Number(from.slice(0, 4)) > 20) throw new BadRequest('Choose a period of at most 20 years.');
  // services unless meetings are asked for: a cell group's headcount is not a Sunday's attendance
  const kind = q.kind === 'meeting' || q.kind === 'all' ? q.kind : 'service';
  // an account limited to one congregation reports on it
  const congregation = currentWall() ?? q.congregation_id;
  return {
    from, to, ...(congregation ? { congregation_id: congregation } : {}),
    ...(kind !== 'service' ? { kind } : {}), ...(q.group_id && kind !== 'service' ? { group_id: q.group_id } : {}),
  };
}

interface SvcRow { id: number; date: string; start_time: string; title: string; congregation_id: number | null }

/** The services (or meetings) in a period; withOffering: only those that take an offering. */
function servicesIn(p: Period, withOffering = false): SvcRow[] {
  const where = ['date >= ?', 'date <= ?'];
  const params: SqlValue[] = [p.from, p.to];
  if (p.congregation_id) {
    // behind a congregation wall the whole church's services count too (as everywhere else)
    where.push(currentWall() ? '(congregation_id = ? OR congregation_id IS NULL)' : 'congregation_id = ?');
    params.push(p.congregation_id);
  }
  if (p.kind !== 'all') {
    where.push('kind = ?');
    params.push(p.kind ?? 'service');
  }
  if (p.group_id) {
    where.push('group_id = ?');
    params.push(p.group_id);
  }
  if (withOffering) where.push('offering = 1');
  return all<SvcRow>(`SELECT id, date, start_time, title, congregation_id FROM services WHERE ${where.join(' AND ')} ORDER BY date, start_time, id`, ...params);
}

const ref = (s: SvcRow): ServiceRef => ({ service_id: s.id, date: s.date, start_time: s.start_time, title: JSON.parse(s.title) as L10n, congregation_id: s.congregation_id });

type Rec = Pick<ServiceRecord, 'service_id' | 'attendance' | 'children' | 'online' | 'visitors' | 'offerings' | 'cash' | 'currency' | 'foreign_cash' | 'verified_at' | 'verified_by' | 'signatures'>;

function recordsFor(ids: number[]): Map<number, Rec> {
  const out = new Map<number, Rec>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = all<Record<string, string | number | null>>(
      `SELECT service_id, attendance, children, online, visitors, offerings, cash, currency, foreign_cash, verified_at, verified_by, signatures
       FROM service_records WHERE service_id IN (${chunk.map(() => '?').join(',')})`, ...chunk,
    );
    for (const r of rows) {
      out.set(Number(r.service_id), {
        service_id: Number(r.service_id),
        attendance: r.attendance as number | null, children: r.children as number | null, online: r.online as number | null,
        visitors: JSON.parse(String(r.visitors ?? '[]')) as Visitor[],
        offerings: JSON.parse(String(r.offerings ?? '[]')) as OfferingLine[],
        cash: JSON.parse(String(r.cash ?? '{}')) as Record<string, number>,
        currency: String(r.currency),
        foreign_cash: JSON.parse(String(r.foreign_cash ?? '{}')),
        verified_at: r.verified_at as string | null, verified_by: r.verified_by as string | null,
        signatures: JSON.parse(String(r.signatures ?? '[]')),
      });
    }
  }
  return out;
}

// ================================================================= attendance

export function attendanceReport(q: Period): AttendanceReport {
  const p = period(q);
  const svcs = servicesIn(p);
  const recs = recordsFor(svcs.map((s) => s.id));
  const rows = svcs.map((s) => {
    const r = recs.get(s.id);
    return { ...ref(s), recorded: r?.attendance != null, attendance: r?.attendance ?? null, children: r?.children ?? null, online: r?.online ?? null, visitors: r?.visitors.length ?? 0 };
  });
  const counted = rows.filter((r) => r.attendance != null) as (typeof rows[number] & { attendance: number })[];
  const values = counted.map((r) => r.attendance);
  const byValue = [...counted].sort((a, b) => b.attendance - a.attendance);
  const prevP = { ...p, from: yearEarlier(p.from), to: yearEarlier(p.to) };
  const prevSvcs = servicesIn(prevP);
  const prevRecs = recordsFor(prevSvcs.map((s) => s.id));
  const prevValues = prevSvcs.map((s) => prevRecs.get(s.id)?.attendance).filter((v): v is number => v != null);
  const congs = new Map<number | null, number[]>();
  for (const r of counted) congs.set(r.congregation_id, [...(congs.get(r.congregation_id) ?? []), r.attendance]);
  return {
    period: p,
    rows,
    summary: {
      services: rows.length, recorded: counted.length, average: average(values), median: median(values),
      highest: byValue[0] ? { date: byValue[0].date, value: byValue[0].attendance } : null,
      lowest: byValue.length ? { date: byValue[byValue.length - 1].date, value: byValue[byValue.length - 1].attendance } : null,
      children_average: average(counted.map((r) => r.children).filter((v): v is number => v != null)),
      online_average: average(counted.map((r) => r.online).filter((v): v is number => v != null)),
      visitors: rows.reduce((s, r) => s + r.visitors, 0),
    },
    previous: { from: prevP.from, to: prevP.to, recorded: prevValues.length, average: average(prevValues) },
    months: monthsBetween(p.from, p.to).map((m) => {
      const inMonth = rows.filter((r) => r.date.startsWith(m));
      return { month: m, services: inMonth.length, average: average(inMonth.map((r) => r.attendance).filter((v): v is number => v != null)), visitors: inMonth.reduce((s, r) => s + r.visitors, 0) };
    }),
    congregations: [...congs].map(([congregation_id, v]) => ({ congregation_id, recorded: v.length, average: average(v) })),
  };
}

// ================================================================= offerings (editors and administrators only)

export function offeringsReport(q: Period): OfferingsReport {
  const p = period(q);
  const main = getSettings().offering.currency;
  // a meeting without an offering is left out, even if its record has offering lines
  const svcs = servicesIn(p, true);
  const recs = recordsFor(svcs.map((s) => s.id));
  const fundMonth = new Map<string, number>();
  const byFund = new Map<string, number>();
  const byMethod = new Map<OfferingMethod, number>();
  const other = new Map<string, { total: number; cash: number; converted: number }>();
  const services: OfferingsReport['services'] = [];
  const unverified: OfferingsReport['unverified'] = [];
  const now = Date.parse(todayIso());
  for (const s of svcs) {
    const r = recs.get(s.id);
    if (!r || !r.offerings.length) continue;
    let total = 0;
    let cash = 0;
    const others = new Map<string, number>();
    for (const l of r.offerings) {
      const c = l.currency ?? r.currency;
      const amt = Number.isFinite(l.amount) ? l.amount : 0;
      if (c === main) {
        total += amt;
        if (l.method === 'cash') cash += amt;
        const k = `${s.date.slice(0, 7)}\u0000${l.fund}`;
        fundMonth.set(k, (fundMonth.get(k) ?? 0) + amt);
        byFund.set(l.fund, (byFund.get(l.fund) ?? 0) + amt);
        byMethod.set(l.method, (byMethod.get(l.method) ?? 0) + amt);
      } else {
        others.set(c, (others.get(c) ?? 0) + amt);
        const o = other.get(c) ?? { total: 0, cash: 0, converted: 0 };
        o.total += amt;
        if (l.method === 'cash') o.cash += amt;
        other.set(c, o);
      }
    }
    // exchanged values entered on the record (foreign cash counted in its own currency)
    for (const c of foreignCurrencies(r.offerings, r.currency)) {
      const conv = r.foreign_cash?.[c]?.converted;
      if (conv && other.has(c)) other.get(c)!.converted += conv;
    }
    services.push({ ...ref(s), total, cash, verified: !!r.verified_at, verified_by: r.verified_by, signed: (r.signatures?.length ?? 0) > 0, other: [...others].map(([currency, t]) => ({ currency, total: t })) });
    if (!r.verified_at) unverified.push({ ...ref(s), total, days: Math.max(0, Math.round((now - Date.parse(s.date)) / 86400000)) });
  }
  const months = monthsBetween(p.from, p.to);
  const funds = [...new Set([...getSettings().offering.funds, ...byFund.keys()])].filter((f) => byFund.has(f));
  return {
    period: p,
    currency: main,
    funds,
    months,
    by_fund_month: [...fundMonth].map(([k, total]) => { const [month, fund] = k.split('\u0000'); return { month, fund, total }; }),
    by_fund: funds.map((fund) => ({ fund, total: byFund.get(fund) ?? 0 })),
    by_method: [...byMethod].map(([method, total]) => ({ method, total })),
    total: [...byFund.values()].reduce((s, v) => s + v, 0),
    other_currencies: [...other].sort(([a], [b]) => a.localeCompare(b)).map(([currency, o]) => ({ currency, ...o })),
    services,
    unverified: unverified.sort((a, b) => a.date.localeCompare(b.date)),
  };
}

// ================================================================= new visitors

const STAGE = (s: Visitor['status']) => Math.max(0, VISITOR_STATUSES.indexOf(s ?? 'new'));

export function visitorsReport(q: Period, opts: { contact: boolean }): VisitorsReport {
  const p = period(q);
  const svcs = servicesIn(p);
  const recs = recordsFor(svcs.map((s) => s.id));
  const visitors: VisitorsReport['visitors'] = [];
  for (const s of svcs) {
    for (const v of recs.get(s.id)?.visitors ?? []) {
      if (!v.name?.trim()) continue;
      visitors.push({
        ...ref(s), name: v.name.trim(), source: v.source?.trim() || null, follow_up_by: v.follow_up_by?.trim() || null, status: v.status ?? 'new',
        ...(opts.contact ? { contact: v.contact?.trim() || null } : {}),
      });
    }
  }
  const funnel = Object.fromEntries(VISITOR_STATUSES.map((st, i) => [st, visitors.filter((v) => STAGE(v.status) >= i).length])) as VisitorsReport['funnel'];
  const sources = new Map<string, number>();
  for (const v of visitors) if (v.source) sources.set(v.source, (sources.get(v.source) ?? 0) + 1);
  const abouts = new Map<string, number>();
  for (const s of svcs) for (const v of recs.get(s.id)?.visitors ?? []) if (v.name?.trim() && v.about?.trim()) abouts.set(v.about.trim(), (abouts.get(v.about.trim()) ?? 0) + 1);
  return {
    period: p,
    visitors: visitors.reverse(),
    funnel,
    sources: [...sources].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count || a.source.localeCompare(b.source)),
    ...(opts.contact ? { abouts: [...abouts].map(([about, count]) => ({ about, count })).sort((a, b) => b.count - a.count) } : {}),
    months: monthsBetween(p.from, p.to).map((month) => ({ month, count: visitors.filter((v) => v.date.startsWith(month)).length })),
  };
}

// ================================================================= serving (rota)

interface PersonRow { id: number; first_name: string; last_name: string; preferred_name: string | null; native_name: string | null }
const personName = (p: PersonRow) => `${p.preferred_name?.trim() || p.first_name} ${p.last_name ?? ''}`.trim() + (p.native_name ? ` ${p.native_name}` : '');
const l10nName = (s: string) => {
  const o = JSON.parse(s) as L10n;
  return [o.en, o.zh].filter(Boolean).join(' ') || Object.values(o).find(Boolean) || '';
};

export function servingReport(q: Period): ServingReport {
  const p = period(q);
  const svcs = servicesIn(p);
  const ids = new Set(svcs.map((s) => s.id));
  const dateOf = new Map(svcs.map((s) => [s.id, s.date]));
  const asg = all<{ service_id: number; role_id: number; person_id: number; status: string }>(
    `SELECT a.service_id, a.role_id, a.person_id, a.status FROM assignments a JOIN services s ON s.id = a.service_id
     WHERE s.date >= ? AND s.date <= ?`, p.from, p.to,
  ).filter((a) => ids.has(a.service_id));
  const people = new Map(all<PersonRow>('SELECT id, first_name, last_name, preferred_name, native_name FROM people').map((x) => [x.id, x]));
  const teams = all<{ id: number; name: string; group_id: number | null }>('SELECT id, name, group_id FROM teams ORDER BY sort, id');
  const roster = all<{ team_id: number; person_id: number }>(
    `SELECT t.id AS team_id, gm.person_id FROM group_members gm JOIN teams t ON t.group_id = gm.group_id
     WHERE (gm.end_date IS NULL OR gm.end_date = '' OR gm.end_date >= ?)`, p.to,
  );
  const teamName = new Map(teams.map((t) => [t.id, l10nName(t.name)]));
  const teamsOf = new Map<number, string[]>();
  for (const m of roster) teamsOf.set(m.person_id, [...(teamsOf.get(m.person_id) ?? []), teamName.get(m.team_id) ?? '']);
  const lastEver = new Map(all<{ person_id: number; last: string }>(
    `SELECT a.person_id, MAX(s.date) AS last FROM assignments a JOIN services s ON s.id = a.service_id WHERE a.status != 'declined' AND s.date <= ? GROUP BY a.person_id`, p.to,
  ).map((r) => [r.person_id, r.last]));

  const per = new Map<number, { served: number; confirmed: number; declined: number; last: string | null }>();
  for (const a of asg) {
    const x = per.get(a.person_id) ?? { served: 0, confirmed: 0, declined: 0, last: null };
    if (a.status === 'declined') x.declined++;
    else {
      x.served++;
      if (a.status === 'confirmed') x.confirmed++;
      const d = dateOf.get(a.service_id)!;
      if (!x.last || d > x.last) x.last = d;
    }
    per.set(a.person_id, x);
  }
  const roles = all<{ id: number; team_id: number; name: string; needed: number; team: string }>(
    'SELECT r.id, r.team_id, r.name, r.needed, t.name AS team FROM roles r JOIN teams t ON t.id = r.team_id ORDER BY t.sort, t.id, r.sort, r.id',
  );
  const qualified = new Map(all<{ role_id: number; n: number }>('SELECT role_id, COUNT(*) AS n FROM role_members GROUP BY role_id').map((r) => [r.role_id, r.n]));
  return {
    period: p,
    services: svcs.length,
    people: [...per].filter(([id]) => people.has(id)).map(([id, x]) => ({
      person_id: id, name: personName(people.get(id)!), served: x.served, confirmed: x.confirmed, declined: x.declined, last_served: x.last, teams: teamsOf.get(id) ?? [],
    })).sort((a, b) => b.served - a.served || a.name.localeCompare(b.name)),
    idle: [...teamsOf.keys()].filter((id) => !(per.get(id)?.served) && people.has(id)).map((id) => ({
      person_id: id, name: personName(people.get(id)!), teams: teamsOf.get(id) ?? [], last_served: lastEver.get(id) ?? null,
    })).sort((a, b) => (a.last_served ?? '').localeCompare(b.last_served ?? '') || a.name.localeCompare(b.name)),
    roles: roles.map((r) => {
      const mine = asg.filter((a) => a.role_id === r.id);
      const bySvc = new Map<number, number>();
      for (const a of mine) if (a.status !== 'declined') bySvc.set(a.service_id, (bySvc.get(a.service_id) ?? 0) + 1);
      const used = new Set(mine.map((a) => a.service_id));
      return {
        role_id: r.id, team: JSON.parse(r.team) as L10n, role: JSON.parse(r.name) as L10n, needed: r.needed,
        services: used.size, short: [...used].filter((sid) => (bySvc.get(sid) ?? 0) < r.needed).length,
        declined: mine.filter((a) => a.status === 'declined').length, qualified: qualified.get(r.id) ?? 0,
      };
    }),
  };
}

// ================================================================= songs

function itemsOf(ids: number[], kinds: string[]) {
  const items: { service_id: number; kind: string; ref_id: number | null; scripture_ref: string | null }[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    items.push(...all<(typeof items)[number]>(
      `SELECT service_id, kind, ref_id, scripture_ref FROM service_items WHERE service_id IN (${chunk.map(() => '?').join(',')}) AND kind IN (${kinds.map(() => '?').join(',')})`,
      ...chunk, ...kinds,
    ));
  }
  return items;
}

export function songsReport(q: Period): SongsReport {
  const p = period(q);
  const svcs = servicesIn(p);
  const dateOf = new Map(svcs.map((s) => [s.id, s.date]));
  const items = itemsOf(svcs.map((s) => s.id), ['song']);
  const songs = new Map(all<{ id: number; title: string; category: string; public_domain: number; copyright: string | null; ccli: string | null }>(
    'SELECT id, title, category, public_domain, copyright, ccli FROM songs',
  ).map((s) => [s.id, s]));
  const use = new Map<number, { times: number; first: string; last: string }>();
  for (const it of items) {
    if (!it.ref_id || !songs.has(it.ref_id)) continue;
    const d = dateOf.get(it.service_id)!;
    const u = use.get(it.ref_id) ?? { times: 0, first: d, last: d };
    u.times++;
    if (d < u.first) u.first = d;
    if (d > u.last) u.last = d;
    use.set(it.ref_id, u);
  }
  const lastEver = new Map(all<{ ref_id: number; last: string }>(
    `SELECT i.ref_id, MAX(s.date) AS last FROM service_items i JOIN services s ON s.id = i.service_id WHERE i.kind = 'song' AND i.ref_id IS NOT NULL AND s.date <= ? GROUP BY i.ref_id`, p.to,
  ).map((r) => [r.ref_id, r.last]));
  return {
    period: p,
    services: svcs.length,
    songs: [...use].map(([id, u]) => {
      const s = songs.get(id)!;
      return { song_id: id, title: JSON.parse(s.title) as L10n, category: s.category, times: u.times, first_used: u.first, last_used: u.last, public_domain: !!s.public_domain, copyright: s.copyright, ccli: s.ccli };
    }).sort((a, b) => b.times - a.times || a.last_used.localeCompare(b.last_used)),
    unused: [...songs.values()].filter((s) => !use.has(s.id)).map((s) => ({ song_id: s.id, title: JSON.parse(s.title) as L10n, category: s.category, last_used: lastEver.get(s.id) ?? null }))
      .sort((a, b) => (a.last_used ?? '').localeCompare(b.last_used ?? '')),
  };
}

// ================================================================= Scripture: chapters read and preached

/** Chapters a reference touches, per book; [] when it is not a reference ("see the bulletin"). */
export function chaptersOf(ref: string): { book: number; chapters: number[] }[] {
  let segs: { book: number; startCh: number; endCh: number }[] = [];
  try {
    segs = parseRef(ref);
  } catch {
    return [];
  }
  const out = new Map<number, Set<number>>();
  for (const sg of segs) {
    const max = CHAPTERS[sg.book - 1] ?? 0;
    const set = out.get(sg.book) ?? new Set<number>();
    for (let c = Math.max(1, sg.startCh); c <= Math.min(max, Math.max(sg.startCh, sg.endCh)); c++) set.add(c);
    out.set(sg.book, set);
  }
  return [...out].map(([book, set]) => ({ book, chapters: [...set].sort((a, b) => a - b) }));
}

/** Years that have services (optionally of one congregation), newest first. */
export function serviceYears(congregationId?: number): number[] {
  return all<{ y: string }>(
    `SELECT DISTINCT substr(date, 1, 4) AS y FROM services ${congregationId ? 'WHERE congregation_id = ?' : ''} ORDER BY y DESC`,
    ...(congregationId ? [congregationId] : []),
  ).map((r) => Number(r.y)).filter((y) => y > 0);
}

/**
 * Which chapters of the Bible were read (scripture items) and preached (the sermon passage), over a period or over
 * chosen years (which need not be consecutive, e.g. 2023 and 2025).
 */
export function scriptureReport(q: { from?: string; to?: string; congregation_id?: number; kind?: string; group_id?: number; years?: number[] }): ScriptureReport {
  const years = [...new Set((q.years ?? []).filter((y) => Number.isInteger(y) && y >= 1900 && y <= 2200))].sort((a, b) => a - b).slice(0, 50);
  let svcs: SvcRow[];
  let p: Period;
  if (years.length) {
    p = { ...period(q), from: `${years[0]}-01-01`, to: `${years[years.length - 1]}-12-31` };
    const want = new Set(years.map(String));
    svcs = servicesIn(p).filter((s) => want.has(s.date.slice(0, 4)));
  } else {
    p = period(q);
    svcs = servicesIn(p);
  }
  const dateOf = new Map(svcs.map((s) => [s.id, s.date]));
  const ids = svcs.map((s) => s.id);
  const passages: ScripturePassage[] = [];
  for (const it of itemsOf(ids, ['scripture'])) {
    if (it.scripture_ref?.trim()) passages.push({ date: dateOf.get(it.service_id)!, service_id: it.service_id, kind: 'reading', ref: it.scripture_ref.trim(), chapters: chaptersOf(it.scripture_ref) });
  }
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    for (const s of all<{ id: number; date: string; sermon_ref: string | null }>(`SELECT id, date, sermon_ref FROM services WHERE id IN (${chunk.map(() => '?').join(',')})`, ...chunk)) {
      if (s.sermon_ref?.trim()) passages.push({ date: s.date, service_id: s.id, kind: 'sermon', ref: s.sermon_ref.trim(), chapters: chaptersOf(s.sermon_ref) });
    }
  }
  passages.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
  const books = BOOKS.map((b, i) => ({ book: b.n, en: b.en, zh: b.zh, zhT: b.zhT, chapters: CHAPTERS[i], read: Array<number>(CHAPTERS[i]).fill(0), preached: Array<number>(CHAPTERS[i]).fill(0) }));
  for (const x of passages) {
    for (const c of x.chapters) {
      const b = books[c.book - 1];
      if (!b) continue;
      for (const ch of c.chapters) (x.kind === 'sermon' ? b.preached : b.read)[ch - 1]++;
    }
  }
  let read = 0, preached = 0, both = 0, covered = 0, ot = 0, nt = 0, bookCount = 0;
  for (const b of books) {
    let any = false;
    for (let i = 0; i < b.chapters; i++) {
      const r = b.read[i] > 0, s = b.preached[i] > 0;
      if (r) read++;
      if (s) preached++;
      if (r && s) both++;
      if (r || s) {
        covered++;
        any = true;
        if (b.book <= 39) ot++;
        else nt++;
      }
    }
    if (any) bookCount++;
  }
  return {
    period: p,
    years,
    years_available: serviceYears(q.congregation_id),
    services: svcs.length,
    books,
    passages,
    totals: { chapters: CHAPTERS.reduce((s, n) => s + n, 0), read, preached, both, covered, ot_covered: ot, nt_covered: nt, books_covered: bookCount },
  };
}

// ================================================================= membership

export function membershipReport(q: Period): MembershipReport {
  const p = period(q);
  const where = p.congregation_id ? (currentWall() ? 'WHERE (congregation_id = ? OR congregation_id IS NULL)' : 'WHERE congregation_id = ?') : '';
  const params: SqlValue[] = p.congregation_id ? [p.congregation_id] : [];
  const rows = all<PersonRow & { status: string; gender: string | null; birth_date: string | null; congregation_id: number | null; membership_date: string | null; baptism_date: string | null; created_at: string }>(
    `SELECT id, first_name, last_name, preferred_name, native_name, status, gender, birth_date, congregation_id, membership_date, baptism_date, created_at FROM people ${where}`, ...params,
  );
  const count = <K extends string | number | null>(xs: K[]) => {
    const m = new Map<K, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return m;
  };
  const active = rows.filter((r) => r.status === 'member' || r.status === 'regular');
  const bands = count(active.map((r) => ageBand(r.birth_date, p.to)));
  const inPeriod = (d: string | null) => !!d && d.slice(0, 10) >= p.from && d.slice(0, 10) <= p.to;
  return {
    period: p,
    total: rows.length,
    by_status: [...count(rows.map((r) => r.status))].map(([status, n]) => ({ status, count: n })).sort((a, b) => b.count - a.count),
    by_congregation: [...count(active.map((r) => r.congregation_id))].map(([congregation_id, n]) => ({ congregation_id, count: n })),
    by_gender: [...count(active.map((r) => r.gender ?? 'unknown'))].map(([gender, n]) => ({ gender, count: n })),
    age_bands: AGE_BANDS.map((band) => ({ band, count: bands.get(band) ?? 0 })),
    joined: rows.filter((r) => inPeriod(r.membership_date)).map((r) => ({ person_id: r.id, name: personName(r), date: r.membership_date!.slice(0, 10) })).sort((a, b) => a.date.localeCompare(b.date)),
    baptised: rows.filter((r) => inPeriod(r.baptism_date)).map((r) => ({ person_id: r.id, name: personName(r), date: r.baptism_date!.slice(0, 10) })).sort((a, b) => a.date.localeCompare(b.date)),
    added: rows.filter((r) => inPeriod(r.created_at)).length,
  };
}
