// CSV: volunteer team rosters (each team's serving-team group, with role qualifications) and unavailability (away dates).
import type { L10n, ServiceRole, Team, Unavailability } from '../../shared/types.ts';
import { all, run } from '../db.ts';
import { displayName } from '../repo/registers.ts';
import { addTeamMember, setTeamLeader, teamRoster } from '../repo/groups.ts';
import { roles as roleTable, teams as teamTable, unavailability as unavTable } from '../repo/volunteers.ts';
import { M, type Change, type Entity, type Msg, type RowPlan } from './engine.ts';
import {
  PERSON_COLS, col, collect, diff, fmtBool, nameKey, parseBool, parseDate, parseList, parseText, personIndex,
} from './common.ts';
import { visiblePeople } from '../lib/walls.ts';

const pickName = (n: L10n, langs: string[]) => langs.map((l) => n[l]).find((x) => x?.trim()) ?? n.en ?? Object.values(n).find(Boolean) ?? '';

// ---------------------------------------------------------------- team members

export const teamMembersCsv: Entity = {
  key: 'team_members',
  label: M('Team members', '事奉团队成员'),
  module: 'volunteers',
  pii: true,
  intro: M(
    'One row per person in a volunteer team. Teams and roles must already exist (Volunteers → Teams); people must be in the member register. When the roles column is present it sets exactly which roles in that team the person is qualified for.',
    '每行是事奉团队中的一位成员。团队和岗位必须已存在（义工事奉 → 团队）；成员必须已在会友名册中。若有 roles 栏位，它会设定此人在该团队中可担任的岗位（以此为准）。',
  ),
  columns: () => [
    col('team', M('Team', '团队'), M('Team name in any language, e.g. AV & Media or 影音.', '任何语言的团队名称，如 AV & Media 或 影音。'), { required: true, example: 'AV & Media', aliases: ['team_name', '团队', '團隊'] }),
    ...PERSON_COLS(),
    col('leader', M('Leader', '组长'), M('yes if the person leads this team.', '若此人是团队负责人，填 yes。'), { values: ['yes', 'no'], example: 'no', aliases: ['is_leader', 'team_leader', '组长'] }),
    col('roles', M('Roles', '岗位'), M('Roles in this team the person can serve in, separated by semicolons, e.g. Sound; AV / Slides.', '此人可担任的岗位，以分号分隔，如：音响; 投影。'), { example: 'Sound; AV / Slides', aliases: ['qualified_roles', 'qualifications', '岗位', '崗位'] }),
  ],
  example: () => [
    { team: 'AV & Media', person: 'David Tan', leader: 'yes', roles: 'Sound; AV / Slides' },
    { team: 'AV & Media', person: '林美恩', leader: 'no', roles: 'AV / Slides' },
    { team: 'Music', person: 'Peter Lim', leader: 'no', roles: 'Musician' },
  ],
  export(ctx) {
    const ts = new Map(teamTable.list().map((t) => [t.id, t]));
    const rs = roleTable.list('', [], 'sort, id');
    const quals = all<{ role_id: number; person_id: number }>('SELECT role_id, person_id FROM role_members');
    const people = new Map(visiblePeople<Parameters<typeof displayName>[0] & { id: number }>().map((p) => [p.id, p]));
    return teamRoster().filter((m) => people.has(m.person_id)).sort((a, b) => (a.team_id === b.team_id ? b.is_leader - a.is_leader : 0)).map((m) => ({
      team: pickName(ts.get(m.team_id)!.name, ctx.langs),
      person_id: m.person_id,
      person: people.get(m.person_id) ? displayName(people.get(m.person_id)!) : '',
      leader: fmtBool(!!m.is_leader),
      roles: rs.filter((r) => r.team_id === m.team_id && quals.some((q) => q.role_id === r.id && q.person_id === m.person_id)).map((r) => pickName(r.name, ctx.langs)).join('; '),
    }));
  },
  plan(input, ctx, present) {
    const idx = personIndex();
    const ts = teamTable.list();
    const rs = roleTable.list('', [], 'sort, id');
    const teamBy = new Map<string, Team>();
    for (const t of ts) for (const v of Object.values(t.name)) if (v) teamBy.set(nameKey(v), t);
    const roster = teamRoster().filter((m) => idx.byId.has(m.person_id));
    const quals = all<{ role_id: number; person_id: number }>('SELECT role_id, person_id FROM role_members').filter((q) => idx.byId.has(q.person_id));
    const seen = new Map<string, number>();
    const roleName = (r: ServiceRole) => pickName(r.name, ctx.langs);

    return input.map((r): RowPlan => {
      const errors: Msg[] = [];
      const team = r.v.team ? teamBy.get(nameKey(r.v.team)) : undefined;
      if (!r.v.team) errors.push(M('Team is empty.', '团队是空的。'));
      else if (!team) errors.push(M(`No team called "${r.v.team}". Teams are set up under Volunteers → Teams.`, `没有名为「${r.v.team}」的团队。团队请在「义工事奉 → 团队」中设定。`));
      const p = collect(errors, () => idx.resolve(r));
      const leader = present.has('leader') ? collect(errors, () => parseBool(r.v.leader, 'leader')) : undefined;
      let roleIds: number[] | undefined;
      if (present.has('roles') && team) {
        roleIds = [];
        const mine = rs.filter((x) => x.team_id === team.id);
        for (const n of parseList(r.v.roles)) {
          const hit = mine.find((x) => Object.values(x.name).some((v) => v && nameKey(v) === nameKey(n)));
          if (!hit) errors.push(M(`"${n}" is not a role in ${pickName(team.name, ctx.langs)} (roles: ${mine.map(roleName).join('; ') || 'none'}).`, `「${n}」不是「${pickName(team.name, ctx.langs)}」的岗位（岗位有：${mine.map(roleName).join('；') || '无'}）。`));
          else if (!roleIds.includes(hit.id)) roleIds.push(hit.id);
        }
      }
      const label = [team ? pickName(team.name, ctx.langs) : r.v.team, p ? displayName(p) : r.v.person].filter(Boolean).join(' — ');
      if (team && p) {
        const k = `${team.id}|${p.id}`;
        if (seen.has(k)) errors.push(M(`Same team and person as row ${seen.get(k)}.`, `与第 ${seen.get(k)} 行的团队和人员相同。`));
        seen.set(k, r.row);
      }
      if (errors.length || !team || !p) return { row: r.row, label, action: 'error', errors };
      const cur = roster.find((m) => m.team_id === team.id && m.person_id === p.id);
      const teamRoles = rs.filter((x) => x.team_id === team.id);
      const curRoles = teamRoles.filter((x) => quals.some((q) => q.role_id === x.id && q.person_id === p.id)).map((x) => x.id);
      const changes: Change[] = [];
      if (leader !== undefined && leader !== null && (!cur || !!cur.is_leader !== leader)) changes.push({ field: 'leader', from: cur ? fmtBool(!!cur.is_leader) : '', to: fmtBool(leader) });
      const fmtRoles = (ids: number[]) => teamRoles.filter((x) => ids.includes(x.id)).map(roleName).join('; ');
      if (roleIds && fmtRoles(roleIds) !== fmtRoles(curRoles)) changes.push({ field: 'roles', from: fmtRoles(curRoles), to: fmtRoles(roleIds) });
      if (cur && !changes.length) return { row: r.row, label, action: 'unchanged' };
      const tid = team.id;
      const pid = p.id;
      const apply = () => {
        if (!cur) addTeamMember(tid, pid, leader ?? undefined);
        else if (leader !== undefined && leader !== null) setTeamLeader(tid, pid, leader);
        if (roleIds) {
          run(`DELETE FROM role_members WHERE person_id = ? AND role_id IN (SELECT id FROM roles WHERE team_id = ?)`, pid, tid);
          for (const rid of roleIds) run('INSERT OR IGNORE INTO role_members (role_id, person_id) VALUES (?, ?)', rid, pid);
        }
      };
      return { row: r.row, label, action: cur ? 'update' : 'create', changes, apply };
    });
  },
};

// ---------------------------------------------------------------- unavailability

export const unavailabilityCsv: Entity = {
  key: 'unavailability',
  label: M('Unavailability', '无法事奉的日期'),
  module: 'volunteers',
  pii: true,
  intro: M(
    'One row per period when someone cannot serve (overseas, exams, confinement). A row with an id updates that entry; the same person with the same dates updates the reason; anything else is added. Leave end empty for a single day.',
    '每行是某人无法事奉的一段时间（出国、考试、坐月子等）。有编号的行会更新该记录；同一人相同日期的行会更新原因；其余的会新增。只有一天时结束日期可留空。',
  ),
  columns: () => [
    col('id', M('Id', '编号'), M('Canon\'s id for the entry (from an export). Leave empty for new entries.', 'Canon 的记录编号（来自导出文件）。新记录请留空。')),
    ...PERSON_COLS(),
    col('start_date', M('From', '开始日期'), M('First day away, e.g. 2025-12-01.', '开始无法事奉的日期，如 2025-12-01。'), { required: true, example: '2025-12-01', aliases: ['start', 'from', '开始', '开始日期'] }),
    col('end_date', M('To', '结束日期'), M('Last day away (empty = same day).', '最后一天（留空表示只有一天）。'), { example: '2025-12-21', aliases: ['end', 'to', 'until', '结束', '结束日期'] }),
    col('reason', M('Reason', '原因'), M('Optional, e.g. overseas, exams.', '可选，如出国、考试。'), { example: 'Overseas', aliases: ['note', 'notes', '原因'] }),
  ],
  example: () => [
    { person: 'David Tan', start_date: '2025-12-01', end_date: '2025-12-21', reason: 'Overseas' },
    { person: '林美恩', start_date: '2025-11-09', end_date: '', reason: '考试' },
  ],
  export() {
    const people = new Map(visiblePeople<Parameters<typeof displayName>[0] & { id: number }>().map((p) => [p.id, p]));
    return unavTable.list('', [], 'start_date, id').filter((u) => people.has(u.person_id)).map((u) => ({
      id: u.id, person_id: u.person_id, person: people.get(u.person_id) ? displayName(people.get(u.person_id)!) : '',
      start_date: u.start_date, end_date: u.end_date, reason: u.reason,
    }));
  },
  plan(input, _ctx, present) {
    const idx = personIndex();
    const list = unavTable.list().filter((u) => idx.byId.has(u.person_id));
    const byId = new Map(list.map((u) => [u.id, u]));
    return input.map((r): RowPlan => {
      const errors: Msg[] = [];
      let cur: Unavailability | undefined;
      if (present.has('id') && r.v.id) {
        cur = byId.get(Number(r.v.id));
        if (!cur) errors.push(M(`No entry with id ${r.v.id}. Leave id empty to add one.`, `没有编号为 ${r.v.id} 的记录。新增请把编号留空。`));
      }
      const p = r.v.person || r.v.person_id || !cur ? collect(errors, () => idx.resolve(r)) : idx.byId.get(cur.person_id);
      const start = collect(errors, () => parseDate(r.v.start_date ?? '', 'start_date'));
      const endRaw = collect(errors, () => parseDate(r.v.end_date ?? '', 'end_date'));
      const end = endRaw ?? start;
      const reason = present.has('reason') ? collect(errors, () => parseText(r.v.reason, 'reason', 500)) : undefined;
      if (!start && !errors.length) errors.push(M('start_date is empty.', '开始日期（start_date）是空的。'));
      if (start && end && end < start) errors.push(M('The end date is before the start date.', '结束日期早于开始日期。'));
      const label = [p ? displayName(p) : r.v.person, start ? `${start}${end && end !== start ? ` – ${end}` : ''}` : ''].filter(Boolean).join(' · ');
      if (errors.length || !p) return { row: r.row, label, action: 'error', errors };
      if (!cur) cur = list.find((u) => u.person_id === p.id && u.start_date === start && u.end_date === end);
      const patch: Record<string, unknown> = { person_id: p.id, start_date: start, end_date: end };
      if (reason !== undefined) patch.reason = reason;
      if (!cur) return { row: r.row, label, action: 'create', apply: () => void unavTable.insert(patch) };
      const changes = diff(
        { person_id: String(cur.person_id), start_date: cur.start_date, end_date: cur.end_date, reason: cur.reason ?? '' },
        { person_id: String(p.id), start_date: start!, end_date: end!, ...(reason !== undefined ? { reason: reason ?? '' } : {}) },
      );
      const id = cur.id;
      return changes.length ? { row: r.row, label, action: 'update', changes, apply: () => void unavTable.update(id, patch) } : { row: r.row, label, action: 'unchanged' };
    });
  },
};
