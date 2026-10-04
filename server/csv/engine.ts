// The CSV import engine shared by every entity: decode → parse → match headers → plan (no writes) →
// apply in ONE transaction. Entities (server/csv/*.ts) declare their columns and how a row is matched,
// compared and saved; the engine produces the preview (dry run) and enforces all-or-nothing.
import type { Lang, ModuleKey } from '../../shared/types.ts';
import { db, tx } from '../db.ts';
import { getSettings } from '../repo/settings.ts';
import { toTraditional } from '../lib/chinese.ts';
import { decodeCsv, detectDelimiter, headerKey, langFromSuffix, matchHeaders, parseRecords, readCell, writeCsv } from '../lib/csv.ts';
import { LANG_CODE_RE } from '../../shared/languages.ts';

/** A message in English and Simplified Chinese (Traditional is converted automatically). */
export interface Msg {
  en: string;
  zh: string;
}
export const M = (en: string, zh: string): Msg => ({ en, zh });

/** A plain-language problem with a row; thrown by column parsers. */
export class RowError extends Error {
  msg: Msg;
  constructor(msg: Msg) {
    super(msg.en);
    this.msg = msg;
  }
}
export const fail = (en: string, zh: string): never => {
  throw new RowError(M(en, zh));
};

export interface Column {
  /** header in the CSV file, e.g. "first_name", "title_zh-Hant" */
  key: string;
  label: Msg;
  description: Msg;
  /** must have a value when a new record is added */
  required?: boolean;
  /** accepted values listed in the column guide */
  values?: string[];
  example?: string;
  /** other headers accepted for this column (matched case/space-insensitively) */
  aliases?: string[];
}

export interface Ctx {
  /** church languages first, then any extra languages found in the file's headers */
  langs: Lang[];
  /** UI language for messages */
  lang: Lang;
  query: Record<string, string | undefined>;
}

/** One data row of the file: values of the columns present in the header (trimmed). */
export interface InRow {
  row: number;
  v: Record<string, string>;
}

export interface Change {
  field: string;
  from: string;
  to: string;
}

export type Action = 'create' | 'update' | 'unchanged' | 'error';

export interface RowPlan {
  /** first spreadsheet row of this record */
  row: number;
  /** last row, when a record spans several rows (templates) */
  to_row?: number;
  label: string;
  action: Action;
  changes?: Change[];
  errors?: Msg[];
  warnings?: Msg[];
  /** performs the writes; resolves references at apply time (earlier rows may have created them) */
  apply?: () => void;
}

export interface Entity {
  key: string;
  label: Msg;
  /** MCP / permission module this data belongs to */
  module: ModuleKey;
  /** personal data: viewers may not export it (PDPA) */
  pii: boolean;
  /** how rows are matched to existing records, shown at the top of the column guide */
  intro: Msg;
  /** column bases that have one column per language, e.g. ["title", "words"] → title_en, words_zh … */
  l10n?: string[];
  /** query parameters the entity needs (e.g. hymnal_id) */
  needs?: string[];
  columns(ctx: Ctx): Column[];
  example(ctx: Ctx): Record<string, string | undefined>[];
  export(ctx: Ctx): Record<string, unknown>[];
  plan(rows: InRow[], ctx: Ctx, present: Set<string>): RowPlan[];
  /** file name stem for downloads */
  fileName?(ctx: Ctx): string;
}

// ---------------------------------------------------------------- context & messages

export function makeCtx(lang: Lang, query: Record<string, string | undefined>, extra: Lang[] = []): Ctx {
  const church = getSettings().languages;
  return { langs: [...new Set([...church, ...extra])], lang, query };
}

export function say(m: Msg, lang: Lang): string {
  if (lang === 'zh') return m.zh;
  if (lang === 'zh-Hant') return toTraditional(m.zh);
  return m.en;
}

// ---------------------------------------------------------------- downloads

function sheet(cols: Column[], rows: Record<string, unknown>[]) {
  return writeCsv([cols.map((c) => c.key), ...rows.map((r) => cols.map((c) => r[c.key] ?? ''))]);
}

export function templateCsv(e: Entity, ctx: Ctx) {
  return sheet(e.columns(ctx), e.example(ctx));
}

export function exportCsv(e: Entity, ctx: Ctx) {
  return sheet(e.columns(ctx), e.export(ctx));
}

export function guide(e: Entity, ctx: Ctx) {
  const l = ctx.lang;
  return {
    entity: e.key,
    label: say(e.label, l),
    intro: say(e.intro, l),
    general: [
      say(M('Save from Excel as "CSV UTF-8 (Comma delimited)". Other CSV types also work; Chinese is converted automatically.', '在 Excel 中请另存为「CSV UTF-8（逗号分隔）」。其他 CSV 格式也可以，中文会自动转换。'), l),
      say(M('Columns you leave out are not changed. An empty cell clears that field.', '文件中没有的栏位不会被更改；空白的格子会清除该栏的资料。'), l),
      say(M('Dates: 2025-03-31 is best; 31/3/2025 (day first) also works. Yes/no columns accept yes, no, y, n, 1, 0, 是, 否.', '日期最好写成 2025-03-31；31/3/2025（日在前）也可以。是/否栏位可填 yes、no、y、n、1、0、是、否。'), l),
      say(M('Nothing is saved until you have checked the preview and pressed Import.', '在您检查预览并按「导入」之前，不会保存任何资料。'), l),
    ],
    columns: e.columns(ctx).map((c) => ({
      key: c.key,
      label: say(c.label, l),
      description: say(c.description, l),
      required: !!c.required,
      values: c.values ?? null,
      example: c.example ?? null,
    })),
  };
}

// ---------------------------------------------------------------- import

export interface Preview {
  entity: string;
  dry_run: boolean;
  applied: boolean;
  encoding: string;
  delimiter: string;
  notes: string[];
  fatal: string | null;
  columns: string[];
  counts: Record<Action, number>;
  rows: {
    row: number;
    to_row?: number;
    label: string;
    action: Action;
    changes?: Change[];
    errors?: string[];
    warnings?: string[];
  }[];
}

const DELIM_NAME: Record<string, Msg> = {
  ';': M('Columns were separated by semicolons (;) — read correctly.', '栏位以分号（;）分隔，已正确读取。'),
  '\t': M('Columns were separated by tabs — read correctly.', '栏位以 Tab 分隔，已正确读取。'),
};

export class ImportBlocked extends Error {
  status = 422;
  preview: Preview;
  constructor(message: string, preview: Preview) {
    super(message);
    this.preview = preview;
  }
}

/** Shorten a value for a diff line. */
const short = (s: string) => {
  const one = s.replace(/\n+/g, ' ⏎ ');
  return one.length > 80 ? one.slice(0, 77) + '…' : one;
};

/**
 * Read the file, plan every row, and (unless dryRun) apply the plan in one transaction.
 * Any row error blocks the whole import unless skipErrors, which applies the valid rows only.
 */
export function runImport(
  e: Entity,
  buf: Uint8Array,
  opts: { dryRun: boolean; skipErrors: boolean; lang: Lang; query: Record<string, string | undefined> },
): Preview {
  const l = opts.lang;
  const { text, encoding } = decodeCsv(buf);
  const delimiter = detectDelimiter(text);
  const notes: string[] = [];
  if (encoding === 'gb18030' || encoding === 'big5') {
    const name = encoding === 'big5' ? 'Big5' : 'GBK';
    notes.push(say(M(
      `This file was saved by Excel in a Chinese (${name}) encoding; it was converted automatically. Next time choose "CSV UTF-8".`,
      `此文件由 Excel 以中文（${name}）编码保存，已自动转换。下次请选择「CSV UTF-8」格式。`,
    ), l));
  }
  if (DELIM_NAME[delimiter]) notes.push(say(DELIM_NAME[delimiter], l));

  const empty = (fatal: string): Preview => ({
    entity: e.key, dry_run: opts.dryRun, applied: false, encoding, delimiter, notes, fatal, columns: [],
    counts: { create: 0, update: 0, unchanged: 0, error: 0 }, rows: [],
  });

  const records = parseRecords(text, delimiter);
  if (!records.length) return empty(say(M('The file is empty.', '文件是空的。'), l));
  const [head, ...data] = records;

  // languages used in per-language headers (title_ms, words_zh-Hant …) join the church languages
  const extra: Lang[] = [];
  for (const h of head.cells) {
    const k = headerKey(h);
    for (const base of e.l10n ?? []) {
      if (!k.startsWith(base + '_')) continue;
      const code = langFromSuffix(k.slice(base.length + 1));
      if (code && LANG_CODE_RE.test(code)) extra.push(code);
    }
  }
  const ctx = makeCtx(l, opts.query, extra);
  const cols = e.columns(ctx);
  const mapped = matchHeaders(head.cells, cols);
  const present = new Set(mapped.filter((k): k is string => !!k));
  const ignored = head.cells.filter((h, i) => !mapped[i] && h.trim());
  if (!present.size) {
    return empty(say(M(
      `None of the column headings were recognised. The first row must hold the headings from the template (e.g. ${cols.slice(0, 3).map((c) => c.key).join(', ')}).`,
      `无法识别任何栏位标题。第一行必须是模板中的标题（例如 ${cols.slice(0, 3).map((c) => c.key).join('、')}）。`,
    ), l));
  }
  if (ignored.length) {
    notes.push(say(M(`Ignored columns (not recognised): ${ignored.join(', ')}.`, `已忽略无法识别的栏位：${ignored.join('、')}。`), l));
  }

  const rows: InRow[] = data.map((r) => {
    const v: Record<string, string> = {};
    mapped.forEach((k, i) => {
      if (k) v[k] = readCell(r.cells[i]);
    });
    return { row: r.row, v };
  });
  if (!rows.length) return { ...empty(say(M('The file has headings but no data rows.', '文件只有标题，没有资料行。'), l)), columns: [...present] };

  let plans: RowPlan[];
  try {
    plans = e.plan(rows, ctx, present);
  } catch (err) {
    if (err instanceof RowError) return { ...empty(say(err.msg, l)), columns: [...present] };
    throw err;
  }

  const counts: Record<Action, number> = { create: 0, update: 0, unchanged: 0, error: 0 };
  for (const p of plans) counts[p.action]++;

  let applied = false;
  if (!opts.dryRun) {
    if (counts.error && !opts.skipErrors) {
      throw new ImportBlocked(
        say(M(
          `Nothing was imported: ${counts.error} row${counts.error > 1 ? 's have' : ' has'} problems. Fix them, or choose "Import valid rows and skip errors".`,
          `未导入任何资料：有 ${counts.error} 行有问题。请先修正，或选择「导入有效的行并跳过错误」。`,
        ), l),
        serialise(),
      );
    }
    tx(() => {
      for (const p of plans) {
        if (p.action === 'error' || p.action === 'unchanged' || !p.apply) continue;
        if (opts.skipErrors) {
          db.exec('SAVEPOINT csv_row');
          try {
            p.apply();
            db.exec('RELEASE csv_row');
          } catch (err) {
            db.exec('ROLLBACK TO csv_row');
            db.exec('RELEASE csv_row');
            counts[p.action]--;
            counts.error++;
            p.action = 'error';
            p.errors = [...(p.errors ?? []), rowFailure(err)];
          }
        } else {
          try {
            p.apply();
          } catch (err) {
            const m = rowFailure(err);
            throw Object.assign(new Error(say(M(`Row ${p.row}: ${m.en} Nothing was imported.`, `第 ${p.row} 行：${m.zh} 未导入任何资料。`), l)), { status: 400 });
          }
        }
      }
    });
    applied = true;
  }
  return serialise();

  function serialise(): Preview {
    return {
      entity: e.key, dry_run: opts.dryRun, applied, encoding, delimiter, notes, fatal: null, columns: [...present], counts,
      rows: plans.map((p) => ({
        row: p.row,
        ...(p.to_row && p.to_row !== p.row ? { to_row: p.to_row } : {}),
        label: p.label,
        action: p.action,
        ...(p.changes?.length ? { changes: p.changes.map((c) => ({ field: c.field, from: short(c.from), to: short(c.to) })) } : {}),
        ...(p.errors?.length ? { errors: p.errors.map((m) => say(m, l)) } : {}),
        ...(p.warnings?.length ? { warnings: p.warnings.map((m) => say(m, l)) } : {}),
      })),
    };
  }
}

function rowFailure(err: unknown): Msg {
  if (err instanceof RowError) return err.msg;
  const m = (err as Error).message ?? String(err);
  if (/UNIQUE/.test(m)) return M('This would create a duplicate.', '这会产生重复的资料。');
  return M(m, m);
}
