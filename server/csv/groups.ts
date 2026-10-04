// CSV: groups (committees, fellowships, cell groups, ministries) and their members — one row per member.
// Groups are matched by name in any language and created when new; memberships by group + person.
import type { Group, GroupKind, GroupMember, L10n } from '../../shared/types.ts';
import { all, get } from '../db.ts';
import { displayName } from '../repo/registers.ts';
import { groups as groupTable, groupMembers } from '../repo/groups.ts';
import { M, say, type Change, type Entity, type Msg, type RowPlan } from './engine.ts';
import {
  PERSON_COLS, col, collect, diff, hasText, l10nCols, mergeL10n, nameKey, parseDate, parseEnum, parseText, personIndex, presentLangs, readL10n,
} from './common.ts';

const KINDS = ['committee', 'fellowship', 'cell_group', 'ministry', 'other'] as const;
const KIND_ALIAS: Record<string, GroupKind> = {
  委员会: 'committee', 委員會: 'committee', 团契: 'fellowship', 團契: 'fellowship', 小组: 'cell_group', 小組: 'cell_group', cell: 'cell_group',
  'cell group': 'cell_group', 'small group': 'cell_group', 事工: 'ministry', 其他: 'other',
};

const kindCol = col('kind', M('Kind', '类别'), M('committee, fellowship, cell_group, ministry or other. Needed for a new group.', 'committee（委员会）、fellowship（团契）、cell_group（小组）、ministry（事工）或 other（其他）。新增群组时必填。'), { values: [...KINDS], example: 'fellowship', aliases: ['type', 'group_kind', '类别'] });
const meetingCol = col('meeting', M('Meeting', '聚会时间'), M('When and where it meets, e.g. Fridays 8pm, church hall.', '聚会时间与地点，如：周五晚上8点，教会礼堂。'), { example: 'Fridays 8pm, church hall', aliases: ['meets', 'meeting_time', '聚会'] });
const roleCol = col('role', M('Role', '职分'), M('e.g. Chair, Secretary, Treasurer, Leader, Member.', '如主席、书记、财务、组长、组员。'), { example: 'Leader', aliases: ['position', '职分', '职务'] });
const startCol = col('start_date', M('Start date', '开始日期'), M('Start of the term (optional).', '任期开始日期（可选）。'), { aliases: ['start', 'from'] });
const endCol = col('end_date', M('End date', '结束日期'), M('End of the term; leave empty while current.', '任期结束日期；现任者留空。'), { aliases: ['end', 'to'] });

type Member = GroupMember;
interface GState {
  id: number | null;
  key: string;
  label: string;
  firstRow: number;
  kind: GroupKind | null;
  meeting: string | null | undefined;
  /** group-level patch to apply once (create or update) */
  patch: Record<string, unknown> | null;
  done: boolean;
}

const label = (n: L10n) => Object.values(n).filter(Boolean).join(' / ');

export const groupsCsv: Entity = {
  key: 'groups',
  label: M('Groups', '群组'),
  module: 'groups',
  pii: true,
  l10n: ['name'],
  intro: M(
    'One row per member of a group (repeat the group\'s name on each row). Groups are matched by name in any language and created when the name is new; members must already be in the member register. A row without a person only creates or updates the group.',
    '每行是群组中的一位成员（每行都要写群组名称）。群组以任何语言的名称来对应，名称不存在时会新建群组；成员必须已在会友名册中。没有填写姓名的行只建立或更新群组本身。',
  ),
  columns: (ctx) => [
    ...l10nCols('name', ctx, M('Group name', '群组名称'), M('The group\'s name in this language.', '此语言的群组名称。'), { required: true, examples: { en: 'Youth Fellowship', zh: '青年团契', 'zh-Hant': '青年團契' }, aliases: ['group', 'group_name'] }),
    kindCol, meetingCol,
    ...PERSON_COLS(false),
    roleCol, startCol, endCol,
  ],
  example: () => [
    { name_en: 'Youth Fellowship', name_zh: '青年团契', 'name_zh-Hant': '青年團契', kind: 'fellowship', meeting: 'Saturdays 3pm, church hall', person: 'David Tan', role: 'Leader', start_date: '2025-01-01' },
    { name_en: 'Youth Fellowship', name_zh: '青年团契', 'name_zh-Hant': '青年團契', kind: 'fellowship', person: '林美恩', role: 'Member' },
    { name_en: 'Board of Deacons', name_zh: '执事会', 'name_zh-Hant': '執事會', kind: 'committee', meeting: 'First Tuesday, 8pm', person: 'Peter Lim', role: 'Chair', start_date: '2024-01-01', end_date: '2025-12-31' },
  ],
  export(ctx) {
    const gs = groupTable.list('', [], 'sort, id');
    const people = new Map(all<Parameters<typeof displayName>[0] & { id: number }>('SELECT * FROM people').map((p) => [p.id, p]));
    const ms = all<Member>('SELECT * FROM group_members ORDER BY group_id, id');
    const out: Record<string, unknown>[] = [];
    for (const g of gs) {
      const base: Record<string, unknown> = { kind: g.kind, meeting: g.meeting };
      for (const l of ctx.langs) base[`name_${l}`] = g.name[l] ?? '';
      const mine = ms.filter((m) => m.group_id === g.id);
      if (!mine.length) out.push(base);
      for (const m of mine) {
        const p = people.get(m.person_id);
        out.push({ ...base, person_id: m.person_id, person: p ? displayName(p) : '', role: m.role, start_date: m.start_date, end_date: m.end_date });
      }
    }
    return out;
  },
  plan(input, ctx, present) {
    const idx = personIndex();
    const langs = presentLangs('name', ctx, present);
    const existing = groupTable.list('', [], 'id');
    const byName = new Map<string, Group>();
    for (const g of existing) for (const v of Object.values(g.name)) if (v && !byName.has(nameKey(v))) byName.set(nameKey(v), g);
    const states = new Map<string, GState>();
    const newByName = new Map<string, string>();
    const memberships = all<Member>('SELECT * FROM group_members');
    const seenMember = new Map<string, number>();

    const ensureGroup = (s: GState) => {
      if (s.id && !get('SELECT 1 FROM groups WHERE id = ?', s.id)) s.id = null; // rolled back with a skipped row
      if (!s.id) {
        s.id = groupTable.insert(s.patch!).id;
        s.done = true;
      } else if (!s.done) {
        if (s.patch) groupTable.update(s.id, s.patch);
        s.done = true;
      }
      return s.id;
    };

    return input.map((r): RowPlan => {
      const errors: Msg[] = [];
      const name = readL10n(r, 'name', langs);
      if (!hasText(name)) return { row: r.row, label: r.v.person || '—', action: 'error', errors: [M('The group name is empty.', '群组名称是空的。')] };
      const keys = Object.values(name).filter(Boolean).map((v) => nameKey(v!));
      const g = keys.map((k) => byName.get(k)).find(Boolean);
      const sKey = g ? `id:${g.id}` : keys.map((k) => newByName.get(k)).find(Boolean) ?? `new:${keys[0]}`;
      const kind = collect(errors, () => (present.has('kind') ? parseEnum(r.v.kind, 'kind', KINDS, KIND_ALIAS) : null)) ?? null;
      const meeting = present.has('meeting') ? collect(errors, () => parseText(r.v.meeting, 'meeting', 500)) : undefined;
      const changes: Change[] = [];
      let s = states.get(sKey);
      let isNewGroup = false;
      if (!s) {
        s = { id: g?.id ?? null, key: sKey, label: label(g ? mergeL10n(g.name, name) : name), firstRow: r.row, kind, meeting, patch: null, done: false };
        states.set(sKey, s);
        if (!g) {
          isNewGroup = true;
          if (!kind) errors.push(M('kind is empty — it is needed to add a new group (committee, fellowship, cell_group, ministry or other).', 'kind（类别）是空的 —— 新增群组时必须填写（committee、fellowship、cell_group、ministry 或 other）。'));
          s.patch = { name: mergeL10n({}, name), kind, ...(meeting ? { meeting } : {}) };
          changes.push({ field: 'group', from: '', to: `${s.label} ${say(M('(new group)', '（新群组）'), ctx.lang)}` });
          for (const k of keys) newByName.set(k, sKey);
        } else {
          const cur: Record<string, string> = { kind: g.kind, meeting: g.meeting ?? '' };
          const inc: Record<string, string> = {};
          const patch: Record<string, unknown> = {};
          if (kind && kind !== g.kind) {
            inc.kind = kind;
            patch.kind = kind;
          }
          if (meeting !== undefined) {
            inc.meeting = meeting ?? '';
            patch.meeting = meeting;
          }
          const newName = mergeL10n(g.name, Object.fromEntries(Object.entries(name).filter(([, v]) => v)));
          for (const l of langs) if (name[l] && name[l] !== g.name[l]) changes.push({ field: `name_${l}`, from: g.name[l] ?? '', to: name[l]! });
          changes.push(...diff(cur, inc));
          if (changes.length) s.patch = { ...patch, name: newName };
        }
      } else {
        if (kind && s.kind && kind !== s.kind) errors.push(M(`Row ${s.firstRow} gives this group the kind "${s.kind}"; this row says "${kind}".`, `第 ${s.firstRow} 行的群组类别是「${s.kind}」，此行却是「${kind}」。`));
        if (meeting && s.meeting && meeting !== s.meeting) errors.push(M(`Row ${s.firstRow} gives this group a different meeting time.`, `第 ${s.firstRow} 行的群组聚会时间与此行不同。`));
        if (s.kind === null && kind) s.kind = kind;
      }
      if (!s.id && s.patch && !s.patch.kind && s.kind) s.patch.kind = s.kind;

      // membership
      const hasPerson = !!(r.v.person || r.v.person_id);
      let memberApply: ((gid: number) => void) | null = null;
      let personLabel = '';
      if (hasPerson) {
        const p = collect(errors, () => idx.resolve(r));
        const role = present.has('role') ? collect(errors, () => parseText(r.v.role, 'role', 100)) : undefined;
        const start = present.has('start_date') ? collect(errors, () => parseDate(r.v.start_date, 'start_date')) : undefined;
        const end = present.has('end_date') ? collect(errors, () => parseDate(r.v.end_date, 'end_date')) : undefined;
        if (p) {
          personLabel = displayName(p);
          const mk = `${sKey}|${p.id}`;
          if (seenMember.has(mk)) errors.push(M(`${personLabel} is already listed in this group on row ${seenMember.get(mk)}.`, `${personLabel} 已在第 ${seenMember.get(mk)} 行列为此群组成员。`));
          seenMember.set(mk, r.row);
          const m = g ? memberships.find((x) => x.group_id === g.id && x.person_id === p.id) : undefined;
          const s2 = (start === undefined ? m?.start_date : start) ?? null;
          const e2 = (end === undefined ? m?.end_date : end) ?? null;
          if (s2 && e2 && e2 < s2) errors.push(M('The end date is before the start date.', '结束日期早于开始日期。'));
          const patch: Record<string, unknown> = {};
          if (role !== undefined) patch.role = role;
          if (start !== undefined) patch.start_date = start;
          if (end !== undefined) patch.end_date = end;
          if (m) {
            const inc: Record<string, string> = {};
            for (const [k, v] of Object.entries(patch)) inc[k] = (v as string | null) ?? '';
            const ch = diff({ role: m.role ?? '', start_date: m.start_date ?? '', end_date: m.end_date ?? '' }, inc);
            changes.push(...ch);
            if (ch.length) memberApply = () => void groupMembers.update(m.id, patch);
          } else {
            changes.push({ field: 'member', from: '', to: `${personLabel}${role ? ` (${role})` : ''}` });
            memberApply = (gid) => void groupMembers.insert({ ...patch, group_id: gid, person_id: p.id });
          }
        }
      }
      const rowLabel = [s.label, personLabel || r.v.person].filter(Boolean).join(' — ');
      if (errors.length) return { row: r.row, label: rowLabel, action: 'error', errors };
      if (!changes.length) return { row: r.row, label: rowLabel, action: 'unchanged' };
      const st = s;
      const apply = () => {
        const gid = ensureGroup(st);
        memberApply?.(gid);
      };
      const created = isNewGroup || changes.some((c) => c.field === 'member');
      return { row: r.row, label: rowLabel, action: created ? 'create' : 'update', changes, apply };
    });
  },
};
