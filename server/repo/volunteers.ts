// Volunteer teams, roles, qualified members, unavailability, per-service assignments and the rota.
import type { Assignment, AssignmentStatus, ServiceRole, Team, Unavailability } from '../../shared/types.ts';
import { all, get, run, tx } from '../db.ts';
import { table, BadRequest, NotFound } from '../lib/table.ts';
import { ensureOnRoleTeam, isLeaderRole, teamGroupId } from './groups.ts';
import { checkRef, wallSql } from '../lib/walls.ts';
import { churchToday } from '../lib/dates.ts';

export const teams = table<Team>({ name: 'teams', cols: ['name', 'description', 'color', 'sort'], json: ['name'] });
export const roles = table<ServiceRole>({ name: 'roles', cols: ['team_id', 'name', 'needed', 'sort'], json: ['name'] });
export const unavailability = table<Unavailability>({
  name: 'unavailability',
  cols: ['person_id', 'start_date', 'end_date', 'reason'],
  guard: { refs: { person_id: 'people' } },
});
export const assignments = table<Assignment>({
  name: 'assignments',
  cols: ['service_id', 'role_id', 'person_id', 'status', 'notes'],
  guard: { refs: { service_id: 'services', person_id: 'people' } },
});

const personName = `TRIM(IFNULL(p.preferred_name, p.first_name) || ' ' || p.last_name) ||
  CASE WHEN p.native_name IS NOT NULL THEN ' ' || p.native_name ELSE '' END`;

/** Teams with their roles and the people qualified for each role. */
export function teamsWithRoles() {
  const ts = teams.list('', [], 'sort, id');
  const rs = roles.list('', [], 'sort, id');
  const members = all<{ role_id: number; person_id: number; name: string }>(
    `SELECT rm.role_id, rm.person_id, ${personName} AS name FROM role_members rm JOIN people p ON p.id = rm.person_id WHERE 1${wallSql('p.congregation_id').sql} ORDER BY name`,
    ...wallSql('p.congregation_id').params,
  );
  // team roster: the current members of each team's "Serving team" group, leaders first, then by name
  for (const t of ts) teamGroupId(t.id);
  const roster = all<{ team_id: number; person_id: number; name: string; role: string | null }>(
    `SELECT t.id AS team_id, gm.person_id, ${personName} AS name, gm.role FROM group_members gm JOIN teams t ON t.group_id = gm.group_id
     JOIN people p ON p.id = gm.person_id WHERE (gm.end_date IS NULL OR gm.end_date >= date('now'))${wallSql('p.congregation_id').sql} ORDER BY name`,
    ...wallSql('p.congregation_id').params,
  ).map((m) => ({ ...m, is_leader: isLeaderRole(m.role) ? 1 : 0 })).sort((a, b) => b.is_leader - a.is_leader);
  return ts.map((t) => ({
    ...t,
    roles: rs
      .filter((r) => r.team_id === t.id)
      .map((r) => ({ ...r, members: members.filter((m) => m.role_id === r.id).map(({ person_id, name }) => ({ person_id, name })) })),
    members: roster.filter((m) => m.team_id === t.id).map(({ person_id, name, is_leader }) => ({ person_id, name, is_leader: !!is_leader })),
  }));
}

export function setRoleMembers(roleId: number, personIds: number[]) {
  roles.get(roleId);
  for (const pid of new Set(personIds)) checkRef('people', pid, 'write');
  tx(() => {
    run('DELETE FROM role_members WHERE role_id = ?', roleId);
    for (const pid of new Set(personIds)) {
      run('INSERT INTO role_members (role_id, person_id) VALUES (?, ?)', roleId, pid);
      // qualifying for a role puts the person on that role's team roster
      ensureOnRoleTeam(roleId, pid);
    }
  });
}

export function roleByName(name: string): ServiceRole | undefined {
  const r = get<Record<string, unknown>>(
    `SELECT * FROM roles WHERE lower(json_extract(name,'$.en')) = lower(?) OR json_extract(name,'$.zh') = ?`,
    name, name,
  );
  return roles.decode(r);
}

export function isUnavailable(personId: number, date: string) {
  return !!get('SELECT 1 FROM unavailability WHERE person_id = ? AND ? BETWEEN start_date AND end_date', personId, date);
}

export function listUnavailability(from?: string, to?: string) {
  return all<Unavailability & { person_name: string }>(
    `SELECT u.*, ${personName} AS person_name FROM unavailability u JOIN people p ON p.id = u.person_id
     WHERE (? IS NULL OR u.end_date >= ?) AND (? IS NULL OR u.start_date <= ?)${wallSql('p.congregation_id').sql} ORDER BY u.start_date`,
    from ?? null, from ?? null, to ?? null, to ?? null, ...wallSql('p.congregation_id').params,
  );
}

export function serviceAssignments(serviceId: number) {
  return all<Assignment & { person_name: string; role_name: string; team_id: number; email: string | null; phone: string | null }>(
    `SELECT a.*, ${personName} AS person_name, r.name AS role_name, r.team_id, p.email, p.phone
     FROM assignments a JOIN people p ON p.id = a.person_id JOIN roles r ON r.id = a.role_id
     JOIN teams t ON t.id = r.team_id
     WHERE a.service_id = ?${wallSql('p.congregation_id').sql} ORDER BY t.sort, t.id, r.sort, r.id, person_name`,
    serviceId, ...wallSql('p.congregation_id').params,
  ).map((a) => ({ ...a, role_name: JSON.parse(a.role_name) }));
}

export function assign(serviceId: number, roleId: number, personId: number, status: AssignmentStatus = 'scheduled') {
  if (!get('SELECT 1 FROM services WHERE id = ?', serviceId)) throw new NotFound(`service ${serviceId} not found`);
  roles.get(roleId);
  if (!get('SELECT 1 FROM people WHERE id = ?', personId)) throw new NotFound(`person ${personId} not found`);
  checkRef('services', serviceId, 'write');
  checkRef('people', personId, 'write');
  run(
    `INSERT INTO assignments (service_id, role_id, person_id, status) VALUES (?,?,?,?)
     ON CONFLICT(service_id, role_id, person_id) DO UPDATE SET status = excluded.status`,
    serviceId, roleId, personId, status,
  );
  return get<Assignment>('SELECT * FROM assignments WHERE service_id = ? AND role_id = ? AND person_id = ?', serviceId, roleId, personId)!;
}

/** Warnings for a service's roster: unavailable people, double bookings, unfilled roles. */
export function rosterWarnings(serviceId: number) {
  const svc = get<{ date: string }>('SELECT date FROM services WHERE id = ?', serviceId);
  if (!svc) throw new NotFound(`service ${serviceId} not found`);
  const as = serviceAssignments(serviceId).filter((a) => a.status !== 'declined');
  const warnings: { type: 'unavailable' | 'double_booked' | 'unfilled'; message: string; role_id?: number; person_id?: number }[] = [];
  const seen = new Map<number, string[]>();
  for (const a of as) {
    if (isUnavailable(a.person_id, svc.date)) {
      warnings.push({ type: 'unavailable', message: `${a.person_name} is unavailable on ${svc.date}`, person_id: a.person_id, role_id: a.role_id });
    }
    seen.set(a.person_id, [...(seen.get(a.person_id) ?? []), a.role_name.en ?? '']);
  }
  for (const [pid, rs] of seen) {
    if (rs.length > 1) {
      const name = as.find((a) => a.person_id === pid)!.person_name;
      warnings.push({ type: 'double_booked', message: `${name} has ${rs.length} roles: ${rs.join(', ')}`, person_id: pid });
    }
  }
  for (const r of roles.list('needed > 0')) {
    const n = as.filter((a) => a.role_id === r.id).length;
    if (n < r.needed) warnings.push({ type: 'unfilled', message: `${r.name.en ?? r.name.zh}: ${n}/${r.needed}`, role_id: r.id });
  }
  return warnings;
}

/** Rota grid for services between two dates. */
export function rota(from: string, to: string, congregationId?: number) {
  const services = all<{ id: number; date: string; start_time: string; title: string; status: string; congregation_id: number | null }>(
    `SELECT id, date, start_time, title, status, congregation_id FROM services WHERE kind = 'service' AND date BETWEEN ? AND ? AND (? IS NULL OR congregation_id = ?)${wallSql('congregation_id').sql} ORDER BY date, start_time`,
    from, to, congregationId ?? null, congregationId ?? null, ...wallSql('congregation_id').params,
  ).map((s) => ({ ...s, title: JSON.parse(s.title) }));
  const ids = services.map((s) => s.id);
  const cells = ids.length
    ? all<{ id: number; service_id: number; role_id: number; person_id: number; status: string; person_name: string }>(
        `SELECT a.id, a.service_id, a.role_id, a.person_id, a.status, ${personName} AS person_name
         FROM assignments a JOIN people p ON p.id = a.person_id WHERE a.service_id IN (${ids.map(() => '?').join(',')})${wallSql('p.congregation_id').sql}`,
        ...ids, ...wallSql('p.congregation_id').params,
      )
    : [];
  return { services, teams: teamsWithRoles(), assignments: cells, unavailability: listUnavailability(from, to) };
}

/**
 * Fill empty role slots for the given services, fairly: prefer qualified people who are available,
 * not already serving in that service, and who have served this role least (then least recently).
 * Existing assignments are never changed. Returns the assignments created.
 */
export function autofill(serviceIds: number[]) {
  const created: (Assignment & { person_name: string })[] = [];
  const svcs = all<{ id: number; date: string }>(
    `SELECT id, date FROM services WHERE id IN (${serviceIds.map(() => '?').join(',') || 'NULL'}) ORDER BY date`,
    ...serviceIds,
  );
  if (!svcs.length) throw new BadRequest('No services selected');
  // Scarcest roles first: a role few people can fill (e.g. Elder on Duty) is staffed before
  // roles those same people could also fill (e.g. Prayer Leader).
  const allRoles = roles
    .list('needed > 0', [], 'sort, id')
    .map((r) => ({ r, pool: get<{ n: number }>('SELECT COUNT(*) n FROM role_members WHERE role_id = ?', r.id)!.n }))
    .sort((a, b) => a.pool - b.pool)
    .map((x) => x.r);
  tx(() => {
    for (const svc of svcs) {
      for (const role of allRoles) {
        const current = all<{ person_id: number }>(
          `SELECT person_id FROM assignments WHERE service_id = ? AND role_id = ? AND status != 'declined'`, svc.id, role.id,
        );
        let missing = role.needed - current.length;
        if (missing <= 0) continue;
        const candidates = all<{ person_id: number; name: string; served: number; last: string | null }>(
          `SELECT rm.person_id, ${personName} AS name,
             (SELECT COUNT(*) FROM assignments a JOIN services s ON s.id = a.service_id
               WHERE a.person_id = rm.person_id AND a.role_id = rm.role_id AND s.date BETWEEN date(?, '-90 days') AND date(?, '+90 days')) AS served,
             (SELECT MAX(s.date) FROM assignments a JOIN services s ON s.id = a.service_id
               WHERE a.person_id = rm.person_id AND s.date < ?) AS last
           FROM role_members rm JOIN people p ON p.id = rm.person_id
           WHERE rm.role_id = ? AND p.status NOT IN ('inactive','transferred','deceased')
             AND rm.person_id NOT IN (SELECT person_id FROM assignments WHERE service_id = ?)
             AND NOT EXISTS (SELECT 1 FROM unavailability u WHERE u.person_id = rm.person_id AND ? BETWEEN u.start_date AND u.end_date)
           ORDER BY served, IFNULL(last, '0000'), rm.person_id`,
          svc.date, svc.date, svc.date, role.id, svc.id, svc.date,
        );
        for (const c of candidates) {
          if (missing <= 0) break;
          const a = assign(svc.id, role.id, c.person_id);
          created.push({ ...a, person_name: c.name });
          missing--;
        }
      }
    }
  });
  return created;
}

/** Upcoming assignments for one person (their personal schedule). */
export function personSchedule(personId: number, from = churchToday()) {
  return all<{ service_id: number; date: string; start_time: string; title: string; role_name: string; status: string }>(
    `SELECT a.service_id, s.date, s.start_time, s.title, r.name AS role_name, a.status
     FROM assignments a JOIN services s ON s.id = a.service_id JOIN roles r ON r.id = a.role_id
     WHERE a.person_id = ? AND s.date >= ? ORDER BY s.date`,
    personId, from,
  ).map((x) => ({ ...x, title: JSON.parse(x.title), role_name: JSON.parse(x.role_name) }));
}
