// MCP tools for the people registers: members (people, households) and co-workers.
// Contact details, addresses, birth dates and notes only when the administrator exposes member PII.
// (server/mcp.ts audits these modules with argument keys only.)
import { z } from 'zod';
import * as S from '../../shared/schemas.ts';
import type { Person } from '../../shared/types.ts';
import { tx } from '../db.ts';
import * as reg from '../repo/registers.ts';
import * as grp from '../repo/groups.ts';
import { findCongregation } from '../repo/congregations.ts';
import { COWORKER_PII, HOUSEHOLD_PII, Id, InputError, Limit, PERSON_PII, RO, WRITE, mergeL10nFields, redact, type ToolDef } from './common.ts';

const MemberStatus = z.enum(['member', 'regular', 'visitor', 'inactive', 'transferred', 'deceased']);

function personSummary(p: Person & { household_name?: string | null }, pii: boolean) {
  return {
    id: p.id,
    name: reg.displayName(p),
    status: p.status,
    gender: p.gender,
    household_id: p.household_id,
    household: p.household_name ?? undefined,
    household_role: p.household_role,
    preferred_lang: p.preferred_lang,
    ...(pii ? { phone: p.phone, email: p.email } : {}),
  };
}

const personOut = (p: Person, pii: boolean) => ({ ...redact(p, PERSON_PII, pii), name: reg.displayName(p) });

function householdOut(id: number, pii: boolean) {
  const h = reg.households.get(id);
  return {
    ...redact({ id: h.id, name: h.name, address: h.address, phone: h.phone, notes: h.notes }, HOUSEHOLD_PII, pii),
    members: reg.people.list('household_id = ?', [id], 'id').map((m) => ({ id: m.id, name: reg.displayName(m), household_role: m.household_role, status: m.status })),
  };
}

export const PEOPLE_TOOLS: ToolDef[] = [
  // ======================================================== members
  {
    name: 'canon_find_people', module: 'members', access: 'read', title: 'Find people', annotations: RO,
    description: 'The member register. view "people" (default): search by name in any language (q), membership status and/or household_id; returns {total, people:[{id, name, status, household…}]}. view "households": families with their members (q filters by name). view "stats": counts by membership status. view "birthdays": birthdays in the next `days` days (only when the administrator exposes personal data). Use canon_get_person for one person. Example: {"q":"Tan","status":["member"]}.',
    input: {
      view: z.enum(['people', 'households', 'stats', 'birthdays']).default('people'),
      q: z.string().max(200).optional(),
      status: z.array(MemberStatus).optional(),
      household_id: Id.optional(),
      congregation: z.union([Id, z.string().max(40)]).optional().describe('congregation id, code or name (churches with several congregations)'),
      days: z.number().int().min(1).max(60).default(14).describe('birthdays'),
      limit: Limit(50, 100),
      offset: z.number().int().min(0).default(0),
    },
    handler: (a, ctx) => {
      if (a.view === 'stats') {
        const by = reg.memberStats();
        return { by_status: Object.fromEntries(by.map((r) => [r.status, r.n])), total: by.reduce((n, r) => n + r.n, 0) };
      }
      if (a.view === 'birthdays') {
        if (!ctx.pii) throw new InputError('Birthdays are withheld by the church administrator on this connection.');
        return reg.upcomingBirthdays(a.days).map((b) => ({ person_id: b.person.id, name: reg.displayName(b.person), date: b.date, in_days: b.in_days }));
      }
      const q = a.q?.trim().toLowerCase();
      if (a.view === 'households') {
        return reg.householdsWithMembers()
          .map((h) => ({
            ...redact({ id: h.id, name: h.name, address: h.address, phone: h.phone }, HOUSEHOLD_PII, ctx.pii),
            members: h.members.map((m) => ({ id: m.id, name: reg.displayName(m), household_role: m.household_role, status: m.status })),
          }))
          .filter((h) => !q || [h.name, ...h.members.map((m) => m.name)].join(' ').toLowerCase().includes(q))
          .slice(a.offset, a.offset + a.limit);
      }
      const c = a.congregation != null ? findCongregation(a.congregation) : undefined;
      if (a.congregation != null && !c) throw new InputError(`unknown congregation ${JSON.stringify(a.congregation)}`);
      const r = reg.listPeople({ q: a.q, status: a.status?.join(','), household_id: a.household_id, congregation_id: c?.id, limit: a.limit, offset: a.offset });
      let rows = r.rows;
      // When contact details are hidden, don't let a search on phone / e-mail reveal who owns them.
      if (!ctx.pii && q) {
        rows = rows.filter((p) => [p.first_name, p.last_name, p.native_name, p.preferred_name].join(' ').toLowerCase().includes(q) ||
          reg.displayName(p).toLowerCase().includes(q));
      }
      return { total: !ctx.pii && q ? rows.length : r.total, people: rows.map((p) => personSummary(p, ctx.pii)) };
    },
  },
  {
    name: 'canon_get_person', module: 'members', access: 'read', title: 'Get a person', annotations: RO,
    description: 'One person from the member register: names, status, membership / baptism dates, household and co-worker positions. Contact details only when the administrator exposes them.',
    input: { id: Id },
    handler: (a, ctx) => {
      const p = reg.people.get(a.id);
      const hh = p.household_id ? reg.households.find(p.household_id) : undefined;
      return {
        ...personOut(p, ctx.pii),
        household: hh ? { id: hh.id, name: hh.name } : null,
        coworker: reg.coworkers.list('person_id = ?', [p.id]).map((c) => redact(c, COWORKER_PII, ctx.pii)),
        ...(ctx.pii ? {} : { redacted: 'contact details, address, birth date and notes are withheld by the administrator' }),
      };
    },
  },
  {
    name: 'canon_save_person', module: 'members', access: 'write', title: 'Save a person', annotations: { ...WRITE, idempotentHint: true },
    description: 'Add a person (no id; fields.first_name required; native_name for a name in another script, e.g. Chinese; status defaults to regular) or update one (id; only the given fields change, e.g. status, household_id + household_role, membership / baptism dates). Search with canon_find_people first to avoid duplicates. Returns the person. Example: {"id":45,"fields":{"status":"member","membership_date":"2026-10-04"}}.',
    input: { id: Id.optional(), fields: S.PersonInput.partial().default({}) },
    handler: (a, ctx) => {
      const p = a.id ? reg.people.update(a.id, mergeL10nFields(reg.people.get(a.id), a.fields, ['honorific'])) : reg.people.insert(S.PersonInput.parse(a.fields));
      return { ...personOut(p, ctx.pii), created: a.id ? undefined : true };
    },
  },
  {
    name: 'canon_save_household', module: 'members', access: 'write', title: 'Save a household', annotations: { ...WRITE, idempotentHint: true },
    description: 'Create a household / family (no id; fields.name required) or update one (id). members links people to it [{person_id, household_role: head|spouse|child|other}]. Returns the household with its members. Example: {"fields":{"name":"Tan family"},"members":[{"person_id":45,"household_role":"head"}]}.',
    input: {
      id: Id.optional(),
      fields: S.HouseholdInput.partial().default({}),
      members: z.array(z.object({ person_id: Id, household_role: z.enum(['head', 'spouse', 'child', 'other']).optional() })).max(30).optional(),
    },
    handler: (a, ctx) => tx(() => {
      const h = a.id ? reg.households.update(a.id, a.fields) : reg.households.insert(S.HouseholdInput.parse(a.fields));
      for (const m of (a.members ?? []) as { person_id: number; household_role?: string }[]) {
        reg.people.update(m.person_id, { household_id: h.id, ...(m.household_role ? { household_role: m.household_role } : {}) });
      }
      return { ...householdOut(h.id, ctx.pii), created: a.id ? undefined : true };
    }),
  },

  // ======================================================== co-workers
  {
    name: 'canon_list_coworkers', module: 'coworkers', access: 'read', title: 'List co-workers', annotations: RO,
    description: 'Pastors, elders, deacons, staff and lay leaders: position, category, employment, ministry area, ordained, term dates, and the committees each sits on (committee tags with role). active=true (default) hides those whose term has ended.',
    input: { active: z.boolean().default(true) },
    handler: (a, ctx) => {
      const { tags } = grp.committeesView();
      return reg.listCoworkers({ active: a.active }).map((c) => ({
        ...redact(c, COWORKER_PII, ctx.pii),
        committees: tags[c.person_id]?.map((t) => ({ group_id: t.group_id, name: t.name, role: t.role })),
      }));
    },
  },
  {
    name: 'canon_save_coworker', module: 'coworkers', access: 'write', title: 'Save a co-worker', annotations: { ...WRITE, idempotentHint: true },
    description: 'Record a co-worker position for an existing person (no id; fields.person_id, position and category required; category: pastor|elder|deacon|ministry_staff|admin_staff|lay_leader) or update one (id; e.g. set end_date when a term ends). Returns the record.',
    input: { id: Id.optional(), fields: S.CoworkerInput.partial().default({}) },
    handler: (a, ctx) => {
      const c = a.id ? reg.coworkers.update(a.id, a.fields) : reg.coworkers.insert(S.CoworkerInput.parse(a.fields));
      return { ...redact(c, COWORKER_PII, ctx.pii), created: a.id ? undefined : true };
    },
  },
];
