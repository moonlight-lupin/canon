// Book-keeping (0.17.0): the chart of accounts, funds, projects and ministries, and journals — drafted, posted
// (numbered, then never changed: the database refuses it too) and reversed. Months and years are closed by a date:
// nothing on or before it can be posted. The books start on a date with an opening journal. Amounts are in minor
// units of the church's currency. Reports: repo/bk-reports.ts; offerings: repo/bk-offerings.ts; bank: repo/bk-bank.ts.
import { all, get, run, tx } from '../db.ts';
import { table, BadRequest, Conflict, NotFound, Forbidden } from '../lib/table.ts';
import { currentActor } from '../lib/actor.ts';
import { ENTITY_LABEL, logChange } from './changelog.ts';
import { getSettings, updateSettings } from './settings.ts';
import {
  CHART_TEMPLATE, FUND_TEMPLATE, METHOD_TEMPLATE, financialYear, totals,
  type AccountKind, type AccountType, type BkAccount, type BkFund, type BkJournal, type BkLine, type BkTag, type BookkeepingSettings,
  type FundRestriction, type JournalKind,
} from '../../shared/bookkeeping.ts';
import type { L10n } from '../../shared/types.ts';

export const accounts = table<BkAccount>({
  name: 'bk_accounts', cols: ['code', 'name', 'type', 'kind', 'active', 'description', 'sort', 'bank_csv'],
  json: ['name', 'bank_csv'], bool: ['active'], touch: true, revision: true,
});
export const funds = table<BkFund>({
  name: 'bk_funds', cols: ['code', 'name', 'restriction', 'active', 'description', 'sort'], json: ['name'], bool: ['active'], touch: true, revision: true,
});
export const projects = table<BkTag>({ name: 'bk_projects', cols: ['code', 'name', 'active', 'sort'], json: ['name'], bool: ['active'], touch: true });
export const ministries = table<BkTag>({ name: 'bk_ministries', cols: ['code', 'name', 'active', 'sort'], json: ['name'], bool: ['active'], touch: true });
const journals = table<Omit<BkJournal, 'lines'>>({
  name: 'bk_journals',
  cols: ['number', 'date', 'memo', 'status', 'kind', 'service_id', 'claim_id', 'reverses_id', 'reversed_by_id', 'created_via', 'created_by', 'posted_by', 'posted_at'],
  touch: true, revision: true,
  // logged here with their lines (logJournal), so a draft's history shows every amount changed before it was posted
  log: false,
});

/** A journal as the change log keeps it: its heading and its lines written out ("5500 GEN Dr 1500.00 · note"). */
function journalSnapshot(j: BkJournal) {
  const acc = new Map(all<{ id: number; code: string }>('SELECT id, code FROM bk_accounts').map((a) => [a.id, a.code]));
  const fnd = new Map(all<{ id: number; code: string }>('SELECT id, code FROM bk_funds').map((f) => [f.id, f.code]));
  const prj = new Map(all<{ id: number; code: string }>('SELECT id, code FROM bk_projects').map((f) => [f.id, f.code]));
  const min = new Map(all<{ id: number; code: string }>('SELECT id, code FROM bk_ministries').map((f) => [f.id, f.code]));
  const lines = j.lines.map((l) => [
    acc.get(l.account_id) ?? `#${l.account_id}`, fnd.get(l.fund_id) ?? `#${l.fund_id}`,
    l.debit ? `Dr ${(l.debit / 100).toFixed(2)}` : `Cr ${(l.credit / 100).toFixed(2)}`,
    l.project_id ? `project ${prj.get(l.project_id) ?? l.project_id}` : '', l.ministry_id ? `ministry ${min.get(l.ministry_id) ?? l.ministry_id}` : '',
    l.orig_currency ? `${l.orig_currency} ${((l.orig_amount ?? 0) / 100).toFixed(2)}` : '', l.memo ? `· ${l.memo}` : '',
  ].filter(Boolean).join(' ')).join('\n');
  return { number: j.number, date: j.date, memo: j.memo, status: j.status, kind: j.kind, posted_by: j.posted_by, reversed_by_id: j.reversed_by_id, lines };
}
function logJournal(action: 'create' | 'update' | 'delete', before: BkJournal | null, after: BkJournal | null, summary?: string) {
  const j = (after ?? before)!;
  logChange({
    entity: 'bk_journals', entity_id: j.id, action, summary,
    before: before ? journalSnapshot(before) : null, after: after ? journalSnapshot(after) : null,
    // an offering journal belongs with its service, so the history shows the drafts before it and the count behind it
    parent: j.service_id ? { entity: 'services', id: j.service_id } : null,
  });
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const who = () => currentActor()?.user_name ?? 'Canon';
const via = () => currentActor()?.via ?? 'system';

export const bkSettings = (): BookkeepingSettings => getSettings().bookkeeping;
const saveBk = (patch: Partial<BookkeepingSettings>) => updateSettings({ bookkeeping: { ...bkSettings(), ...patch } });

// ---------------------------------------------------------------- setting up

/** Whether the books have been started (a start date is set). */
export const booksStarted = () => !!bkSettings().start_date;

/**
 * Start the books: the start date and the financial year, and (with `template`) the church chart of accounts,
 * funds, and where offerings go — matching Settings → Offerings' funds by name. Only while nothing is posted.
 */
export function setupBooks(input: { start_date: string; year_end_month: number; template: boolean }) {
  if (!DATE.test(input.start_date)) throw new BadRequest('Choose the date the books start.');
  if (!(input.year_end_month >= 1 && input.year_end_month <= 12)) throw new BadRequest('Choose the last month of the financial year.');
  if (get('SELECT 1 FROM bk_journals WHERE status = ?', 'posted')) throw new Conflict('The books already have posted journals: their start can no longer change.');
  return tx(() => {
    if (input.template && !get('SELECT 1 FROM bk_accounts')) {
      CHART_TEMPLATE.forEach((a, i) => accounts.insert({ code: a.code, name: a.name, type: a.type, kind: a.kind ?? 'other', active: true, sort: i }));
    }
    if (input.template && !get('SELECT 1 FROM bk_funds')) {
      FUND_TEMPLATE.forEach((f, i) => funds.insert({ code: f.code, name: f.name, restriction: f.restriction, active: true, sort: i }));
    }
    const byCode = (code: string) => get<{ id: number }>('SELECT id FROM bk_accounts WHERE code = ?', code)?.id;
    const method_accounts: BookkeepingSettings['method_accounts'] = { ...bkSettings().method_accounts };
    for (const [m, code] of Object.entries(METHOD_TEMPLATE)) if (method_accounts[m] == null && byCode(code)) method_accounts[m] = byCode(code)!;
    const fund_map = { ...bkSettings().fund_map };
    const income = byCode('4000');
    const general = get<{ id: number }>("SELECT id FROM bk_funds WHERE restriction = 'unrestricted' AND active = 1 ORDER BY sort, id")?.id;
    for (const name of getSettings().offering.funds) {
      if (fund_map[name]) continue;
      const t = FUND_TEMPLATE.find((f) => f.offering?.toLowerCase() === name.toLowerCase());
      const fund = (t && get<{ id: number }>('SELECT id FROM bk_funds WHERE code = ?', t.code)?.id) ?? general;
      if (fund && income) fund_map[name] = { fund_id: fund, income_account_id: income };
    }
    saveBk({ start_date: input.start_date, year_end_month: input.year_end_month, method_accounts, fund_map });
    logChange({ entity: 'settings', entity_id: null, action: 'update', summary: `Book-keeping started on ${input.start_date} (financial year ends in month ${input.year_end_month})` });
    return bkSettings();
  });
}

/** Where offerings go (payment method → account; offering fund → fund and income account) and whether drafts are made. */
export function saveOfferingMapping(input: Pick<BookkeepingSettings, 'offering_drafts' | 'method_accounts' | 'fund_map'>) {
  for (const id of Object.values(input.method_accounts)) if (id != null) assetAccount(id);
  for (const m of Object.values(input.fund_map)) {
    activeFund(m.fund_id);
    const a = activeAccount(m.income_account_id);
    if (a.type !== 'income') throw new BadRequest(`${a.code} is not an income account.`);
  }
  saveBk(input);
  return bkSettings();
}

const assetAccount = (id: number) => {
  const a = activeAccount(id);
  if (a.type !== 'asset') throw new BadRequest(`${a.code} is not an asset account (cash or bank).`);
  return a;
};

// ---------------------------------------------------------------- accounts, funds, tags

const CODE = /^[\w.-]{1,20}$/;
function checkCode(code: string, tableName: string, id?: number) {
  if (!CODE.test(code)) throw new BadRequest('A code is 1–20 letters, digits, dots or dashes, e.g. 4010.');
  if (get(`SELECT 1 FROM ${tableName} WHERE code = ? COLLATE NOCASE AND id != ?`, code, id ?? 0)) throw new Conflict(`The code ${code} is already used.`);
}
const used = (col: string, id: number) => !!get(`SELECT 1 FROM bk_lines WHERE ${col} = ?`, id);

export function listAccounts(): (BkAccount & { used: boolean })[] {
  return accounts.list('', [], "CASE type WHEN 'asset' THEN 1 WHEN 'liability' THEN 2 WHEN 'equity' THEN 3 WHEN 'income' THEN 4 ELSE 5 END, code")
    .map((a) => ({ ...a, used: used('account_id', a.id) }));
}
export function saveAccount(id: number | null, input: { code: string; name: L10n; type: AccountType; kind?: AccountKind; active?: boolean; description?: string | null }) {
  checkCode(input.code, 'bk_accounts', id ?? undefined);
  if (id) {
    const cur = accounts.get(id);
    if (cur.type !== input.type && used('account_id', id)) throw new Conflict('This account is already used: its type can’t change. Retire it and add a new one.');
    return accounts.update(id, { ...input });
  }
  return accounts.insert({ ...input, kind: input.kind ?? 'other', active: input.active ?? true, sort: 0 });
}
export function deleteAccount(id: number) {
  if (used('account_id', id)) throw new Conflict('This account has entries: retire it instead (untick Active).');
  accounts.remove(id);
}
export function activeAccount(id: number): BkAccount {
  const a = accounts.find(id);
  if (!a) throw new BadRequest(`Account ${id} doesn’t exist.`);
  if (!a.active) throw new BadRequest(`Account ${a.code} is retired.`);
  return a;
}

export const listFunds = () => funds.list('', [], 'sort, code').map((f) => ({ ...f, used: used('fund_id', f.id) }));
export function saveFund(id: number | null, input: { code: string; name: L10n; restriction: FundRestriction; active?: boolean; description?: string | null }) {
  checkCode(input.code, 'bk_funds', id ?? undefined);
  return id ? funds.update(id, input) : funds.insert({ ...input, active: input.active ?? true, sort: 0 });
}
export function deleteFund(id: number) {
  if (used('fund_id', id)) throw new Conflict('This fund has entries: retire it instead (untick Active).');
  funds.remove(id);
}
export function activeFund(id: number): BkFund {
  const f = funds.find(id);
  if (!f) throw new BadRequest(`Fund ${id} doesn’t exist.`);
  if (!f.active) throw new BadRequest(`Fund ${f.code} is retired.`);
  return f;
}

export type TagKind = 'projects' | 'ministries';
const tagTable = (k: TagKind) => (k === 'projects' ? projects : ministries);
export const listTags = (k: TagKind) => tagTable(k).list('', [], 'sort, code').map((t) => ({ ...t, used: used(k === 'projects' ? 'project_id' : 'ministry_id', t.id) }));
export function saveTag(k: TagKind, id: number | null, input: { code: string; name: L10n; active?: boolean }) {
  checkCode(input.code, `bk_${k}`, id ?? undefined);
  return id ? tagTable(k).update(id, input) : tagTable(k).insert({ ...input, active: input.active ?? true, sort: 0 });
}
export function deleteTag(k: TagKind, id: number) {
  if (used(k === 'projects' ? 'project_id' : 'ministry_id', id)) throw new Conflict('It has entries: retire it instead (untick Active).');
  tagTable(k).remove(id);
}

// ---------------------------------------------------------------- journals

export interface JournalInput {
  date: string;
  memo?: string | null;
  kind?: JournalKind;
  service_id?: number | null;
  /** an expense claim's journal (approval or payment) */
  claim_id?: number | null;
  lines: BkLine[];
}

const linesOf = (id: number): BkLine[] =>
  all<BkLine>('SELECT id, account_id, fund_id, project_id, ministry_id, congregation_id, debit, credit, memo, orig_currency, orig_amount, rate FROM bk_lines WHERE journal_id = ? ORDER BY position, id', id);

export function getJournal(id: number): BkJournal {
  const j = journals.get(id);
  return { ...j, lines: linesOf(id) } as BkJournal;
}

export interface JournalQuery { from?: string; to?: string; status?: 'draft' | 'posted'; kind?: JournalKind; account_id?: number; fund_id?: number; q?: string; limit?: number; offset?: number }

/** Journals, newest first, with their totals (and lines, for the list). */
export function listJournals(q: JournalQuery = {}) {
  const where: string[] = [];
  const p: (string | number)[] = [];
  if (q.from) { where.push('j.date >= ?'); p.push(q.from); }
  if (q.to) { where.push('j.date <= ?'); p.push(q.to); }
  if (q.status) { where.push('j.status = ?'); p.push(q.status); }
  if (q.kind) { where.push('j.kind = ?'); p.push(q.kind); }
  if (q.account_id) { where.push('EXISTS (SELECT 1 FROM bk_lines l WHERE l.journal_id = j.id AND l.account_id = ?)'); p.push(q.account_id); }
  if (q.fund_id) { where.push('EXISTS (SELECT 1 FROM bk_lines l WHERE l.journal_id = j.id AND l.fund_id = ?)'); p.push(q.fund_id); }
  if (q.q?.trim()) { where.push("(j.memo LIKE ? OR j.number LIKE ? OR EXISTS (SELECT 1 FROM bk_lines l WHERE l.journal_id = j.id AND l.memo LIKE ?))"); const s = `%${q.q.trim()}%`; p.push(s, s, s); }
  const sql = `SELECT j.*, (SELECT COALESCE(SUM(debit),0) FROM bk_lines WHERE journal_id = j.id) AS total_debit,
    (SELECT COALESCE(SUM(credit),0) FROM bk_lines WHERE journal_id = j.id) AS total_credit
    FROM bk_journals j ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY j.status = 'posted', j.date DESC, j.id DESC LIMIT ? OFFSET ?`;
  const rows = all<Omit<BkJournal, 'lines'> & { total_debit: number; total_credit: number }>(sql, ...p, Math.min(q.limit ?? 200, 1000), q.offset ?? 0);
  return rows.map((r) => ({ ...r, lines: linesOf(r.id) }));
}

function cleanLines(lines: BkLine[]): BkLine[] {
  if (!Array.isArray(lines)) throw new BadRequest('A journal needs lines.');
  return lines.map((l, i) => {
    const debit = Math.round(Number(l.debit) || 0);
    const credit = Math.round(Number(l.credit) || 0);
    if (debit < 0 || credit < 0) throw new BadRequest(`Line ${i + 1}: amounts can’t be negative (use the other column).`);
    if (debit > 0 && credit > 0) throw new BadRequest(`Line ${i + 1}: a line is either a debit or a credit, not both.`);
    if (!l.account_id) throw new BadRequest(`Line ${i + 1}: choose an account.`);
    if (!l.fund_id) throw new BadRequest(`Line ${i + 1}: choose a fund.`);
    return {
      account_id: Number(l.account_id), fund_id: Number(l.fund_id), project_id: l.project_id ?? null, ministry_id: l.ministry_id ?? null,
      congregation_id: l.congregation_id ?? null, debit, credit, memo: l.memo?.trim() || null,
      orig_currency: l.orig_currency?.trim().toUpperCase() || null, orig_amount: l.orig_amount ?? null, rate: l.rate ?? null,
    };
  });
}

function writeLines(journalId: number, lines: BkLine[]) {
  run('DELETE FROM bk_lines WHERE journal_id = ?', journalId);
  const ins = `INSERT INTO bk_lines (journal_id, position, account_id, fund_id, project_id, ministry_id, congregation_id, debit, credit, memo, orig_currency, orig_amount, rate)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`;
  lines.forEach((l, i) => run(ins, journalId, i, l.account_id, l.fund_id, l.project_id ?? null, l.ministry_id ?? null, l.congregation_id ?? null, l.debit, l.credit, l.memo ?? null, l.orig_currency ?? null, l.orig_amount ?? null, l.rate ?? null));
}

/** Kinds Canon makes itself, linked to what they came from (the journal reversed, the service, the claim). */
const LINKED_KINDS: JournalKind[] = ['reversal', 'offering', 'claim'];

/** Save a draft (new, or an existing draft). Drafts may be incomplete; posting checks everything. `note` explains it in the log. */
export function saveDraft(id: number | null, input: JournalInput, note?: string): BkJournal {
  if (!DATE.test(input.date ?? '')) throw new BadRequest('Choose the journal’s date.');
  const lines = cleanLines(input.lines);
  for (const l of lines) {
    if (!accounts.find(l.account_id)) throw new BadRequest(`Account ${l.account_id} doesn’t exist.`);
    if (!funds.find(l.fund_id)) throw new BadRequest(`Fund ${l.fund_id} doesn’t exist.`);
  }
  return tx(() => {
    let jid = id;
    const before = jid ? getJournal(jid) : null;
    if (jid) {
      const cur = journals.get(jid);
      if (cur.status === 'posted') throw new Conflict('A posted journal can’t be changed: reverse it instead.');
      // a reversal, an offering's or a claim's entry keeps its kind (its links depend on it); a person's own draft
      // may change between manual, opening, transfer and bank, never into one of those
      const kind = LINKED_KINDS.includes(cur.kind) ? cur.kind : input.kind && !LINKED_KINDS.includes(input.kind) ? input.kind : cur.kind;
      journals.update(jid, { date: input.date, memo: input.memo?.trim() || null, kind });
    } else {
      jid = journals.insert({
        date: input.date, memo: input.memo?.trim() || null, status: 'draft', kind: input.kind ?? 'manual', service_id: input.service_id ?? null, claim_id: input.claim_id ?? null,
        created_via: via(), created_by: who(),
      }).id;
    }
    writeLines(jid, lines);
    const after = getJournal(jid);
    logJournal(before ? 'update' : 'create', before, after, note);
    return after;
  });
}

export function deleteDraft(id: number, note?: string) {
  const j = getJournal(id);
  if (j.status === 'posted') throw new Conflict('A posted journal can’t be deleted: reverse it instead.');
  tx(() => {
    // a claim's payment, deleted as a draft: the claim is not paid after all (approved again, to pay later)
    const paid = get<{ id: number; number: string | null }>("SELECT id, number FROM bk_claims WHERE payment_journal_id = ? AND status = 'paid'", id);
    if (paid) {
      run(`UPDATE bk_claims SET status = 'approved', paid_on = NULL, paid_by = NULL, payment_ref = NULL, payment_journal_id = NULL, approver_paid = 0, updated_at = datetime('now'), revision = revision + 1 WHERE id = ?`, paid.id);
      logChange({ entity: 'bk_claims', entity_id: paid.id, action: 'update', summary: `Claim ${paid.number ?? paid.id}: its payment draft was deleted, so it is approved and not paid` });
    }
    journals.remove(id);
    logJournal('delete', j, null, note);
  });
}

/** What stops a journal from being posted (empty = it can be). */
export function postingProblems(j: Pick<BkJournal, 'date' | 'kind'> & { lines: BkLine[] }): string[] {
  const s = bkSettings();
  const out: string[] = [];
  if (!s.start_date) out.push('Start the books first (Book-keeping → Setup).');
  else if (j.date < s.start_date) out.push(`The books start on ${s.start_date}: a journal can’t be dated before it.`);
  if (s.closed_through && j.date <= s.closed_through) out.push(`The books are closed up to ${s.closed_through}: date it after that, or reopen the period.`);
  if (j.lines.length < 2) out.push('A journal needs at least two lines.');
  if (j.lines.some((l) => !l.debit && !l.credit)) out.push('Every line needs an amount.');
  const t = totals(j.lines);
  if (t.debit !== t.credit) out.push(`Debits (${(t.debit / 100).toFixed(2)}) and credits (${(t.credit / 100).toFixed(2)}) must be equal.`);
  for (const l of j.lines) {
    const a = accounts.find(l.account_id);
    if (!a) out.push(`Account ${l.account_id} doesn’t exist.`);
    else if (!a.active) out.push(`Account ${a.code} is retired.`);
    const f = funds.find(l.fund_id);
    if (!f) out.push(`Fund ${l.fund_id} doesn’t exist.`);
    else if (!f.active) out.push(`Fund ${f.code} is retired.`);
  }
  if (j.kind === 'opening' && s.start_date && j.date !== s.start_date) out.push(`Opening balances are dated the day the books start (${s.start_date}).`);
  return [...new Set(out)];
}

/** The next number in a financial year: 2026-0001, 2026-0002 … */
function nextNumber(date: string): string {
  const fy = financialYear(date, bkSettings().year_end_month);
  // the highest number as a number ("2026-10000" comes after "2026-9999", which a text sort gets wrong)
  const last = get<{ n: number | null }>('SELECT MAX(CAST(substr(number, ?) AS INTEGER)) AS n FROM bk_journals WHERE number LIKE ?', String(fy).length + 2, `${fy}-%`)?.n;
  const seq = (last ?? 0) + 1;
  return `${fy}-${String(seq).padStart(4, '0')}`;
}

/** Post a draft: checked, numbered, and from then on never changed. Agents never post (their drafts wait for a person). */
export function postJournal(id: number): BkJournal {
  if (currentActor()?.via === 'mcp') throw new Forbidden('AI assistants prepare drafts; a person posts them.');
  return tx(() => {
    const j = getJournal(id);
    if (j.status === 'posted') throw new Conflict(`Journal ${j.number} is already posted.`);
    const problems = postingProblems(j);
    // a reversal: the journal it reverses must still be posted and not reversed already
    const original = j.reverses_id ? getJournal(j.reverses_id) : null;
    if (original && original.reversed_by_id) problems.push(`Journal ${original.number} is already reversed.`);
    if (problems.length) throw new BadRequest(problems.join(' '));
    journals.update(id, { status: 'posted', number: nextNumber(j.date), posted_by: who(), posted_at: new Date().toISOString() });
    const posted = getJournal(id);
    logJournal('update', j, posted, `Posted as ${posted.number}`);
    if (original) {
      // only now are the two linked: together they cancel out
      journals.update(original.id, { reversed_by_id: id });
      logJournal('update', original, getJournal(original.id), `Reversed by ${posted.number}`);
    }
    matchDraftedLines(posted);
    return posted;
  });
}

/**
 * A draft made for a bank statement line (on the Bank screen, or by an AI assistant) matches that line once posted:
 * the journal's line on the statement's account for the same amount.
 */
function matchDraftedLines(j: BkJournal) {
  const open = all<{ id: number; statement_id: number; account_id: number; amount: number; date: string; description: string | null }>(
    "SELECT sl.id, sl.statement_id, s.account_id, sl.amount, sl.date, sl.description FROM bk_statement_lines sl JOIN bk_statements s ON s.id = sl.statement_id WHERE sl.journal_id = ? AND sl.status = 'open'", j.id,
  );
  for (const sl of open) {
    const book = all<{ id: number; account_id: number; debit: number; credit: number }>('SELECT id, account_id, debit, credit FROM bk_lines WHERE journal_id = ? ORDER BY position', j.id)
      .find((l) => l.account_id === sl.account_id && l.debit - l.credit === sl.amount && !get('SELECT 1 FROM bk_statement_lines WHERE line_id = ?', l.id) && !get('SELECT 1 FROM bk_match_book_lines WHERE line_id = ?', l.id));
    if (!book) continue;
    run("UPDATE bk_statement_lines SET status = 'matched', line_id = ? WHERE id = ?", book.id, sl.id);
    logChange({ entity: 'bk_statements', entity_id: sl.statement_id, action: 'update', summary: `Line ${sl.date} ${sl.description ?? ''} ${(sl.amount / 100).toFixed(2)} matched to ${j.number}` });
  }
}

/** A draft that reverses this journal (one at a time), if there is one. */
export const reversalDraftOf = (id: number) => get<{ id: number }>("SELECT id FROM bk_journals WHERE reverses_id = ? AND status = 'draft' ORDER BY id LIMIT 1", id)?.id ?? null;

/**
 * Draft the reversal of a posted journal: every line the other way round, on `date` (default today). The posted
 * journal stays as it is; the draft is reviewed and posted like any other, and only then are the two linked (and
 * cancel out). Deleting the draft changes nothing.
 */
export function reverseJournal(id: number, date?: string, memo?: string): BkJournal {
  return tx(() => {
    const j = getJournal(id);
    if (j.status !== 'posted') throw new BadRequest('Only a posted journal is reversed (a draft is simply changed or deleted).');
    if (j.reversed_by_id) throw new Conflict(`Journal ${j.number} is already reversed.`);
    if (j.kind === 'reversal') throw new BadRequest('This journal is itself a reversal: post a new journal instead.');
    const waiting = reversalDraftOf(id);
    if (waiting) throw new Conflict(`A draft reversing ${j.number} is waiting already (journal ${waiting}): post or delete it.`);
    const on = date && DATE.test(date) ? date : new Date().toISOString().slice(0, 10);
    const lines = j.lines.map((l) => ({ ...l, id: undefined, debit: l.credit, credit: l.debit }));
    const r = journals.insert({
      date: on, memo: memo?.trim() || `Reverses ${j.number}${j.memo ? ` (${j.memo})` : ''}`, status: 'draft', kind: 'reversal', reverses_id: id,
      service_id: j.service_id, claim_id: j.claim_id ?? null, created_via: via(), created_by: who(),
    });
    writeLines(r.id, lines);
    const rev = getJournal(r.id);
    logJournal('create', null, rev, `Drafted to reverse ${j.number}`);
    return rev;
  });
}

// ---------------------------------------------------------------- closing periods

/** Close the books up to a date (a month's or a year's end): nothing on or before it can be posted. */
export function closeThrough(date: string) {
  if (!DATE.test(date)) throw new BadRequest('Choose the date to close up to.');
  const s = bkSettings();
  if (s.closed_through && date <= s.closed_through) throw new BadRequest(`The books are already closed up to ${s.closed_through}.`);
  const drafts = get<{ n: number }>("SELECT COUNT(*) n FROM bk_journals WHERE status = 'draft' AND date <= ?", date)!.n;
  if (drafts) throw new Conflict(`${drafts} draft journal(s) are dated on or before ${date}: post, redate or delete them first.`);
  saveBk({ closed_through: date });
  logChange({ entity: 'settings', entity_id: null, action: 'update', summary: `Books closed up to ${date}` });
  return bkSettings();
}

/** Reopen closed periods back to a date (administrators only; recorded in the change log). */
export function reopenThrough(date: string | null, isAdmin: boolean) {
  if (!isAdmin) throw new Forbidden('Only an administrator can reopen a closed period.');
  const s = bkSettings();
  if (date !== null && (!DATE.test(date) || (s.closed_through && date >= s.closed_through))) throw new BadRequest('Choose a date before the current close.');
  saveBk({ closed_through: date });
  logChange({ entity: 'settings', entity_id: null, action: 'update', summary: `Books reopened: closed up to ${date ?? 'nothing'} (was ${s.closed_through})` });
  return bkSettings();
}

/** The opening-balances journal (kind 'opening'), if there is one. */
/** Money fields of a service record shown in a journal's history (not visitors' details or notes). */
const COUNT_FIELDS = new Set(['offerings', 'cash', 'foreign_cash', 'currency', 'counters', 'verified_at', 'verified_by', 'signatures', 'counted_on']);

/**
 * A journal's history from the change log, newest first: every change to it (lines included) and, for an offering
 * journal, its service's earlier drafts and the cash count's changes (money fields only). Shown to anyone who can
 * read the books.
 */
export function journalHistory(id: number) {
  const j = journals.get(id);
  const rec = j.service_id ? get<{ id: number }>('SELECT id FROM service_records WHERE service_id = ?', j.service_id)?.id ?? null : null;
  const rows = all<{ id: number; at: string; user_name: string | null; via: string; client: string | null; entity: string; entity_id: number | null; action: string; name: string; summary: string | null; changes: string }>(
    `SELECT id, at, user_name, via, client, entity, entity_id, action, name, summary, changes FROM change_log
     WHERE (entity = 'bk_journals' AND entity_id IN (?, ?, ?))
        OR (? IS NOT NULL AND entity = 'bk_journals' AND parent_entity = 'services' AND parent_id = ?)
        OR (? IS NOT NULL AND entity = 'service_records' AND entity_id = ?)
     ORDER BY id DESC LIMIT 300`,
    id, j.reverses_id ?? -1, j.reversed_by_id ?? -1, j.service_id, j.service_id, rec, rec,
  );
  return {
    rows: rows.map((r) => {
      const changes = JSON.parse(r.changes || '{}') as Record<string, [unknown, unknown]>;
      if (r.entity === 'service_records') for (const k of Object.keys(changes)) if (!COUNT_FIELDS.has(k)) delete changes[k];
      return { ...r, changes, this_journal: r.entity === 'bk_journals' && r.entity_id === id };
    }).filter((r) => r.entity !== 'service_records' || Object.keys(r.changes).length || r.summary),
    entities: { bk_journals: ENTITY_LABEL.bk_journals, service_records: ENTITY_LABEL.service_records },
  };
}

export const openingJournal = () => {
  const r = get<{ id: number }>("SELECT id FROM bk_journals WHERE kind = 'opening' AND reversed_by_id IS NULL ORDER BY status = 'posted' DESC, id LIMIT 1");
  return r ? getJournal(r.id) : null;
};

/** For tests and the setup screen: does any line use the account / fund. */
export const isUsed = { account: (id: number) => used('account_id', id), fund: (id: number) => used('fund_id', id) };

export { NotFound };
