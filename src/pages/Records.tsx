// Records → Service records: per service held, attendance, new visitors, notes for the team, offerings and the
// cash count, with a printable cash-count declaration for the counters to sign. Read-only users see attendance and
// notes only (the server leaves money and visitors' contact details out for them).
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, qs, useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Bi, Empty, ErrorBox, Field, Loading, PageHead, Seg, addDays, confirmAction, fmtDate, today, useAction, useSession } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import { InfoTip } from '../components/InfoTip.tsx';
import { HistoryButton } from '../components/LogTools.tsx';
import { CONG_LABEL, CongregationBadge, CongregationFilter, useCongregationFilter, useCongregations } from '../components/Congregations.tsx';
import {
  CURRENCIES, DENOMINATIONS, OFFERING_METHODS, cashTotal, denomLabel, methodTotal, money, parseMoney,
  type OfferingLine, type OfferingMethod, type ServiceRecord, type Visitor,
} from '../../shared/records.ts';
import type { L10n, ServiceFull } from '../types-client.ts';
import './records.css';

interface Row {
  service_id: number;
  date: string;
  start_time: string;
  title: L10n;
  congregation_id: number | null;
  recorded: boolean;
  attendance: number | null;
  children: number | null;
  online: number | null;
  visitors: number;
  offering_total: number | null;
  cash_counted: number | null;
  currency: string;
  verified: boolean;
  has_notes: boolean;
}

const METHOD_LABEL: Record<OfferingMethod, string> = { cash: 'Cash', cheque: 'Cheque', transfer: 'Bank transfer', paynow: 'PayNow', card: 'Card', other: 'Other' };

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
            {seeMoney && <div className="card"><div className="small muted">{t('Offerings')}</div><div className="rec-big">{money(offerings, currency, true)}</div>{unverified > 0 && <div className="small warn-text">{t('{n} cash counts not yet verified').replace('{n}', String(unverified))}</div>}</div>}
          </div>
          {isAdmin && <OfferingSettings />}
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
                      {seeMoney && <td className="right nowrap">{r.offering_total ? money(r.offering_total, r.currency) : ''}</td>}
                      {seeMoney && <td>{r.verified ? <span className="badge ok"><Icon name="check" width={12} height={12} />{t('Verified')}</span> : (r.offering_total ?? 0) > 0 ? <span className="badge warn">{t('Not verified')}</span> : null}</td>}
                      <td className="right">{r.has_notes && <Icon name="text" width={14} height={14} />}{!r.recorded && canEdit && <span className="small muted">{t('Not recorded')}</span>}</td>
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

/** Administrators: the currency counted and the funds offerings can go to. */
function OfferingSettings() {
  const { t } = useI18n();
  const { settings, reloadSettings } = useSession();
  const { run, busy } = useAction();
  const cur = settings?.offering ?? { currency: 'SGD', funds: ['General'] };
  const [currency, setCurrency] = useState(cur.currency);
  const [funds, setFunds] = useState(cur.funds.join('\n'));
  const save = () => run(async () => {
    await api.put('/offering-settings', { currency, funds: funds.split('\n').map((f) => f.trim()).filter(Boolean) });
    reloadSettings();
  }, t('Saved.'));
  return (
    <details className="card rec-settings">
      <summary>{t('Currency and funds')}</summary>
      <div className="row" style={{ gap: 16, alignItems: 'flex-start', marginTop: 10, flexWrap: 'wrap' }}>
        <Field label={t('Currency')}>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        </Field>
        <Field label={<>{t('Funds')} <InfoTip text={t('One per line, e.g. General, Missions, Building. They appear in the offerings list of every record.')} /></>}>
          <textarea rows={4} value={funds} onChange={(e) => setFunds(e.target.value)} style={{ width: 240 }} />
        </Field>
        <button className="btn primary" style={{ alignSelf: 'flex-end' }} onClick={save} disabled={busy}>{t('Save')}</button>
      </div>
    </details>
  );
}

// ================================================================= one service's record

type Rec = ServiceRecord & { saved: boolean; hidden?: string[] };

export function RecordEditor() {
  const { id } = useParams();
  const sid = Number(id);
  const { t, lang } = useI18n();
  const { canEdit, isAdmin, settings } = useSession();
  const congs = useCongregations();
  const svc = useApi<ServiceFull>(`/services/${sid}`);
  const rec = useApi<Rec>(`/services/${sid}/record`);
  const { run, busy } = useAction();
  const [d, setD] = useState<Rec | null>(null);
  useEffect(() => {
    if (rec.data) setD(rec.data);
  }, [rec.data]);
  const funds = settings?.offering?.funds ?? ['General'];

  if (svc.error || rec.error) return <div className="page"><ErrorBox error={(svc.error ?? rec.error)!} /></div>;
  if (!svc.data || !d) return <div className="page"><Loading /></div>;
  const s = svc.data;
  const restricted = !!d.hidden?.length;
  const locked = !!d.verified_at && !isAdmin;
  const cur = d.currency;
  const dirty = JSON.stringify(d) !== JSON.stringify(rec.data);
  const set = (p: Partial<Rec>) => setD((x) => (x ? { ...x, ...p } : x));
  const cashLines = methodTotal(d.offerings, 'cash');
  const counted = cashTotal(d.cash);

  const save = () => run(async () => {
    const body = restricted
      ? { attendance: d.attendance, children: d.children, online: d.online, notes: d.notes }
      : { attendance: d.attendance, children: d.children, online: d.online, notes: d.notes, visitors: d.visitors, offerings: d.offerings, cash: d.cash, counters: d.counters, currency: d.currency };
    const r = await api.put<Rec>(`/services/${sid}/record`, body);
    rec.setData({ ...r, saved: true });
  }, t('Saved.'));
  const verify = (v: boolean) => {
    if (!v && !confirmAction(t('Reopen this cash count? The offerings can then be changed again.'))) return;
    run(async () => {
      if (dirty) await api.put(`/services/${sid}/record`, { offerings: d.offerings, cash: d.cash, counters: d.counters, currency: d.currency });
      const r = await api.post<Rec>(`/services/${sid}/record/verify`, { verified: v });
      rec.setData({ ...r, saved: true });
    }, v ? t('Marked as counted and verified.') : t('Reopened.'));
  };
  const num = (v: number | null, on: (n: number | null) => void, w = 110) => (
    <input type="number" min={0} inputMode="numeric" style={{ width: w }} value={v ?? ''} onChange={(e) => on(e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value))))} />
  );

  return (
    <div className="page rec-page">
      <div className="rec-head">
        <Link className="btn sm ghost" to="/records"><Icon name="chevronLeft" />{t('Service records')}</Link>
        <h1><Bi v={s.title} /></h1>
        <span className="muted">{fmtDate(s.date, lang)} · {s.start_time}</span>
        <CongregationBadge id={s.congregation_id} list={congs} />
        <div className="grow" />
        <Link className="btn sm ghost" to={`/services/${sid}`}><Icon name="calendar" />{t('Open the service')}</Link>
        {isAdmin && d.saved && <HistoryButton entity="service_records" id={d.id} />}
      </div>

      <fieldset disabled={!canEdit} className="bare stack">
        <section className="card stack">
          <h3>{t('Attendance')}</h3>
          <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
            <Field label={<>{t('People present')} <InfoTip text={t('Everyone in the room, adults and children.')} /></>}>{num(d.attendance, (n) => set({ attendance: n }))}</Field>
            <Field label={t('of whom children')}>{num(d.children, (n) => set({ children: n }))}</Field>
            <Field label={<>{t('Online')} <InfoTip text={t('Viewers of a live stream, if you have one.')} /></>}>{num(d.online, (n) => set({ online: n }))}</Field>
          </div>
        </section>

        <section className="card stack">
          <div className="row between">
            <h3>{t('New visitors')} <span className="badge">{d.visitors.length}</span></h3>
            {!restricted && <button className="btn sm" onClick={() => set({ visitors: [...d.visitors, { name: '' }] })}><Icon name="plus" />{t('Add visitor')}</button>}
          </div>
          {restricted && <div className="small muted">{t('Contact details are only shown to editors and administrators.')}</div>}
          {d.visitors.length === 0 ? <div className="small muted">{t('No new visitors recorded.')}</div> : (
            <div className="table-wrap">
              <table className="t rec-visitors">
                <thead><tr><th>{t('Name')}</th>{!restricted && <th>{t('Contact')}</th>}<th>{t('How they came')}</th>{!restricted && <th>{t('Follow-up by')}</th>}{!restricted && <th>{t('Notes')}</th>}{!restricted && <th />}</tr></thead>
                <tbody>
                  {d.visitors.map((v, i) => {
                    const upd = (p: Partial<Visitor>) => set({ visitors: d.visitors.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                    return (
                      <tr key={i}>
                        <td><input value={v.name} onChange={(e) => upd({ name: e.target.value })} placeholder={t('Name')} /></td>
                        {!restricted && <td><input value={v.contact ?? ''} onChange={(e) => upd({ contact: e.target.value })} placeholder={t('Phone or e-mail')} /></td>}
                        <td><input value={v.source ?? ''} onChange={(e) => upd({ source: e.target.value })} placeholder={t('e.g. invited by a friend')} disabled={restricted} /></td>
                        {!restricted && <td><input value={v.follow_up_by ?? ''} onChange={(e) => upd({ follow_up_by: e.target.value })} /></td>}
                        {!restricted && <td><input value={v.notes ?? ''} onChange={(e) => upd({ notes: e.target.value })} /></td>}
                        {!restricted && <td><button className="btn sm ghost icon danger" onClick={() => set({ visitors: d.visitors.filter((_, j) => j !== i) })} aria-label={t('Remove')}><Icon name="trash" /></button></td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!restricted && <div className="small muted pdpa">{t('Visitors’ details are personal data: record only what the church needs to follow up (PDPA).')}</div>}
        </section>

        <section className="card stack">
          <h3>{t('Notes for the team')}</h3>
          <textarea rows={4} value={d.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} placeholder={t('What went well, what to fix next time, prayer needs…')} />
        </section>

        {!restricted && (
          <fieldset disabled={locked} className="bare stack">
            <section className="card stack">
              <div className="row between">
                <h3>{t('Offerings')} <InfoTip text={t('One line per fund and payment method, e.g. General · Cash, Missions · Bank transfer.')} /></h3>
                <div className="row">
                  <label className="small muted row" style={{ gap: 6 }}>{t('Currency')}
                    <select className="mini" value={cur} onChange={(e) => set({ currency: e.target.value, cash: {} })}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                  </label>
                  <button className="btn sm" onClick={() => set({ offerings: [...d.offerings, { fund: funds[0] ?? 'General', method: 'cash', amount: 0 }] })}><Icon name="plus" />{t('Add line')}</button>
                </div>
              </div>
              {d.offerings.length === 0 ? <div className="small muted">{t('No offerings entered yet.')}</div> : (
                <table className="t rec-lines">
                  <thead><tr><th>{t('Fund')}</th><th>{t('Method')}</th><th className="right">{t('Amount')}</th><th>{t('Note')}</th><th /></tr></thead>
                  <tbody>
                    {d.offerings.map((l, i) => (
                      <OfferingRow key={i} line={l} funds={funds} currency={cur}
                        onChange={(p) => set({ offerings: d.offerings.map((x, j) => (j === i ? { ...x, ...p } : x)) })}
                        onRemove={() => set({ offerings: d.offerings.filter((_, j) => j !== i) })} />
                    ))}
                  </tbody>
                  <tfoot>
                    {OFFERING_METHODS.filter((m) => d.offerings.some((l) => l.method === m)).map((m) => (
                      <tr key={m} className="small muted"><td /><td>{t(METHOD_LABEL[m])}</td><td className="right">{money(methodTotal(d.offerings, m), cur)}</td><td colSpan={2} /></tr>
                    ))}
                    <tr><td><strong>{t('Total')}</strong></td><td /><td className="right"><strong>{money(methodTotal(d.offerings), cur, true)}</strong></td><td colSpan={2} /></tr>
                  </tfoot>
                </table>
              )}
            </section>

            <section className="card stack">
              <div className="row between">
                <h3>{t('Cash count')} <InfoTip text={t('Count the notes and coins; Canon adds them up. The count must match the cash lines above before it can be verified.')} /></h3>
                {d.verified_at ? <span className="badge ok"><Icon name="check" width={12} height={12} />{t('Counted and verified')} · {d.verified_by}</span> : null}
              </div>
              <CashCount currency={cur} cash={d.cash} onChange={(cash) => set({ cash })} />
              <div className={`callout small ${counted === cashLines ? '' : 'warn'}`}>
                {t('Counted')}: <strong>{money(counted, cur, true)}</strong> · {t('Cash offerings')}: <strong>{money(cashLines, cur, true)}</strong>
                {counted !== cashLines && <> · {t('Difference')}: <strong>{money(Math.abs(counted - cashLines), cur, true)}</strong></>}
              </div>
              <Field label={<>{t('Counted by')} <InfoTip text={t('At least two people count the cash together and sign the declaration.')} /></>}>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  {[...d.counters, ...Array(Math.max(0, 2 - d.counters.length)).fill('')].map((c: string, i: number) => (
                    <input key={i} value={c} placeholder={`${t('Counter')} ${i + 1}`} style={{ width: 200 }}
                      onChange={(e) => { const next = [...d.counters, ...Array(Math.max(0, 2 - d.counters.length)).fill('')]; next[i] = e.target.value; set({ counters: next }); }} />
                  ))}
                  {d.counters.length >= 2 && d.counters.length < 6 && <button className="btn sm ghost" onClick={() => set({ counters: [...d.counters, ''] })}><Icon name="plus" />{t('Add counter')}</button>}
                </div>
              </Field>
            </section>
          </fieldset>
        )}
      </fieldset>

      <div className="rec-actions">
        {!restricted && <Link className="btn" to={`/records/${sid}/declaration`} target="_blank"><Icon name="print" />{t('Print cash-count declaration')}</Link>}
        <div className="grow" />
        {canEdit && !restricted && (d.verified_at
          ? isAdmin && <button className="btn" onClick={() => verify(false)} disabled={busy}>{t('Reopen cash count')}</button>
          : <button className="btn" onClick={() => verify(true)} disabled={busy || !d.offerings.length}><Icon name="check" />{t('Mark as counted and verified')}</button>)}
        {canEdit && <button className="btn primary" onClick={save} disabled={busy || !dirty}>{t('Save')}</button>}
      </div>
      {locked && <div className="small muted" style={{ textAlign: 'right' }}>{t('The cash count is verified: only an administrator can change the offerings.')}</div>}
    </div>
  );
}

function OfferingRow({ line, funds, currency, onChange, onRemove }: { line: OfferingLine; funds: string[]; currency: string; onChange: (p: Partial<OfferingLine>) => void; onRemove: () => void }) {
  const { t } = useI18n();
  const [text, setText] = useState(line.amount ? money(line.amount, currency).replace(/,/g, '') : '');
  const bad = parseMoney(text, currency) === null;
  return (
    <tr>
      <td>
        <select value={line.fund} onChange={(e) => onChange({ fund: e.target.value })}>
          {[...new Set([...funds, line.fund])].map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </td>
      <td>
        <select value={line.method} onChange={(e) => onChange({ method: e.target.value as OfferingMethod })}>
          {OFFERING_METHODS.map((m) => <option key={m} value={m}>{t(METHOD_LABEL[m])}</option>)}
        </select>
      </td>
      <td className="right">
        <input inputMode="decimal" className={bad ? 'invalid' : ''} style={{ width: 130, textAlign: 'right' }} value={text}
          onChange={(e) => { setText(e.target.value); const v = parseMoney(e.target.value, currency); if (v !== null) onChange({ amount: v }); }} />
      </td>
      <td><input value={line.note ?? ''} onChange={(e) => onChange({ note: e.target.value || undefined })} /></td>
      <td><button className="btn sm ghost icon danger" onClick={onRemove} aria-label={t('Remove')}><Icon name="trash" /></button></td>
    </tr>
  );
}

/** Notes and coins: count × value = subtotal. */
function CashCount({ currency, cash, onChange }: { currency: string; cash: Record<string, number>; onChange: (c: Record<string, number>) => void }) {
  const { t } = useI18n();
  const den = DENOMINATIONS[currency] ?? DENOMINATIONS.SGD;
  const row = (d: number) => {
    const n = cash[String(d)] ?? 0;
    return (
      <tr key={d}>
        <td className="right">{denomLabel(d, currency)}</td>
        <td>×</td>
        <td><input type="number" min={0} inputMode="numeric" style={{ width: 90 }} value={n || ''} onChange={(e) => onChange({ ...cash, [String(d)]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} /></td>
        <td className="right muted">{n ? money(n * d, currency) : ''}</td>
      </tr>
    );
  };
  return (
    <div className="rec-cash">
      <table className="t"><thead><tr><th className="right">{t('Banknotes')}</th><th /><th>{t('Count')}</th><th className="right">{t('Subtotal')}</th></tr></thead><tbody>{den.notes.map(row)}</tbody></table>
      <table className="t"><thead><tr><th className="right">{t('Coins')}</th><th /><th>{t('Count')}</th><th className="right">{t('Subtotal')}</th></tr></thead><tbody>{den.coins.map(row)}</tbody></table>
    </div>
  );
}

// ================================================================= the printable declaration

export function CashDeclaration() {
  const { id } = useParams();
  const sid = Number(id);
  const { t, lt, lang } = useI18n();
  const { settings } = useSession();
  const congs = useCongregations();
  const svc = useApi<ServiceFull>(`/services/${sid}`);
  const rec = useApi<Rec>(`/services/${sid}/record`);
  const r = rec.data;
  const den = r ? DENOMINATIONS[r.currency] ?? DENOMINATIONS.SGD : null;
  const counters = useMemo(() => {
    const named = (r?.counters ?? []).filter((c) => c.trim());
    return [...named, ...Array(Math.max(0, 3 - named.length)).fill('')];
  }, [r]);
  if (svc.error || rec.error) return <ErrorBox error={(svc.error ?? rec.error)!} />;
  if (!svc.data || !r || !den) return <Loading />;
  const s = svc.data;
  const cur = r.currency;
  const c = congs.find((x) => x.id === s.congregation_id);
  const both = (en: string, zh: string) => (lang === 'en' ? en : `${zh} ${en}`);
  const line = (d: number) => {
    const n = r.cash[String(d)] ?? 0;
    return <tr key={d}><td className="right">{denomLabel(d, cur)}</td><td className="right">{n || '—'}</td><td className="right">{n ? money(n * d, cur) : '—'}</td></tr>;
  };
  return (
    <div className="decl">
      <div className="decl-bar no-print">
        <Link className="btn sm ghost" to={`/records/${sid}`}><Icon name="chevronLeft" />{t('Back')}</Link>
        <button className="btn sm primary" onClick={() => window.print()}><Icon name="print" />{t('Print')}</button>
      </div>
      <div className="decl-page">
        <h1>{lt(settings?.church_name ?? { en: 'Church' })}</h1>
        <h2>{both('Offering Count Declaration', '奉献点算声明')}</h2>
        <table className="decl-meta">
          <tbody>
            <tr><th>{both('Service', '聚会')}</th><td><Bi v={s.title} /></td></tr>
            <tr><th>{both('Date', '日期')}</th><td>{fmtDate(s.date, lang)} · {s.start_time}</td></tr>
            {c && <tr><th>{lt(CONG_LABEL)}</th><td>{lt(c.name)}</td></tr>}
            <tr><th>{both('Currency', '货币')}</th><td>{cur}</td></tr>
          </tbody>
        </table>

        <h3>{both('Cash count', '现金点算')}</h3>
        <div className="decl-cash">
          <table><thead><tr><th className="right">{both('Note', '纸币')}</th><th className="right">{both('Count', '张数')}</th><th className="right">{both('Amount', '金额')}</th></tr></thead><tbody>{den.notes.map(line)}</tbody></table>
          <table><thead><tr><th className="right">{both('Coin', '硬币')}</th><th className="right">{both('Count', '枚数')}</th><th className="right">{both('Amount', '金额')}</th></tr></thead><tbody>{den.coins.map(line)}</tbody></table>
        </div>
        <p className="decl-total">{both('Total cash counted', '现金总额')}: <strong>{money(cashTotal(r.cash), cur, true)}</strong></p>

        <h3>{both('Offerings by method', '奉献方式')}</h3>
        <table className="decl-methods">
          <tbody>
            {OFFERING_METHODS.filter((m) => r.offerings.some((l) => l.method === m)).map((m) => (
              <tr key={m}><th>{t(METHOD_LABEL[m])}</th><td className="right">{money(methodTotal(r.offerings, m), cur)}</td></tr>
            ))}
            <tr className="sum"><th>{both('Total offerings', '奉献总额')}</th><td className="right">{money(methodTotal(r.offerings), cur, true)}</td></tr>
          </tbody>
        </table>

        <p className="decl-text">
          {lang === 'en'
            ? `We, the undersigned, declare that we counted the cash offering of the above service together, that the count above is correct, and that the cash was handled and kept as the church requires.`
            : `我们以下签名的同工声明：我们一同点算了上述聚会的现金奉献，以上点算正确无误，并已按教会规定处理及保管现金。 We, the undersigned, declare that we counted the cash offering of the above service together, that the count above is correct, and that the cash was handled and kept as the church requires.`}
        </p>
        <table className="decl-sign">
          <thead><tr><th>{both('Name', '姓名')}</th><th>{both('Signature', '签名')}</th><th>{both('Date', '日期')}</th></tr></thead>
          <tbody>{counters.map((n, i) => <tr key={i}><td>{n}</td><td /><td /></tr>)}</tbody>
        </table>
        {r.verified_at && <p className="small muted">{both('Marked as verified in Canon by', '已在 Canon 中由以下人员确认')} {r.verified_by}, {new Date(r.verified_at).toLocaleString(lang === 'en' ? 'en-GB' : 'zh-CN')}</p>}
      </div>
    </div>
  );
}
