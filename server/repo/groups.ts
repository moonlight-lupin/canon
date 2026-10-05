// Groups (committees, fellowships 团契, cell groups 小组, ministries, serving teams) with their members and terms.
// A volunteer team (the AV team, the choir …) is a "Serving team" group: its roster is the group's members, and the
// team (teams.group_id) adds the rota roles. A leader is a member whose role is a leader role (Leader, 组长 …).
import type { Group, GroupKind, GroupMember, L10n } from '../../shared/types.ts';
import { all, get, run, tx, type SqlValue } from '../db.ts';
import { table, BadRequest, NotFound } from '../lib/table.ts';

export class Conflict extends Error {
  status = 409;
}

export const groups = table<Group>({
  name: 'groups',
  cols: ['name', 'kind', 'description', 'color', 'meeting', 'active', 'sort', 'congregation_id'],
  json: ['name'],
  bool: ['active'],
});

export const groupMembers = table<GroupMember>({
  name: 'group_members',
  cols: ['group_id', 'person_id', 'role', 'start_date', 'end_date'],
});

const personName = `TRIM(IFNULL(p.preferred_name, p.first_name) || ' ' || p.last_name) ||
  CASE WHEN p.native_name IS NOT NULL THEN ' ' || p.native_name ELSE '' END`;

const today = () => new Date().toISOString().slice(0, 10);

/** A membership counts as current while its term has not ended. */
const CURRENT = `(gm.end_date IS NULL OR gm.end_date >= ?)`;

/** Officer roles are listed first (moderator / chair / leader, then deputies, then secretary / treasurer). */
const LEAD_RE = /^(moderator|chair(man|person)?|president|leader|head|coordinator|convenor|主席|会长|组长|议长|团长|主理|负责人)$/i;
const DEPUTY_RE = /^(vice[- ]?(chair|president)|deputy|assistant leader|co-?leader|副主席|副会长|副组长|副团长)$/i;
const OFFICER_RE = /^(secretary|clerk|treasurer|书记|秘书|文书|财务|司库)$/i;
export const roleRank = (role: string | null | undefined) => {
  const r = (role ?? '').trim();
  if (!r || /^(member|组员|团员|会员|成员)$/i.test(r)) return 9;
  if (LEAD_RE.test(r)) return 0;
  if (DEPUTY_RE.test(r)) return 1;
  if (OFFICER_RE.test(r)) return 2;
  return 5;
};
export const isLeaderRole = (role: string | null | undefined) => roleRank(role) <= 1;

export interface MemberRow extends GroupMember {
  name: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  native_name: string | null;
  status: string;
  phone: string | null;
  email: string | null;
  current: boolean;
}

const byRank = <T extends { role: string | null; name: string }>(a: T, b: T) =>
  roleRank(a.role) - roleRank(b.role) || a.name.localeCompare(b.name);

/** Members of one group (current terms only unless includePast), officers first. */
export function membersOf(groupId: number, includePast = true): MemberRow[] {
  groups.get(groupId);
  const t = today();
  return all<Omit<MemberRow, 'current'> & { current: number }>(
    `SELECT gm.*, ${personName} AS name, p.first_name, p.last_name, p.preferred_name, p.native_name, p.status, p.phone, p.email,
            CASE WHEN ${CURRENT} THEN 1 ELSE 0 END AS current
     FROM group_members gm JOIN people p ON p.id = gm.person_id
     WHERE gm.group_id = ? ${includePast ? '' : `AND ${CURRENT}`}`,
    t, groupId, ...(includePast ? [] : [t]),
  )
    .map((m) => ({ ...m, current: !!m.current }))
    .sort((a, b) => Number(b.current) - Number(a.current) || byRank(a, b));
}

export interface GroupFilter {
  kind?: GroupKind;
  congregation_id?: number;
  /** include inactive groups (default false) */
  inactive?: boolean;
}

/** Groups with current member counts and their leaders. */
export function listGroups(f: GroupFilter = {}) {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (f.kind) {
    where.push('kind = ?');
    params.push(f.kind);
  }
  if (f.congregation_id) {
    where.push('congregation_id = ?');
    params.push(f.congregation_id);
  }
  if (!f.inactive) where.push('active = 1');
  const gs = groups.list(where.join(' AND '), params, 'sort, id');
  const t = today();
  const counts = new Map(
    all<{ group_id: number; n: number }>(`SELECT gm.group_id, COUNT(*) n FROM group_members gm WHERE ${CURRENT} GROUP BY gm.group_id`, t)
      .map((r) => [r.group_id, r.n]),
  );
  const officers = all<{ group_id: number; person_id: number; name: string; role: string | null }>(
    `SELECT gm.group_id, gm.person_id, ${personName} AS name, gm.role FROM group_members gm JOIN people p ON p.id = gm.person_id
     WHERE ${CURRENT} AND gm.role IS NOT NULL`,
    t,
  ).filter((m) => isLeaderRole(m.role)).sort(byRank);
  return gs.map((g) => ({
    ...g,
    member_count: counts.get(g.id) ?? 0,
    leaders: officers.filter((o) => o.group_id === g.id).map(({ person_id, name, role }) => ({ person_id, name, role })),
  }));
}

/** One group with all its members (past terms included, flagged current=false). */
export function groupDetail(id: number) {
  return { ...groups.get(id), members: membersOf(id, true) };
}

export function createGroup(input: Record<string, unknown>) {
  if (input.kind === 'serving_team') throw new BadRequest('Serving teams are added in Volunteers (Add team), where their rota roles are set.');
  return groups.insert(input);
}

export function updateGroup(id: number, patch: Record<string, unknown>) {
  const cur = groups.get(id);
  if (patch.kind !== undefined && patch.kind !== cur.kind && (patch.kind === 'serving_team' || cur.kind === 'serving_team')) {
    throw new BadRequest('A serving team stays a serving team (and other groups cannot become one): teams are managed in Volunteers.');
  }
  const g = groups.update(id, patch);
  // the team's name, description and colour follow its group
  if (g.kind === 'serving_team') {
    run('UPDATE teams SET name = ?, description = ?, color = ? WHERE group_id = ?', JSON.stringify(g.name), g.description ?? null, g.color, id);
  }
  return g;
}

export function deleteGroup(id: number) {
  const g = groups.get(id);
  if (g.kind === 'serving_team' && get('SELECT 1 FROM teams WHERE group_id = ?', id)) {
    throw new BadRequest('This is a volunteer team: delete it in Volunteers (its rota roles go with it).');
  }
  groups.remove(id);
}

function checkTerm(start?: string | null, end?: string | null) {
  if (start && end && end < start) throw Object.assign(new Error('The end date is before the start date.'), { status: 400 });
}

export function addGroupMember(groupId: number, m: { person_id: number; role?: string | null; start_date?: string | null; end_date?: string | null }) {
  groups.get(groupId);
  if (!get('SELECT 1 FROM people WHERE id = ?', m.person_id)) throw new NotFound(`person ${m.person_id} not found`);
  checkTerm(m.start_date, m.end_date);
  const existing = get<{ id: number }>('SELECT id FROM group_members WHERE group_id = ? AND person_id = ?', groupId, m.person_id);
  if (existing) {
    throw new Conflict(`This person is already a member of this group — edit their membership (member id ${existing.id}) instead.`);
  }
  return groupMembers.insert({ ...m, group_id: groupId, role: m.role?.trim() || null });
}

export function updateGroupMember(memberId: number, patch: { role?: string | null; start_date?: string | null; end_date?: string | null }) {
  const cur = groupMembers.get(memberId);
  checkTerm(patch.start_date === undefined ? cur.start_date : patch.start_date, patch.end_date === undefined ? cur.end_date : patch.end_date);
  // only the term fields may change; an explicit null clears the column
  const p = { role: typeof patch.role === 'string' ? patch.role.trim() || null : patch.role, start_date: patch.start_date, end_date: patch.end_date };
  return groupMembers.update(memberId, p);
}

export function removeGroupMember(memberId: number) {
  groupMembers.remove(memberId);
}

/** The groups a person belongs to (past terms included, flagged). */
export function personGroups(personId: number) {
  const t = today();
  return all<{ id: number; group_id: number; name: string; kind: GroupKind; color: string; active: number; role: string | null; start_date: string | null; end_date: string | null; current: number }>(
    `SELECT gm.id, gm.group_id, g.name, g.kind, g.color, g.active, gm.role, gm.start_date, gm.end_date,
            CASE WHEN ${CURRENT} THEN 1 ELSE 0 END AS current
     FROM group_members gm JOIN groups g ON g.id = gm.group_id WHERE gm.person_id = ? ORDER BY g.sort, g.id`,
    t, personId,
  ).map((r) => ({ ...r, name: JSON.parse(r.name) as L10n, active: !!r.active, current: !!r.current }));
}

/**
 * Committees joined with the co-worker register: each active committee with its current members
 * (role, term, co-worker positions) plus, per person, the committees they sit on (for tags).
 */
export function committeesView() {
  const cs = listGroups({ kind: 'committee' });
  const t = today();
  const rows = all<{ id: number; group_id: number; person_id: number; name: string; role: string | null; start_date: string | null; end_date: string | null }>(
    `SELECT gm.id, gm.group_id, gm.person_id, ${personName} AS name, gm.role, gm.start_date, gm.end_date
     FROM group_members gm JOIN groups g ON g.id = gm.group_id JOIN people p ON p.id = gm.person_id
     WHERE g.kind = 'committee' AND g.active = 1 AND ${CURRENT}`,
    t,
  );
  const positions = all<{ person_id: number; position: string; category: string }>(
    `SELECT person_id, position, category FROM coworkers WHERE end_date IS NULL OR end_date >= ? ORDER BY start_date`, t,
  );
  const committees = cs.map((c) => ({
    ...c,
    members: rows
      .filter((r) => r.group_id === c.id)
      .sort(byRank)
      .map((r) => ({ ...r, positions: positions.filter((p) => p.person_id === r.person_id).map((p) => p.position) })),
  }));
  const tags: Record<number, { member_id: number; group_id: number; name: L10n; color: string; role: string | null }[]> = {};
  for (const c of committees) {
    for (const m of c.members) (tags[m.person_id] ??= []).push({ member_id: m.id, group_id: c.id, name: c.name, color: c.color, role: m.role });
  }
  return { committees, tags };
}

// ---------------------------------------------------------------- volunteer team members

export interface TeamMemberRow {
  team_id: number;
  person_id: number;
  name: string;
  is_leader: boolean;
  status: string;
  /** role ids in this team the person is qualified for */
  roles: number[];
}

/**
 * The team's "Serving team" group (made on first use for a team that has none, e.g. one added before v0.9 or by
 * the first start-up's defaults).
 */
export function teamGroupId(teamId: number): number {
  const t = get<{ group_id: number | null; name: string; description: string | null; color: string; sort: number }>(
    'SELECT group_id, name, description, color, sort FROM teams WHERE id = ?', teamId,
  );
  if (!t) throw new NotFound(`team ${teamId} not found`);
  if (t.group_id && get('SELECT 1 FROM groups WHERE id = ?', t.group_id)) return t.group_id;
  const g = groups.insert({ name: JSON.parse(t.name), kind: 'serving_team', description: t.description, color: t.color, active: true, sort: 1000 + t.sort });
  run('UPDATE teams SET group_id = ? WHERE id = ?', g.id, teamId);
  return g.id;
}

export function teamMembers(teamId: number): TeamMemberRow[] {
  const gid = teamGroupId(teamId);
  const quals = all<{ person_id: number; role_id: number }>(
    'SELECT rm.person_id, rm.role_id FROM role_members rm JOIN roles r ON r.id = rm.role_id WHERE r.team_id = ? ORDER BY r.sort, r.id', teamId,
  );
  return all<{ person_id: number; name: string; role: string | null; status: string }>(
    `SELECT gm.person_id, ${personName} AS name, gm.role, p.status
     FROM group_members gm JOIN people p ON p.id = gm.person_id WHERE gm.group_id = ? AND ${CURRENT}`,
    gid, today(),
  )
    .map((m) => ({ team_id: teamId, person_id: m.person_id, name: m.name, status: m.status, is_leader: isLeaderRole(m.role), roles: quals.filter((q) => q.person_id === m.person_id).map((q) => q.role_id) }))
    .sort((a, b) => Number(b.is_leader) - Number(a.is_leader) || a.name.localeCompare(b.name));
}

/**
 * Put a person on a team's roster (the team's group). Someone whose term had ended joins again; `isLeader` true
 * makes their role "Leader", false clears a leader role, undefined leaves the role as it is.
 */
export function addTeamMember(teamId: number, personId: number, isLeader?: boolean) {
  const gid = teamGroupId(teamId);
  if (!get('SELECT 1 FROM people WHERE id = ?', personId)) throw new NotFound(`person ${personId} not found`);
  const m = get<{ id: number; role: string | null; end_date: string | null }>('SELECT id, role, end_date FROM group_members WHERE group_id = ? AND person_id = ?', gid, personId);
  const role = (cur: string | null) => (isLeader === undefined ? cur : isLeader ? (isLeaderRole(cur) ? cur : 'Leader') : isLeaderRole(cur) ? null : cur);
  if (!m) groupMembers.insert({ group_id: gid, person_id: personId, role: role(null) });
  else if (m.end_date && m.end_date < today()) groupMembers.update(m.id, { end_date: null, role: role(m.role) });
  else if (role(m.role) !== m.role) groupMembers.update(m.id, { role: role(m.role) });
  return teamMembers(teamId).find((x) => x.person_id === personId)!;
}

export function setTeamLeader(teamId: number, personId: number, isLeader: boolean) {
  const gid = teamGroupId(teamId);
  if (!get(`SELECT 1 FROM group_members gm WHERE gm.group_id = ? AND gm.person_id = ? AND ${CURRENT}`, gid, personId, today())) {
    throw new NotFound(`person ${personId} is not in team ${teamId}`);
  }
  return addTeamMember(teamId, personId, isLeader);
}

/**
 * Remove a person from a team. If they are still qualified for roles in that team the call fails with 409,
 * unless cascade is set, which also removes those qualifications (rota history is kept).
 */
export function removeTeamMember(teamId: number, personId: number, cascade = false) {
  const gid = teamGroupId(teamId);
  const held = all<{ role_id: number; name: string }>(
    'SELECT rm.role_id, r.name FROM role_members rm JOIN roles r ON r.id = rm.role_id WHERE r.team_id = ? AND rm.person_id = ? ORDER BY r.sort, r.id',
    teamId, personId,
  );
  if (held.length && !cascade) {
    const names = held.map((h) => {
      const n = JSON.parse(h.name) as L10n;
      return n.en || Object.values(n).find(Boolean) || `role ${h.role_id}`;
    });
    throw new Conflict(
      `Still qualified for ${held.length} role${held.length > 1 ? 's' : ''} in this team (${names.join(', ')}). Remove those qualifications first, or remove with cascade to drop them too.`,
    );
  }
  tx(() => {
    if (held.length) run(`DELETE FROM role_members WHERE person_id = ? AND role_id IN (SELECT id FROM roles WHERE team_id = ?)`, personId, teamId);
    const m = get<{ id: number }>('SELECT id FROM group_members WHERE group_id = ? AND person_id = ?', gid, personId);
    if (m) groupMembers.remove(m.id);
    else if (!held.length) throw new NotFound(`person ${personId} is not in team ${teamId}`);
  });
  return { removed_qualifications: held.map((h) => h.role_id) };
}

/** The teams a person is on (with leader flag). */
export function personTeams(personId: number) {
  return all<{ team_id: number; name: string; color: string; role: string | null }>(
    `SELECT t.id AS team_id, t.name, t.color, gm.role FROM group_members gm JOIN teams t ON t.group_id = gm.group_id
     WHERE gm.person_id = ? AND ${CURRENT} ORDER BY t.sort, t.id`,
    personId, today(),
  ).map((r) => ({ team_id: r.team_id, name: JSON.parse(r.name) as L10n, color: r.color, is_leader: isLeaderRole(r.role) }));
}

/** Every team's current roster (team id, person id, leader), ordered by team. */
export function teamRoster() {
  for (const t of all<{ id: number }>('SELECT id FROM teams')) teamGroupId(t.id);
  return all<{ team_id: number; person_id: number; role: string | null }>(
    `SELECT t.id AS team_id, gm.person_id, gm.role FROM group_members gm JOIN teams t ON t.group_id = gm.group_id
     WHERE ${CURRENT} ORDER BY t.sort, t.id, gm.person_id`,
    today(),
  ).map((m) => ({ team_id: m.team_id, person_id: m.person_id, is_leader: isLeaderRole(m.role) ? 1 : 0 }));
}

/** Qualifying for a role puts the person on that role's team roster (if they are not on it yet). */
export function ensureOnRoleTeam(roleId: number, personId: number) {
  const r = get<{ team_id: number }>('SELECT team_id FROM roles WHERE id = ?', roleId);
  if (!r) return;
  const gid = teamGroupId(r.team_id);
  const m = get<{ id: number; end_date: string | null }>('SELECT id, end_date FROM group_members WHERE group_id = ? AND person_id = ?', gid, personId);
  if (!m) groupMembers.insert({ group_id: gid, person_id: personId });
  else if (m.end_date && m.end_date < today()) groupMembers.update(m.id, { end_date: null });
}

/** A new volunteer team, with its "Serving team" group. */
export function createTeam(input: { name: L10n; description?: string | null; color?: string; sort?: number }) {
  const g = groups.insert({ name: input.name, kind: 'serving_team', description: input.description ?? null, color: input.color ?? '#64748b', active: true, sort: 1000 + (input.sort ?? 0) });
  const id = Number(run('INSERT INTO teams (name, description, color, sort, group_id) VALUES (?, ?, ?, ?, ?)', JSON.stringify(input.name), input.description ?? null, input.color ?? '#64748b', input.sort ?? 0, g.id).lastInsertRowid);
  return id;
}

/** Change a team (its group follows). */
export function updateTeam(teamId: number, patch: { name?: L10n; description?: string | null; color?: string; sort?: number }) {
  const gid = teamGroupId(teamId);
  const sets: string[] = [];
  const params: SqlValue[] = [];
  if (patch.name !== undefined) { sets.push('name = ?'); params.push(JSON.stringify(patch.name)); }
  if (patch.description !== undefined) { sets.push('description = ?'); params.push(patch.description); }
  if (patch.color !== undefined) { sets.push('color = ?'); params.push(patch.color); }
  if (patch.sort !== undefined) { sets.push('sort = ?'); params.push(patch.sort); }
  if (sets.length) run(`UPDATE teams SET ${sets.join(', ')} WHERE id = ?`, ...params, teamId);
  groups.update(gid, { name: patch.name, description: patch.description, color: patch.color });
}

/** Delete a team: its rota roles and assignments (database cascade) and its serving-team group. */
export function deleteTeam(teamId: number) {
  const gid = teamGroupId(teamId);
  tx(() => {
    run('DELETE FROM teams WHERE id = ?', teamId);
    groups.remove(gid);
  });
}
