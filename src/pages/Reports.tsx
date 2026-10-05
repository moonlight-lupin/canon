// Records → Reports: attendance, offerings, new visitors, serving, songs and Scripture, membership — for a period and
// (in churches with several) a congregation. Each report can be printed or exported to CSV (opens in Excel).
// Offerings are only offered to editors and administrators (the server refuses them to read-only users), and a
// month's offerings print as a one-page summary for the treasurer.
import { useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { qs, useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Bi, Empty, ErrorBox, Field, Loading, PageHead, Seg, fmtDate, today, useSession } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import { InfoTip } from '../components/InfoTip.tsx';
import { CONG_LABEL, CongregationBadge, CongregationFilter, useCongregationFilter, useCongregations } from '../components/Congregations.tsx';
import { METHOD_LABEL, VISITOR_STATUS_LABEL, money } from '../../shared/records.ts';
import {
  movingAverage, toCsv,
  type AttendanceReport, type MembershipReport, type OfferingsReport, type ReportKind, type ScriptureReport, type ServingReport, type SongsReport, type VisitorsReport, type VisitorStatus,
} from '../../shared/reports.ts';
import { STATUS_LABEL } from './people-common.tsx';
import type { L10n, MemberStatus } from '../types-client.ts';
import './records.css';
import './reports.css';

const TABS: { kind: ReportKind; label: string; money?: boolean }[] = [
  { kind: 'attendance', label: 'Attendance' },
  { kind: 'offerings', label: 'Offerings', money: true },
  { kind: 'visitors', label: 'New visitors' },
  { kind: 'serving', label: 'Serving' },
  { kind: 'songs', label: 'Songs' },
  { kind: 'scripture', label: 'Scripture' },
  { kind: 'membership', label: 'Membership' },
];

type Preset = '3m' | '6m' | '12m' | 'ytd' | 'last' | 'custom';
const monthsAgo = (d: string, n: number) => {
  const dt = new Date(d + 'T00:00:00');
  dt.setMonth(dt.getMonth() - n);
  dt.setDate(dt.getDate() + 1);
  return dt.toISOString().slice(0, 10);
};
function presetRange(p: Preset): [string, string] {
  const t = today();
  const y = Number(t.slice(0, 4));
  if (p === '3m') return [monthsAgo(t, 3), t];
  if (p === '6m') return [monthsAgo(t, 6), t];
  if (p === 'ytd') return [`${y}-01-01`, t];
  if (p === 'last') return [`${y - 1}-01-01`, `${y - 1}-12-31`];
  return [monthsAgo(t, 12), t];
}

/** L10n → "English 中文" for CSV files. */
const both = (v: L10n | null | undefined) => (v ? [v.en, v.zh ?? v['zh-Hant']].filter(Boolean).join(' ') || Object.values(v).find(Boolean) || '' : '');

function download(name: string, rows: (string | number | null | undefined)[][]) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function Reports() {
  const { t, lang } = useI18n();
  const { canEdit } = useSession();
  const [params, setParams] = useSearchParams();
  const tabs = TABS.filter((x) => !x.money || canEdit);
  const kind = (tabs.find((x) => x.kind === params.get('tab'))?.kind ?? 'attendance') as ReportKind;
  const [preset, setPreset] = useState<Preset>('12m');
  const [custom, setCustom] = useState<[string, string]>(() => presetRange('12m'));
  const [from, to] = preset === 'custom' ? custom : presetRange(preset);
  const [cong, setCong, congs] = useCongregationFilter('reports');
  const q = qs({ from, to, congregation: cong });
  const ctx: Ctx = { q, from, to, cong, congs };

  return (
    <div className="page rep-page">
      <PageHead eyebrow={t('Records')} title={t('Reports')} sub={t('Trends and summaries over a period, to print or export to Excel.')}>
        <CongregationFilter value={cong} onChange={setCong} list={congs} />
      </PageHead>
      <div className="rep-bar-top no-print">
        <Seg<ReportKind> value={kind} onChange={(k) => setParams({ tab: k }, { replace: true })} options={tabs.map((x) => ({ value: x.kind, label: t(x.label) }))} />
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)} aria-label={t('Period')}>
            <option value="3m">{t('Last 3 months')}</option>
            <option value="6m">{t('Last 6 months')}</option>
            <option value="12m">{t('Last 12 months')}</option>
            <option value="ytd">{t('This year')}</option>
            <option value="last">{t('Last year')}</option>
            <option value="custom">{t('Choose dates…')}</option>
          </select>
          {preset === 'custom' && (
            <>
              <input type="date" value={custom[0]} max={custom[1]} onChange={(e) => e.target.value && setCustom([e.target.value, custom[1]])} aria-label={t('From')} />
              <span className="muted">–</span>
              <input type="date" value={custom[1]} min={custom[0]} onChange={(e) => e.target.value && setCustom([custom[0], e.target.value])} aria-label={t('To')} />
            </>
          )}
          <button className="btn" onClick={() => window.print()}><Icon name="print" />{t('Print')}</button>
        </div>
      </div>
      <p className="rep-period">{fmtDate(from, lang)} – {fmtDate(to, lang)}</p>
      {kind === 'attendance' && <AttendanceTab {...ctx} />}
      {kind === 'offerings' && canEdit && <OfferingsTab {...ctx} />}
      {kind === 'visitors' && <VisitorsTab {...ctx} />}
      {kind === 'serving' && <ServingTab {...ctx} />}
      {kind === 'songs' && <SongsTab {...ctx} />}
      {kind === 'scripture' && <ScriptureTab {...ctx} />}
      {kind === 'membership' && <MembershipTab {...ctx} />}
    </div>
  );
}

interface Ctx { q: string; from: string; to: string; cong: number | null; congs: ReturnType<typeof useCongregations> }

// ================================================================= building blocks

function Stat({ label, value, sub, tip }: { label: string; value: ReactNode; sub?: ReactNode; tip?: string }) {
  return (
    <div className="card rep-stat">
      <div className="small muted">{label}{tip && <InfoTip text={tip} />}</div>
      <div className="rep-big">{value ?? '—'}</div>
      {sub && <div className="small muted">{sub}</div>}
    </div>
  );
}

function Section({ title, tip, csv, children }: { title: string; tip?: string; csv?: () => void; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <section className="card stack rep-sect">
      <div className="row between">
        <h3>{title}{tip && <InfoTip text={tip} />}</h3>
        {csv && <button className="btn sm ghost no-print" onClick={csv}><Icon name="download" />{t('CSV')}</button>}
      </div>
      {children}
    </section>
  );
}

/** Horizontal bars: label, bar, value. */
function Bars({ items, fmt = String }: { items: { key: string; label: ReactNode; value: number; note?: ReactNode }[]; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <table className="rep-bars">
      <tbody>
        {items.map((i) => (
          <tr key={i.key}>
            <th>{i.label}</th>
            <td className="rep-bar-cell"><div className="rep-bar" style={{ width: `${(i.value / max) * 100}%` }} /></td>
            <td className="right nowrap">{fmt(i.value)}{i.note && <span className="small muted"> {i.note}</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Line chart of values per point, with a dashed moving average. */
function LineChart({ points, label }: { points: { x: string; y: number | null }[]; label: string }) {
  const { t } = useI18n();
  const W = 720;
  const H = 220;
  const pad = { l: 40, r: 12, t: 12, b: 26 };
  const ys = points.map((p) => p.y).filter((v): v is number => v != null);
  if (ys.length < 2) return <div className="small muted">{t('Not enough recorded services for a chart yet.')}</div>;
  const max = Math.ceil(Math.max(...ys) * 1.1);
  const min = Math.max(0, Math.floor(Math.min(...ys) * 0.8));
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, points.length - 1);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - (v - min) / Math.max(1, max - min));
  const path = (vals: (number | null)[]) => {
    let d = '';
    vals.forEach((v, i) => {
      if (v == null) return;
      d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    });
    return d;
  };
  const avg = movingAverage(points.map((p) => p.y), 4);
  const ticks = [min, Math.round((min + max) / 2), max];
  const every = Math.max(1, Math.ceil(points.length / 8));
  return (
    <svg className="rep-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="grid" />
          <text x={pad.l - 6} y={y(v) + 4} textAnchor="end">{v}</text>
        </g>
      ))}
      {points.map((p, i) => (i % every === 0 ? <text key={i} x={x(i)} y={H - 6} textAnchor="middle">{p.x.slice(5)}</text> : null))}
      <path d={path(points.map((p) => p.y))} className="line" />
      <path d={path(avg)} className="avg" />
      {points.map((p, i) => (p.y != null ? <circle key={i} cx={x(i)} cy={y(p.y)} r={2.6} className="dot"><title>{`${p.x}: ${p.y}`}</title></circle> : null))}
    </svg>
  );
}

/** Columns per month. */
function Columns({ items, fmt = String }: { items: { label: string; value: number }[]; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="rep-cols" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((i) => (
        <div key={i.label} className="rep-col" title={`${i.label}: ${fmt(i.value)}`}>
          <span className="v">{i.value ? fmt(i.value) : ''}</span>
          <div className="b" style={{ height: `${(i.value / max) * 100}%` }} />
          <span className="l">{i.label.slice(2)}</span>
        </div>
      ))}
    </div>
  );
}

function useReport<T>(kind: ReportKind, q: string) {
  return useApi<T>(`/reports/${kind}${q}`);
}
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '');

// ================================================================= attendance

function AttendanceTab({ q, congs }: Ctx) {
  const { t, lt, lang } = useI18n();
  const { data: r, error } = useReport<AttendanceReport>('attendance', q);
  if (error) return <ErrorBox error={error} />;
  if (!r) return <Loading />;
  const s = r.summary;
  const change = s.average != null && r.previous.average ? Math.round(((s.average - r.previous.average) / r.previous.average) * 100) : null;
  const recorded = r.rows.filter((x) => x.recorded);
  return (
    <>
      <div className="rep-stats">
        <Stat label={t('Average attendance')} value={s.average != null ? Math.round(s.average) : null} sub={t('{n} of {m} services recorded').replace('{n}', String(s.recorded)).replace('{m}', String(s.services))} />
        <Stat label={t('Same period last year')} value={r.previous.average != null ? Math.round(r.previous.average) : null}
          sub={change != null ? <span className={change >= 0 ? 'ok-text' : 'warn-text'}>{change >= 0 ? '+' : ''}{change}%</span> : t('No records')} />
        <Stat label={t('Highest')} value={s.highest?.value} sub={s.highest ? fmtDate(s.highest.date, lang) : ''} />
        <Stat label={t('of whom children')} value={s.children_average != null ? Math.round(s.children_average) : null} sub={t('on average')} />
        <Stat label={t('Online')} value={s.online_average != null ? Math.round(s.online_average) : null} sub={t('on average')} />
        <Stat label={t('New visitors')} value={s.visitors} />
      </div>
      {!recorded.length ? <div className="card"><Empty title={t('No attendance recorded in this period')}>{t('Attendance is entered on each service’s record (Records → Service records).')}</Empty></div> : (
        <>
          <Section title={t('Attendance per service')} tip={t('Each dot is a service; the dashed line is the average of the last four.')}>
            <LineChart label={t('Attendance per service')} points={recorded.map((x) => ({ x: x.date, y: x.attendance }))} />
          </Section>
          <div className="rep-grid">
            <Section title={t('By month')} csv={() => download(`attendance-months-${r.period.from}.csv`, [['Month', 'Services', 'Average attendance', 'New visitors'], ...r.months.map((m) => [m.month, m.services, m.average, m.visitors])])}>
              <table className="t">
                <thead><tr><th>{t('Month')}</th><th className="right">{t('Services')}</th><th className="right">{t('Average')}</th><th className="right">{t('New visitors')}</th></tr></thead>
                <tbody>{r.months.map((m) => <tr key={m.month}><td>{m.month}</td><td className="right">{m.services}</td><td className="right">{m.average != null ? Math.round(m.average) : '—'}</td><td className="right">{m.visitors || ''}</td></tr>)}</tbody>
              </table>
            </Section>
            {r.congregations.length > 1 && (
              <Section title={lt(CONG_LABEL)}>
                <Bars items={r.congregations.map((c) => ({ key: String(c.congregation_id), label: congs.find((x) => x.id === c.congregation_id) ? lt(congs.find((x) => x.id === c.congregation_id)!.name) : t('Not set'), value: Math.round(c.average ?? 0), note: `(${c.recorded})` }))} />
              </Section>
            )}
          </div>
          <Section title={t('Services')} csv={() => download(`attendance-${r.period.from}-${r.period.to}.csv`, [['Date', 'Time', 'Service', 'Attendance', 'Children', 'Online', 'New visitors'], ...r.rows.map((x) => [x.date, x.start_time, both(x.title), x.attendance, x.children, x.online, x.visitors])])}>
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>{t('Date')}</th><th>{t('Service')}</th><th className="right">{t('Attendance')}</th><th className="right">{t('of whom children')}</th><th className="right">{t('Online')}</th><th className="right">{t('New visitors')}</th></tr></thead>
                <tbody>
                  {[...r.rows].reverse().map((x) => (
                    <tr key={x.service_id}>
                      <td className="nowrap"><Link to={`/records/${x.service_id}`}>{fmtDate(x.date, lang)}</Link></td>
                      <td><CongregationBadge id={x.congregation_id} list={congs} /> <Bi v={x.title} /></td>
                      <td className="right">{x.attendance ?? <span className="muted">—</span>}</td><td className="right">{x.children ?? ''}</td><td className="right">{x.online ?? ''}</td><td className="right">{x.visitors || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </>
  );
}

// ================================================================= offerings

function OfferingsTab({ q, to, cong, congs }: Ctx) {
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

function VisitorsTab({ q, congs }: Ctx) {
  const { t, lang } = useI18n();
  const { data: r, error } = useReport<VisitorsReport>('visitors', q);
  if (error) return <ErrorBox error={error} />;
  if (!r) return <Loading />;
  const total = r.funnel.new;
  const hasContact = r.visitors.some((v) => 'contact' in v);
  return (
    <>
      <div className="rep-stats">
        <Stat label={t('New visitors')} value={total} />
        <Stat label={t('Contacted')} value={r.funnel.contacted} sub={pct(r.funnel.contacted, total)} />
        <Stat label={t('Came back')} value={r.funnel.returning} sub={pct(r.funnel.returning, total)} />
        <Stat label={t('Joined the church')} value={r.funnel.joined} sub={pct(r.funnel.joined, total)} />
      </div>
      {!total ? <div className="card"><Empty title={t('No new visitors recorded in this period')} /></div> : (
        <>
          <div className="rep-grid">
            <Section title={t('Follow-up')} tip={t('Set each visitor’s follow-up on the service record: Contacted, Came back, Joined the church. A visitor who joined is counted in every step before it.')}>
              <Bars items={(['new', 'contacted', 'returning', 'joined'] as VisitorStatus[]).map((s) => ({ key: s, label: t(VISITOR_STATUS_LABEL[s]), value: r.funnel[s], note: pct(r.funnel[s], total) }))} />
            </Section>
            {(r.abouts?.length ?? 0) > 0 && (
              <Section title={t('Who they are')} tip={t('How visitors described themselves on the visitor form (counted; who said what stays on the service records).')}>
                <Bars items={r.abouts!.map((a) => ({ key: a.about, label: a.about, value: a.count }))} />
              </Section>
            )}
            <Section title={t('How they came')}>
              {r.sources.length ? <Bars items={r.sources.slice(0, 12).map((s) => ({ key: s.source, label: s.source, value: s.count }))} /> : <div className="small muted">{t('Not recorded.')}</div>}
            </Section>
          </div>
          <Section title={t('By month')}><Columns items={r.months.map((m) => ({ label: m.month, value: m.count }))} /></Section>
          <Section title={t('Visitors')} csv={() => download(`visitors-${r.period.from}-${r.period.to}.csv`, [['Date', 'Service', 'Name', ...(hasContact ? ['Contact'] : []), 'How they came', 'Follow-up by', 'Follow-up'], ...r.visitors.map((v) => [v.date, both(v.title), v.name, ...(hasContact ? [v.contact] : []), v.source, v.follow_up_by, VISITOR_STATUS_LABEL[v.status]])])}>
            {hasContact && <div className="small muted pdpa">{t('Visitors’ details are personal data: keep exports safe and delete them when done (PDPA).')}</div>}
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>{t('Date')}</th><th>{t('Name')}</th>{hasContact && <th>{t('Contact')}</th>}<th>{t('How they came')}</th><th>{t('Follow-up by')}</th><th>{t('Follow-up')}</th></tr></thead>
                <tbody>
                  {r.visitors.map((v, i) => (
                    <tr key={i}>
                      <td className="nowrap"><Link to={`/records/${v.service_id}`}>{fmtDate(v.date, lang)}</Link> <CongregationBadge id={v.congregation_id} list={congs} /></td>
                      <td>{v.name}</td>{hasContact && <td>{v.contact ?? ''}</td>}<td>{v.source ?? ''}</td><td>{v.follow_up_by ?? ''}</td>
                      <td><span className={`badge ${v.status === 'joined' ? 'ok' : v.status === 'new' ? '' : 'lapis'}`}>{t(VISITOR_STATUS_LABEL[v.status])}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </>
  );
}

// ================================================================= serving

function ServingTab({ q }: Ctx) {
  const { t, lt, lang } = useI18n();
  const { data: r, error } = useReport<ServingReport>('serving', q);
  if (error) return <ErrorBox error={error} />;
  if (!r) return <Loading />;
  const hard = r.roles.filter((x) => x.services > 0 && (x.short > 0 || x.qualified < x.needed * 2));
  return (
    <>
      <div className="rep-stats">
        <Stat label={t('Services')} value={r.services} />
        <Stat label={t('People serving')} value={r.people.filter((p) => p.served).length} />
        <Stat label={t('Most often')} value={r.people[0]?.served ?? null} sub={r.people[0]?.name} />
        <Stat label={t('Team members not rostered')} value={r.idle.length} tip={t('Members of a serving team who were not on the rota in this period.')} />
      </div>
      {hard.length > 0 && (
        <Section title={t('Roles that are hard to fill')} tip={t('Roles that were short of people at some services, or have fewer than twice as many qualified people as each service needs.')}>
          <table className="t">
            <thead><tr><th>{t('Team')}</th><th>{t('Role')}</th><th className="right">{t('Needed')}</th><th className="right">{t('Short at')}</th><th className="right">{t('Declined')}</th><th className="right">{t('Qualified people')}</th></tr></thead>
            <tbody>{hard.map((x) => <tr key={x.role_id}><td>{lt(x.team)}</td><td>{lt(x.role)}</td><td className="right">{x.needed}</td><td className="right">{x.short ? <span className="warn-text">{t('{n} of {m} services').replace('{n}', String(x.short)).replace('{m}', String(x.services))}</span> : ''}</td><td className="right">{x.declined || ''}</td><td className="right">{x.qualified}</td></tr>)}</tbody>
          </table>
        </Section>
      )}
      <Section title={t('How often each person served')} csv={() => download(`serving-${r.period.from}-${r.period.to}.csv`, [['Name', 'Teams', 'Served', 'Confirmed', 'Declined', 'Last served'], ...r.people.map((p) => [p.name, p.teams.join('; '), p.served, p.confirmed, p.declined, p.last_served])])}>
        {!r.people.length ? <div className="small muted">{t('Nobody was on the rota in this period.')}</div> : (
          <Bars items={r.people.slice(0, 40).map((p) => ({ key: String(p.person_id), label: p.name, value: p.served, note: p.declined ? `(${t('declined')} ${p.declined})` : undefined }))} />
        )}
      </Section>
      {r.idle.length > 0 && (
        <Section title={t('Team members not rostered')} csv={() => download(`not-rostered-${r.period.to}.csv`, [['Name', 'Teams', 'Last served'], ...r.idle.map((p) => [p.name, p.teams.join('; '), p.last_served])])}>
          <table className="t">
            <thead><tr><th>{t('Name')}</th><th>{t('Teams')}</th><th>{t('Last served')}</th></tr></thead>
            <tbody>{r.idle.map((p) => <tr key={p.person_id}><td>{p.name}</td><td className="small">{p.teams.join(', ')}</td><td>{p.last_served ? fmtDate(p.last_served, lang) : <span className="muted">{t('Never')}</span>}</td></tr>)}</tbody>
          </table>
        </Section>
      )}
    </>
  );
}

// ================================================================= songs and Scripture

function SongsTab({ q }: Ctx) {
  const { t, lang } = useI18n();
  const { data: r, error } = useReport<SongsReport>('songs', q);
  const [showUnused, setShowUnused] = useState(false);
  if (error) return <ErrorBox error={error} />;
  if (!r) return <Loading />;
  const licensed = r.songs.filter((s) => !s.public_domain);
  return (
    <>
      <div className="rep-stats">
        <Stat label={t('Services')} value={r.services} />
        <Stat label={t('Songs sung')} value={r.songs.length} sub={t('{n} times in all').replace('{n}', String(r.songs.reduce((s, x) => s + x.times, 0)))} />
        <Stat label={t('Under copyright')} value={licensed.length} tip={t('Songs not marked public domain in the library: report their use to your licence (e.g. CCLI).')} />
        <Stat label={t('Not sung in this period')} value={r.unused.length} />
      </div>
      <Section title={t('Songs sung')} csv={() => download(`songs-${r.period.from}-${r.period.to}.csv`, [['Song', 'Times', 'First', 'Last', 'Public domain', 'Copyright', 'CCLI song number'], ...r.songs.map((s) => [both(s.title), s.times, s.first_used, s.last_used, s.public_domain ? 'yes' : 'no', s.copyright, s.ccli])])}>
        {!r.songs.length ? <div className="small muted">{t('No songs in the services of this period.')}</div> : (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>{t('Song')}</th><th className="right">{t('Times')}</th><th>{t('Last sung')}</th><th>{t('Copyright')}</th></tr></thead>
              <tbody>{r.songs.map((s) => <tr key={s.song_id}><td><Bi v={s.title} /></td><td className="right">{s.times}</td><td className="nowrap">{fmtDate(s.last_used, lang)}</td><td className="small">{s.public_domain ? <span className="muted">{t('Public domain')}</span> : <>{s.copyright}{s.ccli ? ` · CCLI ${s.ccli}` : ''}</>}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </Section>
      <Section title={t('Not sung in this period')} csv={() => download(`songs-not-sung-${r.period.to}.csv`, [['Song', 'Category', 'Last sung'], ...r.unused.map((s) => [both(s.title), s.category, s.last_used])])}>
        <button className="btn sm ghost no-print" onClick={() => setShowUnused(!showUnused)}><Icon name={showUnused ? 'chevronDown' : 'chevronRight'} />{t('{n} songs').replace('{n}', String(r.unused.length))}</button>
        {showUnused && (
          <table className="t">
            <thead><tr><th>{t('Song')}</th><th>{t('Last sung')}</th></tr></thead>
            <tbody>{r.unused.map((s) => <tr key={s.song_id}><td><Bi v={s.title} /></td><td>{s.last_used ? fmtDate(s.last_used, lang) : <span className="muted">{t('Never')}</span>}</td></tr>)}</tbody>
          </table>
        )}
      </Section>
    </>
  );
}

// ================================================================= Scripture: every book and chapter

function ScriptureTab({ q, cong }: Ctx) {
  const { t, lang } = useI18n();
  const [years, setYears] = useState<number[]>([]);
  const [onlyCovered, setOnlyCovered] = useState(false);
  const [pick, setPick] = useState<{ book: number; ch: number } | null>(null);
  const url = years.length ? `/reports/scripture${qs({ years: years.join(','), congregation: cong })}` : `/reports/scripture${q}`;
  const { data: r, error } = useApi<ScriptureReport>(url);
  if (error) return <ErrorBox error={error} />;
  if (!r) return <Loading />;
  const tot = r.totals;
  const name = (b: ScriptureReport['books'][number]) => (lang === 'en' ? b.en : lang === 'zh-Hant' ? b.zhT : b.zh);
  const toggleYear = (y: number) => {
    setPick(null);
    setYears((ys) => (ys.includes(y) ? ys.filter((x) => x !== y) : [...ys, y].sort((a, b) => a - b)));
  };
  const picked = pick ? r.passages.filter((x) => x.chapters.some((c) => c.book === pick.book && c.chapters.includes(pick.ch))) : [];
  const unread = r.passages.filter((x) => !x.chapters.length);
  const groups: [string, number, number][] = [[t('Old Testament'), 0, 39], [t('New Testament'), 39, 66]];
  return (
    <>
      <div className="card rep-years no-print">
        <span className="small muted">{t('Years')} <InfoTip text={t('Choose one or more years (they need not follow each other) instead of the period above. Choose none to use the period.')} /></span>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {r.years_available.map((y) => (
            <button key={y} className={`year-chip${years.includes(y) ? ' on' : ''}`} aria-pressed={years.includes(y)} onClick={() => toggleYear(y)}>{y}</button>
          ))}
          {years.length > 0 && <button className="btn sm ghost" onClick={() => { setYears([]); setPick(null); }}>{t('Use the period')}</button>}
        </div>
        <label className="switch small"><input type="checkbox" checked={onlyCovered} onChange={(e) => setOnlyCovered(e.target.checked)} />{t('Only books with readings or sermons')}</label>
      </div>
      {years.length > 0 && <p className="rep-period">{t('Years')}: {years.join(', ')}</p>}
      <div className="rep-stats">
        <Stat label={t('Chapters read or preached')} value={`${tot.covered} / ${tot.chapters}`} sub={pct(tot.covered, tot.chapters)} />
        <Stat label={t('Read')} value={tot.read} sub={t('chapters')} />
        <Stat label={t('Preached')} value={tot.preached} sub={t('chapters')} />
        <Stat label={t('Old Testament')} value={pct(tot.ot_covered, 929) || '0%'} sub={`${tot.ot_covered} / 929`} />
        <Stat label={t('New Testament')} value={pct(tot.nt_covered, 260) || '0%'} sub={`${tot.nt_covered} / 260`} />
        <Stat label={t('Books')} value={`${tot.books_covered} / 66`} />
      </div>
      <Section title={t('Chapters read and preached')} tip={t('Readings are the Scripture items of each service; sermons are the sermon passage. A darker square was read or preached more often. Click a square to see when.')}
        csv={() => download(`scripture-chapters-${r.period.from}-${r.period.to}.csv`, [['Book', 'Chapter', 'Read', 'Preached'], ...r.books.flatMap((b) => b.read.map((n, i) => [b.en, i + 1, n, b.preached[i]]).filter((x) => x[2] || x[3]))])}>
        <div className="heat-legend small">
          <span><i className="heat-cell read l3" />{t('Read')}</span>
          <span><i className="heat-cell preached l3" />{t('Preached')}</span>
          <span><i className="heat-cell both l3" />{t('Read and preached')}</span>
          <span><i className="heat-cell" />{t('Not yet')}</span>
        </div>
        {groups.map(([label, a, b]) => {
          const list = r.books.slice(a, b).filter((bk) => !onlyCovered || bk.read.some(Boolean) || bk.preached.some(Boolean));
          if (!list.length) return null;
          return (
            <div key={label} className="heat-group">
              <h4>{label}</h4>
              {list.map((bk) => (
                <div key={bk.book} className="heat-row">
                  <div className="heat-book">{name(bk)}</div>
                  <div className="heat-cells">
                    {bk.read.map((rd, i) => {
                      const pr = bk.preached[i];
                      const kind = rd && pr ? 'both' : rd ? 'read' : pr ? 'preached' : '';
                      const n = rd + pr;
                      const on = pick?.book === bk.book && pick.ch === i + 1;
                      return (
                        <button key={i} className={`heat-cell ${kind} l${Math.min(3, n)}${on ? ' sel' : ''}`}
                          title={`${name(bk)} ${i + 1}${rd ? ` · ${t('Read')} ${rd}×` : ''}${pr ? ` · ${t('Preached')} ${pr}×` : ''}`}
                          aria-label={`${name(bk)} ${i + 1}`} onClick={() => setPick(on ? null : { book: bk.book, ch: i + 1 })} />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </Section>
      {pick && (
        <Section title={`${name(r.books[pick.book - 1])} ${pick.ch}`}>
          {!picked.length ? <div className="small muted">{t('Not read or preached in this period.')}</div> : (
            <table className="t">
              <tbody>{picked.map((x, i) => <tr key={i}><td className="nowrap"><Link to={`/services/${x.service_id}`}>{fmtDate(x.date, lang)}</Link></td><td><span className={`badge ${x.kind === 'sermon' ? 'reed' : 'lapis'}`}>{t(x.kind === 'sermon' ? 'Sermon' : 'Reading')}</span></td><td>{x.ref}</td></tr>)}</tbody>
            </table>
          )}
        </Section>
      )}
      <Section title={t('Readings and sermons')} csv={() => download(`scripture-${r.period.from}-${r.period.to}.csv`, [['Date', 'Kind', 'Passage'], ...r.passages.map((p) => [p.date, p.kind, p.ref])])}>
        {!r.passages.length ? <div className="small muted">{t('No readings or sermon passages in this period.')}</div> : (
          <details>
            <summary className="small">{t('{n} passages').replace('{n}', String(r.passages.length))}{unread.length ? ` · ${t('{n} not recognised as Bible references').replace('{n}', String(unread.length))}` : ''}</summary>
            <table className="t">
              <tbody>{r.passages.map((x, i) => <tr key={i}><td className="nowrap">{fmtDate(x.date, lang)}</td><td>{t(x.kind === 'sermon' ? 'Sermon' : 'Reading')}</td><td>{x.ref}{!x.chapters.length && <span className="small warn-text"> · {t('not recognised')}</span>}</td></tr>)}</tbody>
            </table>
          </details>
        )}
      </Section>
    </>
  );
}

// ================================================================= membership

function MembershipTab({ q, congs }: Ctx) {
  const { t, lt, lang } = useI18n();
  const { data: r, error } = useReport<MembershipReport>('membership', q);
  if (error) return <ErrorBox error={error} />;
  if (!r) return <Loading />;
  const n = (s: string) => r.by_status.find((x) => x.status === s)?.count ?? 0;
  const GENDER: Record<string, string> = { M: 'Male', F: 'Female', unknown: 'Not recorded' };
  return (
    <>
      <div className="rep-stats">
        <Stat label={t('Members')} value={n('member')} />
        <Stat label={t('Regulars')} value={n('regular')} />
        <Stat label={t('Joined in this period')} value={r.joined.length} tip={t('Membership date in this period.')} />
        <Stat label={t('Baptised in this period')} value={r.baptised.length} />
        <Stat label={t('Added to the register')} value={r.added} />
      </div>
      <div className="rep-grid">
        <Section title={t('By status')} csv={() => download('membership-status.csv', [['Status', 'People'], ...r.by_status.map((s) => [s.status, s.count])])}>
          <Bars items={r.by_status.map((s) => ({ key: s.status, label: t(STATUS_LABEL[s.status as MemberStatus] ?? s.status), value: s.count }))} />
        </Section>
        <Section title={t('By age')} tip={t('Members and regulars, by age at the end of the period.')} csv={() => download('membership-age.csv', [['Age', 'People'], ...r.age_bands.map((b) => [b.band, b.count])])}>
          <Bars items={r.age_bands.map((b) => ({ key: b.band, label: b.band === 'unknown' ? t('No birth date') : b.band, value: b.count }))} />
        </Section>
        <Section title={t('By gender')}>
          <Bars items={r.by_gender.map((g) => ({ key: g.gender, label: t(GENDER[g.gender] ?? g.gender), value: g.count }))} />
        </Section>
        {congs.length > 0 && (
          <Section title={lt(CONG_LABEL)}>
            <Bars items={r.by_congregation.map((c) => ({ key: String(c.congregation_id), label: congs.find((x) => x.id === c.congregation_id) ? lt(congs.find((x) => x.id === c.congregation_id)!.name) : t('Not set'), value: c.count }))} />
          </Section>
        )}
      </div>
      {(r.joined.length > 0 || r.baptised.length > 0) && (
        <div className="rep-grid">
          <Section title={t('Joined')}>
            <table className="t"><tbody>{r.joined.map((p) => <tr key={p.person_id}><td>{p.name}</td><td className="nowrap">{fmtDate(p.date, lang)}</td></tr>)}</tbody></table>
          </Section>
          <Section title={t('Baptised')}>
            <table className="t"><tbody>{r.baptised.map((p) => <tr key={p.person_id}><td>{p.name}</td><td className="nowrap">{fmtDate(p.date, lang)}</td></tr>)}</tbody></table>
          </Section>
        </div>
      )}
    </>
  );
}
