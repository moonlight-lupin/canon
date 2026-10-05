// MCP tools for service records and reports. Two nested modules, each switched on by the administrator:
//  - records: attendance, new visitors (names, how they came, follow-up) and notes for the team; agents with write
//    access may record attendance, notes and visitors — never money;
//  - contributions (inside records, read only): offerings and cash counts, and the offerings report.
// Visitors' contact details only when the administrator exposes personal data. Signature images are never returned.
// Reports for other modules (serving, songs and Scripture, membership) live here too, gated by their own module.
import { z } from 'zod';
import type { Visitor } from '../../shared/records.ts';
import * as rec from '../repo/records.ts';
import * as reports from '../repo/reports.ts';
import { DateStr, Id, RO, WRITE, addDays, canRead, today, type Ctx, type ToolDef } from './common.ts';
import { get as dbGet } from '../db.ts';

const PeriodInput = {
  from: DateStr.optional().describe('default: 12 months before `to`'),
  to: DateStr.optional().describe('default: today'),
  congregation_id: Id.optional().describe('one congregation (ids from canon_whoami); default: all'),
  kind: z.enum(['service', 'meeting', 'all']).optional().describe('services (default), meetings of groups (fellowships, cell groups, Sunday school …), or both'),
  group_id: Id.optional().describe('with kind "meeting": one group\'s meetings (ids from canon_find_groups)'),
};
const periodOf = (a: { from?: string; to?: string; congregation_id?: number; kind?: string; group_id?: number }) => reports.period(a);
// the connection's access already follows the person's role (no offerings for roles without them)
const money = (ctx: Ctx) => canRead(ctx, 'contributions');

const visitorOut = (v: Visitor, i: number, ctx: Ctx) => ({
  index: i, name: v.name, source: v.source ?? null, follow_up_by: v.follow_up_by ?? null, status: v.status ?? 'new',
  ...(ctx.pii ? { contact: v.contact ?? null, notes: v.notes ?? null, prayer: v.prayer ?? null, about: v.about ?? null } : {}),
});

function recordOut(serviceId: number, ctx: Ctx) {
  const r = rec.recordFor(serviceId);
  const out: Record<string, unknown> = {
    service_id: serviceId, saved: r.saved, attendance: r.attendance, children: r.children, online: r.online, notes: r.notes,
    visitors: r.visitors.map((v, i) => visitorOut(v, i, ctx)),
  };
  // a meeting says so (and whether it takes an offering at all)
  const s = dbGet<{ kind: string; group_id: number | null; offering: number }>('SELECT kind, group_id, offering FROM services WHERE id = ?', serviceId);
  if (s?.kind === 'meeting') Object.assign(out, { kind: 'meeting', group_id: s.group_id, offering_taken: !!s.offering });
  // moved to an archive file: read-only, and not in the reports (an administrator can bring it back in Canon)
  if (r.archived_year) Object.assign(out, { archived_year: r.archived_year, read_only: `in the ${r.archived_year} archive` });
  if (money(ctx)) {
    Object.assign(out, {
      currency: r.currency, offerings: r.offerings, cash_count: r.cash, foreign_cash: r.foreign_cash,
      counters: r.counters, verified_at: r.verified_at, verified_by: r.verified_by,
      signed_by: (r.signatures ?? []).map((s) => ({ name: s.name, signed_at: s.signed_at, via: s.via === 'account' ? 'own account' : 'on screen' })),
    });
  } else out.offerings = 'not shared with AI agents on this connection';
  return out;
}

const VisitorIn = z.object({
  name: z.string().min(1).max(200),
  source: z.string().max(300).optional().describe('how they came, e.g. "invited by a friend"'),
  follow_up_by: z.string().max(200).optional(),
  status: z.enum(['new', 'contacted', 'returning', 'joined']).optional(),
  contact: z.string().max(300).optional().describe('only when member contact details are exposed on this connection'),
});

export const RECORD_TOOLS: ToolDef[] = [
  {
    name: 'canon_list_service_records', module: 'records', access: 'read', title: 'List service records', annotations: RO,
    description: 'Services (or, with kind "meeting", the meetings of groups) between two dates (default: the last 8 weeks) with what was recorded: attendance, children, online, number of new visitors, whether there are notes for the team — and, when offerings are shared on this connection, the offering total in the church currency, other currencies and whether the cash count is verified. A meeting may take no offering (`offering: false`): then it has no money. Example: {"from":"2026-09-01","to":"2026-09-30","kind":"meeting"}.',
    input: { from: DateStr.optional(), to: DateStr.optional(), congregation_id: Id.optional(), kind: z.enum(['service', 'meeting']).optional().describe('default: both'), group_id: Id.optional() },
    handler: (a, ctx) => {
      const to = a.to ?? today();
      const from = a.from ?? addDays(to, -56);
      const showMoney = money(ctx);
      return {
        from, to,
        services: rec.listRecords({ from, to, congregation_id: a.congregation_id, kind: a.kind, group_id: a.group_id }).map((r) => ({
          service_id: r.service_id, kind: r.kind, group_id: r.group_id, group_name: r.group_name, offering: r.offering,
          date: r.date, start_time: r.start_time, title: r.title, congregation_id: r.congregation_id,
          recorded: r.recorded, attendance: r.attendance, children: r.children, online: r.online, new_visitors: r.visitors, has_notes: r.has_notes,
          ...(showMoney ? { currency: r.currency, offering_total: r.offering_total, other_currencies: r.other_currencies, cash_count_verified: r.verified } : {}),
        })),
      };
    },
  },
  {
    name: 'canon_get_service_record', module: 'records', access: 'read', title: 'Get a service record', annotations: RO,
    description: 'One service\'s record: attendance, children, online, notes for the team, and new visitors (index, name, how they came, follow-up by, status new|contacted|returning|joined; contact details only when the administrator shares personal data). When offerings are shared: the offering lines (amounts in cents), cash count, other currencies, counters, who verified and who signed (names only). Example: {"service_id":12}.',
    input: { service_id: Id },
    handler: (a, ctx) => recordOut(a.service_id, ctx),
  },
  {
    name: 'canon_save_service_record', module: 'records', access: 'write', title: 'Record attendance, notes and visitors', annotations: WRITE,
    description: 'Record what happened at a service: attendance, children, online, notes for the team (replaces the notes — read them first with canon_get_service_record and keep what is there), add_visitors (appended), and visitor_updates by index (status / follow_up_by). Never changes offerings or cash counts. Ask the user before overwriting numbers someone already entered. Returns the record. Example: {"service_id":12,"attendance":134,"children":22,"add_visitors":[{"name":"Sam Example","source":"walked in"}],"visitor_updates":[{"index":0,"status":"contacted"}]}.',
    input: {
      service_id: Id,
      attendance: z.number().int().min(0).max(100000).nullable().optional(),
      children: z.number().int().min(0).max(100000).nullable().optional(),
      online: z.number().int().min(0).max(1000000).nullable().optional(),
      notes: z.string().max(20000).nullable().optional(),
      add_visitors: z.array(VisitorIn).max(100).optional(),
      visitor_updates: z.array(z.object({ index: z.number().int().min(0), status: z.enum(['new', 'contacted', 'returning', 'joined']).optional(), follow_up_by: z.string().max(200).optional() })).max(200).optional(),
    },
    handler: (a, ctx) => {
      const cur = rec.recordFor(a.service_id);
      const visitors = cur.visitors.map((v) => ({ ...v }));
      for (const u of a.visitor_updates ?? []) {
        const v = visitors[u.index];
        if (!v) throw new Error(`no visitor at index ${u.index} (the record has ${visitors.length})`);
        if (u.status) v.status = u.status === 'new' ? undefined : u.status;
        if (u.follow_up_by !== undefined) v.follow_up_by = u.follow_up_by || undefined;
      }
      for (const v of a.add_visitors ?? []) {
        visitors.push({
          name: v.name.trim(), source: v.source, follow_up_by: v.follow_up_by, status: v.status && v.status !== 'new' ? v.status : undefined,
          ...(ctx.pii && v.contact ? { contact: v.contact } : {}),
        });
      }
      const patch: Record<string, unknown> = {};
      for (const k of ['attendance', 'children', 'online', 'notes'] as const) if (a[k] !== undefined) patch[k] = a[k];
      if (a.add_visitors?.length || a.visitor_updates?.length) patch.visitors = visitors;
      rec.saveRecord(a.service_id, patch, { name: ctx.auth.user.display_name, admin: false });
      return recordOut(a.service_id, ctx);
    },
  },
  {
    name: 'canon_attendance_report', module: 'records', access: 'read', title: 'Attendance and visitors report', annotations: RO,
    description: 'Attendance over a period (default: the last 12 months): average, median, highest and lowest, children and online averages, the same period a year earlier, averages per month and per congregation, and each service\'s numbers (services unless kind is "meeting" or "all": a cell group\'s headcount would distort Sunday\'s); plus new visitors: how many reached each follow-up step (new → contacted → came back → joined), how they came, and per month. Visitor names only. Example: {"from":"2026-01-01","to":"2026-06-30"}.',
    input: PeriodInput,
    handler: (a) => {
      const p = periodOf(a);
      const att = reports.attendanceReport(p);
      const vis = reports.visitorsReport(p, { contact: false });
      return {
        ...att,
        rows: att.rows.filter((r) => r.recorded).map((r) => ({ service_id: r.service_id, date: r.date, title: r.title, congregation_id: r.congregation_id, attendance: r.attendance, children: r.children, online: r.online, visitors: r.visitors })),
        visitors: { funnel: vis.funnel, sources: vis.sources, months: vis.months, people: vis.visitors.map((v) => ({ date: v.date, service_id: v.service_id, name: v.name, source: v.source, status: v.status })) },
      };
    },
  },
  {
    name: 'canon_offerings_report', module: 'contributions', access: 'read', title: 'Offerings report', annotations: RO,
    description: 'Offerings over a period (default: the last 12 months), amounts in cents of the church currency: by fund and month, by fund, by payment method, total; other currencies kept apart (never converted; `converted` is the exchanged value entered on the records); each service\'s total, cash and whether its cash count is verified or signed (with kind "meeting": the meetings that take an offering); and cash counts still waiting to be verified, oldest first, with days waiting. Read only. Example: {"from":"2026-09-01","to":"2026-09-30"}.',
    input: PeriodInput,
    handler: (a, ctx) => {
      if (!money(ctx)) throw new Error('Offerings are not shared on this connection.');
      return reports.offeringsReport(periodOf(a));
    },
  },
  {
    name: 'canon_serving_report', module: 'volunteers', access: 'read', title: 'Serving report', annotations: RO,
    description: 'The rota over a past period (default: the last 12 months), services only: how often each person served (confirmed, declined, last served, teams), serving-team members who were not rostered (and when they last served), and per role how many services used it, at how many it was short of people, declines and how many people are qualified — to spot overload and roles that are hard to fill. Names only. Example: {"from":"2026-04-01","to":"2026-09-30"}.',
    input: { from: DateStr.optional(), to: DateStr.optional() },
    handler: (a) => reports.servingReport(periodOf(a)),
  },
  {
    name: 'canon_song_report', module: 'services', access: 'read', title: 'Song usage report', annotations: RO,
    description: 'What was sung in the services of a period (default: the last 12 months): each song with times sung, first/last date, public domain or copyright and CCLI song number (for a licence usage report), and library songs not sung in the period (with when they were last sung). Example: {"from":"2026-01-01","to":"2026-12-31"}.',
    input: PeriodInput,
    handler: (a) => reports.songsReport(periodOf(a)),
  },
  {
    name: 'canon_scripture_report', module: 'services', access: 'read', title: 'Scripture coverage report', annotations: RO,
    description: 'Which chapters of the Bible were read (Scripture items) and preached (sermon passages), over a period (default: the last 12 months) or over chosen years that need not follow each other (`years`: [2023, 2025]). Returns totals (chapters covered of 1,189; Old and New Testament; books), per book the chapters read / preached (only books with any, unless all_books), the passages with dates, and the years that have services. Useful for planning a reading or preaching series on neglected books. Example: {"years":[2024,2025]}.',
    input: { ...PeriodInput, years: z.array(z.number().int().min(1900).max(2200)).max(50).optional(), all_books: z.boolean().optional().describe('include books with nothing read or preached') },
    handler: (a) => {
      const r = reports.scriptureReport(a);
      const books = r.books.filter((b) => a.all_books || b.read.some(Boolean) || b.preached.some(Boolean)).map((b) => ({
        book: b.en, zh: b.zh, chapters: b.chapters,
        read: b.read.flatMap((n, i) => (n ? [i + 1] : [])), preached: b.preached.flatMap((n, i) => (n ? [i + 1] : [])),
      }));
      return { period: r.period, years: r.years, years_available: r.years_available, services: r.services, totals: r.totals, books, passages: r.passages.map((x) => ({ date: x.date, service_id: x.service_id, kind: x.kind, ref: x.ref })) };
    },
  },
  {
    name: 'canon_membership_stats', module: 'members', access: 'read', title: 'Membership statistics', annotations: RO,
    description: 'Counts from the member register: people by status, members and regulars by congregation, gender and age band (no birth dates), and who joined (membership date) or was baptised in a period, plus how many were added to the register. Example: {"from":"2026-01-01","to":"2026-12-31"}.',
    input: PeriodInput,
    handler: (a) => reports.membershipReport(periodOf(a)),
  },
];
