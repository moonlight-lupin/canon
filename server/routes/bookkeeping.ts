// REST routes for book-keeping (0.17.0, optional module "bookkeeping"; switched off = 404, shared/modules.ts).
// Reading needs the role's Book-keeping access, changes need edit; reopening a closed period is for administrators.
import express from 'express';
import { z } from 'zod';
import { all, get } from '../db.ts';
import * as B from '../repo/bookkeeping.ts';
import * as R from '../repo/bk-reports.ts';
import { syncOfferingsBetween } from '../repo/bk-offerings.ts';
import { accountsCsv, fundsCsv, journalsCsv } from '../repo/bk-export.ts';
import { importChart, type ChartPart } from '../repo/bk-chart-import.ts';
import * as Claims from '../repo/bk-claims.ts';
import { claimsSignInStatus } from './claims-self.ts';
import { publicUrl } from '../lib/public-url.ts';
import { addressForOthers } from '../lib/lan.ts';
import { qrSvg } from '../repo/presentation.ts';
import * as Bank from '../repo/bk-bank.ts';
import { getSettings } from '../repo/settings.ts';
import { can, isAdmin, mayReopenCounts } from '../lib/permissions.ts';
import { L10nSchema } from '../../shared/schemas.ts';
import { JOURNAL_KIND_LABEL, type JournalKind } from '../../shared/bookkeeping.ts';
import { h, id, sendCsv, str } from './helpers.ts';
import { sendXlsx } from '../lib/xlsx-export.ts';
import { bodyBytes, rawBody, uiLang } from './csv.ts';
import { importJournals, journalTemplateRows, readJournalFile } from '../repo/bk-import.ts';
import { asActor } from '../lib/actor.ts';
import { checkRef, wallSql } from '../lib/walls.ts';
import { churchToday } from '../lib/dates.ts';

export const bookkeepingRoutes = express.Router();

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const today = () => churchToday();
const num = (v: unknown) => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : undefined);
const filterOf = (q: Record<string, unknown>): R.Filter => ({ fund_id: num(q.fund_id), project_id: num(q.project_id), ministry_id: num(q.ministry_id), congregation_id: num(q.congregation_id) });

const Line = z.object({
  account_id: z.number().int(),
  fund_id: z.number().int(),
  project_id: z.number().int().nullable().optional(),
  ministry_id: z.number().int().nullable().optional(),
  congregation_id: z.number().int().nullable().optional(),
  debit: z.number().int().min(0).default(0),
  credit: z.number().int().min(0).default(0),
  memo: z.string().max(500).nullable().optional(),
  orig_currency: z.string().max(3).nullable().optional(),
  orig_amount: z.number().int().nullable().optional(),
  rate: z.number().positive().nullable().optional(),
});
const JournalInput = z.object({
  date,
  memo: z.string().max(1000).nullable().optional(),
  kind: z.enum(['manual', 'opening', 'transfer']).optional(),
  lines: z.array(Line).max(500),
});

// ---------------------------------------------------------------- overview and setup

bookkeepingRoutes.get('/bookkeeping', h(() => {
  const s = B.bkSettings();
  const drafts = get<{ n: number }>("SELECT COUNT(*) n FROM bk_journals WHERE status = 'draft'")!.n;
  const offeringDrafts = get<{ n: number }>("SELECT COUNT(*) n FROM bk_journals WHERE status = 'draft' AND kind = 'offering'")!.n;
  // cash and bank balances today, for the overview
  const money = s.start_date ? R.balanceSheet(today()).assets.rows.filter((r) => {
    const a = get<{ kind: string }>('SELECT kind FROM bk_accounts WHERE id = ?', r.account_id);
    return a && ['bank', 'cash', 'undeposited', 'foreign_cash'].includes(a.kind);
  }) : [];
  return {
    settings: s, currency: getSettings().offering.currency, offering_funds: getSettings().offering.funds, started: !!s.start_date,
    drafts, offering_drafts: offeringDrafts, money,
    opening: B.openingJournal(), kinds: JOURNAL_KIND_LABEL,
  };
}));

bookkeepingRoutes.put('/bookkeeping/setup', h((req) => B.setupBooks(z.object({ start_date: date, year_end_month: z.number().int().min(1).max(12), template: z.boolean() }).parse(req.body))));
bookkeepingRoutes.put('/bookkeeping/offering-mapping', h((req) => B.saveOfferingMapping(z.object({
  offering_drafts: z.boolean(),
  method_accounts: z.record(z.string().max(20), z.number().int().nullable()).transform((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => v != null)) as Record<string, number>),
  fund_map: z.record(z.string().max(100), z.object({ fund_id: z.number().int(), income_account_id: z.number().int() })),
}).parse(req.body))));

// ---------------------------------------------------------------- accounts, funds, projects, ministries

const AccountInput = z.object({
  code: z.string().min(1).max(20), name: L10nSchema, type: z.enum(['asset', 'liability', 'equity', 'income', 'expense']),
  kind: z.enum(['bank', 'cash', 'undeposited', 'foreign_cash', 'fund_balance', 'fund_transfer', 'other']).optional(),
  active: z.boolean().optional(), description: z.string().max(1000).nullable().optional(),
});
bookkeepingRoutes.get('/bookkeeping/accounts', h(() => B.listAccounts()));
bookkeepingRoutes.post('/bookkeeping/accounts', h((req) => B.saveAccount(null, AccountInput.parse(req.body))));
bookkeepingRoutes.patch('/bookkeeping/accounts/:id', h((req) => B.saveAccount(id(req), AccountInput.parse(req.body))));
bookkeepingRoutes.delete('/bookkeeping/accounts/:id', h((req) => {
  B.deleteAccount(id(req));
  return { deleted: true };
}));

const FundInput = z.object({
  code: z.string().min(1).max(20), name: L10nSchema, restriction: z.enum(['unrestricted', 'designated', 'restricted', 'endowment']),
  active: z.boolean().optional(), description: z.string().max(1000).nullable().optional(),
});
bookkeepingRoutes.get('/bookkeeping/funds', h(() => B.listFunds()));
bookkeepingRoutes.post('/bookkeeping/funds', h((req) => B.saveFund(null, FundInput.parse(req.body))));
bookkeepingRoutes.patch('/bookkeeping/funds/:id', h((req) => B.saveFund(id(req), FundInput.parse(req.body))));
bookkeepingRoutes.delete('/bookkeeping/funds/:id', h((req) => {
  B.deleteFund(id(req));
  return { deleted: true };
}));

const TagInput = z.object({ code: z.string().min(1).max(20), name: L10nSchema, active: z.boolean().optional() });
const tagKind = (v: unknown): B.TagKind => {
  if (v === 'projects' || v === 'ministries') return v;
  throw Object.assign(new Error('Not found'), { status: 404 });
};
bookkeepingRoutes.get('/bookkeeping/tags/:kind', h((req) => B.listTags(tagKind(req.params.kind))));
bookkeepingRoutes.post('/bookkeeping/tags/:kind', h((req) => B.saveTag(tagKind(req.params.kind), null, TagInput.parse(req.body))));
bookkeepingRoutes.patch('/bookkeeping/tags/:kind/:id', h((req) => B.saveTag(tagKind(req.params.kind), id(req), TagInput.parse(req.body))));
bookkeepingRoutes.delete('/bookkeeping/tags/:kind/:id', h((req) => {
  B.deleteTag(tagKind(req.params.kind), id(req));
  return { deleted: true };
}));

// ---------------------------------------------------------------- journals

bookkeepingRoutes.get('/bookkeeping/journals', h((req) => {
  const q = req.query as Record<string, string | undefined>;
  return B.listJournals({
    from: str(q.from), to: str(q.to), status: q.status === 'draft' || q.status === 'posted' ? q.status : undefined,
    kind: (str(q.kind) as JournalKind | undefined), account_id: num(q.account_id), fund_id: num(q.fund_id), q: str(q.q),
    limit: num(q.limit), offset: num(q.offset),
  });
}));
bookkeepingRoutes.get('/bookkeeping/journals/:id', h((req) => {
  const j = B.getJournal(id(req));
  const reversesNumber = j.reverses_id ? B.getJournal(j.reverses_id).number : null;
  return { ...j, problems: j.status === 'draft' ? B.postingProblems(j) : [], reversal_draft_id: j.status === 'posted' ? B.reversalDraftOf(j.id) : null, reverses_number: reversesNumber };
}));
/** A journal's history: every change to it (lines included), and for offerings the cash count behind it. */
bookkeepingRoutes.get('/bookkeeping/journals/:id/history', h((req) => B.journalHistory(id(req))));
bookkeepingRoutes.post('/bookkeeping/journals', h((req) => B.saveDraft(null, JournalInput.parse(req.body))));
bookkeepingRoutes.put('/bookkeeping/journals/:id', h((req) => B.saveDraft(id(req), JournalInput.parse(req.body))));
bookkeepingRoutes.delete('/bookkeeping/journals/:id', h((req) => {
  B.deleteDraft(id(req));
  return { deleted: true };
}));
bookkeepingRoutes.post('/bookkeeping/journals/:id/post', h((req) => B.postJournal(id(req))));
/** Post several drafts (e.g. a week's offering drafts): each is checked; the ones with problems stay drafts. */
bookkeepingRoutes.post('/bookkeeping/journals/post', h((req) => {
  const ids = z.object({ ids: z.array(z.number().int()).min(1).max(500) }).parse(req.body).ids;
  const posted: string[] = [];
  const failed: { id: number; error: string }[] = [];
  for (const j of ids) {
    try {
      posted.push(B.postJournal(j).number!);
    } catch (e) {
      failed.push({ id: j, error: (e as Error).message });
    }
  }
  return { posted, failed };
}));
bookkeepingRoutes.post('/bookkeeping/journals/:id/reverse', h((req) => {
  const b = z.object({ date: date.optional(), memo: z.string().max(1000).optional() }).parse(req.body ?? {});
  return B.reverseJournal(id(req), b.date, b.memo);
}));

// ---------------------------------------------------------------- offerings, closing

bookkeepingRoutes.post('/bookkeeping/offerings/sync', h((req) => {
  const b = z.object({ from: date, to: date }).parse(req.body);
  return syncOfferingsBetween(b.from, b.to);
}));
/** A service's offerings in the books (for its record page): the draft waiting, and what is posted. */
bookkeepingRoutes.get('/bookkeeping/offerings/:id', h((req) => ({
  started: !!B.bkSettings().start_date,
  journals: all<{ id: number; number: string | null; status: string; kind: string; date: string }>(
    "SELECT id, number, status, kind, date FROM bk_journals WHERE service_id = ? AND kind IN ('offering', 'reversal') ORDER BY id", id(req),
  ),
})));
bookkeepingRoutes.post('/bookkeeping/close', h((req) => B.closeThrough(z.object({ date }).parse(req.body).date)));
bookkeepingRoutes.post('/bookkeeping/reopen', h((req) => B.reopenThrough(z.object({ date: date.nullable() }).parse(req.body).date, isAdmin(req.user!))));

// ---------------------------------------------------------------- reports

const asOf = (q: Record<string, unknown>) => str(q.as_of) ?? today();
const period = (q: Record<string, unknown>) => {
  const to = str(q.to) ?? today();
  const from = str(q.from) ?? `${to.slice(0, 4)}-01-01`;
  return { from, to };
};
bookkeepingRoutes.get('/bookkeeping/reports/trial-balance', h((req) => R.trialBalance(asOf(req.query))));
bookkeepingRoutes.get('/bookkeeping/reports/income-expenditure', h((req) => {
  const p = period(req.query);
  return R.incomeExpenditure(p.from, p.to, filterOf(req.query));
}));
bookkeepingRoutes.get('/bookkeeping/reports/balance-sheet', h((req) => R.balanceSheet(asOf(req.query))));
bookkeepingRoutes.get('/bookkeeping/reports/fund-movements', h((req) => {
  const p = period(req.query);
  return R.fundMovements(p.from, p.to);
}));
bookkeepingRoutes.get('/bookkeeping/reports/by/:dim', h((req) => {
  const dim = req.params.dim;
  if (dim !== 'project' && dim !== 'ministry' && dim !== 'congregation') throw Object.assign(new Error('Not found'), { status: 404 });
  const p = period(req.query);
  return R.byDimension(dim, p.from, p.to);
}));
bookkeepingRoutes.get('/bookkeeping/reports/ledger/:id', h((req) => {
  const p = period(req.query);
  const l = R.ledger(id(req), p.from, p.to, filterOf(req.query));
  if (!l) throw Object.assign(new Error('Account not found'), { status: 404 });
  return l;
}));

// ---------------------------------------------------------------- exports

/**
 * Every posted line in a period, one row each, for the church's accountant or other accounting software (most
 * import a "manual journal" CSV with these columns: number, date, narration, account code, debit, credit).
 */
bookkeepingRoutes.get('/bookkeeping/export/journals.csv', h((req, res) => {
  const p = period(req.query);
  sendCsv(res, `journals-${p.from}-to-${p.to}.csv`, journalsCsv(p.from, p.to));
}));
/** The same journal lines as an Excel file with a title block (the CSV is for accounting software). */
bookkeepingRoutes.get('/bookkeeping/export/journals.xlsx', h((req, res) => {
  const p = period(req.query);
  const [header, ...rows] = journalsCsv(p.from, p.to);
  sendXlsx(req, res, uiLang(req), { file: `journals-${p.from}-to-${p.to}`, title: 'Journals', period: `${p.from} – ${p.to}`, header: header as string[], rows, money: [10, 11, 14], pii: true });
}));

// ---------------------------------------------------------------- bank statements

const Layout = z.object({
  header_row: z.number().int().min(0).max(200),
  date: z.string().max(200),
  description: z.string().max(200),
  amount: z.string().max(200).optional(),
  debit: z.string().max(200).optional(),
  credit: z.string().max(200).optional(),
  reference: z.string().max(200).optional(),
  date_format: z.string().max(20),
});
const fileData = (b64: string) => {
  const data = Buffer.from(b64, 'base64');
  if (!data.length) throw Object.assign(new Error('Choose the statement file.'), { status: 400 });
  if (data.length > 1_500_000) throw Object.assign(new Error('The file is larger than 1.5 MB: export a shorter period.'), { status: 400 });
  return data;
};
bookkeepingRoutes.get('/bookkeeping/bank/statements', h((req) => Bank.listStatements(num((req.query as Record<string, unknown>).account_id))));
bookkeepingRoutes.get('/bookkeeping/bank/statements/:id', h((req) => Bank.getStatement(id(req))));
bookkeepingRoutes.post('/bookkeeping/bank/preview', h((req) => {
  const b = z.object({ account_id: z.number().int(), file: z.string().max(8_000_000) }).parse(req.body);
  return Bank.previewStatement(b.account_id, fileData(b.file));
}));
bookkeepingRoutes.post('/bookkeeping/bank/statements', h((req) => {
  const b = z.object({
    account_id: z.number().int(), file: z.string().max(8_000_000), file_name: z.string().max(200).optional(), layout: Layout,
    opening_balance: z.number().int().nullable().optional(), closing_balance: z.number().int().nullable().optional(),
  }).parse(req.body);
  return Bank.importStatement({ account_id: b.account_id, data: fileData(b.file), layout: b.layout, file_name: b.file_name, opening_balance: b.opening_balance, closing_balance: b.closing_balance });
}));
bookkeepingRoutes.delete('/bookkeeping/bank/statements/:id', h((req) => {
  Bank.deleteStatement(id(req));
  return { deleted: true };
}));
bookkeepingRoutes.post('/bookkeeping/bank/statements/:id/auto-match', h((req) => ({ matched: Bank.autoMatch(id(req)) })));
bookkeepingRoutes.post('/bookkeeping/bank/statements/:id/done', h((req) => {
  Bank.setStatementDone(id(req), z.object({ done: z.boolean() }).parse(req.body).done);
  return Bank.getStatement(id(req));
}));
bookkeepingRoutes.post('/bookkeeping/bank/lines/:id/match', h((req) => {
  Bank.matchLine(id(req), z.object({ line_id: z.number().int() }).parse(req.body).line_id);
  return { ok: true };
}));
/** Several statement lines and/or book entries matched as one group, when the totals agree. */
bookkeepingRoutes.post('/bookkeeping/bank/match-group', h((req) => {
  const b = z.object({ statement_line_ids: z.array(z.number().int()).min(1).max(50), book_line_ids: z.array(z.number().int()).min(1).max(50) }).parse(req.body);
  Bank.matchGroup(b.statement_line_ids, b.book_line_ids);
  return { ok: true };
}));
bookkeepingRoutes.post('/bookkeeping/bank/lines/:id/unmatch', h((req) => {
  Bank.unmatchLine(id(req));
  return { ok: true };
}));
bookkeepingRoutes.post('/bookkeeping/bank/lines/:id/ignore', h((req) => {
  Bank.ignoreLine(id(req), z.object({ ignored: z.boolean() }).parse(req.body).ignored);
  return { ok: true };
}));
/** Services money in could be the offering of (a PayNow or transfer seen first on the statement). */
bookkeepingRoutes.get('/bookkeeping/bank/lines/:id/services', h((req) => Bank.servicesNear(id(req))));
/** Add a bank line to a service's offerings (needs the Offerings permission too): drafted, and matched when posted. */
bookkeepingRoutes.post('/bookkeeping/bank/lines/:id/offering', h((req) => {
  const b = z.object({ service_id: z.number().int(), fund: z.string().min(1).max(100), method: z.enum(['paynow', 'transfer', 'card', 'cheque', 'other']), post: z.boolean() }).parse(req.body);
  if (!can(req.user, 'contributions', 'edit')) throw Object.assign(new Error('Adding to a service’s offerings needs the Offerings permission.'), { status: 403 });
  return Bank.offeringFromLine(id(req), b, { name: req.user?.display_name ?? '', admin: mayReopenCounts(req.user), money: true });
}));
bookkeepingRoutes.post('/bookkeeping/bank/lines/:id/entry', h((req) => Bank.entryFromLine(id(req), z.object({
  account_id: z.number().int(), fund_id: z.number().int(), memo: z.string().max(500).nullable().optional(),
  project_id: z.number().int().nullable().optional(), ministry_id: z.number().int().nullable().optional(), post: z.boolean(),
}).parse(req.body))));

// ---------------------------------------------------------------- expense claims (0.17.1)
// The office's view: every claim, entering paper claims, how each line is booked, paying, the approvers and settings.
// Claimants and approvers use /self/claims (routes/claims-self.ts), also from inside Canon.

const office = (req: express.Request): Claims.Party => ({ as: 'office', person_id: req.user?.person_id ?? null, name: req.user?.display_name ?? '' });
const ClaimLine = z.object({
  id: z.number().int().optional(), date: z.string().max(10).nullable().optional(), description: z.string().max(300).default(''), payee: z.string().max(120).nullable().optional(),
  amount: z.number().int().min(0), account_id: z.number().int().nullable().optional(), fund_id: z.number().int().nullable().optional(),
  ministry_id: z.number().int().nullable().optional(), project_id: z.number().int().nullable().optional(),
});
const ClaimInput = z.object({
  purpose: z.string().max(300).nullable().optional(), ministry_id: z.number().int().nullable().optional(), project_id: z.number().int().nullable().optional(),
  fund_id: z.number().int().nullable().optional(), pay_to: z.string().max(200).nullable().optional(), lines: z.array(ClaimLine).max(100),
});
const claimInput = (b: unknown) => {
  const x = ClaimInput.parse(b);
  return { ...x, lines: x.lines.map((l) => ({ ...l, date: l.date || null, payee: l.payee ?? null })) };
};
/** One claim for the office: with who may approve it, how many approvals it needs, what stops it, and its link. */
const claimView = (c: ReturnType<typeof Claims.getClaim>, req?: express.Request) => ({
  ...c,
  // where to repay: for those who keep the books (read-only roles, e.g. an auditor, see that it is set)
  pay_to: req && !can(req.user, 'bookkeeping', 'edit') && c.pay_to ? '•••' : c.pay_to,
  needed: Claims.approvalsNeeded(c), approvers: Claims.approversOf(c).map((a) => ({ person_id: a.person_id, name: a.name })),
  problems: c.status === 'draft' ? Claims.submitProblems(c) : [], link: Claims.claimLink(c.id),
});

bookkeepingRoutes.get('/bookkeeping/claims', h((req) => {
  const q = req.query as Record<string, string | undefined>;
  const status = ['draft', 'submitted', 'approved', 'rejected', 'paid', 'withdrawn', 'open'].includes(q.status ?? '') ? (q.status as Claims.ClaimQuery['status']) : undefined;
  return { claims: Claims.listClaims({ status, q: str(q.q), from: str(q.from), to: str(q.to), walled: true }), counts: Claims.claimCounts() };
}));
bookkeepingRoutes.get('/bookkeeping/claims/:id', h((req) => claimView(Claims.getClaim(id(req)), req)));
/** The office enters a claim for a member (e.g. one handed in on paper). */
bookkeepingRoutes.post('/bookkeeping/claims', h((req) => {
  const b = z.object({ person_id: z.number().int() }).passthrough().parse(req.body);
  checkRef('people', b.person_id); // a member of the account's own congregation (or the whole church's)
  return claimView(Claims.createClaim(b.person_id, claimInput(req.body), office(req)));
}));
bookkeepingRoutes.put('/bookkeeping/claims/:id', h((req) => claimView(Claims.updateClaim(id(req), claimInput(req.body), office(req)))));
bookkeepingRoutes.put('/bookkeeping/claims/:id/booking', h((req) => claimView(Claims.classifyClaim(id(req), z.object({
  ministry_id: z.number().int().nullable().optional(), project_id: z.number().int().nullable().optional(), fund_id: z.number().int().nullable().optional(),
  lines: z.array(z.object({ id: z.number().int(), account_id: z.number().int().nullable().optional(), fund_id: z.number().int().nullable().optional(), ministry_id: z.number().int().nullable().optional(), project_id: z.number().int().nullable().optional() })).max(100),
}).parse(req.body)))));
bookkeepingRoutes.delete('/bookkeeping/claims/:id', h((req) => {
  Claims.deleteClaim(id(req), office(req));
  return { deleted: true };
}));
bookkeepingRoutes.post('/bookkeeping/claims/:id/files', express.raw({ type: () => true, limit: '11mb' }), h((req) => {
  const q = req.query as Record<string, string | undefined>;
  return claimView(Claims.addClaimFile(id(req), { name: String(q.name ?? 'receipt'), mime: String(req.get('Content-Type') ?? '').split(';')[0], data: req.body as Buffer, line_id: Number(q.line_id) || null }, office(req)));
}));
bookkeepingRoutes.delete('/bookkeeping/claims/files/:id', h((req) => claimView(Claims.removeClaimFile(id(req), office(req)))));
bookkeepingRoutes.get('/bookkeeping/claims/files/:id', (req, res, next) => {
  try {
    const f = Claims.claimFileData(id(req));
    res.setHeader('Content-Type', f.file.mime);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${f.file.name.replace(/[^\w.-]+/g, '_')}"`);
    res.send(f.data);
  } catch (e) {
    next(e);
  }
});
/** A claim the claimant signed on paper (its scan among the receipts). */
bookkeepingRoutes.post('/bookkeeping/claims/:id/submit-paper', h((req) => claimView(Claims.submitClaim(id(req), { paper: true }, office(req)))));
bookkeepingRoutes.post('/bookkeeping/claims/:id/withdraw', h((req) => claimView(Claims.withdrawClaim(id(req), office(req)))));
bookkeepingRoutes.post('/bookkeeping/claims/:id/pay', h((req) => {
  const b = z.object({ date: date.optional(), bank_account_id: z.number().int(), reference: z.string().max(200).nullable().optional(), post: z.boolean() }).parse(req.body);
  return claimView(Claims.payClaim(id(req), b, { name: req.user?.display_name ?? '', person_id: req.user?.person_id ?? null }));
}));

bookkeepingRoutes.get('/bookkeeping/claim-approvers', h(() => Claims.listApprovers()));
const ApproverInput = z.object({ person_id: z.number().int(), ministry_ids: z.array(z.number().int()).nullable().optional(), max_amount: z.number().int().nullable().optional(), active: z.boolean().optional() });
bookkeepingRoutes.post('/bookkeeping/claim-approvers', h((req) => Claims.saveApprover(null, ApproverInput.parse(req.body))));
bookkeepingRoutes.patch('/bookkeeping/claim-approvers/:id', h((req) => Claims.saveApprover(id(req), ApproverInput.parse(req.body))));
bookkeepingRoutes.delete('/bookkeeping/claim-approvers/:id', h((req) => {
  Claims.deleteApprover(id(req));
  return Claims.listApprovers();
}));
/** Members to choose an approver or a claimant from (names only). */
bookkeepingRoutes.get('/bookkeeping/claim-people', h((req) => {
  const q = str((req.query as Record<string, unknown>).q) ?? '';
  const w = wallSql('congregation_id');
  return all<{ id: number; name: string; email: number }>(
    `SELECT id, TRIM(IFNULL(preferred_name, first_name) || ' ' || IFNULL(last_name, '')) AS name, (email IS NOT NULL AND email <> '') AS email FROM people
     WHERE erased_at IS NULL AND (first_name LIKE ? OR last_name LIKE ? OR preferred_name LIKE ? OR native_name LIKE ?)${w.sql} ORDER BY first_name, last_name LIMIT 20`,
    `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, ...w.params,
  ).map((r) => ({ ...r, email: !!r.email }));
}));
bookkeepingRoutes.get('/bookkeeping/claim-settings', h(async () => ({ settings: B.bkSettings(), sign_in: await claimsSignInStatus(true) })));
bookkeepingRoutes.put('/bookkeeping/claim-settings', h(async (req) => {
  const b = z.object({
    claims_self_service: z.boolean(), claims_two_above: z.number().int().nullable(),
    claims_payable_account_id: z.number().int().nullable(), claims_default_account_id: z.number().int().nullable(),
  }).parse(req.body);
  if (b.claims_self_service) {
    const st = await claimsSignInStatus(true);
    const bad = st.gates.filter((g) => !g.ok);
    if (bad.length) throw Object.assign(new Error(`Phone sign-in needs ${bad.map((g) => (g.key === 'email' ? 'working e-mail (Settings → E-mail: send a test)' : 'a public https address (Settings → AI / MCP)')).join(' and ')}.`), { status: 400 });
  }
  return { settings: Claims.saveClaimSettings(b), sign_in: await claimsSignInStatus() };
}));
/** The claims page for members (to share, or print as a QR code for the notice board). */
bookkeepingRoutes.get('/bookkeeping/claims-link', h(async (req) => {
  const link = `${publicUrl() || addressForOthers(`${req.protocol}://${req.get('host')}`)}/self/claims`;
  return { link, public: !!publicUrl(), qr: await qrSvg(link) };
}));

// ---------------------------------------------------------------- importing journals (0.17.2)

/** The template to fill in (Excel; CSV also accepted when importing). */
bookkeepingRoutes.get('/bookkeeping/import/journals-template.xlsx', h((req, res) => {
  const [header, ...rows] = journalTemplateRows();
  sendXlsx(req, res, uiLang(req), { file: 'canon-journals-template', title: 'Journals: template', header, rows, money: [9, 10], pii: false });
}));
/** Preview (?dry_run=1) or import: journals without errors come in as drafts, for the treasurer to post. */
bookkeepingRoutes.post('/bookkeeping/import/journals', rawBody, h((req) => {
  const data = bodyBytes(req);
  if (req.query.dry_run === '1') return readJournalFile(data);
  return asActor({ user_id: req.user?.id ?? null, user_name: req.user?.display_name ?? null, via: 'import' }, () => importJournals(data));
}));

// ---------------------------------------------------------------- importing the chart (0.18.0)

const chartPart = (v: unknown): ChartPart => {
  if (v === 'accounts' || v === 'funds') return v;
  throw Object.assign(new Error('Not found'), { status: 404 });
};
/** The chart as it is, to edit in Excel and import back (new codes are added, known ones updated). */
bookkeepingRoutes.get('/bookkeeping/import/chart/:part.xlsx', h((req, res) => {
  const part = chartPart(req.params.part);
  const [header, ...rows] = part === 'accounts' ? accountsCsv() : fundsCsv();
  sendXlsx(req, res, uiLang(req), { file: `canon-${part}`, title: part === 'accounts' ? 'Chart of accounts' : 'Funds', header: header as string[], rows, pii: false });
}));
/** Preview (?dry_run=1) or import the chart of accounts or the funds. */
bookkeepingRoutes.post('/bookkeeping/import/chart/:part', rawBody, h((req) => asActor(
  { user_id: req.user?.id ?? null, user_name: req.user?.display_name ?? null, via: 'import' },
  () => importChart(chartPart(req.params.part), bodyBytes(req), req.query.dry_run === '1'),
)));
