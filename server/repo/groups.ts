// Groups (committees, fellowships 团契, cell groups 小组, ministries) with their members and terms,
// and the member roster of volunteer teams (team_members: the AV team, the choir, …).
import type { Group, GroupKind, GroupMember, L10n } from '../../shared/types.ts';
import { all, get, run, tx, type SqlValue } from '../db.ts';
import { table, NotFound } from '../lib/table.ts';

export class Conflict extends Error {
  status = 409;
}

export const groups = table<Group>({
  name: 'groups',
  cols: ['name', 'kind', 'description', 'color', 'meeting', 'active', 'sort'],
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
  return groups.insert(input);
}

export function updateGroup(id: number, patch: Record<string, unknown>) {
  return groups.update(id, patch);
}

export function deleteGroup(id: number) {
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

function teamExists(teamId: number) {
  if (!get('SELECT 1 FROM teams WHERE id = ?', teamId)) throw new NotFound(`team ${teamId} not found`);
}

export function teamMembers(teamId: number): TeamMemberRow[] {
  teamExists(teamId);
  const quals = all<{ person_id: number; role_id: number }>(
    'SELECT rm.person_id, rm.role_id FROM role_members rm JOIN roles r ON r.id = rm.role_id WHERE r.team_id = ? ORDER BY r.sort, r.id', teamId,
  );
  return all<{ team_id: number; person_id: number; name: string; is_leader: number; status: string }>(
    `SELECT tm.team_id, tm.person_id, ${personName} AS name, tm.is_leader, p.status
     FROM team_members tm JOIN people p ON p.id = tm.person_id WHERE tm.team_id = ? ORDER BY tm.is_leader DESC, name`,
    teamId,
  ).map((m) => ({ ...m, is_leader: !!m.is_leader, roles: quals.filter((q) => q.person_id === m.person_id).map((q) => q.role_id) }));
}

/** Add a person to a team (or just change is_leader if they are already in it). */
export function addTeamMember(teamId: number, personId: number, isLeader?: boolean) {
  teamExists(teamId);
  if (!get('SELECT 1 FROM people WHERE id = ?', personId)) throw new NotFound(`person ${personId} not found`);
  run(
    `INSERT INTO team_members (team_id, person_id, is_leader) VALUES (?, ?, ?)
     ON CONFLICT(team_id, person_id) DO UPDATE SET is_leader = CASE WHEN ? IS NULL THEN is_leader ELSE excluded.is_leader END`,
    teamId, personId, isLeader ? 1 : 0, isLeader === undefined ? null : 1,
  );
  return teamMembers(teamId).find((m) => m.person_id === personId)!;
}

export function setTeamLeader(teamId: number, personId: number, isLeader: boolean) {
  const r = run('UPDATE team_members SET is_leader = ? WHERE team_id = ? AND person_id = ?', isLeader ? 1 : 0, teamId, personId);
  if (!r.changes) throw new NotFound(`person ${personId} is not in team ${teamId}`);
  return teamMembers(teamId).find((m) => m.person_id === personId)!;
}

/**
 * Remove a person from a team. If they are still qualified for roles in that team the call fails with 409,
 * unless cascade is set, which also removes those qualifications (rota history is kept).
 */
export function removeTeamMember(teamId: number, personId: number, cascade = false) {
  teamExists(teamId);
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
    const r = run('DELETE FROM team_members WHERE team_id = ? AND person_id = ?', teamId, personId);
    if (!r.changes && !held.length) throw new NotFound(`person ${personId} is not in team ${teamId}`);
  });
  return { removed_qualifications: held.map((h) => h.role_id) };
}

/** The teams a person is on (with leader flag). */
export function personTeams(personId: number) {
  return all<{ team_id: number; name: string; color: string; is_leader: number }>(
    'SELECT tm.team_id, t.name, t.color, tm.is_leader FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.person_id = ? ORDER BY t.sort, t.id',
    personId,
  ).map((r) => ({ ...r, name: JSON.parse(r.name) as L10n, is_leader: !!r.is_leader }));
}
