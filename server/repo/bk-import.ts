// Importing journals (0.17.2) from an Excel or CSV file: one row per line, the rows of a journal sharing its
// reference (the Journal column). Accounts and funds by code; projects, ministries and congregations by code or name.
// A preview first (each journal with what stops it), then the journals come in as DRAFTS — the treasurer reviews and
// posts them, as every journal. The template has the same columns as the journal export, so an export (e.g. from
// another Canon) imports back.
import { all } from '../db.ts';
import { decodeCsv, headerKey, parseCsv } from '../lib/csv.ts';
import { isXlsx, readXlsx, tableRows } from '../lib/xlsx-read.ts';
import { parseBankDate, DATE_FORMATS } from './bk-bank.ts';
import { postingProblems, saveDraft } from './bookkeeping.ts';
import type { BkLine, JournalKind } from '../../shared/bookkeeping.ts';

export const JOURNAL_COLUMNS = ['Journal', 'Date', 'Narration', 'Kind', 'Account code', 'Fund', 'Project', 'Ministry', 'Congregation', 'Debit', 'Credit', 'Line note'];
const ALIASES: Record<string, string[]> = {
  journal: ['journal', 'journalref', 'ref', 'reference', 'journalno', 'no', 'number', 'entry'],
  date: ['date', 'journaldate'],
  narration: ['narration', 'description', 'memo', 'journalmemo'],
  kind: ['kind', 'type'],
  account: ['accountcode', 'account', 'code', 'glcode'],
  fund: ['fund', 'fundcode'],
  project: ['project', 'projectcode'],
  ministry: ['ministry', 'ministrycode', 'department'],
  congregation: ['congregation', 'congregationcode'],
  debit: ['debit', 'dr', 'debitamount'],
  credit: ['credit', 'cr', 'creditamount'],
  note: ['linenote', 'note', 'linememo', 'linedescription'],
};

/** The template: the headings and a few fictional examples (rent paid; a transfer between funds). */
export function journalTemplateRows(): string[][] {
  return [
    JOURNAL_COLUMNS,
    ['J1', '2026-10-01', 'October hall rent (example)', '', '5500', 'GEN', '', '', '', '1500.00', '', 'Hall rent'],
    ['J1', '2026-10-01', '', '', '1100', 'GEN', '', '', '', '', '1500.00', 'Paid by transfer'],
    ['J2', '2026-10-05', 'Missions support (example)', '', '5100', 'MIS', '', '', '', '300.00', '', ''],
    ['J2', '2026-10-05', '', '', '1100', 'MIS', '', '', '', '', '300.00', ''],
  ];
}

export interface ImportedJournal {
  ref: string;
  date: string | null;
  memo: string | null;
  kind: JournalKind;
  rows: number[];
  lines: BkLine[];
  debit: number;
  credit: number;
  /** stops the import of this journal (an unknown account, a date that can't be read …) */
  errors: string[];
  /** will stop it from being POSTED (not from coming in as a draft): unbalanced, a closed period … */
  problems: string[];
}

const cents = (s: string): number | null => {
  const t = s.replace(/[,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!t) return 0;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
};
function readDate(s: string): string | null {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  for (const f of DATE_FORMATS) {
    const d = parseBankDate(t, f);
    if (d) return d;
  }
  return null;
}

/** Read the file and group its rows into journals, each checked. */
export function readJournalFile(data: Uint8Array): { journals: ImportedJournal[]; fatal: string | null; ignored: string[] } {
  let rows: string[][];
  try {
    rows = isXlsx(data) ? tableRows(readXlsx(data)) : parseCsv(decodeCsv(data).text);
  } catch (e) {
    return { journals: [], fatal: (e as Error).message, ignored: [] };
  }
  rows = rows.filter((r) => r.some((c) => c?.trim()));
  if (rows.length < 2) return { journals: [], fatal: 'The file has no rows below the headings.', ignored: [] };
  const head = rows[0].map((h) => headerKey(h ?? '').replace(/_/g, ''));
  const at: Record<string, number> = {};
  const ignored: string[] = [];
  head.forEach((h, i) => {
    const k = Object.keys(ALIASES).find((key) => ALIASES[key].includes(h));
    // "Account code" wins over "Account" (the export has both: the name is only for reading)
    if (k && (at[k] === undefined || (k === 'account' && h === 'accountcode'))) at[k] = i;
    else if (!k && rows[0][i]?.trim()) ignored.push(rows[0][i]);
  });
  const missing = ['journal', 'date', 'account', 'fund'].filter((k) => at[k] === undefined);
  if (at.debit === undefined && at.credit === undefined) missing.push('debit / credit');
  if (missing.length) return { journals: [], fatal: `These columns are missing: ${missing.join(', ')}. Start from the template.`, ignored };

  const byCode = (table: string, withName = false) => {
    const m = new Map<string, number>();
    for (const r of all<{ id: number; code: string; name?: string }>(`SELECT id, code${withName ? ', name' : ''} FROM ${table}`)) {
      m.set(r.code.trim().toLowerCase(), r.id);
      if (withName && r.name) for (const v of Object.values(JSON.parse(r.name) as Record<string, string>)) if (v?.trim()) m.set(v.trim().toLowerCase(), r.id);
    }
    return m;
  };
  const accounts = byCode('bk_accounts');
  const funds = byCode('bk_funds');
  const projects = byCode('bk_projects', true);
  const ministries = byCode('bk_ministries', true);
  const congs = byCode('congregations', true);
  const cell = (r: string[], k: string) => (at[k] === undefined ? '' : (r[at[k]] ?? '').trim());

  const groups = new Map<string, ImportedJournal>();
  rows.slice(1).forEach((r, i) => {
    const rowNo = i + 2;
    const ref = cell(r, 'journal') || `(row ${rowNo})`;
    let j = groups.get(ref);
    if (!j) {
      j = { ref, date: null, memo: null, kind: 'manual', rows: [], lines: [], debit: 0, credit: 0, errors: [], problems: [] };
      groups.set(ref, j);
    }
    j.rows.push(rowNo);
    const ds = cell(r, 'date');
    if (ds) {
      const d = readDate(ds);
      if (!d) j.errors.push(`Row ${rowNo}: “${ds}” is not a date (use YYYY-MM-DD).`);
      else if (!j.date) j.date = d;
      else if (d !== j.date) j.errors.push(`Row ${rowNo}: a journal has one date (${j.date}); this row says ${d}.`);
    }
    if (!j.memo && cell(r, 'narration')) j.memo = cell(r, 'narration');
    const kind = cell(r, 'kind').toLowerCase();
    if (kind === 'opening' || kind === 'transfer') j.kind = kind;
    const code = cell(r, 'account');
    const account = accounts.get(code.toLowerCase());
    if (!account) j.errors.push(`Row ${rowNo}: no account with the code “${code}”.`);
    const fcode = cell(r, 'fund');
    const fund = funds.get(fcode.toLowerCase());
    if (!fund) j.errors.push(`Row ${rowNo}: no fund with the code “${fcode}”.`);
    const tag = (m: Map<string, number>, k: string, what: string) => {
      const v = cell(r, k);
      if (!v) return null;
      const id = m.get(v.toLowerCase());
      if (!id) j!.errors.push(`Row ${rowNo}: no ${what} “${v}”.`);
      return id ?? null;
    };
    const project_id = tag(projects, 'project', 'project');
    const ministry_id = tag(ministries, 'ministry', 'ministry');
    const congregation_id = tag(congs, 'congregation', 'congregation');
    const dr = cents(cell(r, 'debit'));
    const cr = cents(cell(r, 'credit'));
    if (dr === null || cr === null) j.errors.push(`Row ${rowNo}: the amount is not a number.`);
    else if (dr < 0 || cr < 0) j.errors.push(`Row ${rowNo}: amounts can’t be negative (use the other column).`);
    else if (dr && cr) j.errors.push(`Row ${rowNo}: a line is a debit or a credit, not both.`);
    else if (!dr && !cr) j.errors.push(`Row ${rowNo}: no amount.`);
    if (account && fund && dr !== null && cr !== null && dr >= 0 && cr >= 0) {
      j.lines.push({ account_id: account, fund_id: fund, project_id, ministry_id, congregation_id, debit: dr, credit: cr, memo: cell(r, 'note') || null });
      j.debit += dr;
      j.credit += cr;
    }
  });
  const journals = [...groups.values()];
  for (const j of journals) {
    if (!j.date) j.errors.push('No date.');
    else if (!j.errors.length) j.problems = postingProblems({ date: j.date, kind: j.kind, lines: j.lines });
  }
  return { journals, fatal: null, ignored };
}

/** Bring the journals without errors in as drafts. */
export function importJournals(data: Uint8Array) {
  const r = readJournalFile(data);
  if (r.fatal) return { ...r, imported: [] as number[] };
  const imported: number[] = [];
  for (const j of r.journals) {
    if (j.errors.length) continue;
    imported.push(saveDraft(null, { date: j.date!, memo: j.memo, kind: j.kind, lines: j.lines }, `Imported from a file (journal ${j.ref})`).id);
  }
  return { ...r, imported };
}
