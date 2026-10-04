// MCP tools for volunteers: teams, roles, team rosters, the rota (assignments) and unavailability.
import { z } from 'zod';
import * as S from '../../shared/schemas.ts';
import type { AssignmentStatus, L10n } from '../../shared/types.ts';
import { get } from '../db.ts';
import { NotFound } from '../lib/table.ts';
import * as reg from '../repo/registers.ts';
import * as vol from '../repo/volunteers.ts';
import * as grp from '../repo/groups.ts';
import { DESTRUCTIVE, DateStr, Id, InputError, RO, addDays, need, runBatch, today, type Ctx, type ToolDef } from './common.ts';

const Status = z.enum(['scheduled', 'confirmed', 'declined']);

const unavailableLine = (u: ReturnType<typeof vol.listUnavailability>[number], ctx: Ctx) => ({
  id: u.id, person_id: u.person_id, person: u.person_name, start_date: u.start_date, end_date: u.end_date, ...(ctx.pii ? { reason: u.reason } : {}),
});

// ---------------------------------------------------------------- rota batch

const RotaOp = z.object({
  op: z.enum(['assign', 'set_status', 'unassign', 'autofill']),
  service_id: Id.optional(),
  role_id: Id.optional(),
  person_id: Id.optional(),
  assignment_id: Id.optional().describe('set_status / unassign (or give service_id + role_id + person_id)'),
  status: Status.optional(),
  service_ids: z.array(Id).max(30).optional().describe('autofill'),
});
type RotaOp = z.infer<typeof RotaOp>;

function findAssignment(o: RotaOp) {
  if (o.assignment_id) return vol.assignments.get(o.assignment_id);
  const sid = need(o.service_id, 'assignment_id or service_id', o.op);
  const rid = need(o.role_id, 'role_id', o.op);
  const pid = need(o.person_id, 'person_id', o.op);
  const a = get<{ id: number }>('SELECT id FROM assignments WHERE service_id = ? AND role_id = ? AND person_id = ?', sid, rid, pid);
  if (!a) throw new NotFound(`person ${pid} is not assigned to role ${rid} in service ${sid}`);
  return vol.assignments.get(a.id);
}

function applyRotaOp(o: RotaOp, touched: Set<number>) {
  switch (o.op) {
    case 'assign': {
      const a = vol.assign(need(o.service_id, 'service_id', o.op), need(o.role_id, 'role_id', o.op), need(o.person_id, 'person_id', o.op), o.status as AssignmentStatus | undefined);
      touched.add(a.service_id);
      return { op: o.op, assignment_id: a.id, service_id: a.service_id, role_id: a.role_id, person_id: a.person_id, status: a.status };
    }
    case 'set_status': {
      const cur = findAssignment(o);
      const a = vol.assignments.update(cur.id, { status: need(o.status, 'status', o.op) });
      touched.add(a.service_id);
      return { op: o.op, assignment_id: a.id, status: a.status };
    }
    case 'unassign': {
      const cur = findAssignment(o);
      vol.assignments.remove(cur.id);
      touched.add(cur.service_id);
      return { op: o.op, assignment_id: cur.id, service_id: cur.service_id, role_id: cur.role_id, person_id: cur.person_id };
    }
    case 'autofill': {
      const ids = o.service_ids?.length ? o.service_ids : [need(o.service_id, 'service_ids', o.op)];
      const created = vol.autofill(ids);
      ids.forEach((id) => touched.add(id));
      return {
        op: o.op,
        created: created.map((x) => ({ assignment_id: x.id, service_id: x.service_id, role_id: x.role_id, person_id: x.person_id, person: x.person_name })),
      };
    }
  }
}

// ---------------------------------------------------------------- team roster batch

const TeamOp = z.object({
  op: z.enum(['add', 'remove', 'set_leader']),
  person_id: Id,
  is_leader: z.boolean().optional().describe('add / set_leader (default true for set_leader)'),
  cascade: z.boolean().optional().describe('remove: also drop their role qualifications in this team'),
});
type TeamOp = z.infer<typeof TeamOp>;

function applyTeamOp(teamId: number, o: TeamOp) {
  switch (o.op) {
    case 'add': {
      const m = grp.addTeamMember(teamId, o.person_id, o.is_leader);
      return { op: o.op, person_id: m.person_id, is_leader: m.is_leader };
    }
    case 'set_leader': {
      const m = grp.setTeamLeader(teamId, o.person_id, o.is_leader ?? true);
      return { op: o.op, person_id: m.person_id, is_leader: m.is_leader };
    }
    case 'remove':
      return { op: o.op, person_id: o.person_id, ...grp.removeTeamMember(teamId, o.person_id, !!o.cascade) };
  }
}

// ---------------------------------------------------------------- tools

export const VOLUNTEER_TOOLS: ToolDef[] = [
  {
    name: 'canon_get_rota', module: 'volunteers', access: 'read', title: 'Get the rota', annotations: RO,
    description: 'The volunteer rota for services between two dates (default: the next 8 weeks): each service with its assignments (assignment id, role, person, status); every team with its roles (id, how many needed, people qualified), its roster (members, leaders); and who is unavailable (unavailability ids). With person_id: that person\'s upcoming schedule, teams and unavailability instead. Names only, no contact details. Example: {"from":"2026-10-01","to":"2026-10-31"}.',
    input: { from: DateStr.optional(), to: DateStr.optional(), person_id: Id.optional() },
    handler: (a, ctx) => {
      const from = a.from ?? today();
      if (a.person_id) {
        const p = reg.people.get(a.person_id);
        return {
          person_id: p.id,
          person: reg.displayName(p),
          schedule: vol.personSchedule(p.id, from).filter((s) => !a.to || s.date <= a.to),
          teams: grp.personTeams(p.id).map((t) => ({ team_id: t.team_id, name: t.name, is_leader: t.is_leader })),
          unavailable: vol.listUnavailability(from, a.to).filter((u) => u.person_id === p.id).map((u) => unavailableLine(u, ctx)),
        };
      }
      const to = a.to ?? addDays(from, 56);
      const r = vol.rota(from, to);
      const roleName = new Map<number, L10n>();
      for (const t of r.teams) for (const ro of t.roles) roleName.set(ro.id, ro.name);
      return {
        from,
        to,
        services: r.services.map((s) => ({
          id: s.id, date: s.date, start_time: s.start_time, title: s.title, status: s.status,
          assignments: r.assignments.filter((x) => x.service_id === s.id).map((x) => ({
            id: x.id, role_id: x.role_id, role: roleName.get(x.role_id), person_id: x.person_id, person: x.person_name, status: x.status,
          })),
        })),
        teams: r.teams.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          roles: t.roles.map((ro) => ({ id: ro.id, name: ro.name, needed: ro.needed, qualified: ro.members })),
          members: t.members,
        })),
        unavailable: r.unavailability.map((u) => unavailableLine(u, ctx)),
      };
    },
  },
  {
    name: 'canon_update_rota', module: 'volunteers', access: 'write', title: 'Update the rota', annotations: DESTRUCTIVE,
    description: 'Apply a batch of rota changes in one transaction: assign {service_id, role_id, person_id, status?} (if already assigned only the status changes); set_status {assignment_id, status: scheduled|confirmed|declined}; unassign {assignment_id} (prefer set_status "declined" when someone declined; ask before removing); autofill {service_ids} fills empty slots fairly with qualified, available people (existing assignments are never changed). set_status / unassign also accept service_id + role_id + person_id instead of assignment_id. All or nothing: if any op fails nothing changes and per-op errors are returned. Returns the results and the roster warnings of the services touched — tell the user about them. Example: {"ops":[{"op":"assign","service_id":12,"role_id":3,"person_id":45},{"op":"autofill","service_ids":[12,13]}]}.',
    input: { ops: z.array(RotaOp).min(1).max(50) },
    handler: (a) => {
      const touched = new Set<number>();
      const results = runBatch(a.ops as RotaOp[], (o) => applyRotaOp(o, touched));
      const warnings = [...touched].flatMap((sid) => vol.rosterWarnings(sid).map((w) => ({ service_id: sid, ...w })));
      return { results, warnings: warnings.length ? warnings : undefined };
    },
  },
  {
    name: 'canon_update_team_members', module: 'volunteers', access: 'write', title: 'Update a team roster', annotations: DESTRUCTIVE,
    description: 'Change who is on a volunteer team (team ids from canon_get_rota) in one transaction: add {person_id, is_leader?}, set_leader {person_id, is_leader}, remove {person_id, cascade?}. Removing fails while the person is still qualified for roles in the team unless cascade=true, which drops those qualifications too (past rota assignments are kept). Being qualified for a role adds a person to its team automatically. All or nothing, with per-op errors. Returns the team roster. Example: {"team_id":2,"ops":[{"op":"add","person_id":45,"is_leader":true},{"op":"remove","person_id":31}]}.',
    input: { team_id: Id, ops: z.array(TeamOp).min(1).max(50) },
    handler: (a) => {
      const results = runBatch(a.ops as TeamOp[], (o) => applyTeamOp(a.team_id, o));
      const members = grp.teamMembers(a.team_id).map((m) => ({ person_id: m.person_id, name: m.name, is_leader: m.is_leader, roles: m.roles }));
      return { team_id: a.team_id, results, members };
    },
  },
  {
    name: 'canon_set_unavailability', module: 'volunteers', access: 'write', title: 'Set unavailability', annotations: DESTRUCTIVE,
    description: 'Record that a person is unavailable from start_date to end_date inclusive (e.g. travelling), or remove a record (action "remove" with its id from canon_get_rota). Returns the record, or {removed}. Example: {"person_id":45,"start_date":"2026-11-01","end_date":"2026-11-14","reason":"overseas"}.',
    input: {
      action: z.enum(['add', 'remove']).default('add'),
      id: Id.optional().describe('remove'),
      ...S.UnavailabilityInput.partial().shape,
    },
    handler: (a) => {
      if (a.action === 'remove') {
        const u = vol.unavailability.get(need(a.id, 'id', 'remove'));
        vol.unavailability.remove(u.id);
        return { removed: u.id, person_id: u.person_id };
      }
      const input = S.UnavailabilityInput.parse({ person_id: a.person_id, start_date: a.start_date, end_date: a.end_date, reason: a.reason });
      if (input.end_date < input.start_date) throw new InputError('end_date is before start_date');
      const u = vol.unavailability.insert(input);
      return { id: u.id, person_id: u.person_id, start_date: u.start_date, end_date: u.end_date };
    },
  },
];
