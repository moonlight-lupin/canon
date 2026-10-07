// Bank reconciliation (0.17.0). A bank account's CSV statement is imported (the bank's column layout is remembered
// on the account after the first import, rows above the column names skipped, lines already imported skipped);
// each statement line is matched to a posted line on that account — Canon suggests the same amount within a week —
// or becomes a new journal (bank charges, interest), or is ignored. The reconciliation compares the statement's
// closing balance with the books: the book balance less what the bank hasn't shown yet.
import { all, get, run, tx } from '../db.ts';
import { BadRequest, Conflict, NotFound } from '../lib/table.ts';
import { currentActor } from '../lib/actor.ts';
import { decodeCsv, parseCsv } from '../lib/csv.ts';
import { isXlsx, readXlsx } from '../lib/xlsx-read.ts';

/** A statement's rows: from the bank's CSV, or an Excel file (its first sheet). Empty rows left out. */
function statementRows(data: Buffer): string[][] {
  const b = new Uint8Array(data);
  const rows = isXlsx(b) ? readXlsx(b) : parseCsv(decodeCsv(b).text);
  return rows.filter((r) => r.some((c) => c?.trim()));
}
import { logChange } from './changelog.ts';
import { accounts, activeAccount, activeFund, getJournal, postJournal, postingProblems, saveDraft } from './bookkeeping.ts';
import { recordFor, saveRecord, type Who } from './records.ts';
import { getSettings } from './settings.ts';
import type { OfferingMethod } from '../../shared/records.ts';
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
  const rows = statementRows(data);
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
  const taken = new Set<string>();
  // each column answers one question: "Transaction Date" is the date, not the description
  const find = (re: RegExp) => h.find((c) => !taken.has(c) && re.test(norm(c))) ?? '';
  const date = find(/^(transactiondate|date|valuedate|postingdate|日期|交易日期)/) || find(/date|日期/);
  taken.add(date);
  const description = find(/description|details|particulars|narrative|reference1|摘要|说明/) || find(/transaction/) || h.find((c) => c !== date) || '';
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

/**
 * The lines of a statement not imported before for this account. Statements overlap (this month's file repeats the
 * end of last month's), and a bank can show two genuine transactions that look alike (two SGD 50 PayNow gifts on the
 * same day). So:
 * - a line with the bank's reference is the same transaction only as a line with that reference (date and amount
 *   too); lines imported earlier without a reference are compared as below;
 * - otherwise lines are counted: if the earlier imports hold two "same date, amount and description" lines and this
 *   file three, one is new.
 * Exact retries add nothing; nothing genuine is dropped (v0.17.2 review, F1).
 */
function newLines<T extends { date: string; amount: number; description: string | null; reference: string | null }>(accountId: number, lines: T[]): T[] {
  const before = all<{ date: string; amount: number; description: string | null; reference: string | null }>(
    'SELECT sl.date, sl.amount, sl.description, sl.reference FROM bk_statement_lines sl JOIN bk_statements s ON s.id = sl.statement_id WHERE s.account_id = ?', accountId,
  );
  const plain = (l: { date: string; amount: number; description: string | null }) => `${l.date}|${l.amount}|${(l.description ?? '').trim()}`;
  const withRef = (l: { date: string; amount: number; reference: string | null }) => `${l.date}|${l.amount}|${(l.reference ?? '').trim()}`;
  const count = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const refs = new Map<string, number>();
  const plains = new Map<string, number>();
  const plainsNoRef = new Map<string, number>();
  for (const b of before) {
    if (b.reference?.trim()) count(refs, withRef(b));
    else count(plainsNoRef, plain(b));
    count(plains, plain(b));
  }
  // take one earlier occurrence of a key, if any is left
  const take = (m: Map<string, number>, k: string) => {
    const n = m.get(k) ?? 0;
    if (n <= 0) return false;
    m.set(k, n - 1);
    return true;
  };
  return lines.filter((l) => {
    if (l.reference?.trim()) {
      const seen = take(refs, withRef(l)) || take(plainsNoRef, plain(l));
      // the earlier line it matched can't be matched again by a line without a reference
      if (seen) take(plains, plain(l));
      return !seen;
    }
    return !take(plains, plain(l));
  });
}

/** Import a statement with a layout (saved on the account for next time). Lines already imported are skipped. */
export function importStatement(input: { account_id: number; data: Buffer; layout: BankCsvLayout; file_name?: string; opening_balance?: number | null; closing_balance?: number | null }) {
  const a = activeAccount(input.account_id);
  if (a.kind !== 'bank') throw new BadRequest(`${a.code} is not a bank account (Book-keeping → Accounts: kind “bank”).`);
  const rows = statementRows(input.data);
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
    const fresh = newLines(a.id, lines);
    // everything was imported before: no empty statement
    if (!fresh.length) return { statement_id: null, lines: 0, already: lines.length, skipped };
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
  const drafts = new Set(all<{ id: number }>("SELECT id FROM bk_journals WHERE status = 'draft' AND id IN (SELECT journal_id FROM bk_statement_lines WHERE statement_id = ?)", id).map((r) => r.id));
  return {
    statement: s,
    lines: lines.map((l) => ({
      ...l, matched: matched.get(l.id) ?? null, suggestions: l.status === 'open' ? suggestions(l, pool) : [],
      draft_id: l.status === 'open' && l.journal_id && drafts.has(l.journal_id) ? l.journal_id : null,
    })),
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
  const n = get<{ number: string }>('SELECT j.number FROM bk_lines l JOIN bk_journals j ON j.id = l.journal_id WHERE l.id = ?', bookLineId)?.number;
  logLine(l, `matched to ${n}`);
}
export function unmatchLine(id: number) {
  const l = lineOf(id);
  run("UPDATE bk_statement_lines SET status = 'open', line_id = NULL WHERE id = ?", id);
  logLine(l, 'unmatched');
}
export function ignoreLine(id: number, ignored: boolean) {
  const l = lineOf(id);
  if (l.status === 'matched') throw new Conflict('Unmatch it first.');
  run('UPDATE bk_statement_lines SET status = ? WHERE id = ?', ignored ? 'ignored' : 'open', id);
  logLine(l, ignored ? 'ignored' : 'no longer ignored');
}
/** Matching is part of the audit trail: each match, unmatch and ignore is logged on its statement. */
const logLine = (l: StatementLine, what: string) =>
  logChange({ entity: 'bk_statements', entity_id: l.statement_id, action: 'update', summary: `Line ${l.date} ${l.description ?? ''} ${(l.amount / 100).toFixed(2)} ${what}` });

/**
 * Tie a draft to a statement line (an entry the books lack, drafted on the Bank screen or by an AI assistant): when
 * the draft is posted, the line is matched to it (repo/bookkeeping.ts).
 */
export function linkDraftToLine(lineId: number, journalId: number) {
  const l = lineOf(lineId);
  if (l.status !== 'open') throw new Conflict('This statement line is already matched or ignored.');
  if (l.journal_id && l.journal_id !== journalId && get("SELECT 1 FROM bk_journals WHERE id = ? AND status = 'draft'", l.journal_id)) {
    throw new Conflict(`This statement line already has a draft (journal ${l.journal_id}): change that draft instead.`);
  }
  run('UPDATE bk_statement_lines SET journal_id = ? WHERE id = ?', journalId, lineId);
  return l;
}
export const statementLine = (id: number) => lineOf(id);

// ---------------------------------------------------------------- PayNow and transfers found at the reconciliation

/** Services that money in on a date could be the offering of: from two weeks before to two days after, nearest first. */
export function servicesNear(lineId: number) {
  const l = lineOf(lineId);
  const day = (n: number) => new Date(Date.parse(`${l.date}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
  return all<{ id: number; date: string; title: string; kind: string; verified: number; offering: number }>(
    `SELECT s.id, s.date, s.title, s.kind, (r.verified_at IS NOT NULL) AS verified, s.offering FROM services s LEFT JOIN service_records r ON r.service_id = s.id
     WHERE s.date >= ? AND s.date <= ? AND IFNULL(s.offering, 1) <> 0 ORDER BY ABS(julianday(s.date) - julianday(?)), s.date DESC LIMIT 12`,
    day(-14), day(2), l.date,
  ).map((x) => ({ id: x.id, date: x.date, title: JSON.parse(x.title || '{}') as Record<string, string>, kind: x.kind, verified: !!x.verified }));
}

/**
 * A gift by PayNow or transfer that the treasurer first sees on the bank statement: added to the service's offerings
 * (allowed after the cash count is verified — only the cash is locked), so the record and the offering reports have
 * it. A verified count then drafts the entry, tied to this line: posting it matches the line (`post` does that now).
 */
export function offeringFromLine(id: number, input: { service_id: number; fund: string; method: OfferingMethod; post: boolean }, who: Who) {
  const l = lineOf(id);
  if (l.amount <= 0) throw new BadRequest('Only money in can be an offering.');
  if (input.method === 'cash') throw new BadRequest('Cash is counted at the service: choose PayNow, transfer, card or cheque.');
  if (!getSettings().offering.funds.includes(input.fund)) throw new BadRequest(`“${input.fund}” is not an offering fund (Settings → Offerings).`);
  return tx(() => {
    // one statement line is one gift: it is added to a service's offerings once, whatever is retried (review F2)
    const prior = get<{ service_id: number }>(
      "SELECT r.service_id FROM service_records r, json_each(r.offerings) o WHERE json_extract(o.value, '$.bank_line_id') = ? LIMIT 1", id,
    );
    if (prior && prior.service_id !== input.service_id) throw new Conflict(`This bank line is already among the offerings of another service (#${prior.service_id}).`);
    if (!prior) {
      if (l.status !== 'open') throw new Conflict('This line is already matched or ignored.');
      const r0 = recordFor(input.service_id);
      saveRecord(input.service_id, { offerings: [...(r0.offerings ?? []), { fund: input.fund, method: input.method, amount: l.amount, bank_line_id: id }] }, who);
      logChange({ entity: 'bk_statements', entity_id: l.statement_id, action: 'update', summary: `Line ${l.date} ${l.description ?? ''} ${(l.amount / 100).toFixed(2)} added to the offerings of service ${input.service_id} (${input.fund}, ${input.method})` });
    }
    const added = !prior;
    const now = lineOf(id);
    if (now.status === 'matched') {
      const jid = get<{ journal_id: number }>('SELECT journal_id FROM bk_lines WHERE id = ?', now.line_id)?.journal_id;
      return { added, journal: jid ? getJournal(jid) : null, matched: true };
    }
    const r = recordFor(input.service_id);
    const draft = get<{ id: number }>("SELECT id FROM bk_journals WHERE service_id = ? AND kind = 'offering' AND status = 'draft' ORDER BY id LIMIT 1", input.service_id);
    // not verified yet: the count drafts it later, and the line is matched then (it will be suggested)
    if (!r.verified_at || !draft) return { added, journal: null, matched: false };
    linkDraftToLine(id, draft.id);
    if (!input.post) return { added, journal: getJournal(draft.id), matched: false };
    const j = getJournal(draft.id);
    const problems = postingProblems(j);
    if (problems.length) throw new BadRequest(problems.join(' '));
    const posted = postJournal(j.id);
    return { added, journal: posted, matched: lineOf(id).status === 'matched' };
  });
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
    const j = saveDraft(l.journal_id && get("SELECT 1 FROM bk_journals WHERE id = ? AND status = 'draft'", l.journal_id) ? l.journal_id : null, {
      date: l.date, kind: 'bank', memo: input.memo?.trim() || l.description || 'Bank', lines: [
        { account_id: l.account_id, fund_id: input.fund_id, ...tags, debit: into ? amt : 0, credit: into ? 0 : amt, memo: l.reference },
        { account_id: input.account_id, fund_id: input.fund_id, ...tags, debit: into ? 0 : amt, credit: into ? amt : 0, memo: l.description },
      ],
    }, 'Entered from a bank statement line');
    run('UPDATE bk_statement_lines SET journal_id = ? WHERE id = ?', j.id, id);
    if (input.post) {
      const problems = postingProblems(j);
      if (problems.length) throw new BadRequest(problems.join(' '));
      // posting matches the line it was drafted for
      return postJournal(j.id);
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
