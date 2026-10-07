// Book-keeping reports, from posted journals only: trial balance, income and expenditure (by fund), balance sheet,
// fund movements, income and spending by project / ministry / congregation, and an account's ledger. Each prints
// (with the church's name and the period) and downloads as CSV.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { qs, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Empty, ErrorBox, Loading, fmtDate, today, useSession } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import { useCongregations } from '../../components/Congregations.tsx';
import { downloadTable } from '../../components/xlsx-download.ts';
import { setExportScope } from '../../components/xlsx-download.ts';
import { useEffect } from 'react';
import { ACCOUNT_TYPE_LABEL, FUND_RESTRICTION_LABEL, JOURNAL_KIND_LABEL, yearStart, type AccountType, type FundRestriction, type JournalKind } from '../../../shared/bookkeeping.ts';
import type { L10n } from '../../../shared/types.ts';
import { AccountSelect, FundSelect, TagSelect, csvMoney, fmtMoney, fmtSigned, useBooks } from './common.tsx';

type Report = 'trial_balance' | 'income_expenditure' | 'balance_sheet' | 'fund_movements' | 'by_project' | 'by_ministry' | 'by_congregation' | 'ledger';
const REPORTS: { key: Report; label: string; asOf?: boolean }[] = [
  { key: 'income_expenditure', label: 'Income and expenditure' },
  { key: 'balance_sheet', label: 'Balance sheet', asOf: true },
  { key: 'fund_movements', label: 'Fund movements' },
  { key: 'trial_balance', label: 'Trial balance', asOf: true },
  { key: 'by_project', label: 'By project' },
  { key: 'by_ministry', label: 'By ministry' },
  { key: 'by_congregation', label: 'By congregation' },
  { key: 'ledger', label: 'Account ledger' },
];

interface Acc { account_id: number; code: string; name: L10n }
interface TB { as_of: string; year_start: string; rows: (Acc & { type: AccountType; debit: number; credit: number })[]; debit: number; credit: number; balanced: boolean }
interface FundCol { id: number; code: string; name: L10n }
interface IESection { rows: (Acc & { by_fund: Record<number, number>; total: number })[]; by_fund: Record<number, number>; total: number }
interface IE { from: string; to: string; funds: FundCol[]; income: IESection; expense: IESection; surplus: Record<number, number>; total_surplus: number }
interface BS {
  as_of: string; assets: { rows: (Acc & { amount: number })[]; total: number }; liabilities: { rows: (Acc & { amount: number })[]; total: number };
  net_assets: number; funds: { fund_id: number; code: string; name: L10n; restriction: FundRestriction; amount: number }[]; funds_total: number; balanced: boolean;
}
interface FM { rows: { fund_id: number; code: string; name: L10n; restriction: FundRestriction; opening: number; income: number; expense: number; transfers: number; other: number; closing: number }[] }
interface Dim { rows: { id: number | null; code: string; name: L10n | null; income: number; expense: number; net: number }[] }
interface Ledger {
  account: { id: number; code: string; name: L10n; type: AccountType }; opening: number; closing: number;
  lines: { journal_id: number; number: string; date: string; jmemo: string | null; memo: string | null; fund_id: number; debit: number; credit: number; kind: JournalKind; balance: number }[];
}

export function ReportsTab() {
  const { t, lt, lang } = useI18n();
  const b = useBooks();
  const { settings } = useSession();
  const congs = useCongregations();
  const [sp, setSp] = useSearchParams();
  const s = b.overview.settings;
  const reports = REPORTS.filter((r) => r.key !== 'by_congregation' || congs.length > 1);
  const report = (reports.find((r) => r.key === sp.get('report'))?.key ?? 'income_expenditure') as Report;
  const asOfReport = !!REPORTS.find((r) => r.key === report)?.asOf;
  const fyStart = yearStart(today(), s.year_end_month);
  const [from, setFrom] = useState(s.start_date && s.start_date > fyStart ? s.start_date : fyStart);
  const [to, setTo] = useState(today());
  const [fund, setFund] = useState<number | null>(null);
  const [project, setProject] = useState<number | null>(null);
  const [ministry, setMinistry] = useState<number | null>(null);
  const account = Number(sp.get('account')) || null;
  const setParam = (p: Record<string, string>) => setSp({ tab: 'reports', report, ...(account ? { account: String(account) } : {}), ...p }, { replace: true });
  const title = t(REPORTS.find((r) => r.key === report)!.label);
  const period = asOfReport ? t('As at {date}').replace('{date}', fmtDate(to, lang)) : `${fmtDate(from, lang)} – ${fmtDate(to, lang)}`;
  const file = (name: string) => `${name}-${asOfReport ? to : `${from}-to-${to}`}`;
  // the title block of the Excel files: the report, its period and filters
  useEffect(() => {
    setExportScope({
      report: title,
      period,
      filters: [b.overview.currency, fund ? lt(b.funds.find((f) => f.id === fund)?.name) : '', project ? lt(b.projects.find((x) => x.id === project)?.name) : '', ministry ? lt(b.ministries.find((x) => x.id === ministry)?.name) : '', report === 'ledger' && account ? `${b.accounts.find((a) => a.id === account)?.code ?? ''} ${lt(b.accounts.find((a) => a.id === account)?.name)}` : ''].filter(Boolean),
    });
    return () => setExportScope({});
  }, [title, period, fund, project, ministry, account, report]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="stack bk-reports">
      <div className="row bk-toolbar no-print">
        <select value={report} onChange={(e) => setParam({ report: e.target.value })} aria-label={t('Report')}>
          {reports.map((r) => <option key={r.key} value={r.key}>{t(r.label)}</option>)}
        </select>
        {report === 'ledger' && <div className="bk-acc-filter"><AccountSelect value={account} onChange={(v) => setParam(v ? { account: String(v) } : {})} /></div>}
        {!asOfReport && <><input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label={t('From')} /><span className="muted">–</span></>}
        <input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label={asOfReport ? t('As at') : t('To')} />
        {(report === 'income_expenditure' || report === 'ledger') && (
          <>
            <div className="bk-acc-filter"><FundSelect value={fund} onChange={setFund} empty={t('All funds')} /></div>
            {b.projects.length > 0 && <TagSelect kind="projects" value={project} onChange={setProject} />}
            {b.ministries.length > 0 && <TagSelect kind="ministries" value={ministry} onChange={setMinistry} />}
          </>
        )}
        <div className="grow" />
        <button className="btn" onClick={() => window.print()}><Icon name="print" />{t('Print')}</button>
      </div>
      <div className="bk-report-head">
        <div className="small muted">{lt(settings?.church_name)}</div>
        <h2>{title}</h2>
        <div className="small muted">{period} · {b.overview.currency}{fund ? ` · ${lt(b.funds.find((f) => f.id === fund)?.name)}` : ''}</div>
      </div>
      {report === 'trial_balance' && <TrialBalance asOf={to} file={file('trial-balance')} />}
      {report === 'income_expenditure' && <IncomeExpenditure q={qs({ from, to, fund_id: fund, project_id: project, ministry_id: ministry })} file={file('income-and-expenditure')} />}
      {report === 'balance_sheet' && <BalanceSheet asOf={to} file={file('balance-sheet')} />}
      {report === 'fund_movements' && <FundMovements q={qs({ from, to })} file={file('fund-movements')} />}
      {report === 'by_project' && <ByDim dim="project" q={qs({ from, to })} file={file('by-project')} />}
      {report === 'by_ministry' && <ByDim dim="ministry" q={qs({ from, to })} file={file('by-ministry')} />}
      {report === 'by_congregation' && <ByDim dim="congregation" q={qs({ from, to })} file={file('by-congregation')} />}
      {report === 'ledger' && (account ? <LedgerView id={account} q={qs({ from, to, fund_id: fund, project_id: project, ministry_id: ministry })} file={file('ledger')} /> : <Empty title={t('Choose an account.')} />)}
    </div>
  );
}

/** The report as Excel: amounts as money (every column after the names). */
function CsvButton({ name, rows }: { name: string; rows: () => (string | number | null | undefined)[][] }) {
  const { t } = useI18n();
  const make = () => {
    const r = rows();
    // money: the columns whose values are amounts written as "1234.50"
    const money = (r[0] ?? []).map((_, i) => i).filter((i) => r.slice(1).some((x) => typeof x[i] === 'string' && /^-?\d+\.\d{2}$/.test(String(x[i]))));
    downloadTable(name, r, { money });
  };
  return <button className="btn small no-print" onClick={make}><Icon name="download" />{t('Download (Excel)')}</button>;
}

function useReport<T>(path: string) {
  const r = useApi<T>(path);
  return { ...r, gate: r.error ? <ErrorBox error={r.error} /> : !r.data ? <Loading /> : null };
}

function TrialBalance({ asOf, file }: { asOf: string; file: string }) {
  const { t, lt } = useI18n();
  const r = useReport<TB>(`/bookkeeping/reports/trial-balance${qs({ as_of: asOf })}`);
  if (r.gate) return r.gate;
  const d = r.data!;
  const name = (x: TB['rows'][number]) => (x.account_id === 0 ? t('Surplus of earlier years') : lt(x.name));
  return (
    <div className="card flush">
      <table className="t bk-report">
        <thead><tr><th>{t('Code')}</th><th>{t('Account')}</th><th className="bk-num">{t('Debit')}</th><th className="bk-num">{t('Credit')}</th></tr></thead>
        <tbody>
          {d.rows.map((x) => <tr key={x.account_id}><td>{x.code}</td><td>{name(x)}</td><td className="bk-num">{x.debit ? fmtMoney(x.debit) : ''}</td><td className="bk-num">{x.credit ? fmtMoney(x.credit) : ''}</td></tr>)}
          <tr className="bk-total"><td /><td>{t('Total')} {d.balanced ? <span className="badge ok">{t('Balanced')}</span> : <span className="badge danger">{t('Not balanced')}</span>}</td><td className="bk-num">{fmtMoney(d.debit)}</td><td className="bk-num">{fmtMoney(d.credit)}</td></tr>
        </tbody>
      </table>
      <div className="bk-note row between">
        <span className="small muted">{t('Income and expenses from {date}, the start of the financial year.').replace('{date}', d.year_start)}</span>
        <CsvButton name={file} rows={() => [['Code', 'Account', 'Type', 'Debit', 'Credit'], ...d.rows.map((x) => [x.code, x.account_id === 0 ? 'Surplus of earlier years' : x.name.en ?? lt(x.name), x.type, csvMoney(x.debit), csvMoney(x.credit)]), ['', 'Total', '', csvMoney(d.debit), csvMoney(d.credit)]]} />
      </div>
    </div>
  );
}

function IncomeExpenditure({ q, file }: { q: string; file: string }) {
  const { t, lt } = useI18n();
  const r = useReport<IE>(`/bookkeeping/reports/income-expenditure${q}`);
  if (r.gate) return r.gate;
  const d = r.data!;
  if (!d.income.rows.length && !d.expense.rows.length) return <Empty title={t('Nothing posted in this period.')} />;
  const many = d.funds.length > 1;
  const section = (label: string, s: IESection) => (
    <>
      <tr className="bk-section"><td colSpan={2 + (many ? d.funds.length : 0)}>{label}</td></tr>
      {s.rows.map((x) => (
        <tr key={x.account_id}>
          <td>{x.code} {lt(x.name)}</td>
          {many && d.funds.map((f) => <td key={f.id} className="bk-num">{x.by_fund[f.id] ? fmtSigned(x.by_fund[f.id]) : ''}</td>)}
          <td className="bk-num">{fmtSigned(x.total)}</td>
        </tr>
      ))}
      <tr className="bk-subtotal"><td>{t('Total')} — {label}</td>{many && d.funds.map((f) => <td key={f.id} className="bk-num">{fmtSigned(s.by_fund[f.id])}</td>)}<td className="bk-num">{fmtSigned(s.total)}</td></tr>
    </>
  );
  return (
    <div className="card flush table-wrap">
      <table className="t bk-report">
        <thead><tr><th />{many && d.funds.map((f) => <th key={f.id} className="bk-num">{lt(f.name)}</th>)}<th className="bk-num">{t('Total')}</th></tr></thead>
        <tbody>
          {section(t('Income'), d.income)}
          {section(t('Expenditure'), d.expense)}
          <tr className="bk-total"><td>{d.total_surplus >= 0 ? t('Surplus') : t('Deficit')}</td>{many && d.funds.map((f) => <td key={f.id} className="bk-num">{fmtSigned(d.surplus[f.id])}</td>)}<td className="bk-num">{fmtSigned(d.total_surplus)}</td></tr>
        </tbody>
      </table>
      <div className="bk-note row end">
        <CsvButton name={file} rows={() => {
          const head = ['Code', 'Account', ...d.funds.map((f) => f.code), 'Total'];
          const sec = (label: string, s: IESection) => [[label], ...s.rows.map((x) => [x.code, x.name.en ?? lt(x.name), ...d.funds.map((f) => csvMoney(x.by_fund[f.id] ?? 0)), csvMoney(x.total)]), ['', `Total ${label.toLowerCase()}`, ...d.funds.map((f) => csvMoney(s.by_fund[f.id] ?? 0)), csvMoney(s.total)]];
          return [head, ...sec('Income', d.income), ...sec('Expenditure', d.expense), ['', 'Surplus / (deficit)', ...d.funds.map((f) => csvMoney(d.surplus[f.id] ?? 0)), csvMoney(d.total_surplus)]];
        }} />
      </div>
    </div>
  );
}

function BalanceSheet({ asOf, file }: { asOf: string; file: string }) {
  const { t, lt } = useI18n();
  const r = useReport<BS>(`/bookkeeping/reports/balance-sheet${qs({ as_of: asOf })}`);
  if (r.gate) return r.gate;
  const d = r.data!;
  return (
    <div className="card flush">
      <table className="t bk-report">
        <tbody>
          <tr className="bk-section"><td colSpan={2}>{t(ACCOUNT_TYPE_LABEL.asset)}</td></tr>
          {d.assets.rows.map((x) => <tr key={x.account_id}><td>{x.code} {lt(x.name)}</td><td className="bk-num">{fmtSigned(x.amount)}</td></tr>)}
          <tr className="bk-subtotal"><td>{t('Total assets')}</td><td className="bk-num">{fmtSigned(d.assets.total)}</td></tr>
          <tr className="bk-section"><td colSpan={2}>{t(ACCOUNT_TYPE_LABEL.liability)}</td></tr>
          {d.liabilities.rows.map((x) => <tr key={x.account_id}><td>{x.code} {lt(x.name)}</td><td className="bk-num">{fmtSigned(x.amount)}</td></tr>)}
          <tr className="bk-subtotal"><td>{t('Total liabilities')}</td><td className="bk-num">{fmtSigned(d.liabilities.total)}</td></tr>
          <tr className="bk-total"><td>{t('Net assets')}</td><td className="bk-num">{fmtSigned(d.net_assets)}</td></tr>
          <tr className="bk-section"><td colSpan={2}>{t('Funds‖books')}</td></tr>
          {d.funds.map((x) => <tr key={x.fund_id}><td>{lt(x.name)} <span className="small muted">{t(FUND_RESTRICTION_LABEL[x.restriction])}</span></td><td className="bk-num">{fmtSigned(x.amount)}</td></tr>)}
          <tr className="bk-total"><td>{t('Total funds')} {d.balanced ? <span className="badge ok">{t('Balanced')}</span> : <span className="badge danger">{t('Not balanced')}</span>}</td><td className="bk-num">{fmtSigned(d.funds_total)}</td></tr>
        </tbody>
      </table>
      <div className="bk-note row end">
        <CsvButton name={file} rows={() => [
          ['Section', 'Code', 'Name', 'Amount'],
          ...d.assets.rows.map((x) => ['Assets', x.code, x.name.en ?? lt(x.name), csvMoney(x.amount)]), ['Assets', '', 'Total assets', csvMoney(d.assets.total)],
          ...d.liabilities.rows.map((x) => ['Liabilities', x.code, x.name.en ?? lt(x.name), csvMoney(x.amount)]), ['Liabilities', '', 'Total liabilities', csvMoney(d.liabilities.total)],
          ['', '', 'Net assets', csvMoney(d.net_assets)],
          ...d.funds.map((x) => ['Funds', x.code, x.name.en ?? lt(x.name), csvMoney(x.amount)]), ['Funds', '', 'Total funds', csvMoney(d.funds_total)],
        ]} />
      </div>
    </div>
  );
}

function FundMovements({ q, file }: { q: string; file: string }) {
  const { t, lt } = useI18n();
  const r = useReport<FM>(`/bookkeeping/reports/fund-movements${q}`);
  if (r.gate) return r.gate;
  const d = r.data!;
  if (!d.rows.length) return <Empty title={t('Nothing posted in this period.')} />;
  const sum = (k: 'opening' | 'income' | 'expense' | 'transfers' | 'other' | 'closing') => d.rows.reduce((n, x) => n + x[k], 0);
  const showOther = d.rows.some((x) => x.other);
  return (
    <div className="card flush table-wrap">
      <table className="t bk-report">
        <thead><tr><th>{t('Fund‖books')}</th><th className="bk-num">{t('Opening')}</th><th className="bk-num">{t('Income')}</th><th className="bk-num">{t('Expenditure')}</th><th className="bk-num">{t('Transfers')}</th>{showOther && <th className="bk-num">{t('Other')}</th>}<th className="bk-num">{t('Closing')}</th></tr></thead>
        <tbody>
          {d.rows.map((x) => (
            <tr key={x.fund_id}>
              <td>{lt(x.name)} <div className="small muted">{t(FUND_RESTRICTION_LABEL[x.restriction])}</div></td>
              <td className="bk-num">{fmtSigned(x.opening)}</td><td className="bk-num">{fmtSigned(x.income)}</td><td className="bk-num">{fmtSigned(-x.expense)}</td>
              <td className="bk-num">{x.transfers ? fmtSigned(x.transfers) : ''}</td>{showOther && <td className="bk-num">{x.other ? fmtSigned(x.other) : ''}</td>}<td className="bk-num">{fmtSigned(x.closing)}</td>
            </tr>
          ))}
          <tr className="bk-total"><td>{t('Total')}</td><td className="bk-num">{fmtSigned(sum('opening'))}</td><td className="bk-num">{fmtSigned(sum('income'))}</td><td className="bk-num">{fmtSigned(-sum('expense'))}</td><td className="bk-num">{fmtSigned(sum('transfers'))}</td>{showOther && <td className="bk-num">{fmtSigned(sum('other'))}</td>}<td className="bk-num">{fmtSigned(sum('closing'))}</td></tr>
        </tbody>
      </table>
      <div className="bk-note row end">
        <CsvButton name={file} rows={() => [['Fund', 'Restriction', 'Opening', 'Income', 'Expenditure', 'Transfers', 'Other', 'Closing'], ...d.rows.map((x) => [x.code, x.restriction, csvMoney(x.opening), csvMoney(x.income), csvMoney(-x.expense), csvMoney(x.transfers), csvMoney(x.other), csvMoney(x.closing)])]} />
      </div>
    </div>
  );
}

function ByDim({ dim, q, file }: { dim: 'project' | 'ministry' | 'congregation'; q: string; file: string }) {
  const { t, lt } = useI18n();
  const r = useReport<Dim>(`/bookkeeping/reports/by/${dim}${q}`);
  if (r.gate) return r.gate;
  const d = r.data!;
  if (!d.rows.length) return <Empty title={t('Nothing posted in this period.')} />;
  const none = dim === 'project' ? t('No project') : dim === 'ministry' ? t('No ministry') : t('No congregation');
  return (
    <div className="card flush table-wrap">
      <table className="t bk-report">
        <thead><tr><th /><th className="bk-num">{t('Income')}</th><th className="bk-num">{t('Expenditure')}</th><th className="bk-num">{t('Net')}</th></tr></thead>
        <tbody>
          {d.rows.map((x) => (
            <tr key={x.id ?? 'none'} className={x.id === null ? 'muted' : ''}><td>{x.id === null ? none : lt(x.name)}</td><td className="bk-num">{fmtSigned(x.income)}</td><td className="bk-num">{fmtSigned(x.expense)}</td><td className="bk-num">{fmtSigned(x.net)}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="bk-note row end">
        <CsvButton name={file} rows={() => [['Code', 'Name', 'Income', 'Expenditure', 'Net'], ...d.rows.map((x) => [x.code, x.name ? x.name.en ?? lt(x.name) : `(${none})`, csvMoney(x.income), csvMoney(x.expense), csvMoney(x.net)])]} />
      </div>
    </div>
  );
}

function LedgerView({ id, q, file }: { id: number; q: string; file: string }) {
  const { t, lt, lang } = useI18n();
  const b = useBooks();
  const r = useReport<Ledger>(`/bookkeeping/reports/ledger/${id}${q}`);
  if (r.gate) return r.gate;
  const d = r.data!;
  const fund = (fid: number) => b.funds.find((f) => f.id === fid)?.code ?? '';
  return (
    <div className="card flush table-wrap">
      <h3 className="bk-card-title">{d.account.code} {lt(d.account.name)}</h3>
      <table className="t bk-report">
        <thead><tr><th>{t('Date')}</th><th>{t('Journal')}</th><th>{t('Narration')}</th><th>{t('Fund‖books')}</th><th className="bk-num">{t('Debit')}</th><th className="bk-num">{t('Credit')}</th><th className="bk-num">{t('Balance')}</th></tr></thead>
        <tbody>
          <tr className="bk-subtotal"><td colSpan={6}>{t('Brought forward')}</td><td className="bk-num">{fmtSigned(d.opening)}</td></tr>
          {d.lines.map((l, i) => (
            <tr key={i} className="click" onClick={() => b.go('journals', { open: String(l.journal_id) })}>
              <td className="nowrap">{fmtDate(l.date, lang, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
              <td className="nowrap"><span className="code">{l.number}</span></td>
              <td>{l.memo ?? l.jmemo}<span className="small muted"> · {t(JOURNAL_KIND_LABEL[l.kind])}</span></td>
              <td className="small">{fund(l.fund_id)}</td>
              <td className="bk-num">{l.debit ? fmtMoney(l.debit) : ''}</td><td className="bk-num">{l.credit ? fmtMoney(l.credit) : ''}</td><td className="bk-num">{fmtSigned(l.balance)}</td>
            </tr>
          ))}
          <tr className="bk-total"><td colSpan={6}>{t('Closing balance')}</td><td className="bk-num">{fmtSigned(d.closing)}</td></tr>
        </tbody>
      </table>
      <div className="bk-note row end">
        <CsvButton name={file} rows={() => [['Date', 'Journal', 'Narration', 'Fund', 'Debit', 'Credit', 'Balance'], ['', '', 'Brought forward', '', '', '', csvMoney(d.opening)], ...d.lines.map((l) => [l.date, l.number, l.memo ?? l.jmemo, fund(l.fund_id), csvMoney(l.debit || null), csvMoney(l.credit || null), csvMoney(l.balance)])]} />
      </div>
    </div>
  );
}
