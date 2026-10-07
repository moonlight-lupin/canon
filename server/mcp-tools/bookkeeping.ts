// AI-assistant tools for book-keeping (0.17.0, module "bookkeeping"). Reading: the chart of accounts and funds with
// balances, journals, and the reports. Writing is DRAFT journals only (e.g. from a bank statement or receipts the
// user pasted): a person reviews and posts them in Canon. Agents never post, reverse or change a posted journal
// (repo/bookkeeping.ts refuses it for MCP whatever the tool). Amounts are in cents (minor units).
import { z } from 'zod';
import { all, get } from '../db.ts';
import * as B from '../repo/bookkeeping.ts';
import * as R from '../repo/bk-reports.ts';
import { getSettings } from '../repo/settings.ts';
import { DateStr, Id, RO, WRITE, today, type ToolDef } from './common.ts';

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

export const BOOKKEEPING_TOOLS: ToolDef[] = [
  {
    name: 'canon_books', module: 'bookkeeping', access: 'read', title: 'The books: accounts and funds', annotations: RO,
    description: 'The church’s books at a glance (amounts in cents of the church currency): the start date, financial year and the date the books are closed up to; the chart of accounts (code, name, type asset | liability | equity | income | expense, kind, active) with each account’s balance on as_of (default today); funds (code, restriction unrestricted | designated | restricted | endowment) with their balances; projects and ministries; drafts waiting to be posted. Codes are what canon_draft_journal takes. Example: {"as_of":"2026-09-30"}.',
    input: { as_of: DateStr.optional() },
    handler: (a) => {
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
    },
  },
  {
    name: 'canon_books_report', module: 'bookkeeping', access: 'read', title: 'A book-keeping report', annotations: RO,
    description: 'A report from the posted books (cents): trial_balance and balance_sheet (as_of), income_expenditure (from–to, by fund; optional fund / project / ministry code to filter), fund_movements (from–to: opening, income, expenditure, transfers, closing per fund), by_project / by_ministry / by_congregation (from–to), ledger (account code, from–to: each line with a running balance). Earlier years’ surplus is part of each fund’s balance. Example: {"report":"income_expenditure","from":"2026-01-01","to":"2026-09-30"}.',
    input: {
      report: ReportName, as_of: DateStr.optional(), from: DateStr.optional(), to: DateStr.optional(),
      account: z.string().max(20).optional(), fund: z.string().max(20).optional(), project: z.string().max(20).optional(), ministry: z.string().max(20).optional(),
    },
    handler: (a) => {
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
    },
  },
  {
    name: 'canon_books_journals', module: 'bookkeeping', access: 'read', title: 'Journals', annotations: RO,
    description: 'Journals, newest first (cents; lines with account and fund codes): filter by from / to dates, status draft | posted, account or fund code, words in the narration (q). With id: one journal, with what stops a draft from being posted. Example: {"status":"draft"}.',
    input: { id: Id.optional(), from: DateStr.optional(), to: DateStr.optional(), status: z.enum(['draft', 'posted']).optional(), account: z.string().max(20).optional(), fund: z.string().max(20).optional(), q: z.string().max(200).optional(), limit: z.number().int().min(1).max(200).default(50) },
    handler: (a) => {
      if (a.id) {
        const j = B.getJournal(a.id);
        return { amounts_in: 'cents', ...journalOut(j), problems: j.status === 'draft' ? B.postingProblems(j) : [] };
      }
      const rows = B.listJournals({ from: a.from, to: a.to, status: a.status, account_id: codeOf('bk_accounts', a.account, 'account') ?? undefined, fund_id: codeOf('bk_funds', a.fund, 'fund') ?? undefined, q: a.q, limit: a.limit });
      return { amounts_in: 'cents', journals: rows.map((j) => journalOut(j as ReturnType<typeof B.getJournal>)) };
    },
  },
  {
    name: 'canon_draft_journal', module: 'bookkeeping', access: 'write', title: 'Draft a journal (a person posts it)', annotations: { ...WRITE, idempotentHint: false },
    description: 'Prepare a DRAFT journal for the treasurer to review and post in Canon — e.g. from a bank statement, receipts or a payroll summary the user gave you. You can never post one, nor change a posted journal. Each line: account code, fund code (every line needs a fund), optional project / ministry codes, debit_cents OR credit_cents (whole cents, one per line), memo. Debits must equal credits for it to be postable; the reply lists anything still stopping it. With id: replace an existing DRAFT’s date, memo and lines. Check canon_books for the codes first, and confirm with the user before drafting. Example: {"date":"2026-10-01","memo":"October rent","lines":[{"account":"5500","fund":"GEN","debit_cents":150000},{"account":"1100","fund":"GEN","credit_cents":150000}]}.',
    input: {
      id: Id.optional(), date: DateStr, memo: z.string().max(1000).optional(),
      lines: z.array(z.object({
        account: z.string().max(20), fund: z.string().max(20), project: z.string().max(20).optional(), ministry: z.string().max(20).optional(),
        debit_cents: z.number().int().min(0).optional(), credit_cents: z.number().int().min(0).optional(), memo: z.string().max(500).optional(),
      })).min(1).max(200),
    },
    handler: (a) => {
      if (!B.bkSettings().start_date) throw new InputError('The books have not been started yet (Book-keeping → Setup in Canon).');
      const lines = (a.lines as { account: string; fund: string; project?: string; ministry?: string; debit_cents?: number; credit_cents?: number; memo?: string }[]).map((l, i) => {
        if ((l.debit_cents ?? 0) > 0 && (l.credit_cents ?? 0) > 0) throw new InputError(`Line ${i + 1}: give debit_cents or credit_cents, not both.`);
        return {
          account_id: codeOf('bk_accounts', l.account, 'account')!, fund_id: codeOf('bk_funds', l.fund, 'fund')!,
          project_id: codeOf('bk_projects', l.project, 'project'), ministry_id: codeOf('bk_ministries', l.ministry, 'ministry'),
          debit: l.debit_cents ?? 0, credit: l.credit_cents ?? 0, memo: l.memo ?? null,
        };
      });
      const j = B.saveDraft(a.id ?? null, { date: a.date, memo: a.memo ?? null, lines });
      return { amounts_in: 'cents', ...journalOut(j), problems: B.postingProblems(j), note: 'A draft: the treasurer reviews and posts it in Canon (Book-keeping → Journals).' };
    },
  },
];
