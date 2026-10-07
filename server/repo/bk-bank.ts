// Bank reconciliation (0.17.0). A bank account's CSV statement is imported (the bank's column layout is remembered
// on the account after the first import, rows above the column names skipped, lines already imported skipped);
// each statement line is matched to a posted line on that account — Canon suggests the same amount within a week —
// or becomes a new journal (bank charges, interest), or is ignored. The reconciliation compares the statement's
// closing balance with the books: the book balance less what the bank hasn't shown yet.
import { all, get, run, tx } from '../db.ts';
import { BadRequest, Conflict, NotFound } from '../lib/table.ts';
import { currentActor } from '../lib/actor.ts';
import { decodeCsv, parseCsv } from '../lib/csv.ts';
import { logChange } from './changelog.ts';
import { accounts, activeAccount, activeFund, postJournal, postingProblems, saveDraft, getJournal } from './bookkeeping.ts';
import type { BankCsvLayout } from '../../shared/bookkeeping.ts';

export interface StatementLine { id: number; statement_id: number; position: number; date: string; description: string | null; reference: string | null; amount: number; status: 'open' | 'matched' | 'ignored'; line_id: number | null; journal_id: number | null }

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD MMM YYYY', 'DD-MMM-YYYY', 'YYYY/MM/DD', 'DD.MM.YYYY'];

/** A date written the bank's way, as YYYY-MM-DD (null when it doesn't read). */
export function parseBankDate(s: string, format: string): string | null {
  const t = s.trim();
  const iso = (y: number, m: number, d: number) => (y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null);
  const yy = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
  let m: RegExpMatchArray | null;
  switch (format) {
    case 'DD/MM/YYYY': case 'DD.MM.YYYY':
      m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
      return m ? iso(yy(m[3]), Number(m[2]), Number(m[1])) : null;
    case 'MM/DD/YYYY':
      m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
      return m ? iso(yy(m[3]), Number(m[1]), Number(m[2])) : null;
    case 'YYYY-MM-DD': case 'YYYY/MM/DD':
      m = t.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/);
      return m ? iso(Number(m[1]), Number(m[2]), Number(m[3])) : null;
    case 'DD MMM YYYY': case 'DD-MMM-YYYY':
      m = t.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-](\d{2,4})/);
      return m ? iso(yy(m[3]), MONTHS.indexOf(m[2].toLowerCase()) + 1, Number(m[1])) : null;
    default:
      return null;
  }
}

/** An amount as written on a statement ("1,234.50", "(12.00)", "12.00 DR", "S$50") in minor units; null if none. */
export function parseBankAmount(s: string | undefined): number | null {
  if (s == null) return null;
  let t = s.trim();
  if (!t) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(t)) { sign = -1; t = t.slice(1, -1); }
  if (/\bDR\b|\bD$/i.test(t)) sign = -1;
  t = t.replace(/\b(CR|DR)\b/gi, '').replace(/[^\d.,-]/g, '');
  if (t.startsWith('-')) { sign = -sign; t = t.slice(1); }
  // "1.234,50" (comma decimals) when the last separator is a comma followed by two digits
  if (/,\d{2}$/.test(t) && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return sign * Math.round(Number(t) * 100);
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z一-鿿]/g, '');

/** The row with the layout's column names: found by the date column's name (the bank may add or drop lines above it). */
function headerIndex(rows: string[][], L: BankCsvLayout): number {
  const i = rows.findIndex((r) => r.some((c) => c.trim() === L.date));
  return i >= 0 ? i : L.header_row;
}

/** Read a statement file: its rows, and a guess at the layout (or the account's saved one). */
export function previewStatement(accountId: number, data: Buffer) {
  const a = accounts.get(accountId);
  const { text } = decodeCsv(new Uint8Array(data));
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim()));
  if (!rows.length) throw new BadRequest('The file is empty.');
  const saved = a.bank_csv;
  const at = saved ? rows.findIndex((r) => r.some((c) => c.trim() === saved.date)) : -1;
  const layout = saved && at >= 0 ? { ...saved, header_row: at } : guessLayout(rows);
  return { rows: rows.slice(0, 40), layout, saved: !!saved, formats: DATE_FORMATS };
}

/** Find the column names and which column is which (date, description, amount or money out / money in). */
export function guessLayout(rows: string[][]): BankCsvLayout {
  const isHeader = (r: string[]) => r.some((c) => /date|日期/.test(norm(c))) && r.some((c) => /amount|debit|credit|withdraw|deposit|金额|支出|存入/.test(norm(c)));
  const header_row = Math.max(0, rows.findIndex(isHeader));
  const h = rows[header_row] ?? [];
  const find = (re: RegExp) => h.find((c) => re.test(norm(c))) ?? '';
  const date = find(/^(transactiondate|date|valuedate|postingdate|日期|交易日期)/) || find(/date|日期/);
  const description = find(/description|details|particulars|narrative|reference1|transaction|摘要|说明/) || h.find((c) => c !== date) || '';
  const amount = find(/^amount|金额/);
  const debit = find(/debit|withdraw|moneyout|支出|提款/);
  const credit = find(/credit|deposit|moneyin|存入|收入/);
  const reference = find(/reference|ref|cheque|支票/);
  // the date format: the first that reads the dates under the header
  const di = h.indexOf(date);
  const sample = rows.slice(header_row + 1, header_row + 12).map((r) => r[di] ?? '').filter((c) => /\d/.test(c));
  const date_format = DATE_FORMATS.find((f) => sample.length && sample.every((s) => parseBankDate(s, f))) ?? 'DD/MM/YYYY';
  return { header_row, date, description, ...(amount && !(debit && credit) ? { amount } : { debit, credit }), ...(reference && reference !== description ? { reference } : {}), date_format };
}

/** Import a statement with a layout (saved on the account for next time). Lines already imported are skipped. */
export function importStatement(input: { account_id: number; data: Buffer; layout: BankCsvLayout; file_name?: string; opening_balance?: number | null; closing_balance?: number | null }) {
  const a = activeAccount(input.account_id);
  if (a.kind !== 'bank') throw new BadRequest(`${a.code} is not a bank account (Book-keeping → Accounts: kind “bank”).`);
  const { text } = decodeCsv(new Uint8Array(input.data));
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim()));
  const L = { ...input.layout, header_row: headerIndex(rows, input.layout) };
  const h = rows[L.header_row] ?? [];
  const col = (name?: string) => (name ? h.indexOf(name) : -1);
  const [ci, di, ai, dbi, cri, ri] = [col(L.date), col(L.description), col(L.amount), col(L.debit), col(L.credit), col(L.reference)];
  if (ci < 0) throw new BadRequest('Choose the date column.');
  if (ai < 0 && dbi < 0 && cri < 0) throw new BadRequest('Choose the amount column, or the money-out and money-in columns.');
  const lines: Omit<StatementLine, 'id' | 'statement_id' | 'status' | 'line_id' | 'journal_id'>[] = [];
  const skipped: string[] = [];
  rows.slice(L.header_row + 1).forEach((r, i) => {
    const date = parseBankDate(r[ci] ?? '', L.date_format);
    if (!date) {
      if ((r[ci] ?? '').trim()) skipped.push(`row ${L.header_row + i + 2}: “${r[ci]}” is not a date`);
      return; // totals, footers
    }
    let amount: number | null;
    if (ai >= 0) amount = parseBankAmount(r[ai]);
    else amount = (parseBankAmount(r[cri]) ?? 0) - Math.abs(parseBankAmount(r[dbi]) ?? 0);
    if (!amount) return;
    lines.push({ position: i, date, description: (r[di] ?? '').trim() || null, reference: ri >= 0 ? (r[ri] ?? '').trim() || null : null, amount });
  });
  if (!lines.length) throw new BadRequest(`No transactions were found with this layout.${skipped.length ? ` ${skipped.slice(0, 3).join('; ')}` : ''}`);
  return tx(() => {
    // the same line in an earlier statement of this account: skipped
    const seen = new Set(all<{ k: string }>(
      "SELECT sl.date || '|' || sl.amount || '|' || IFNULL(sl.description,'') AS k FROM bk_statement_lines sl JOIN bk_statements s ON s.id = sl.statement_id WHERE s.account_id = ?", a.id,
    ).map((r) => r.k));
    const fresh = lines.filter((l) => !seen.has(`${l.date}|${l.amount}|${l.description ?? ''}`));
    const dates = lines.map((l) => l.date).sort();
    const st = Number(run(
      'INSERT INTO bk_statements (account_id, starts_on, ends_on, opening_balance, closing_balance, file_name, imported_by) VALUES (?,?,?,?,?,?,?)',
      a.id, dates[0], dates.at(-1)!, input.opening_balance ?? null, input.closing_balance ?? null, input.file_name ?? null, currentActor()?.user_name ?? null,
    ).lastInsertRowid);
    for (const l of fresh) run('INSERT INTO bk_statement_lines (statement_id, position, date, description, reference, amount) VALUES (?,?,?,?,?,?)', st, l.position, l.date, l.description, l.reference, l.amount);
    accounts.update(a.id, { bank_csv: L });
    logChange({ entity: 'bk_statements', entity_id: st, action: 'create', summary: `Bank statement for ${a.code} imported: ${fresh.length} lines${lines.length - fresh.length ? `, ${lines.length - fresh.length} already imported` : ''}` });
    return { statement_id: st, lines: fresh.length, already: lines.length - fresh.length, skipped };
  });
}

// ---------------------------------------------------------------- matching

interface BookLine { id: number; journal_id: number; number: string; date: string; memo: string | null; jmemo: string | null; amount: number; kind: string }

/** Posted lines on the bank account not yet matched to any statement line (money in = positive). */
function openBookLines(accountId: number, upTo?: string): BookLine[] {
  return all<BookLine>(
    `SELECT l.id, l.journal_id, j.number, j.date, l.memo, j.memo AS jmemo, (l.debit - l.credit) AS amount, j.kind FROM bk_lines l JOIN bk_journals j ON j.id = l.journal_id
     WHERE l.account_id = ? AND j.status = 'posted' ${upTo ? 'AND j.date <= ?' : ''} AND NOT EXISTS (SELECT 1 FROM bk_statement_lines sl WHERE sl.line_id = l.id)
     ORDER BY j.date, l.id`, accountId, ...(upTo ? [upTo] : []),
  );
}
const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400_000;

/** Book lines that could be this statement line: the same amount, within a week, nearest first. */
function suggestions(line: StatementLine, pool: BookLine[]): BookLine[] {
  return pool.filter((b) => b.amount === line.amount && days(b.date, line.date) <= 7).sort((x, y) => days(x.date, line.date) - days(y.date, line.date)).slice(0, 3);
}

export function getStatement(id: number) {
  const s = get<{ id: number; account_id: number; starts_on: string; ends_on: string; opening_balance: number | null; closing_balance: number | null; file_name: string | null; imported_at: string; imported_by: string | null; done_at: string | null; done_by: string | null }>('SELECT * FROM bk_statements WHERE id = ?', id);
  if (!s) throw new NotFound('Statement not found');
  const lines = all<StatementLine>('SELECT * FROM bk_statement_lines WHERE statement_id = ? ORDER BY date, position', id);
  const pool = openBookLines(s.account_id);
  const matched = new Map(all<BookLine & { sl: number }>(
    `SELECT sl.id AS sl, l.id, l.journal_id, j.number, j.date, l.memo, j.memo AS jmemo, (l.debit - l.credit) AS amount, j.kind FROM bk_statement_lines sl
     JOIN bk_lines l ON l.id = sl.line_id JOIN bk_journals j ON j.id = l.journal_id WHERE sl.statement_id = ?`, id,
  ).map((r) => [r.sl, r]));
  return {
    statement: s,
    lines: lines.map((l) => ({ ...l, matched: matched.get(l.id) ?? null, suggestions: l.status === 'open' ? suggestions(l, pool) : [] })),
    reconciliation: reconciliation(s.account_id, s.ends_on, s.closing_balance),
  };
}

export const listStatements = (accountId?: number) => all(
  `SELECT s.*, a.code AS account_code, (SELECT COUNT(*) FROM bk_statement_lines WHERE statement_id = s.id) AS lines,
     (SELECT COUNT(*) FROM bk_statement_lines WHERE statement_id = s.id AND status = 'open') AS open
   FROM bk_statements s JOIN bk_accounts a ON a.id = s.account_id ${accountId ? 'WHERE s.account_id = ?' : ''} ORDER BY s.ends_on DESC, s.id DESC`,
  ...(accountId ? [accountId] : []),
);

const lineOf = (id: number) => {
  const l = get<StatementLine & { account_id: number }>('SELECT sl.*, s.account_id FROM bk_statement_lines sl JOIN bk_statements s ON s.id = sl.statement_id WHERE sl.id = ?', id);
  if (!l) throw new NotFound('Statement line not found');
  return l;
};

export function matchLine(id: number, bookLineId: number) {
  const l = lineOf(id);
  const b = get<{ account_id: number; amount: number; status: string }>('SELECT l.account_id, (l.debit - l.credit) AS amount, j.status FROM bk_lines l JOIN bk_journals j ON j.id = l.journal_id WHERE l.id = ?', bookLineId);
  if (!b || b.status !== 'posted') throw new BadRequest('Match a posted line.');
  if (b.account_id !== l.account_id) throw new BadRequest('That line is on another account.');
  if (b.amount !== l.amount) throw new BadRequest('The amounts differ.');
  if (get('SELECT 1 FROM bk_statement_lines WHERE line_id = ? AND id != ?', bookLineId, id)) throw new Conflict('That book line is already matched to another statement line.');
  run("UPDATE bk_statement_lines SET status = 'matched', line_id = ? WHERE id = ?", bookLineId, id);
}
export function unmatchLine(id: number) {
  lineOf(id);
  run("UPDATE bk_statement_lines SET status = 'open', line_id = NULL WHERE id = ?", id);
}
export function ignoreLine(id: number, ignored: boolean) {
  const l = lineOf(id);
  if (l.status === 'matched') throw new Conflict('Unmatch it first.');
  run('UPDATE bk_statement_lines SET status = ? WHERE id = ?', ignored ? 'ignored' : 'open', id);
}

/** Match every line that has exactly one suggestion on the same day. */
export function autoMatch(statementId: number) {
  const s = getStatement(statementId);
  let n = 0;
  const taken = new Set<number>();
  for (const l of s.lines) {
    if (l.status !== 'open') continue;
    const same = l.suggestions.filter((b) => b.date === l.date && !taken.has(b.id));
    if (same.length === 1) {
      matchLine(l.id, same[0].id);
      taken.add(same[0].id);
      n++;
    }
  }
  return n;
}

/** A statement line the books lack (a bank charge, interest): a journal against another account, matched to it. */
export function entryFromLine(id: number, input: { account_id: number; fund_id: number; memo?: string | null; project_id?: number | null; ministry_id?: number | null; post: boolean }) {
  const l = lineOf(id);
  if (l.status !== 'open') throw new Conflict('This line is already matched or ignored.');
  activeAccount(input.account_id);
  activeFund(input.fund_id);
  return tx(() => {
    const amt = Math.abs(l.amount);
    const into = l.amount > 0;
    const tags = { project_id: input.project_id ?? null, ministry_id: input.ministry_id ?? null };
    const j = saveDraft(null, {
      date: l.date, kind: 'bank', memo: input.memo?.trim() || l.description || 'Bank', lines: [
        { account_id: l.account_id, fund_id: input.fund_id, ...tags, debit: into ? amt : 0, credit: into ? 0 : amt, memo: l.reference },
        { account_id: input.account_id, fund_id: input.fund_id, ...tags, debit: into ? 0 : amt, credit: into ? amt : 0, memo: l.description },
      ],
    });
    run('UPDATE bk_statement_lines SET journal_id = ? WHERE id = ?', j.id, id);
    if (input.post) {
      const problems = postingProblems(j);
      if (problems.length) throw new BadRequest(problems.join(' '));
      const p = postJournal(j.id);
      const bankLine = get<{ id: number }>('SELECT id FROM bk_lines WHERE journal_id = ? AND account_id = ? ORDER BY position LIMIT 1', p.id, l.account_id)!;
      matchLine(id, bankLine.id);
      return getJournal(p.id);
    }
    return j;
  });
}

export function setStatementDone(id: number, done: boolean) {
  run('UPDATE bk_statements SET done_at = ?, done_by = ? WHERE id = ?', done ? new Date().toISOString() : null, done ? currentActor()?.user_name ?? null : null, id);
}
export function deleteStatement(id: number) {
  if (!get('SELECT 1 FROM bk_statements WHERE id = ?', id)) throw new NotFound('Statement not found');
  run('DELETE FROM bk_statements WHERE id = ?', id);
  logChange({ entity: 'bk_statements', entity_id: id, action: 'delete', summary: 'Bank statement removed (journals made from it stay)' });
}

/**
 * The reconciliation at a statement's end date: the book balance, less what the books have that no statement shows
 * yet (deposits not yet credited, payments not yet presented), should be the bank's closing balance. Entries from
 * before the account's first imported statement, and the opening balance, count as already cleared.
 */
export function reconciliation(accountId: number, endsOn: string, closing: number | null) {
  const book = get<{ b: number }>(
    "SELECT COALESCE(SUM(l.debit - l.credit), 0) b FROM bk_lines l JOIN bk_journals j ON j.id = l.journal_id WHERE l.account_id = ? AND j.status = 'posted' AND j.date <= ?", accountId, endsOn,
  )!.b;
  // the opening balance, and entries before the first imported statement, were cleared before Canon kept the books
  const since = get<{ d: string | null }>('SELECT MIN(starts_on) d FROM bk_statements WHERE account_id = ?', accountId)!.d ?? endsOn;
  const uncleared = openBookLines(accountId, endsOn).filter((b) => b.kind !== 'opening' && b.date >= since);
  const unclearedTotal = uncleared.reduce((n, b) => n + b.amount, 0);
  const expected = book - unclearedTotal;
  return { ends_on: endsOn, book_balance: book, uncleared, uncleared_total: unclearedTotal, expected_bank_balance: expected, statement_balance: closing, difference: closing == null ? null : closing - expected };
}
