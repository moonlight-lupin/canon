// Value parsers / formatters and lookups shared by the CSV entities. Parsers are forgiving (Excel date
// formats, yes/是, labels instead of codes) and throw RowError with a plain-language message.
import type { L10n, Lang, Person } from '../../shared/types.ts';
import { langInfo } from '../../shared/languages.ts';
import { toSimplified } from '../lib/chinese.ts';
import { displayName } from '../repo/registers.ts';
import { M, fail, type Change, type Column, type Ctx, type InRow, type Msg } from './engine.ts';
import { visiblePeople } from '../lib/walls.ts';

// ---------------------------------------------------------------- columns

export const col = (key: string, label: Msg, description: Msg, extra: Partial<Column> = {}): Column => ({ key, label, description, ...extra });

const langName = (code: string) => {
  const i = langInfo(code);
  return { en: i.name, zh: i.native };
};

/** One column per language: title_en, title_zh, title_zh-Hant … The bare base ("title") means the primary language. */
export function l10nCols(base: string, ctx: Ctx, label: Msg, description: Msg, opts: { required?: boolean; examples?: Record<string, string>; aliases?: string[] } = {}): Column[] {
  return ctx.langs.map((lang, i) => {
    const n = langName(lang);
    return col(`${base}_${lang}`, M(`${label.en} (${n.en})`, `${label.zh}（${n.zh}）`), description, {
      required: opts.required && i === 0,
      example: opts.examples?.[lang],
      aliases: i === 0 ? [base, ...(opts.aliases ?? [])] : (opts.aliases ?? []).map((a) => `${a}_${lang}`),
    });
  });
}

/** Languages of a per-language column base that are present in the file. */
export const presentLangs = (base: string, ctx: Ctx, present: Set<string>) => ctx.langs.filter((l) => present.has(`${base}_${l}`));

/** Incoming per-language values of a base: only languages present in the file; '' clears. */
export function readL10n(r: InRow, base: string, langs: Lang[]): L10n {
  const out: L10n = {};
  for (const l of langs) out[l] = r.v[`${base}_${l}`] ?? '';
  return out;
}

/** Replace the languages present in the file, keep the others; drop empty values. */
export function mergeL10n(cur: L10n | null | undefined, inc: L10n): L10n {
  const out: L10n = { ...(cur ?? {}) };
  for (const [k, v] of Object.entries(inc)) {
    if (v) out[k] = v;
    else delete out[k];
  }
  for (const k of Object.keys(out)) if (!out[k]?.trim()) delete out[k];
  return out;
}

export const hasText = (v: L10n) => Object.values(v).some((x) => !!x?.trim());

/** Changes between formatted current and incoming values (only the keys of `inc`). */
export function diff(cur: Record<string, string>, inc: Record<string, string>): Change[] {
  const out: Change[] = [];
  for (const [k, v] of Object.entries(inc)) if ((cur[k] ?? '') !== v) out.push({ field: k, from: cur[k] ?? '', to: v });
  return out;
}

/** Run parsers for a row, collecting every problem rather than stopping at the first. */
export function collect<T>(errors: Msg[], fn: () => T): T | undefined {
  try {
    return fn();
  } catch (e) {
    if (e && typeof e === 'object' && 'msg' in e) errors.push((e as { msg: Msg }).msg);
    else throw e;
    return undefined;
  }
}

// ---------------------------------------------------------------- values

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function ymd(y: number, m: number, d: number, raw: string, label: string) {
  if (y < 100) y += y < 50 ? 2000 : 1900;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (!m || !d || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    fail(`${label}: "${raw}" is not a real date.`, `${label}：「${raw}」不是有效的日期。`);
  }
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Dates as typed or as Excel re-saves them: 2025-03-31, 2025/3/31, 31/3/2025 (day first), 31-Mar-2025, 31 March 2025, 2025年3月31日. */
export function parseDate(s: string, label: string): string | null {
  const t = s.trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T].*)?$/);
  if (m) return ymd(+m[1], +m[2], +m[3], t, label);
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?: .*)?$/);
  if (m) {
    let d = +m[1];
    let mo = +m[2];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d]; // clearly month-first (US Excel)
    return ymd(+m[3], mo, d, t, label);
  }
  m = t.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s,]+(\d{2}|\d{4})$/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) {
    return ymd(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1], t, label);
  }
  m = t.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return ymd(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2], t, label);
  return fail(`${label}: "${t}" is not a date — write it like 2025-03-31.`, `${label}：「${t}」不是日期，请写成 2025-03-31。`);
}

const YES = new Set(['yes', 'y', 'true', '1', 'x', '✓', '是', '对', '對', 'ya', 'ok']);
const NO = new Set(['no', 'n', 'false', '0', '否', '不', '不是', 'tidak', '-']);

export function parseBool(s: string, label: string): boolean | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  if (YES.has(t)) return true;
  if (NO.has(t)) return false;
  return fail(`${label}: write yes or no (not "${s}").`, `${label}：请填 yes 或 no（是/否），而不是「${s}」。`);
}
export const fmtBool = (b: boolean | null | undefined) => (b === null || b === undefined ? '' : b ? 'yes' : 'no');

/** Match one of `values`, also accepting labels/aliases (case-, space- and dash-insensitive). */
export function parseEnum<T extends string>(s: string, label: string, values: readonly T[], aliases: Record<string, T> = {}): T | null {
  const t = s.trim();
  if (!t) return null;
  const k = t.toLowerCase().replace(/[\s\-_/]+/g, '_');
  for (const v of values) if (v.toLowerCase() === k) return v;
  for (const [a, v] of Object.entries(aliases)) if (a.toLowerCase().replace(/[\s\-_/]+/g, '_') === k || a === t) return v;
  return fail(
    `${label}: "${t}" is not one of the accepted values (${values.join(', ')}).`,
    `${label}：「${t}」不是可接受的值（${values.join('、')}）。`,
  );
}

export function parseInt10(s: string, label: string, min: number, max: number): number | null {
  const t = s.trim().replace(/,/g, '');
  if (!t) return null;
  if (!/^-?\d+$/.test(t) || +t < min || +t > max) fail(`${label}: "${s}" should be a whole number from ${min} to ${max}.`, `${label}：「${s}」应为 ${min} 到 ${max} 之间的整数。`);
  return +t;
}

export function parseNumber(s: string, label: string, min: number, max: number): number | null {
  const t = s.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < min || n > max) fail(`${label}: "${s}" should be a number from ${min} to ${max}.`, `${label}：「${s}」应为 ${min} 到 ${max} 之间的数字。`);
  return n;
}

/** 10:00, 9:30, 9.30, 0930, 9:30 am, 7pm → HH:MM */
export function parseTime(s: string, label: string): string | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})(?:[:.]?(\d{2}))?(?::\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?$/);
  if (m) {
    let h = +m[1];
    const min = m[2] ? +m[2] : 0;
    if (m[3]?.startsWith('p') && h < 12) h += 12;
    if (m[3]?.startsWith('a') && h === 12) h = 0;
    if (h < 24 && min < 60) return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  return fail(`${label}: "${s}" is not a time — write it like 10:00 or 19:30.`, `${label}：「${s}」不是时间，请写成 10:00 或 19:30。`);
}

/** Text with a length limit ('' → null). */
export function parseText(s: string, label: string, max = 4000): string | null {
  const t = s.trim();
  if (!t) return null;
  if (t.length > max) fail(`${label} is too long (${t.length} characters; at most ${max}).`, `${label}太长（${t.length} 个字；最多 ${max}）。`);
  return t;
}

/** "a; b, c" → ["a","b","c"] (semicolons preferred; Chinese punctuation accepted). */
export const parseList = (s: string) => s.split(/[;；,，、\n]/).map((x) => x.trim()).filter(Boolean);
export const fmtList = (xs: string[] | null | undefined) => (xs ?? []).join('; ');

export const fmtL10nValue = (v: L10n | null | undefined, lang: Lang) => (v?.[lang] ?? '').trim();

/** Comparison key for titles and names: case-, space- and punctuation-insensitive; Traditional folded to Simplified. */
export const nameKey = (s: string) => toSimplified(s.normalize('NFKC').toLowerCase()).replace(/[\s\p{P}\p{S}]+/gu, '');

// ---------------------------------------------------------------- people

export const PERSON_COLS = (required = true): Column[] => [
  col('person_id', M('Person id', '会友编号'), M('Optional. The person\'s id from a member export; use it when two people share a name.', '可选。会友导出文件中的编号；两人同名时请填写。'), { aliases: ['member_id', 'people_id'] }),
  col('person', M('Person', '姓名'), M('The person\'s name as in the member register: English name (e.g. David Tan) or Chinese name (陈大卫).', '会友名册中的姓名：英文名（如 David Tan）或中文名（陈大卫）。'), {
    required, aliases: ['name', 'member', 'member_name', 'full_name', '姓名', '名字', '会友'], example: 'David Tan',
  }),
];

/** Name index over the member register, built once per import. */
export function personIndex() {
  // an account limited to one congregation only finds its own people (and the whole church's)
  const people = visiblePeople<Person>();
  const byId = new Map(people.map((p) => [p.id, p]));
  const byName = new Map<string, Person[]>();
  const add = (k: string, p: Person) => {
    if (!k) return;
    const list = byName.get(k) ?? [];
    if (!list.includes(p)) list.push(p);
    byName.set(k, list);
  };
  for (const p of people) {
    const keys = [
      `${p.first_name} ${p.last_name}`, `${p.last_name} ${p.first_name}`, p.preferred_name ? `${p.preferred_name} ${p.last_name}` : '',
      p.native_name ?? '', displayName(p),
    ];
    for (const k of keys) add(nameKey(k), p);
  }
  return {
    byId,
    /** Resolve the person of a row from person_id or person; throws a plain message when unknown or ambiguous. */
    resolve(r: InRow): Person {
      const idRaw = r.v.person_id?.trim();
      if (idRaw) {
        const p = byId.get(Number(idRaw));
        if (!p) fail(`No person with id ${idRaw} in the member register.`, `会友名册中没有编号为 ${idRaw} 的人。`);
        return p!;
      }
      const name = r.v.person?.trim();
      if (!name) fail('Person is empty — write the person\'s name.', '姓名是空的，请填写姓名。');
      const hits = byName.get(nameKey(name!)) ?? [];
      if (!hits.length) fail(`No one called "${name}" in the member register. Add them under Members first.`, `会友名册中没有「${name}」。请先在会友名册中加入此人。`);
      if (hits.length > 1) fail(`${hits.length} people are called "${name}" (ids ${hits.map((p) => p.id).join(', ')}). Add the person_id column to choose.`, `有 ${hits.length} 人叫「${name}」（编号 ${hits.map((p) => p.id).join('、')}）。请加上 person_id 栏位来指定。`);
      return hits[0];
    },
  };
}

// ---------------------------------------------------------------- simple fields

/** A column mapped to one record field: how to read the cell and how to show the current value. */
export interface Field<R> {
  col: Column;
  /** cell text (trimmed, may be '') → stored value (null clears) */
  parse: (s: string) => unknown;
  /** current stored value of the record */
  get: (rec: R) => unknown;
  /** stored value → cell text (default: String) */
  fmt?: (v: unknown) => string;
  /** record field written (default: the column key); false = handled by the entity */
  db?: string | false;
}

export const fmtField = <R,>(f: Field<R>, v: unknown) => (f.fmt ? f.fmt(v) : v === null || v === undefined ? '' : String(v));

/**
 * Read the fields present in the file for one row. Returns the patch (record fields), the incoming and
 * current values formatted as cells (for unchanged / diff), and parse errors.
 */
export function readFields<R>(fields: Field<R>[], r: InRow, present: Set<string>, current: R | undefined) {
  const errors: Msg[] = [];
  const patch: Record<string, unknown> = {};
  const values: Record<string, unknown> = {};
  const inc: Record<string, string> = {};
  const cur: Record<string, string> = {};
  for (const f of fields) {
    if (!present.has(f.col.key)) continue;
    const ok = { v: undefined as unknown, good: false };
    collect(errors, () => {
      ok.v = f.parse(r.v[f.col.key] ?? '');
      ok.good = true;
    });
    if (!ok.good) continue;
    values[f.col.key] = ok.v;
    if (f.db !== false) patch[f.db ?? f.col.key] = ok.v;
    inc[f.col.key] = fmtField(f, ok.v);
    if (current) cur[f.col.key] = fmtField(f, f.get(current));
  }
  return { errors, patch, values, inc, cur };
}

/** Errors for required columns that are empty (needed when adding a record). */
export function missingRequired<R>(fields: Field<R>[], values: Record<string, unknown>, what: Msg): Msg[] {
  return fields
    .filter((f) => f.col.required && (values[f.col.key] === null || values[f.col.key] === undefined || values[f.col.key] === ''))
    .map((f) => M(`${f.col.key} is empty — it is needed to add a new ${what.en}.`, `${f.col.key} 是空的 —— 新增${what.zh}时必须填写。`));
}
