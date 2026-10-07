// CSV: the member register (people) with their household. Match by id, else by exact name + birth date.
import { approverEmailLocked } from '../repo/bk-claims.ts';
import type { Person } from '../../shared/types.ts';
import { PersonInput } from '../../shared/schemas.ts';
import { LANG_CODE_RE } from '../../shared/languages.ts';
import { all } from '../db.ts';
import { households, people } from '../repo/registers.ts';
import { M, fail, say, type Entity, type Msg, type RowPlan } from './engine.ts';
import {
  col, collect, diff, l10nCols, mergeL10n, missingRequired, parseDate, parseEnum, parseText, presentLangs, readFields, readL10n, type Field,
} from './common.ts';
import type { Ctx } from './engine.ts';
import { cleanCustomValues, optionValue, type MemberField } from '../../shared/member-fields.ts';
import { getSettings } from '../repo/settings.ts';
import { seesSensitive, wallSql } from '../lib/walls.ts';

/**
 * The church's own fields (Settings → Member fields): one column each, custom_<key>. Fields marked sensitive only for
 * accounts whose role sees them: for others they are not exported, not shown in a preview and not changed by an
 * import (a custom_<key> column for one is ignored like any unknown column).
 */
const allCustomDefs = (): MemberField[] => getSettings().member_fields ?? [];
const customDefs = (): MemberField[] => allCustomDefs().filter((d) => seesSensitive() || !d.sensitive);
const customCols = () => customDefs().map((d) => col(
  `custom_${d.key}`,
  M(d.label.en || Object.values(d.label)[0] || d.key, d.label.zh || d.label.en || d.key),
  d.type === 'date' ? M('A date, e.g. 2024-05-12.', '日期，如 2024-05-12。')
    : d.type === 'yesno' ? M('yes or no.', 'yes（是）或 no（否）。')
      : d.type === 'choice' ? M(`One of: ${(d.options ?? []).map((o) => optionValue(o, getSettings().languages[0])).join(', ')}.`, `以下其一：${(d.options ?? []).map((o) => optionValue(o, getSettings().languages[0])).join('、')}。`)
        : M('Text.', '文字。'),
  { ...(d.type === 'yesno' ? { values: ['yes', 'no'] } : d.type === 'choice' ? { values: (d.options ?? []).map((o) => optionValue(o, getSettings().languages[0])) } : {}) },
));
const customOf = (p: Row | undefined): Record<string, string> => {
  const c = p?.custom as unknown;
  if (!c) return {};
  return (typeof c === 'string' ? JSON.parse(c) : c) as Record<string, string>;
};

type Row = Person & { household_name: string | null };

const STATUS = ['member', 'regular', 'visitor', 'inactive', 'transferred', 'deceased'] as const;
const STATUS_ALIAS: Record<string, (typeof STATUS)[number]> = {
  会友: 'member', 會友: 'member', 'communicant member': 'member', 'regular attendee': 'regular', 慕道友: 'regular', 常来: 'regular',
  访客: 'visitor', 訪客: 'visitor', 新朋友: 'visitor', guest: 'visitor', 不活跃: 'inactive', 转会: 'transferred', 轉會: 'transferred',
  已故: 'deceased', 安息: 'deceased',
};
const GENDER_ALIAS: Record<string, 'M' | 'F'> = { male: 'M', man: 'M', 男: 'M', female: 'F', woman: 'F', 女: 'F', l: 'M', p: 'F' };
const HH_ROLES = ['head', 'spouse', 'child', 'other'] as const;
const HH_ALIAS: Record<string, (typeof HH_ROLES)[number]> = {
  户主: 'head', 戶主: 'head', husband: 'spouse', wife: 'spouse', 配偶: 'spouse', 丈夫: 'spouse', 妻子: 'spouse',
  son: 'child', daughter: 'child', 儿子: 'child', 女儿: 'child', 孩子: 'child', 子女: 'child', 其他: 'other',
};
const BAPT = ['infant', 'adult'] as const;

const text = (key: string, max = 4000) => (s: string) => parseText(s, key, max);
const date = (key: string) => (s: string) => parseDate(s, key);

const FIELDS: Field<Row>[] = [
  { col: col('first_name', M('First name', '名字'), M('Given name in English letters, e.g. David. Needed for a new person.', '英文名字（如 David）。新增会友时必填。'), { required: true, example: 'David', aliases: ['first', 'given_name', '名'] }), parse: text('first_name', 200), get: (p) => p.first_name },
  { col: col('last_name', M('Surname', '姓'), M('Family name, e.g. Tan.', '姓氏（如 Tan）。'), { example: 'Tan', aliases: ['surname', 'family_name', 'last', '姓氏'] }), parse: (s) => parseText(s, 'last_name', 200) ?? '', get: (p) => p.last_name },
  { col: col('native_name', M('Chinese name', '中文名'), M('Name in Chinese characters (or another script).', '中文姓名（或其他文字的姓名）。'), { example: '陈大卫', aliases: ['chinese_name', '中文名', '中文姓名', 'native'] }), parse: text('native_name', 200), get: (p) => p.native_name },
  { col: col('preferred_name', M('Preferred name', '常用名'), M('The name used at church, if different.', '在教会常用的称呼（如与名字不同）。'), { aliases: ['nickname', 'known_as'] }), parse: text('preferred_name', 200), get: (p) => p.preferred_name },
  { col: col('gender', M('Gender', '性别'), M('M or F.', 'M（男）或 F（女）。'), { values: ['M', 'F'], example: 'M', aliases: ['sex', '性别', '性別'] }), parse: (s) => parseEnum(s, 'gender', ['M', 'F'] as const, GENDER_ALIAS), get: (p) => p.gender },
  { col: col('birth_date', M('Birth date', '出生日期'), M('Date of birth, e.g. 1985-06-15.', '出生日期，如 1985-06-15。'), { example: '1985-06-15', aliases: ['dob', 'birthday', 'date_of_birth', '生日', '出生日期'] }), parse: date('birth_date'), get: (p) => p.birth_date },
  { col: col('phone', M('Phone', '电话'), M('Mobile number, e.g. +60 12-345 6789. If Excel drops the leading 0 or +, format the column as Text.', '手机号码，如 +60 12-345 6789。若 Excel 去掉了开头的 0 或 +，请把该栏设为「文本」格式。'), { example: '+60 12-345 6789', aliases: ['mobile', 'handphone', 'hp', 'tel', 'telephone', '电话', '手机'] }), parse: text('phone', 100), get: (p) => p.phone },
  { col: col('email', M('Email', '电邮'), M('Email address.', '电子邮件地址。'), { example: 'david.tan@example.com', aliases: ['e_mail', 'email_address', '电邮', '邮箱'] }), parse: (s) => { const t = parseText(s, 'email', 320); if (t && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) fail(`email: "${t}" does not look like an email address.`, `email：「${t}」不像电邮地址。`); return t; }, get: (p) => p.email },
  { col: col('address', M('Address', '地址'), M('Home address.', '住址。'), { aliases: ['home_address', '地址'] }), parse: text('address'), get: (p) => p.address },
  { col: col('status', M('Status', '身份'), M('member, regular (regular attender), visitor, inactive, transferred or deceased. New people default to regular.', 'member（会友）、regular（常来聚会）、visitor（访客）、inactive（不活跃）、transferred（已转会）或 deceased（已安息）。新增时默认为 regular。'), { values: [...STATUS], example: 'member', aliases: ['membership_status', '身份'] }), parse: (s) => parseEnum(s, 'status', STATUS, STATUS_ALIAS), get: (p) => p.status },
  { col: col('membership_date', M('Membership date', '入会日期'), M('Date received as a member.', '成为会友的日期。'), { aliases: ['member_since', '入会日期'] }), parse: date('membership_date'), get: (p) => p.membership_date },
  { col: col('baptism_date', M('Baptism date', '受洗日期'), M('Date of baptism.', '受洗日期。'), { example: '2003-04-20', aliases: ['baptised', 'baptized', '受洗日期'] }), parse: date('baptism_date'), get: (p) => p.baptism_date },
  { col: col('baptism_type', M('Baptism type', '洗礼类别'), M('infant or adult.', 'infant（婴儿洗）或 adult（成人洗）。'), { values: [...BAPT], example: 'adult' }), parse: (s) => parseEnum(s, 'baptism_type', BAPT, { 婴儿洗: 'infant', 婴儿: 'infant', 成人洗: 'adult', 成人: 'adult' }), get: (p) => p.baptism_type },
  { col: col('profession_date', M('Profession of faith', '坚信礼日期'), M('Date of public profession of faith (confirmation).', '公开承认信仰（坚信礼）的日期。'), { aliases: ['confirmation_date'] }), parse: date('profession_date'), get: (p) => p.profession_date },
  { col: col('preferred_lang', M('Preferred language', '偏好语言'), M('Language code, e.g. en, zh (Simplified Chinese), zh-Hant (Traditional), ms.', '语言代码，如 en、zh（简体中文）、zh-Hant（繁体中文）、ms。'), { example: 'zh', aliases: ['language', 'lang'] }), parse: (s) => { const t = s.trim(); if (!t) return null; const c = /^zh[-_]?(hant|tw|hk)$/i.test(t) ? 'zh-Hant' : t.toLowerCase(); if (!LANG_CODE_RE.test(c)) fail(`preferred_lang: "${t}" is not a language code like en or zh.`, `preferred_lang：「${t}」不是语言代码（如 en 或 zh）。`); return c; }, get: (p) => p.preferred_lang },
  { col: col('household', M('Household', '家庭'), M('Household name, e.g. Tan family. A new household is created when the name is new.', '家庭名称，如 Tan family。名称不存在时会自动建立新家庭。'), { example: 'Tan family', aliases: ['family', 'household_name', '家庭'] }), parse: text('household', 200), get: (p) => p.household_name, db: false },
  { col: col('household_role', M('Household role', '家庭角色'), M('head, spouse, child or other.', 'head（户主）、spouse（配偶）、child（子女）或 other（其他）。'), { values: [...HH_ROLES], example: 'head', aliases: ['role_in_household', 'relationship'] }), parse: (s) => parseEnum(s, 'household_role', HH_ROLES, HH_ALIAS), get: (p) => p.household_role },
  { col: col('notes', M('Notes', '备注'), M('Anything else.', '其他备注。'), { aliases: ['remarks', 'note', '备注'] }), parse: text('notes'), get: (p) => p.notes },
];

/** Honorific titles, one column per church language: honorific_zh = 弟兄 / 姐妹 / 传道, honorific_en = Bro. / Sis. / Ps. */
const honorificCols = (ctx: Ctx) =>
  l10nCols('honorific', ctx, M('Title', '称谓'), M('Church title printed with the name: Chinese after it (弟兄, 姐妹, 传道, 牧师), English before it (Bro., Sis., Ps., Rev.).', '印在名字旁的称谓：中文在名字后（弟兄、姐妹、传道、牧师），英文在名字前（Bro.、Sis.、Ps.、Rev.）。'), {
    examples: { en: 'Bro.', zh: '弟兄', 'zh-Hant': '弟兄' }, aliases: ['title', '称谓'],
  });

const ID = col('id', M('Id', '编号'), M('Canon\'s id for the person (from an export). Leave empty for new people; rows with an id update that person.', 'Canon 的会友编号（来自导出文件）。新会友请留空；有编号的行会更新该会友。'), { aliases: ['person_id', '编号'] });

const nameKey = (first: string, last: string, birth: string | null) => `${first.trim().toLowerCase()}|${last.trim().toLowerCase()}|${birth ?? ''}`;
const label = (p: { first_name?: unknown; last_name?: unknown; native_name?: unknown }) =>
  [p.first_name, p.last_name, p.native_name].filter((x) => typeof x === 'string' && x).join(' ');

// only the people this account may see: an export, a preview and a match by name never reach another congregation's
const rows = () => {
  const w = wallSql('p.congregation_id');
  return all<Row>(`SELECT p.*, h.name household_name FROM people p LEFT JOIN households h ON h.id = p.household_id WHERE 1${w.sql} ORDER BY p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE, p.id`, ...w.params);
};

export const members: Entity = {
  key: 'members',
  label: M('Members', '会友名册'),
  module: 'members',
  pii: true,
  intro: M(
    'One row per person. A row with an id updates that person; otherwise a person with the same first name, surname and birth date is updated; anyone else is added.',
    '每行一位会友。有编号（id）的行会更新该会友；否则以相同的名字、姓氏和出生日期找到的会友会被更新；其余的会新增。',
  ),
  l10n: ['honorific'],
  columns: (ctx) => [ID, ...FIELDS.map((f) => f.col), ...honorificCols(ctx), ...customCols()],
  example: () => [
    { first_name: 'David', last_name: 'Tan', native_name: '陈大卫', gender: 'M', birth_date: '1978-03-12', phone: '+60 12-345 6789', email: 'david.tan@example.com', address: '12 Jalan Bukit, 47300 Petaling Jaya', status: 'member', membership_date: '2005-06-05', baptism_date: '2003-04-20', baptism_type: 'adult', preferred_lang: 'en', household: 'Tan family', household_role: 'head' },
    { first_name: 'Grace', last_name: 'Tan', native_name: '林美恩', gender: 'F', birth_date: '1981-11-02', phone: '+60 16-222 3344', status: 'member', baptism_date: '1999-12-25', baptism_type: 'adult', preferred_lang: 'zh', household: 'Tan family', household_role: 'spouse' },
    { first_name: 'Wei Ming', last_name: 'Lim', native_name: '林伟明', preferred_name: 'William', gender: 'M', phone: '+65 9123 4567', status: 'visitor', preferred_lang: 'zh', notes: 'First visit Easter Sunday' },
  ],
  export: (ctx) => rows().map((p) => {
    const out: Record<string, unknown> = { id: p.id };
    for (const f of FIELDS) out[f.col.key] = f.get(p);
    const h = typeof p.honorific === 'string' ? (JSON.parse(p.honorific) as Record<string, string>) : (p.honorific ?? {});
    for (const l of ctx.langs) out[`honorific_${l}`] = h[l] ?? '';
    const c = customOf(p);
    for (const d of customDefs()) out[`custom_${d.key}`] = c[d.key] ?? '';
    return out;
  }),
  fileName: () => 'members',
  plan(input, ctx, present) {
    const all_ = rows();
    const byId = new Map(all_.map((p) => [p.id, p]));
    const byKey = new Map<string, Row[]>();
    for (const p of all_) {
      const k = nameKey(p.first_name, p.last_name, p.birth_date);
      byKey.set(k, [...(byKey.get(k) ?? []), p]);
    }
    const seen = new Map<string, number>();
    const hhCache = new Map<string, number>();
    const household = (name: string) => {
      const k = name.toLowerCase();
      let id = hhCache.get(k) ?? all<{ id: number }>('SELECT id FROM households WHERE name = ? COLLATE NOCASE ORDER BY id', name).map((h) => h.id).find((hid) => !!households.find(hid));
      if (!id) id = households.insert({ name }).id;
      hhCache.set(k, id);
      return id;
    };
    const what: Msg = M('person', '会友');
    const hLangs = presentLangs('honorific', ctx, present);
    const honorificOf = (p: Row | undefined) => (typeof p?.honorific === 'string' ? JSON.parse(p.honorific) : (p?.honorific ?? {})) as Record<string, string>;

    return input.map((r): RowPlan => {
      const errors: Msg[] = [];
      let cur: Row | undefined;
      const idRaw = present.has('id') ? r.v.id : '';
      if (idRaw) {
        cur = byId.get(Number(idRaw));
        if (!cur) errors.push(M(`No person with id ${idRaw}. Leave id empty to add a new person.`, `没有编号为 ${idRaw} 的会友。新增会友请把编号留空。`));
      } else {
        // natural key from the file (falls back to nothing when names are missing)
        // (a bad date is reported once, by the field parser below)
        const birth = collect([], () => (present.has('birth_date') ? parseDate(r.v.birth_date, 'birth_date') : null)) ?? null;
        const first = r.v.first_name ?? '';
        if (first) {
          const hits = byKey.get(nameKey(first, r.v.last_name ?? '', birth)) ?? [];
          if (hits.length > 1) errors.push(M(`${hits.length} people are called ${first} ${r.v.last_name ?? ''} with this birth date (ids ${hits.map((h) => h.id).join(', ')}). Add the id column to say which one.`, `有 ${hits.length} 位会友叫 ${first} ${r.v.last_name ?? ''} 且出生日期相同（编号 ${hits.map((h) => h.id).join('、')}）。请加上 id 栏位来指定。`));
          else cur = hits[0];
        }
      }
      const f = readFields(FIELDS, r, present, cur);
      errors.push(...f.errors);
      const name = label(cur ? { ...cur, ...f.values } : f.values) || `#${idRaw}`;
      // the same person twice in one file
      const dupKey = cur ? `id:${cur.id}` : `new:${nameKey(String(f.values.first_name ?? ''), String(f.values.last_name ?? ''), (f.values.birth_date as string) ?? null)}`;
      if (seen.has(dupKey) && (cur || f.values.first_name)) errors.push(M(`Same person as row ${seen.get(dupKey)}.`, `与第 ${seen.get(dupKey)} 行是同一人。`));
      else seen.set(dupKey, r.row);
      if (!cur) errors.push(...missingRequired(FIELDS, f.values, what));
      if (cur && present.has('first_name') && !f.values.first_name) errors.push(M('first_name cannot be emptied.', '名字（first_name）不能清空。'));
      const patch = { ...f.patch };
      if (patch.last_name === null) patch.last_name = '';
      if (hLangs.length) {
        const inc = readL10n(r, 'honorific', hLangs);
        const curH = honorificOf(cur);
        const merged = mergeL10n(curH, inc);
        if (JSON.stringify(merged) !== JSON.stringify(curH)) {
          patch.honorific = Object.keys(merged).length ? merged : null;
          for (const l of hLangs) {
            f.inc[`honorific_${l}`] = inc[l] ?? '';
            if (cur) f.cur[`honorific_${l}`] = curH[l] ?? '';
          }
        }
      }
      // the church's own fields: the file's values on top of the stored ones (an empty cell clears that field)
      const cdefs = customDefs().filter((d) => present.has(`custom_${d.key}`));
      if (cdefs.length) {
        const curC = customOf(cur);
        const given = Object.fromEntries(cdefs.map((d) => [d.key, r.v[`custom_${d.key}`] ?? '']));
        // cleaned against every field, so values the account doesn't see (sensitive ones) are kept as they are
        const { values, errors: ce } = cleanCustomValues({ ...curC, ...given }, allCustomDefs(), getSettings().languages[0]);
        errors.push(...ce.map((e) => M(e, e)));
        if (JSON.stringify(values) !== JSON.stringify(curC)) {
          patch.custom = values;
          for (const d of cdefs) {
            f.inc[`custom_${d.key}`] = values[d.key] ?? '';
            if (cur) f.cur[`custom_${d.key}`] = curC[d.key] ?? '';
          }
        }
      }
      if (!patch.status) {
        // an empty status keeps the current one (new people default to regular)
        delete patch.status;
        delete f.inc.status;
      }
      if (!errors.length) {
        const check = (cur ? PersonInput.partial() : PersonInput).safeParse(patch);
        if (!check.success) errors.push(...check.error.issues.map((i) => M(`${i.path.join('.')}: ${i.message}`, `${i.path.join('.')}：${i.message}`)));
      }
      if (cur && !errors.length && approverEmailLocked(cur.id, patch.email as string | null | undefined)) {
        errors.push(M('This member approves expense claims and signs in with this e-mail address: an administrator or the treasurer changes it.', '这位会友负责审批报销，并用这个电邮地址登入：须由管理员或司库更改。'));
      }
      if (errors.length) return { row: r.row, label: name, action: 'error', errors };
      const hh = present.has('household') ? (f.values.household as string | null) : undefined;
      const save = () => {
        const p = { ...patch };
        if (hh !== undefined) p.household_id = hh ? household(hh) : null;
        if (cur) people.update(cur.id, p);
        else people.insert(p);
      };
      if (!cur) return { row: r.row, label: name, action: 'create', apply: save };
      const changes = diff(f.cur, f.inc).map((c) => (c.field === 'household' && c.to && !all_.some((p) => p.household_name?.toLowerCase() === c.to.toLowerCase()) ? { ...c, to: `${c.to} ${say(M('(new household)', '（新家庭）'), ctx.lang)}` } : c));
      return changes.length ? { row: r.row, label: name, action: 'update', changes, apply: save } : { row: r.row, label: name, action: 'unchanged' };
    });
  },
};
