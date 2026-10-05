// Records → Service records: per service held, attendance, new visitors, notes for the team, offerings and the
// cash count, with a printable cash-count declaration for the counters to sign — on paper, or on screen with
// signature pads (Currency and funds → Signing). Offerings in another currency are counted and totalled separately.
// Read-only users see attendance and notes only (the server leaves money and visitors' contact details out for them).
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { qs, useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Bi, Empty, ErrorBox, Loading, PageHead, Seg, addDays, fmtDate, today, useSession } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import { CongregationBadge, CongregationFilter, useCongregationFilter } from '../components/Congregations.tsx';
import { money } from '../../shared/records.ts';
import type { L10n } from '../types-client.ts';
import './records.css';

interface Row {
  service_id: number;
  date: string;
  start_time: string;
  title: L10n;
  congregation_id: number | null;
  recorded: boolean;
  archived_year?: number | null;
  attendance: number | null;
  children: number | null;
  online: number | null;
  visitors: number;
  offering_total: number | null;
  cash_counted: number | null;
  /** offerings in other currencies than the record's, kept apart from offering_total */
  other_currencies?: { currency: string; total: number }[];
  currency: string;
  verified: boolean;
  has_notes: boolean;
  /** visitor-form entries waiting for review */
  pending_cards?: number;
}

// ================================================================= the list

export default function Records() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const { canEdit, isAdmin } = useSession();
  const [range, setRange] = useState<'8' | '26' | '52'>('8');
  const [cong, setCong, congs] = useCongregationFilter('records');
  const from = addDays(today(), -Number(range) * 7);
  const { data, error } = useApi<Row[]>(`/records${qs({ from, to: today(), congregation: cong })}`);
  const rows = data ?? [];
  const recorded = rows.filter((r) => r.attendance != null);
  const avg = recorded.length ? Math.round(recorded.reduce((s, r) => s + (r.attendance ?? 0), 0) / recorded.length) : null;
  const visitors = rows.reduce((s, r) => s + r.visitors, 0);
  const currency = rows.find((r) => r.recorded)?.currency ?? 'SGD';
  const offerings = rows.reduce((s, r) => s + (r.offering_total ?? 0), 0);
  const others = new Map<string, number>();
  for (const r of rows) for (const o of r.other_currencies ?? []) others.set(o.currency, (others.get(o.currency) ?? 0) + o.total);
  const unverified = rows.filter((r) => r.recorded && (r.offering_total ?? 0) > 0 && !r.verified).length;
  // read-only users get no money from the server; editors always see the columns
  const seeMoney = canEdit || rows.some((r) => r.offering_total !== null);

  return (
    <div className="page">
      <PageHead eyebrow={t('Records')} title={t('Service records')} sub={t('Attendance, new visitors, notes for the team and offerings, for each service held.')}>
        <CongregationFilter value={cong} onChange={setCong} list={congs} />
        <Seg value={range} onChange={setRange} options={[{ value: '8', label: t('8 weeks') }, { value: '26', label: t('6 months') }, { value: '52', label: t('12 months') }]} />
      </PageHead>
      {error && <ErrorBox error={error} />}
      {!data ? <Loading /> : (
        <>
          <div className="rec-stats">
            <div className="card"><div className="small muted">{t('Average attendance')}</div><div className="rec-big">{avg ?? '—'}</div><div className="small muted">{t('{n} services recorded').replace('{n}', String(recorded.length))}</div></div>
            <div className="card"><div className="small muted">{t('New visitors')}</div><div className="rec-big">{visitors}</div></div>
            {seeMoney && <div className="card"><div className="small muted">{t('Offerings')}</div><div className="rec-big">{money(offerings, currency, true)}</div>{[...others].map(([c, v]) => <div key={c} className="small muted">+ {money(v, c, true)}</div>)}{unverified > 0 && <div className="small warn-text">{t('{n} cash counts not yet verified').replace('{n}', String(unverified))}</div>}</div>}
          </div>
          {isAdmin && <div className="small muted rec-settings-link"><Icon name="settings" width={13} height={13} /> {t('Currency, funds and how counters sign are set in')} <Link to="/settings?tab=offerings">{t('Settings → Offerings')}</Link></div>}
          {!rows.length ? <div className="card"><Empty title={t('No services in this period')} /></div> : (
            <div className="card flush table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>{t('Date')}</th><th>{t('Service')}</th><th className="right">{t('Attendance')}</th><th className="right">{t('New visitors')}</th>
                    {seeMoney && <th className="right">{t('Offerings')}</th>}{seeMoney && <th>{t('Cash count')}</th>}<th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.service_id} className="click" onClick={() => nav(`/records/${r.service_id}`)}>
                      <td className="nowrap"><Link to={`/records/${r.service_id}`} onClick={(e) => e.stopPropagation()}><strong>{fmtDate(r.date, lang)}</strong></Link> <span className="muted">{r.start_time}</span></td>
                      <td><CongregationBadge id={r.congregation_id} list={congs} /> <Bi v={r.title} /></td>
                      <td className="right">{r.attendance ?? <span className="muted">—</span>}{r.online ? <span className="small muted"> +{r.online} {t('online')}</span> : null}</td>
                      <td className="right">{r.visitors || ''}</td>
                      {seeMoney && <td className="right nowrap">{r.offering_total ? money(r.offering_total, r.currency) : ''}{(r.other_currencies ?? []).map((o) => <div key={o.currency} className="small muted">+ {money(o.total, o.currency, true)}</div>)}</td>}
                      {seeMoney && <td>{r.verified ? <span className="badge ok"><Icon name="check" width={12} height={12} />{t('Verified')}</span> : (r.offering_total ?? 0) > 0 ? <span className="badge warn">{t('Not verified')}</span> : null}</td>}
                      <td className="right">{(r.pending_cards ?? 0) > 0 && <span className="badge warn" title={t('Visitor cards to review')}>{r.pending_cards} {t('to review')}</span>} {r.has_notes && <Icon name="text" width={14} height={14} />}{r.archived_year ? <span className="badge" title={t('Read-only: open it from Settings → Security & privacy')}>{t('Archived')} {r.archived_year}</span> : !r.recorded && canEdit && <span className="small muted">{t('Not recorded')}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ================================================================= one service's record
