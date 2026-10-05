// Reports: offerings by fund, month and method, and the treasurer's monthly summary.
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { qs, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Bi, Empty, ErrorBox, Field, Loading, fmtDate, useSession } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import { InfoTip } from '../../components/InfoTip.tsx';
import { CongregationBadge, useCongregations } from '../../components/Congregations.tsx';
import { METHOD_LABEL, money } from '../../../shared/records.ts';
import type { OfferingsReport } from '../../../shared/reports.ts';
import { Bars, Columns, type Ctx, download, pct, Section, Stat, useReport } from './charts.tsx';
import '../records.css';
import '../reports.css';

export function OfferingsTab({ q, to, cong, congs }: Ctx) {
  const { t, lang } = useI18n();
  const { data: r, error } = useReport<OfferingsReport>('offerings', q);
  const [month, setMonth] = useState(to.slice(0, 7));
  if (error) return <ErrorBox error={error} />;
  if (!r) return <Loading />;
  const cur = r.currency;
  const m = (n: number) => money(n, cur);
  const cash = r.by_method.find((x) => x.method === 'cash')?.total ?? 0;
  const cell = (month: string, fund: string) => r.by_fund_month.find((x) => x.month === month && x.fund === fund)?.total ?? 0;
  const monthTotal = (month: string) => r.by_fund_month.filter((x) => x.month === month).reduce((s, x) => s + x.total, 0);
  return (
    <>
      <div className="rep-stats">
        <Stat label={t('Offerings')} value={money(r.total, cur, true)} sub={r.other_currencies.map((o) => `+ ${money(o.total, o.currency, true)}`).join(' · ')} />
        <Stat label={t('Cash')} value={m(cash)} sub={pct(cash, r.total)} />
        <Stat label={t('Other methods')} value={m(r.total - cash)} sub={pct(r.total - cash, r.total)} />
        <Stat label={t('Cash counts not yet verified')} value={r.unverified.length} sub={r.unverified[0] ? t('oldest: {n} days').replace('{n}', String(r.unverified[0].days)) : ''} />
      </div>
      <div className="card row rep-month no-print">
        <Field label={<>{t('Monthly summary for the treasurer')} <InfoTip text={t('One printable page per month: totals by fund and method, each service with its cash count, other currencies, and lines to sign.')} /></>}>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </Field>
        <Link className="btn" to={`/reports/offerings/${month}${qs({ congregation: cong })}`} target="_blank"><Icon name="print" />{t('Open the summary')}</Link>
      </div>
      {!r.services.length ? <div className="card"><Empty title={t('No offerings recorded in this period')} /></div> : (
        <>
          <Section title={t('By fund and month')} tip={t('In the church’s currency. Offerings in other currencies are listed separately and never converted.')}
            csv={() => download(`offerings-${r.period.from}-${r.period.to}.csv`, [['Month', ...r.funds, 'Total'], ...r.months.map((mo) => [mo, ...r.funds.map((f) => cell(mo, f) / 100), monthTotal(mo) / 100]), ['Total', ...r.by_fund.map((f) => f.total / 100), r.total / 100]])}>
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>{t('Month')}</th>{r.funds.map((f) => <th key={f} className="right">{f}</th>)}<th className="right">{t('Total')}</th></tr></thead>
                <tbody>{r.months.map((mo) => <tr key={mo}><td>{mo}</td>{r.funds.map((f) => <td key={f} className="right">{cell(mo, f) ? m(cell(mo, f)) : ''}</td>)}<td className="right"><strong>{monthTotal(mo) ? m(monthTotal(mo)) : ''}</strong></td></tr>)}</tbody>
                <tfoot><tr><th>{t('Total')}</th>{r.by_fund.map((f) => <th key={f.fund} className="right">{m(f.total)}</th>)}<th className="right">{money(r.total, cur, true)}</th></tr></tfoot>
              </table>
            </div>
            <Columns items={r.months.map((mo) => ({ label: mo, value: monthTotal(mo) }))} fmt={(n) => money(n, cur).replace(/\.\d+$/, '')} />
          </Section>
          <div className="rep-grid">
            <Section title={t('By payment method')}>
              <Bars items={r.by_method.sort((a, b) => b.total - a.total).map((x) => ({ key: x.method, label: t(METHOD_LABEL[x.method]), value: x.total }))} fmt={m} />
            </Section>
            {r.other_currencies.length > 0 && (
              <Section title={t('Other currencies')} tip={t('Kept in their own currency. “Value once exchanged” is what was entered on the records when the cash was exchanged or banked.')}>
                <table className="t">
                  <thead><tr><th>{t('Currency')}</th><th className="right">{t('Total')}</th><th className="right">{t('of which cash')}</th><th className="right">{t('Value once exchanged')}</th></tr></thead>
                  <tbody>{r.other_currencies.map((o) => <tr key={o.currency}><td>{o.currency}</td><td className="right">{money(o.total, o.currency)}</td><td className="right">{money(o.cash, o.currency)}</td><td className="right">{o.converted ? money(o.converted, cur, true) : '—'}</td></tr>)}</tbody>
                </table>
              </Section>
            )}
          </div>
          {r.unverified.length > 0 && (
            <Section title={t('Cash counts not yet verified')}>
              <table className="t">
                <thead><tr><th>{t('Date')}</th><th>{t('Service')}</th><th className="right">{t('Offerings')}</th><th className="right">{t('Waiting')}</th></tr></thead>
                <tbody>{r.unverified.map((x) => <tr key={x.service_id}><td className="nowrap"><Link to={`/records/${x.service_id}`}>{fmtDate(x.date, lang)}</Link></td><td><CongregationBadge id={x.congregation_id} list={congs} /> <Bi v={x.title} /></td><td className="right">{m(x.total)}</td><td className="right"><span className={x.days > 14 ? 'warn-text' : ''}>{t('{n} days').replace('{n}', String(x.days))}</span></td></tr>)}</tbody>
              </table>
            </Section>
          )}
        </>
      )}
    </>
  );
}

/** One month's offerings on an A4 page for the treasurer (opens without the app's menus). */
export function OfferingsMonth() {
  const { month = '' } = useParams();
  const [params] = useSearchParams();
  const { t, lt, lang } = useI18n();
  const { settings } = useSession();
  const congs = useCongregations();
  const cong = Number(params.get('congregation')) || null;
  const valid = /^\d{4}-\d{2}$/.test(month);
  const last = valid ? new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate() : 28;
  const { data: r, error } = useApi<OfferingsReport>(`/reports/offerings${qs({ from: `${month}-01`, to: `${month}-${last}`, congregation: cong })}`);
  const bi = (en: string, zh: string) => (lang === 'en' ? en : `${zh} ${en}`);
  if (!valid) return <ErrorBox error={t('Choose a month.')} />;
  if (error) return <ErrorBox error={error} />;
  if (!r) return <Loading />;
  const cur = r.currency;
  const c = congs.find((x) => x.id === cong);
  const cash = r.by_method.find((x) => x.method === 'cash')?.total ?? 0;
  return (
    <div className="decl">
      <div className="decl-bar no-print">
        <Link className="btn sm ghost" to="/reports?tab=offerings"><Icon name="chevronLeft" />{t('Reports')}</Link>
        <button className="btn sm primary" onClick={() => window.print()}><Icon name="print" />{t('Print')}</button>
      </div>
      <div className="decl-page">
        <h1>{lt(settings?.church_name ?? { en: 'Church' })}</h1>
        <h2>{bi('Monthly Offerings Summary', '每月奉献汇总')} · {month}{c ? ` · ${lt(c.name)}` : ''}</h2>
        <h3>{bi('By fund', '奉献项目')}</h3>
        <table className="decl-methods">
          <tbody>
            {r.by_fund.map((f) => <tr key={f.fund}><th>{f.fund}</th><td className="right">{money(f.total, cur)}</td></tr>)}
            <tr className="sum"><th>{bi('Total', '总额')}</th><td className="right">{money(r.total, cur, true)}</td></tr>
          </tbody>
        </table>
        <h3>{bi('By payment method', '奉献方式')}</h3>
        <table className="decl-methods">
          <tbody>
            {r.by_method.map((x) => <tr key={x.method}><th>{t(METHOD_LABEL[x.method])}</th><td className="right">{money(x.total, cur)}</td></tr>)}
            <tr className="sum"><th>{bi('of which cash', '其中现金')}</th><td className="right">{money(cash, cur, true)}</td></tr>
          </tbody>
        </table>
        {r.other_currencies.length > 0 && (
          <>
            <h3>{bi('Other currencies (not converted)', '其他货币（未兑换）')}</h3>
            <table className="decl-methods">
              <tbody>{r.other_currencies.map((o) => <tr key={o.currency}><th>{o.currency}</th><td className="right">{money(o.total, o.currency, true)}{o.converted ? ` (${bi('exchanged', '兑换后')}: ${money(o.converted, cur, true)})` : ''}</td></tr>)}</tbody>
            </table>
          </>
        )}
        <h3>{bi('Services', '聚会')}</h3>
        <table className="decl-meta">
          <thead><tr><th>{bi('Date', '日期')}</th><th>{bi('Service', '聚会')}</th><th className="right">{bi('Total', '总额')}</th><th className="right">{bi('Cash', '现金')}</th><th>{bi('Cash count', '现金点算')}</th></tr></thead>
          <tbody>
            {r.services.map((x) => (
              <tr key={x.service_id}>
                <td>{fmtDate(x.date, lang, { day: 'numeric', month: 'short' })}</td>
                <td>{lt(x.title)}</td>
                <td className="right">{money(x.total, cur)}{x.other.map((o) => <div key={o.currency} className="small">+ {money(o.total, o.currency, true)}</div>)}</td>
                <td className="right">{money(x.cash, cur)}</td>
                <td>{x.verified ? `✓ ${x.signed ? bi('signed', '已签名') : ''} ${x.verified_by ?? ''}` : bi('NOT VERIFIED', '未确认')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {r.unverified.length > 0 && <p className="decl-text"><strong>{bi(`${r.unverified.length} cash count(s) not yet verified.`, `${r.unverified.length} 次现金点算尚未确认。`)}</strong></p>}
        <table className="decl-sign" style={{ marginTop: 18 }}>
          <thead><tr><th>{bi('Prepared by', '制表')}</th><th>{bi('Signature', '签名')}</th><th>{bi('Date', '日期')}</th></tr></thead>
          <tbody><tr><td /><td /><td /></tr><tr><td /><td /><td /></tr></tbody>
        </table>
        <p className="small muted">{bi('From Canon service records; amounts in', '根据 Canon 聚会记录；金额单位')} {cur}. {new Date().toLocaleString(lang === 'en' ? 'en-GB' : 'zh-CN')}</p>
      </div>
    </div>
  );
}

// ================================================================= new visitors
