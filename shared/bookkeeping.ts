// Book-keeping (0.17.0): the church's double-entry books, an optional module. Amounts are in minor units (cents) of
// the church's currency. Every journal line carries a fund (unrestricted, designated, restricted or endowment) and
// may carry a project, a congregation and a ministry. Posted journals are never changed: a mistake is corrected by
// a reversing journal. See docs/ROADMAP.md "0.17.0 — Book-keeping".
import type { L10n } from './types.ts';

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
export const ACCOUNT_TYPES: AccountType[] = ['asset', 'liability', 'equity', 'income', 'expense'];
export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = { asset: 'Assets', liability: 'Liabilities', equity: 'Funds‖books', income: 'Income', expense: 'Expenses' };
/** The side an account's balance normally sits on: assets and expenses debit, the rest credit. */
export const DEBIT_NORMAL: Record<AccountType, boolean> = { asset: true, expense: true, liability: false, equity: false, income: false };

/** What an account is for, where Canon needs to know (offerings, the bank, fund balances). */
export type AccountKind = 'bank' | 'cash' | 'undeposited' | 'foreign_cash' | 'fund_balance' | 'fund_transfer' | 'other';
export const ACCOUNT_KINDS: AccountKind[] = ['bank', 'cash', 'undeposited', 'foreign_cash', 'fund_balance', 'fund_transfer', 'other'];

export type FundRestriction = 'unrestricted' | 'designated' | 'restricted' | 'endowment';
export const FUND_RESTRICTIONS: FundRestriction[] = ['unrestricted', 'designated', 'restricted', 'endowment'];
export const FUND_RESTRICTION_LABEL: Record<FundRestriction, string> = { unrestricted: 'Unrestricted', designated: 'Designated', restricted: 'Restricted', endowment: 'Endowment' };

export type JournalStatus = 'draft' | 'posted';
/** Where a journal came from. */
export type JournalKind = 'manual' | 'opening' | 'offering' | 'bank' | 'reversal' | 'transfer' | 'claim';
export const JOURNAL_KIND_LABEL: Record<JournalKind, string> = {
  manual: 'Journal', opening: 'Opening balances', offering: 'Offerings', bank: 'Bank', reversal: 'Reversal', transfer: 'Fund transfer', claim: 'Claim',
};

export interface BkAccount {
  id: number;
  code: string;
  name: L10n;
  type: AccountType;
  kind: AccountKind;
  active: boolean;
  description: string | null;
  sort: number;
  /** bank accounts: how the bank's CSV statement is laid out (remembered after the first import) */
  bank_csv: BankCsvLayout | null;
}

export interface BkFund {
  id: number;
  code: string;
  name: L10n;
  restriction: FundRestriction;
  active: boolean;
  description: string | null;
  sort: number;
}

/** A project, or a ministry / department: an optional tag on a line. */
export interface BkTag {
  id: number;
  code: string;
  name: L10n;
  active: boolean;
  sort: number;
}

export interface BkLine {
  id?: number;
  account_id: number;
  fund_id: number;
  project_id?: number | null;
  ministry_id?: number | null;
  congregation_id?: number | null;
  /** minor units; one of debit and credit is 0 */
  debit: number;
  credit: number;
  memo?: string | null;
  /** an amount in another currency, booked at its converted value: the original and the rate are kept */
  orig_currency?: string | null;
  orig_amount?: number | null;
  rate?: number | null;
}

export interface BkJournal {
  id: number;
  /** set when posted, e.g. 2026-0042 (financial year, then a running number) */
  number: string | null;
  date: string;
  memo: string | null;
  status: JournalStatus;
  kind: JournalKind;
  /** offerings: the service the journal comes from */
  service_id: number | null;
  /** an expense claim's approval or payment journal (0.17.1) */
  claim_id?: number | null;
  /** a reversal: the journal it reverses; and the other way round */
  reverses_id: number | null;
  reversed_by_id: number | null;
  /** 'web', 'mcp' (an AI assistant's draft) or 'system' */
  created_via: string;
  created_by: string | null;
  posted_by: string | null;
  posted_at: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
  lines: BkLine[];
}

/** How a bank's CSV statement is laid out: which column holds what, and how dates are written. */
export interface BankCsvLayout {
  /** the row holding the column names (banks put account details above it); 0 = the first row */
  header_row: number;
  date: string;
  description: string;
  /** one signed amount column, or separate money-out / money-in columns */
  amount?: string;
  debit?: string;
  credit?: string;
  reference?: string;
  /** e.g. 'DD/MM/YYYY', 'YYYY-MM-DD', 'DD MMM YYYY' */
  date_format: string;
}

export interface BookkeepingSettings {
  /** the date the books start (the opening balances are on it); null = not set up yet */
  start_date: string | null;
  /** the last month of the financial year (12 = the calendar year) */
  year_end_month: number;
  /** nothing on or before this date can be posted or changed (closed months and years) */
  closed_through: string | null;
  /** verified offerings become draft journals */
  offering_drafts: boolean;
  /** offering payment method → the account the money goes to (cash → undeposited offerings, PayNow → bank …) */
  method_accounts: Partial<Record<string, number>>;
  /** offering fund name (Settings → Offerings) → its fund in the books and the income account */
  fund_map: Record<string, { fund_id: number; income_account_id: number }>;
  /** expense claims (0.17.1): members may claim on their phones (sign-in code by e-mail) */
  claims_self_service: boolean;
  /** claims above this amount (minor units) need two different approvers; null = one is enough */
  claims_two_above: number | null;
  /** what approved claims owe (default: the account coded 2100) and the expense account a line has when nobody chose one */
  claims_payable_account_id: number | null;
  claims_default_account_id: number | null;
}

export const DEFAULT_BOOKKEEPING: BookkeepingSettings = {
  start_date: null, year_end_month: 12, closed_through: null, offering_drafts: true, method_accounts: {}, fund_map: {},
  claims_self_service: false, claims_two_above: null, claims_payable_account_id: null, claims_default_account_id: null,
};

// ---------------------------------------------------------------- expense claims (0.17.1)

/**
 * draft (being prepared: by the claimant, the office or an AI assistant) -> submitted (signed by the claimant) ->
 * approved (by one approver, or two above the set amount) -> paid. An approver may also send it back (draft again)
 * or reject it; the claimant may withdraw it before it is approved.
 */
export type ClaimStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'paid' | 'withdrawn';
export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  draft: 'Being prepared', submitted: 'Waiting for approval', approved: 'Approved, to pay', rejected: 'Rejected', paid: 'Paid', withdrawn: 'Withdrawn',
};

export interface ClaimLine {
  id?: number;
  date: string | null;
  description: string;
  /** the shop or person paid */
  payee: string | null;
  /** minor units */
  amount: number;
  /** how it is booked (the office or the approver may choose; a default otherwise) */
  account_id?: number | null;
  fund_id?: number | null;
  ministry_id?: number | null;
  project_id?: number | null;
}

export interface ClaimFile { id: number; line_id: number | null; name: string; mime: string; size: number; created_at: string }

export interface ClaimSignature { name: string; image: string; signed_at: string; hash: string; via: 'device' | 'account' | 'paper'; by?: string }

export interface ClaimApproval {
  id: number; person_id: number | null; name: string; decision: 'approved' | 'rejected' | 'returned'; note: string | null;
  image: string | null; hash: string | null; via: string; at: string;
}

export interface Claim {
  id: number;
  number: string | null;
  person_id: number | null;
  claimant: string;
  purpose: string | null;
  ministry_id: number | null;
  project_id: number | null;
  fund_id: number | null;
  congregation_id: number | null;
  /** where to repay (e.g. a PayNow number, a bank account): never shown to AI assistants */
  pay_to: string | null;
  status: ClaimStatus;
  note: string | null;
  signature: ClaimSignature | null;
  submitted_at: string | null;
  approved_at: string | null;
  approval_journal_id: number | null;
  payment_journal_id: number | null;
  paid_on: string | null;
  paid_by: string | null;
  payment_ref: string | null;
  /** an approver of this claim also paid it (allowed; shown on the claim and in the list) */
  approver_paid: boolean;
  created_via: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
  lines: ClaimLine[];
  files: ClaimFile[];
  approvals: ClaimApproval[];
  total: number;
}

export interface ClaimApprover { id: number; person_id: number; name: string; email: string | null; ministry_ids: number[] | null; max_amount: number | null; active: boolean }

/** The financial year a date falls in, by the year it ends: with year_end_month 3, 2026-05-01 is in FY 2027. */
export function financialYear(date: string, yearEndMonth: number): number {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  return yearEndMonth === 12 || m <= yearEndMonth ? y : y + 1;
}
/** The first day of the financial year a date falls in. */
export function yearStart(date: string, yearEndMonth: number): string {
  const fy = financialYear(date, yearEndMonth);
  if (yearEndMonth === 12) return `${fy}-01-01`;
  const m = yearEndMonth + 1;
  return `${fy - 1}-${String(m).padStart(2, '0')}-01`;
}
/** The last day of a financial year. */
export function yearEnd(fy: number, yearEndMonth: number): string {
  const last = new Date(Date.UTC(fy, yearEndMonth, 0)).getUTCDate();
  return `${fy}-${String(yearEndMonth).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- the church template

export interface TemplateAccount { code: string; name: L10n; type: AccountType; kind?: AccountKind }

/** A starting chart of accounts for a church (the treasurer renames, adds and retires accounts afterwards). */
export const CHART_TEMPLATE: TemplateAccount[] = [
  { code: '1000', name: { en: 'Cash in hand', zh: '库存现金' }, type: 'asset', kind: 'cash' },
  { code: '1010', name: { en: 'Offerings not yet banked', zh: '未存入银行的奉献' }, type: 'asset', kind: 'undeposited' },
  { code: '1020', name: { en: 'Foreign cash awaiting exchange', zh: '待兑换外币现金' }, type: 'asset', kind: 'foreign_cash' },
  { code: '1100', name: { en: 'Bank — current account', zh: '银行 — 往来户口' }, type: 'asset', kind: 'bank' },
  { code: '1110', name: { en: 'Bank — savings / fixed deposits', zh: '银行 — 储蓄 / 定期存款' }, type: 'asset', kind: 'bank' },
  { code: '1200', name: { en: 'Receivables and deposits', zh: '应收款项与押金' }, type: 'asset' },
  { code: '1300', name: { en: 'Prepayments', zh: '预付款项' }, type: 'asset' },
  { code: '1500', name: { en: 'Equipment and property', zh: '设备与产业' }, type: 'asset' },
  { code: '1590', name: { en: 'Accumulated depreciation', zh: '累计折旧' }, type: 'asset' },
  { code: '2000', name: { en: 'Payables and accruals', zh: '应付款项与应计费用' }, type: 'liability' },
  { code: '2100', name: { en: 'Claims to repay', zh: '应付报销款' }, type: 'liability' },
  { code: '2200', name: { en: 'Funds held for others', zh: '代管款项' }, type: 'liability' },
  { code: '3000', name: { en: 'Accumulated funds', zh: '累积款项' }, type: 'equity', kind: 'fund_balance' },
  { code: '3100', name: { en: 'Transfers between funds', zh: '款项之间的转拨' }, type: 'equity', kind: 'fund_transfer' },
  { code: '4000', name: { en: 'Tithes and offerings', zh: '什一与奉献' }, type: 'income' },
  { code: '4010', name: { en: 'Designated gifts', zh: '指定用途奉献' }, type: 'income' },
  { code: '4200', name: { en: 'Event and programme income', zh: '活动与课程收入' }, type: 'income' },
  { code: '4300', name: { en: 'Rental of premises', zh: '场地租金收入' }, type: 'income' },
  { code: '4400', name: { en: 'Interest and dividends', zh: '利息与股息' }, type: 'income' },
  { code: '4900', name: { en: 'Other income', zh: '其他收入' }, type: 'income' },
  { code: '5000', name: { en: 'Staff salaries and contributions', zh: '同工薪金与公积金' }, type: 'expense' },
  { code: '5010', name: { en: 'Staff benefits and training', zh: '同工福利与培训' }, type: 'expense' },
  { code: '5100', name: { en: 'Missions support', zh: '宣教支持' }, type: 'expense' },
  { code: '5200', name: { en: 'Worship and music', zh: '崇拜与音乐' }, type: 'expense' },
  { code: '5300', name: { en: 'Children and youth', zh: '儿童与青少年事工' }, type: 'expense' },
  { code: '5400', name: { en: 'Fellowship and events', zh: '团契与活动' }, type: 'expense' },
  { code: '5500', name: { en: 'Rent and utilities', zh: '租金与水电' }, type: 'expense' },
  { code: '5510', name: { en: 'Repairs and maintenance', zh: '维修与保养' }, type: 'expense' },
  { code: '5600', name: { en: 'Office and administration', zh: '办公与行政' }, type: 'expense' },
  { code: '5610', name: { en: 'IT and software', zh: '资讯科技与软件' }, type: 'expense' },
  { code: '5620', name: { en: 'Printing and stationery', zh: '印刷与文具' }, type: 'expense' },
  { code: '5700', name: { en: 'Bank charges', zh: '银行手续费' }, type: 'expense' },
  { code: '5800', name: { en: 'Depreciation', zh: '折旧' }, type: 'expense' },
  { code: '5900', name: { en: 'Benevolence and welfare', zh: '慈惠与福利' }, type: 'expense' },
  { code: '5990', name: { en: 'Other expenses', zh: '其他支出' }, type: 'expense' },
];

export interface TemplateFund { code: string; name: L10n; restriction: FundRestriction; offering?: string }
/** Starting funds; `offering` matches a fund name in Settings → Offerings, so its offerings land in it. */
export const FUND_TEMPLATE: TemplateFund[] = [
  { code: 'GEN', name: { en: 'General fund', zh: '常费' }, restriction: 'unrestricted', offering: 'General' },
  { code: 'MIS', name: { en: 'Missions fund', zh: '宣教款项' }, restriction: 'designated', offering: 'Missions' },
  { code: 'BLD', name: { en: 'Building fund', zh: '建堂款项' }, restriction: 'restricted', offering: 'Building' },
  { code: 'BEN', name: { en: 'Benevolence fund', zh: '慈惠款项' }, restriction: 'restricted' },
];

/** Offering payment method → the template account its money goes to. */
export const METHOD_TEMPLATE: Record<string, string> = {
  cash: '1010', cheque: '1010', other: '1010', paynow: '1100', transfer: '1100', card: '1100',
};

/** Sum of debits and of credits. */
export function totals(lines: Pick<BkLine, 'debit' | 'credit'>[]) {
  let debit = 0;
  let credit = 0;
  for (const l of lines) {
    debit += l.debit || 0;
    credit += l.credit || 0;
  }
  return { debit, credit, balanced: debit === credit && debit > 0 };
}
