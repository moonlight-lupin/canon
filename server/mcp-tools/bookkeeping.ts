// AI-assistant tools for book-keeping (0.17.0, module "bookkeeping"). Reading: the chart of accounts and funds with
// balances, journals, the reports, and imported bank statements with the lines still to match. Writing is DRAFT
// journals only (e.g. for a statement line the books lack, or receipts the user pasted): a person reviews and posts
// them in Canon; a draft made for a statement line is matched to it when posted. Importing statements and matching
// stay with people. Agents may draft the reversal of a posted journal; they never post, nor change a posted journal
// (repo/bookkeeping.ts refuses it for MCP whatever the tool). Amounts are in cents (minor units).
import { z } from 'zod';
import { all, get } from '../db.ts';
import * as B from '../repo/bookkeeping.ts';
import * as R from '../repo/bk-reports.ts';
import * as Bank from '../repo/bk-bank.ts';
import { getSettings } from '../repo/settings.ts';
import { DateStr, Id, RO, WRITE, today, viewOptions, type ToolDef } from './common.ts';

class InputError extends Error {
  status = 400;
}
const codeOf = (tableName: string, code: string | undefined | null, what: string): number | null => {
  if (!code) return null;
  const r = get<{ id: number }>(`SELECT id FROM ${tableName} WHERE code = ? COLLATE NOCASE`, code.trim());
  if (!r) throw new InputError(`No ${what} with the code "${code}" (see canon_books).`);
  return r.id;
};
const accountsByCode = () => new Map(all<{ id: number; code: string }>('SELECT id, code FROM bk_accounts').map((a) => [a.id, a.code]));
const fundsByCode = () => new Map(all<{ id: number; code: string }>('SELECT id, code FROM bk_funds').map((f) => [f.id, f.code]));

/** A journal as agents read it: codes instead of ids. */
function journalOut(j: ReturnType<typeof B.getJournal>) {
  const a = accountsByCode();
  const f = fundsByCode();
  return {
    id: j.id, number: j.number, date: j.date, status: j.status, kind: j.kind, memo: j.memo, service_id: j.service_id ?? undefined,
    reverses_id: j.reverses_id ?? undefined, reversed_by_id: j.reversed_by_id ?? undefined, created_via: j.created_via,
    lines: j.lines.map((l) => ({ account: a.get(l.account_id), fund: f.get(l.fund_id), debit_cents: l.debit, credit_cents: l.credit, memo: l.memo ?? undefined, ...(l.orig_currency ? { orig_currency: l.orig_currency, orig_amount_cents: l.orig_amount } : {}) })),
  };
}

const ReportName = z.enum(['trial_balance', 'income_expenditure', 'balance_sheet', 'fund_movements', 'by_project', 'by_ministry', 'by_congregation', 'ledger']);

const BooksView = z.enum(['overview', 'report', 'journals', 'statements']);

export const BOOKKEEPING_TOOLS: ToolDef[] = [
  {
    name: 'canon_books', module: 'bookkeeping', access: 'read', title: 'The books', annotations: RO,
    description: 'The church’s books, by view (amounts in cents of the church currency). overview (default): the start date, financial year and the date the books are closed up to; the chart of accounts (code, name, type asset | liability | equity | income | expense, kind, active) with each account’s balance on as_of (default today); funds (code, restriction unrestricted | designated | restricted | endowment) with their balances; projects and ministries; drafts waiting to be posted. Codes are what canon_draft_journal takes. report (name it in report): trial_balance and balance_sheet (as_of), income_expenditure (from–to, by fund; optional fund / project / ministry code to filter), fund_movements (from–to: opening, income, expenditure, transfers, closing per fund), by_project / by_ministry / by_congregation (from–to), ledger (account code, from–to: each line with a running balance); earlier years’ surplus is part of each fund’s balance. journals: newest first, lines with account and fund codes; filter by from / to dates, status draft | posted, account or fund code, words in the narration (q), limit; with id, one journal with what stops a draft from being posted. statements: bank statements imported in Canon (Book-keeping → Bank); without id the statements (bank account code, period, lines, how many are still to match, reconciled or not, closing balance); with id its lines (money out negative; open_only: false for all) — status open | matched | ignored, the journal a matched line is matched to, a draft already waiting for an open line (draft_journal_id), and suggestions (posted entries for the same amount within a week) — and the reconciliation (book balance, not yet on a statement, what the bank should show, the statement balance, the difference). For an open line the books lack (a bank charge, interest, a direct debit), draft its journal with canon_draft_journal and statement_line: posting it matches the line. Matching and importing are done by a person in Canon. Examples: {"as_of":"2026-09-30"}, {"view":"report","report":"income_expenditure","from":"2026-01-01","to":"2026-09-30"}, {"view":"journals","status":"draft"}, {"view":"statements","id":3}.',
    input: {
      view: BooksView.optional(), report: ReportName.optional(), id: Id.optional(), as_of: DateStr.optional(), from: DateStr.optional(), to: DateStr.optional(),
      account: z.string().max(20).optional(), fund: z.string().max(20).optional(), project: z.string().max(20).optional(), ministry: z.string().max(20).optional(),
      status: z.enum(['draft', 'posted']).optional(), q: z.string().max(200).optional(), limit: z.number().int().min(1).max(200).optional(), open_only: z.boolean().optional(),
    },
    handler: (a) => {
      const view: z.infer<typeof BooksView> = a.view ?? (a.report ? 'report' : 'overview');
      viewOptions(a, 'view', view, {
        overview: ['as_of'],
        report: ['report', 'as_of', 'from', 'to', 'account', 'fund', 'project', 'ministry'],
        journals: ['id', 'from', 'to', 'status', 'account', 'fund', 'q', 'limit'],
        statements: ['id', 'account', 'open_only'],
      });
      switch (view) {
        case 'overview': {
          const s = B.bkSettings();
          const asOf = a.as_of ?? today();
          const tb = s.start_date ? R.trialBalance(asOf) : null;
          const bal = new Map((tb?.rows ?? []).map((r) => [r.account_id, r.debit - r.credit]));
          const fb = s.start_date ? R.fundBalances(asOf) : new Map<number, number>();
          return {
            amounts_in: 'cents', currency: getSettings().offering.currency,
            started: !!s.start_date, start_date: s.start_date, year_end_month: s.year_end_month, closed_through: s.closed_through,
            accounts: B.listAccounts().map((x) => ({ code: x.code, name: x.name, type: x.type, kind: x.kind, active: x.active, balance_cents_debit_positive: bal.get(x.id) ?? 0 })),
            funds: B.listFunds().map((f) => ({ code: f.code, name: f.name, restriction: f.restriction, active: f.active, balance_cents: fb.get(f.id) ?? 0 })),
            projects: B.listTags('projects').map((t) => ({ code: t.code, name: t.name, active: t.active })),
            ministries: B.listTags('ministries').map((t) => ({ code: t.code, name: t.name, active: t.active })),
            drafts_waiting: get<{ n: number }>("SELECT COUNT(*) n FROM bk_journals WHERE status = 'draft'")!.n,
          };
        }
        case 'report': {
          if (!a.report) throw new InputError('Name the report: report (see the description).');
          const to = a.to ?? today();
          const from = a.from ?? `${to.slice(0, 4)}-01-01`;
          const f: R.Filter = { fund_id: codeOf('bk_funds', a.fund, 'fund') ?? undefined, project_id: codeOf('bk_projects', a.project, 'project') ?? undefined, ministry_id: codeOf('bk_ministries', a.ministry, 'ministry') ?? undefined };
          const out = (() => {
            switch (a.report as z.infer<typeof ReportName>) {
              case 'trial_balance': return R.trialBalance(a.as_of ?? to);
              case 'balance_sheet': return R.balanceSheet(a.as_of ?? to);
              case 'income_expenditure': return R.incomeExpenditure(from, to, f);
              case 'fund_movements': return R.fundMovements(from, to);
              case 'by_project': return R.byDimension('project', from, to);
              case 'by_ministry': return R.byDimension('ministry', from, to);
              case 'by_congregation': return R.byDimension('congregation', from, to);
              case 'ledger': {
                const id = codeOf('bk_accounts', a.account, 'account');
                if (!id) throw new InputError('The ledger needs an account code.');
                return R.ledger(id, from, to, f);
              }
            }
          })();
          return { amounts_in: 'cents', ...out };
        }
        case 'journals': {
          if (a.id) {
            const j = B.getJournal(a.id);
            return { amounts_in: 'cents', ...journalOut(j), problems: j.status === 'draft' ? B.postingProblems(j) : [] };
          }
          const rows = B.listJournals({ from: a.from, to: a.to, status: a.status, account_id: codeOf('bk_accounts', a.account, 'account') ?? undefined, fund_id: codeOf('bk_funds', a.fund, 'fund') ?? undefined, q: a.q, limit: a.limit ?? 50 });
          return { amounts_in: 'cents', journals: rows.map((j) => journalOut(j as ReturnType<typeof B.getJournal>)) };
        }
        case 'statements': {
          if (!a.id) {
            const accountId = codeOf('bk_accounts', a.account, 'account') ?? undefined;
            return { amounts_in: 'cents', statements: (Bank.listStatements(accountId) as Record<string, unknown>[]).map((x) => ({
              id: x.id, account: x.account_code, starts_on: x.starts_on, ends_on: x.ends_on, lines: x.lines, to_match: x.open,
              reconciled: !!x.done_at, closing_balance_cents: x.closing_balance,
            })) };
          }
          const openOnly = a.open_only ?? true;
          const st = Bank.getStatement(a.id);
          const code = new Map(all<{ id: number; code: string }>('SELECT id, code FROM bk_accounts').map((x) => [x.id, x.code]));
          return {
            amounts_in: 'cents',
            statement: { id: st.statement.id, account: code.get(st.statement.account_id), starts_on: st.statement.starts_on, ends_on: st.statement.ends_on, reconciled: !!st.statement.done_at },
            lines: st.lines.filter((l) => !openOnly || l.status === 'open').map((l) => ({
              id: l.id, date: l.date, description: l.description, reference: l.reference ?? undefined, amount_cents: l.amount, status: l.status,
              matched_to: l.matched?.number ?? (l.group ? l.group.book.map((b) => b.number).join(', ') : undefined), draft_journal_id: l.draft_id ?? undefined,
              group_suggestions: l.group_suggestions?.length ? l.group_suggestions.map((g) => ({ with_lines: g.statement_line_ids, journals: g.book.map((b) => b.number) })) : undefined,
              suggestions: l.suggestions.length ? l.suggestions.map((x) => ({ journal: x.number, date: x.date, memo: x.memo ?? x.jmemo })) : undefined,
            })),
            reconciliation: {
              book_balance_cents: st.reconciliation.book_balance, not_yet_on_a_statement_cents: st.reconciliation.uncleared_total,
              bank_should_show_cents: st.reconciliation.expected_bank_balance, statement_balance_cents: st.reconciliation.statement_balance, difference_cents: st.reconciliation.difference,
            },
          };
        }
      }
    },
  },
  {
    name: 'canon_draft_journal', module: 'bookkeeping', access: 'write', title: 'Draft a journal (a person posts it)', annotations: { ...WRITE, idempotentHint: false },
    description: 'Prepare a DRAFT journal for the treasurer to review and post in Canon — e.g. from a bank statement, receipts or a payroll summary the user gave you. You can never post one, nor change a posted journal. Each line: account code, fund code (every line needs a fund), optional project / ministry codes, debit_cents OR credit_cents (whole cents, one per line), memo. Debits must equal credits for it to be postable; the reply lists anything still stopping it. With id: replace an existing DRAFT’s date, memo and lines. With reverses (a posted journal’s number, e.g. "2026-0042", from canon_books {"view":"journals"}) and no lines: a draft that reverses it, every line the other way round, on date (default today), memo saying why; the posted journal stays as it is, and when the treasurer posts the draft the two are linked and cancel out (deleting the draft changes nothing). One reversing draft at a time; a journal already reversed, or itself a reversal, can’t be. To correct a mistake, draft the reversal, then draft the right journal. With statement_line (from canon_books {"view":"statements"}): the draft is for that bank statement line — include a line on the statement’s bank account for its amount (money in = debit, money out = credit); when the treasurer posts it, the statement line is matched to it. Check canon_books for the codes first, and confirm with the user before drafting. Example: {"date":"2026-10-01","memo":"October rent","lines":[{"account":"5500","fund":"GEN","debit_cents":150000},{"account":"1100","fund":"GEN","credit_cents":150000}]}, {"reverses":"2026-0042","memo":"Rent booked to the wrong fund"}.',
    input: {
      id: Id.optional(), date: DateStr.optional().describe('required unless reverses'), memo: z.string().max(1000).optional(), statement_line: Id.optional(),
      reverses: z.string().min(1).max(20).optional().describe('the number of a posted journal to reverse (no lines)'),
      lines: z.array(z.object({
        account: z.string().max(20), fund: z.string().max(20), project: z.string().max(20).optional(), ministry: z.string().max(20).optional(),
        debit_cents: z.number().int().min(0).optional(), credit_cents: z.number().int().min(0).optional(), memo: z.string().max(500).optional(),
      })).min(1).max(200).optional().describe('required unless reverses'),
    },
    handler: (a) => {
      if (a.reverses) {
        if (a.id || a.lines || a.statement_line) throw new InputError('reverses drafts its own lines: give only date and memo with it.');
        const ref = String(a.reverses).trim();
        const row = get<{ id: number }>('SELECT id FROM bk_journals WHERE number = ?', ref) ?? (/^\d+$/.test(ref) ? get<{ id: number }>('SELECT id FROM bk_journals WHERE id = ?', Number(ref)) : undefined);
        if (!row) throw new InputError(`No posted journal numbered "${ref}" (see canon_books {"view":"journals"}).`);
        const j = B.reverseJournal(row.id, a.date, a.memo ? `Reverses ${B.getJournal(row.id).number}: ${a.memo}` : undefined);
        return { amounts_in: 'cents', ...journalOut(j), reverses: B.getJournal(row.id).number, problems: B.postingProblems(j), note: 'A draft: the treasurer reviews and posts it in Canon (Book-keeping → Journals); only then is the journal reversed.' };
      }
      if (!a.date || !a.lines) throw new InputError('A journal needs date and lines (or reverses, to draft the reversal of a posted one).');
      if (!B.bkSettings().start_date) throw new InputError('The books have not been started yet (Book-keeping → Setup in Canon).');
      const lines = (a.lines as { account: string; fund: string; project?: string; ministry?: string; debit_cents?: number; credit_cents?: number; memo?: string }[]).map((l, i) => {
        if ((l.debit_cents ?? 0) > 0 && (l.credit_cents ?? 0) > 0) throw new InputError(`Line ${i + 1}: give debit_cents or credit_cents, not both.`);
        return {
          account_id: codeOf('bk_accounts', l.account, 'account')!, fund_id: codeOf('bk_funds', l.fund, 'fund')!,
          project_id: codeOf('bk_projects', l.project, 'project'), ministry_id: codeOf('bk_ministries', l.ministry, 'ministry'),
          debit: l.debit_cents ?? 0, credit: l.credit_cents ?? 0, memo: l.memo ?? null,
        };
      });
      if (a.id && B.getJournal(a.id).status !== 'draft') throw new InputError('That journal is posted: it can’t be changed (the treasurer can reverse it in Canon).');
      const sl = a.statement_line ? Bank.statementLine(a.statement_line) : null;
      if (sl && sl.status !== 'open') throw new InputError('That statement line is already matched or ignored.');
      const j = B.saveDraft(a.id ?? null, { date: a.date, memo: a.memo ?? null, lines, ...(sl ? { kind: 'bank' as const } : {}) }, sl ? 'Drafted by an AI assistant for a bank statement line' : undefined);
      let statement: Record<string, unknown> | undefined;
      if (sl) {
        Bank.linkDraftToLine(sl.id, j.id);
        const bank = get<{ account_id: number }>('SELECT account_id FROM bk_statements WHERE id = ?', sl.statement_id)!.account_id;
        const fits = j.lines.some((l) => l.account_id === bank && l.debit - l.credit === sl.amount);
        statement = { line: sl.id, matches_when_posted: fits, ...(fits ? {} : { warning: `No line on the bank account for ${(sl.amount / 100).toFixed(2)} (money in = debit, money out = credit): it won’t be matched when posted.` }) };
      }
      return { amounts_in: 'cents', ...journalOut(j), problems: B.postingProblems(j), statement_line: statement, note: 'A draft: the treasurer reviews and posts it in Canon (Book-keeping → Journals).' };
    },
  },
];
