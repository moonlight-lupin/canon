// CSV: the co-worker register (pastors, elders, deacons, staff). The person is found by person_id or name;
// a record is matched by its id, else by the same person and position.
import type { Coworker, Person } from '../../shared/types.ts';
import { all } from '../db.ts';
import { coworkers as cwTable, displayName } from '../repo/registers.ts';
import { M, type Entity, type Msg, type RowPlan } from './engine.ts';
import {
  PERSON_COLS, col, collect, diff, fmtBool, fmtField, missingRequired, parseBool, parseDate, parseEnum, parseText, personIndex, readFields, type Field,
} from './common.ts';

const CATS = ['pastor', 'elder', 'deacon', 'ministry_staff', 'admin_staff', 'lay_leader'] as const;
const CAT_ALIAS: Record<string, (typeof CATS)[number]> = {
  牧师: 'pastor', 牧師: 'pastor', rev: 'pastor', reverend: 'pastor', 长老: 'elder', 長老: 'elder', 执事: 'deacon', 執事: 'deacon',
  staff: 'ministry_staff', 传道: 'ministry_staff', 傳道: 'ministry_staff', 同工: 'ministry_staff', 行政: 'admin_staff', admin: 'admin_staff',
  'lay leader': 'lay_leader', 领袖: 'lay_leader',
};
const EMP = ['full_time', 'part_time', 'volunteer'] as const;
const EMP_ALIAS: Record<string, (typeof EMP)[number]> = { fulltime: 'full_time', parttime: 'part_time', 全职: 'full_time', 全職: 'full_time', 兼职: 'part_time', 兼職: 'part_time', 义工: 'volunteer', 義工: 'volunteer', 志愿: 'volunteer' };

const FIELDS: Field<Coworker>[] = [
  { col: col('position', M('Position', '职位'), M('Title of the post, e.g. Senior Pastor, Youth Worker.', '职位名称，如主任牧师、青年干事。'), { required: true, example: 'Senior Pastor', aliases: ['title', 'post', '职位', '職位'] }), parse: (s) => parseText(s, 'position', 200), get: (c) => c.position },
  { col: col('category', M('Category', '类别'), M('pastor, elder, deacon, ministry_staff, admin_staff or lay_leader.', 'pastor（牧师）、elder（长老）、deacon（执事）、ministry_staff（传道同工）、admin_staff（行政同工）或 lay_leader（平信徒领袖）。'), { required: true, values: [...CATS], example: 'pastor', aliases: ['type', '类别'] }), parse: (s) => parseEnum(s, 'category', CATS, CAT_ALIAS), get: (c) => c.category },
  { col: col('employment', M('Employment', '聘用'), M('full_time, part_time or volunteer (default).', 'full_time（全职）、part_time（兼职）或 volunteer（义务，默认）。'), { values: [...EMP], example: 'full_time' }), parse: (s) => parseEnum(s, 'employment', EMP, EMP_ALIAS), get: (c) => c.employment },
  { col: col('ministry_area', M('Ministry area', '事工范围'), M('e.g. Youth, Chinese congregation.', '如青年事工、华文堂。'), { example: 'Chinese congregation', aliases: ['area', 'ministry'] }), parse: (s) => parseText(s, 'ministry_area', 200), get: (c) => c.ministry_area },
  { col: col('ordained', M('Ordained', '已按立'), M('yes or no.', 'yes（是）或 no（否）。'), { values: ['yes', 'no'], example: 'yes' }), parse: (s) => parseBool(s, 'ordained'), get: (c) => c.ordained, fmt: (v) => fmtBool(v as boolean) },
  { col: col('start_date', M('Start date', '开始日期'), M('When the post began.', '任职开始日期。'), { example: '2015-01-01', aliases: ['start', 'from', '开始'] }), parse: (s) => parseDate(s, 'start_date'), get: (c) => c.start_date },
  { col: col('end_date', M('End date', '结束日期'), M('When the post ended; leave empty while serving.', '卸任日期；仍在任时留空。'), { aliases: ['end', 'to', '结束'] }), parse: (s) => parseDate(s, 'end_date'), get: (c) => c.end_date },
  { col: col('notes', M('Notes', '备注'), M('Anything else.', '其他备注。'), { aliases: ['remarks'] }), parse: (s) => parseText(s, 'notes'), get: (c) => c.notes },
];

const ID = col('id', M('Id', '编号'), M('Canon\'s id for this co-worker record (from an export). Leave empty for new records.', 'Canon 的同工记录编号（来自导出文件）。新记录请留空。'));

const list = () => all<Omit<Coworker, 'ordained'> & { ordained: number }>('SELECT * FROM coworkers ORDER BY id').map((c): Coworker => ({ ...c, ordained: !!c.ordained }));

export const coworkers: Entity = {
  key: 'coworkers',
  label: M('Co-workers', '同工名册'),
  module: 'coworkers',
  pii: true,
  intro: M(
    'One row per post. The person must already be in the member register (by name or person_id). A row with an id updates that record; otherwise the same person with the same position is updated; anything else is added.',
    '每行一个职位。此人必须已在会友名册中（以姓名或 person_id 指定）。有编号的行会更新该记录；否则同一人的相同职位会被更新；其余的会新增。',
  ),
  columns: () => [ID, ...PERSON_COLS(), ...FIELDS.map((f) => f.col)],
  example: () => [
    { person: 'David Tan', position: 'Senior Pastor', category: 'pastor', employment: 'full_time', ministry_area: 'English congregation', ordained: 'yes', start_date: '2015-01-01' },
    { person: '林美恩', position: '传道', category: 'ministry_staff', employment: 'full_time', ministry_area: '华文堂', ordained: 'no', start_date: '2020-07-01' },
    { person: 'Peter Lim', position: 'Elder', category: 'elder', employment: 'volunteer', ordained: 'yes', start_date: '2019-01-01', end_date: '2024-12-31' },
  ],
  export: () => {
    const people = new Map(all<Person>('SELECT * FROM people').map((p) => [p.id, p]));
    return list().map((c) => {
      const out: Record<string, unknown> = { id: c.id, person_id: c.person_id, person: people.get(c.person_id) ? displayName(people.get(c.person_id)!) : '' };
      for (const f of FIELDS) out[f.col.key] = fmtField(f, f.get(c));
      return out;
    });
  },
  plan(input, _ctx, present) {
    const idx = personIndex();
    const cur_ = list();
    const byId = new Map(cur_.map((c) => [c.id, c]));
    const what: Msg = M('co-worker record', '同工记录');
    return input.map((r): RowPlan => {
      const errors: Msg[] = [];
      let cur: Coworker | undefined;
      let personId: number | undefined;
      if (present.has('id') && r.v.id) {
        cur = byId.get(Number(r.v.id));
        if (!cur) errors.push(M(`No co-worker record with id ${r.v.id}. Leave id empty to add one.`, `没有编号为 ${r.v.id} 的同工记录。新增请把编号留空。`));
        personId = cur?.person_id;
      }
      if (r.v.person_id || r.v.person || !cur) {
        const p = collect(errors, () => idx.resolve(r));
        if (p) personId = p.id;
      }
      if (!cur && personId && r.v.position) {
        cur = cur_.find((c) => c.person_id === personId && c.position.trim().toLowerCase() === r.v.position.trim().toLowerCase());
      }
      const f = readFields(FIELDS, r, present, cur);
      errors.push(...f.errors);
      const person = personId ? idx.byId.get(personId) : undefined;
      const label = [person ? displayName(person) : r.v.person, f.values.position ?? cur?.position].filter(Boolean).join(' — ');
      if (!cur) errors.push(...missingRequired(FIELDS, f.values, what));
      if (cur) for (const k of ['position', 'category'] as const) if (present.has(k) && !f.values[k]) errors.push(M(`${k} cannot be emptied.`, `${k} 不能清空。`));
      const start = (f.values.start_date ?? cur?.start_date) as string | null;
      const end = (f.values.end_date ?? cur?.end_date) as string | null;
      if (start && end && end < start) errors.push(M('The end date is before the start date.', '结束日期早于开始日期。'));
      if (errors.length) return { row: r.row, label, action: 'error', errors };
      const patch = { ...f.patch };
      if (patch.employment === null) {
        patch.employment = 'volunteer';
        f.inc.employment = 'volunteer';
      }
      if (patch.ordained === null) {
        patch.ordained = false;
        f.inc.ordained = 'no';
      }
      if (!cur) return { row: r.row, label, action: 'create', apply: () => void cwTable.insert({ ...patch, person_id: personId }) };
      const changes = diff(f.cur, f.inc);
      if (personId !== cur.person_id) changes.unshift({ field: 'person_id', from: String(cur.person_id), to: String(personId) });
      const id = cur.id;
      return changes.length
        ? { row: r.row, label, action: 'update', changes, apply: () => void cwTable.update(id, { ...patch, person_id: personId }) }
        : { row: r.row, label, action: 'unchanged' };
    });
  },
};
