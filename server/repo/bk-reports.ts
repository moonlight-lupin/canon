// Book-keeping reports (0.17.0), from posted journals only. Balance-sheet accounts (assets, liabilities, funds)
// add up from the start of the books; income and expenses for the period asked. A fund's balance is its own
// entries on fund accounts (opening balances, transfers) plus all its income less its expenses so far — so the
// surplus of earlier years sits in each fund without a closing journal. Amounts are minor units.
import { all, get } from '../db.ts';
import { bkSettings } from './bookkeeping.ts';
import { DEBIT_NORMAL, yearStart, type AccountType, type FundRestriction } from '../../shared/bookkeeping.ts';
import type { L10n } from '../../shared/types.ts';

interface Sum { account_id: number; fund_id: number; d: number; c: number }
interface AccountRow { id: number; code: string; name: L10n; type: AccountType; kind: string }
interface FundRow { id: number; code: string; name: L10n; restriction: FundRestriction }

const accountsById = () => new Map(all<AccountRow>('SELECT id, code, name, type, kind FROM bk_accounts').map((a) => [a.id, { ...a, name: JSON.parse(a.name as unknown as string) as L10n }]));
const fundsById = () => new Map(all<FundRow>('SELECT id, code, name, restriction FROM bk_funds ORDER BY sort, code').map((f) => [f.id, { ...f, name: JSON.parse(f.name as unknown as string) as L10n }]));

export interface Filter { fund_id?: number; project_id?: number; ministry_id?: number; congregation_id?: number }
function filterSql(f: Filter = {}) {
  const w: string[] = [];
  const p: number[] = [];
  for (const k of ['fund_id', 'project_id', 'ministry_id', 'congregation_id'] as const) if (f[k]) { w.push(`l.${k} = ?`); p.push(f[k]!); }
  return { sql: w.length ? ' AND ' + w.join(' AND ') : '', params: p };
}

/** Sums by account and fund of posted lines dated in [from, to] (from null = since the start); optionally without the opening balances. */
function sums(from: string | null, to: string, f: Filter = {}, withoutOpening = false): Sum[] {
  const x = filterSql(f);
  return all<Sum>(
    `SELECT l.account_id, l.fund_id, SUM(l.debit) d, SUM(l.credit) c FROM bk_lines l JOIN bk_journals j ON j.id = l.journal_id
     WHERE j.status = 'posted' AND j.date <= ? ${from ? 'AND j.date >= ?' : ''}${withoutOpening ? " AND j.kind <> 'opening'" : ''}${x.sql} GROUP BY l.account_id, l.fund_id`,
    ...(from ? [to, from] : [to]), ...x.params,
  );
}
const bal = (type: AccountType, d: number, c: number) => (DEBIT_NORMAL[type] ? d - c : c - d);
const dayBefore = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10);

/** Each fund's balance at a date: its fund-account entries plus its income less expenses, since the start. */
export function fundBalances(asOf: string, f: Filter = {}): Map<number, number> {
  const acc = accountsById();
  const out = new Map<number, number>();
  for (const s of sums(null, asOf, f)) {
    const a = acc.get(s.account_id)!;
    if (a.type === 'asset' || a.type === 'liability') continue;
    out.set(s.fund_id, (out.get(s.fund_id) ?? 0) + (s.c - s.d));
  }
  return out;
}

// ---------------------------------------------------------------- trial balance

export function trialBalance(asOf: string) {
  const acc = accountsById();
  const fy = yearStart(asOf, bkSettings().year_end_month);
  const byAccount = new Map<number, { d: number; c: number }>();
  const add = (id: number, d: number, c: number) => {
    const r = byAccount.get(id) ?? { d: 0, c: 0 };
    r.d += d;
    r.c += c;
    byAccount.set(id, r);
  };
  let priorSurplus = 0;
  for (const s of sums(null, asOf)) {
    const a = acc.get(s.account_id)!;
    if (a.type === 'income' || a.type === 'expense') continue;
    add(s.account_id, s.d, s.c);
  }
  for (const s of sums(fy, asOf)) {
    const a = acc.get(s.account_id)!;
    if (a.type === 'income' || a.type === 'expense') add(s.account_id, s.d, s.c);
  }
  // earlier years' income less expenses: shown with the funds' balance
  for (const s of sums(null, dayBefore(fy))) {
    const a = acc.get(s.account_id)!;
    if (a.type === 'income' || a.type === 'expense') priorSurplus += s.c - s.d;
  }
  const rows = [...byAccount].map(([id, r]) => {
    const a = acc.get(id)!;
    const net = r.d - r.c;
    return { account_id: id, code: a.code, name: a.name, type: a.type, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
  }).filter((r) => r.debit || r.credit).sort((a, b) => (a.code < b.code ? -1 : 1));
  if (priorSurplus) rows.push({ account_id: 0, code: '', name: { en: 'Surplus of earlier years (in the funds)', zh: '往年盈余（已计入基金）' }, type: 'equity', debit: priorSurplus < 0 ? -priorSurplus : 0, credit: priorSurplus > 0 ? priorSurplus : 0 });
  const debit = rows.reduce((n, r) => n + r.debit, 0);
  const credit = rows.reduce((n, r) => n + r.credit, 0);
  return { as_of: asOf, year_start: fy, rows, debit, credit, balanced: debit === credit };
}

// ---------------------------------------------------------------- income and expenditure

export function incomeExpenditure(from: string, to: string, f: Filter = {}) {
  const acc = accountsById();
  const fundRows = fundsById();
  const lines = new Map<number, Map<number, number>>(); // account → fund → amount (positive = normal side)
  const usedFunds = new Set<number>();
  for (const s of sums(from, to, f)) {
    const a = acc.get(s.account_id)!;
    if (a.type !== 'income' && a.type !== 'expense') continue;
    const m = lines.get(s.account_id) ?? new Map<number, number>();
    m.set(s.fund_id, (m.get(s.fund_id) ?? 0) + bal(a.type, s.d, s.c));
    lines.set(s.account_id, m);
    usedFunds.add(s.fund_id);
  }
  const funds = [...fundRows.values()].filter((x) => usedFunds.has(x.id));
  const section = (type: 'income' | 'expense') => {
    const rows = [...lines].filter(([id]) => acc.get(id)!.type === type).map(([id, m]) => {
      const a = acc.get(id)!;
      const by_fund = Object.fromEntries(funds.map((x) => [x.id, m.get(x.id) ?? 0]));
      return { account_id: id, code: a.code, name: a.name, by_fund, total: [...m.values()].reduce((n, v) => n + v, 0) };
    }).sort((a, b) => (a.code < b.code ? -1 : 1));
    const by_fund = Object.fromEntries(funds.map((x) => [x.id, rows.reduce((n, r) => n + (r.by_fund[x.id] ?? 0), 0)]));
    return { rows, by_fund, total: rows.reduce((n, r) => n + r.total, 0) };
  };
  const income = section('income');
  const expense = section('expense');
  const surplus = Object.fromEntries(funds.map((x) => [x.id, (income.by_fund[x.id] ?? 0) - (expense.by_fund[x.id] ?? 0)]));
  return { from, to, filter: f, funds, income, expense, surplus, total_surplus: income.total - expense.total };
}

// ---------------------------------------------------------------- balance sheet

export function balanceSheet(asOf: string) {
  const acc = accountsById();
  const fundRows = fundsById();
  const byAccount = new Map<number, number>();
  for (const s of sums(null, asOf)) {
    const a = acc.get(s.account_id)!;
    if (a.type !== 'asset' && a.type !== 'liability') continue;
    byAccount.set(s.account_id, (byAccount.get(s.account_id) ?? 0) + bal(a.type, s.d, s.c));
  }
  const section = (type: 'asset' | 'liability') => {
    const rows = [...byAccount].filter(([id, v]) => acc.get(id)!.type === type && v !== 0)
      .map(([id, v]) => ({ account_id: id, code: acc.get(id)!.code, name: acc.get(id)!.name, amount: v })).sort((a, b) => (a.code < b.code ? -1 : 1));
    return { rows, total: rows.reduce((n, r) => n + r.amount, 0) };
  };
  const assets = section('asset');
  const liabilities = section('liability');
  const fb = fundBalances(asOf);
  const funds = [...fundRows.values()].filter((x) => fb.get(x.id)).map((x) => ({ fund_id: x.id, code: x.code, name: x.name, restriction: x.restriction, amount: fb.get(x.id)! }));
  const fundsTotal = funds.reduce((n, r) => n + r.amount, 0);
  return { as_of: asOf, assets, liabilities, net_assets: assets.total - liabilities.total, funds, funds_total: fundsTotal, balanced: assets.total - liabilities.total === fundsTotal };
}

// ---------------------------------------------------------------- fund movements

export function fundMovements(from: string, to: string) {
  const acc = accountsById();
  const fundRows = fundsById();
  const closing = fundBalances(to);
  const mv = new Map<number, { income: number; expense: number; transfers: number; other: number }>();
  // the opening balances journal is where a fund starts, not a movement in the year the books begin
  for (const s of sums(from, to, {}, true)) {
    const a = acc.get(s.account_id)!;
    if (a.type === 'asset' || a.type === 'liability') continue;
    const m = mv.get(s.fund_id) ?? { income: 0, expense: 0, transfers: 0, other: 0 };
    if (a.type === 'income') m.income += s.c - s.d;
    else if (a.type === 'expense') m.expense += s.d - s.c;
    else if (a.kind === 'fund_transfer') m.transfers += s.c - s.d;
    else m.other += s.c - s.d;
    mv.set(s.fund_id, m);
  }
  const rows = [...fundRows.values()].map((x) => {
    const m = mv.get(x.id) ?? { income: 0, expense: 0, transfers: 0, other: 0 };
    const end = closing.get(x.id) ?? 0;
    return { fund_id: x.id, code: x.code, name: x.name, restriction: x.restriction, opening: end - (m.income - m.expense + m.transfers + m.other), ...m, closing: end };
  }).filter((r) => r.opening || r.income || r.expense || r.transfers || r.other || r.closing);
  return { from, to, rows };
}

// ---------------------------------------------------------------- by project, ministry or congregation

export type Dimension = 'project' | 'ministry' | 'congregation';
const DIM: Record<Dimension, { col: string; table: string }> = {
  project: { col: 'project_id', table: 'bk_projects' }, ministry: { col: 'ministry_id', table: 'bk_ministries' }, congregation: { col: 'congregation_id', table: 'congregations' },
};

/** Income, expenses and the net for each project / ministry / congregation (and lines with none). */
export function byDimension(dim: Dimension, from: string, to: string) {
  const d = DIM[dim];
  const rows = all<{ tag: number | null; type: AccountType; dd: number; cc: number }>(
    `SELECT l.${d.col} AS tag, a.type, SUM(l.debit) dd, SUM(l.credit) cc FROM bk_lines l JOIN bk_journals j ON j.id = l.journal_id JOIN bk_accounts a ON a.id = l.account_id
     WHERE j.status = 'posted' AND j.date >= ? AND j.date <= ? AND a.type IN ('income','expense') GROUP BY l.${d.col}, a.type`, from, to,
  );
  const names = new Map(all<{ id: number; name: string; code?: string }>(`SELECT * FROM ${d.table}`).map((r) => [r.id, { name: JSON.parse(r.name) as L10n, code: r.code ?? '' }]));
  const by = new Map<number | null, { income: number; expense: number }>();
  for (const r of rows) {
    const m = by.get(r.tag) ?? { income: 0, expense: 0 };
    if (r.type === 'income') m.income += r.cc - r.dd;
    else m.expense += r.dd - r.cc;
    by.set(r.tag, m);
  }
  return {
    dimension: dim, from, to,
    rows: [...by].map(([tag, m]) => ({ id: tag, code: tag ? names.get(tag)?.code ?? '' : '', name: tag ? names.get(tag)?.name ?? { en: `#${tag}` } : null, ...m, net: m.income - m.expense }))
      .sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : a.code < b.code ? -1 : 1)),
  };
}

// ---------------------------------------------------------------- one account's ledger

export function ledger(accountId: number, from: string, to: string, f: Filter = {}) {
  const a = accountsById().get(accountId);
  if (!a) return null;
  const x = filterSql(f);
  // income and expenses start each financial year at nothing
  const since = a.type === 'income' || a.type === 'expense' ? yearStart(from, bkSettings().year_end_month) : null;
  const o = get<{ d: number; c: number }>(
    `SELECT COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c FROM bk_lines l JOIN bk_journals j ON j.id = l.journal_id
     WHERE j.status = 'posted' AND l.account_id = ? AND j.date < ? ${since ? 'AND j.date >= ?' : ''}${x.sql}`, accountId, from, ...(since ? [since] : []), ...x.params,
  )!;
  let running = bal(a.type, o.d, o.c);
  const opening = running;
  const lines = all<{ journal_id: number; number: string; date: string; jmemo: string | null; memo: string | null; fund_id: number; debit: number; credit: number; kind: string }>(
    `SELECT l.journal_id, j.number, j.date, j.memo AS jmemo, l.memo, l.fund_id, l.debit, l.credit, j.kind FROM bk_lines l JOIN bk_journals j ON j.id = l.journal_id
     WHERE j.status = 'posted' AND l.account_id = ? AND j.date >= ? AND j.date <= ?${x.sql} ORDER BY j.date, j.number, l.position`, accountId, from, to, ...x.params,
  ).map((l) => {
    running += bal(a.type, l.debit, l.credit);
    return { ...l, balance: running };
  });
  return { account: a, from, to, opening, closing: running, lines };
}
