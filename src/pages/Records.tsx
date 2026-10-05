// Records → Service records: per service held, attendance, new visitors, notes for the team, offerings and the
// cash count, with a printable cash-count declaration for the counters to sign — on paper, or on screen with
// signature pads (Currency and funds → Signing). Offerings in another currency are counted and totalled separately.
// Read-only users see attendance and notes only (the server leaves money and visitors' contact details out for them).
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, qs, useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Bi, Empty, ErrorBox, Field, Loading, PageHead, Seg, addDays, confirmAction, fmtDate, today, useAction, useSession } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import { InfoTip } from '../components/InfoTip.tsx';
import { HistoryButton } from '../components/LogTools.tsx';
import { VisitorCardsReview } from './VisitorForm.tsx';
import { sourceLabel } from '../../shared/visitor-form.ts';
import { CONG_LABEL, CongregationBadge, CongregationFilter, useCongregationFilter, useCongregations } from '../components/Congregations.tsx';
import {
  CURRENCIES, DENOMINATIONS, METHOD_LABEL, OFFERING_METHODS, cashTotal, countProblems, denomLabel, foreignCounted, foreignCurrencies, methodTotal, money, parseMoney,
  VISITOR_STATUSES, VISITOR_STATUS_LABEL, type ForeignCash, type OfferingLine, type OfferingMethod, type ServiceRecord, type Visitor, type VisitorStatus,
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
                      <td className="right">{(r.pending_cards ?? 0) > 0 && <span className="badge warn" title={t('Visitor cards to review')}>{r.pending_cards} {t('to review')}</span>} {r.has_notes && <Icon name="text" width={14} height={14} />}{!r.recorded && canEdit && <span className="small muted">{t('Not recorded')}</span>}</td>
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

type Rec = ServiceRecord & { saved: boolean; hidden?: string[] };

export function RecordEditor() {
  const { id } = useParams();
  const sid = Number(id);
  const nav = useNavigate();
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
  // the visitor form's answers, suggested when typing "How they came"
  const sourceOptions = (settings?.visitor_form?.sources ?? []).map((o) => sourceLabel(o, settings?.languages?.[0])).filter(Boolean);
  const onScreen = settings?.offering?.signing === 'screen';
  const minCount = Math.min(6, Math.max(2, settings?.offering?.min_counters ?? 2));
  const [signer, setSigner] = useState('');
  const [ink, setInk] = useState<string | null>(null);
  const [padKey, setPadKey] = useState(0);

  if (svc.error || rec.error) return <div className="page"><ErrorBox error={(svc.error ?? rec.error)!} /></div>;
  if (!svc.data || !d) return <div className="page"><Loading /></div>;
  const s = svc.data;
  const restricted = !!d.hidden?.length;
  // a verified count is locked for everyone; an administrator reopens it to correct it
  const locked = !!d.verified_at;
  const cur = d.currency;
  const dirty = JSON.stringify(d) !== JSON.stringify(rec.data);
  const set = (p: Partial<Rec>) => setD((x) => (x ? { ...x, ...p } : x));
  const cashLines = methodTotal(d.offerings, 'cash', cur, cur);
  const counted = cashTotal(d.cash);
  const foreign = foreignCurrencies(d.offerings, cur);
  const problems = countProblems(d);
  const sigs = d.signatures ?? [];
  const setForeign = (c: string, p: Partial<ForeignCash>) => set({ foreign_cash: { ...d.foreign_cash, [c]: { ...d.foreign_cash?.[c], ...p } } });

  const body = () => restricted
    ? { attendance: d.attendance, children: d.children, online: d.online, notes: d.notes }
    : locked
      ? { attendance: d.attendance, children: d.children, online: d.online, notes: d.notes, visitors: d.visitors, offerings: d.offerings }
      : {
        attendance: d.attendance, children: d.children, online: d.online, notes: d.notes, visitors: d.visitors, offerings: d.offerings, cash: d.cash, counters: d.counters, currency: d.currency, counted_on: d.counted_on ?? null,
        // counts of currencies no longer in the offerings are dropped
        foreign_cash: Object.fromEntries(Object.entries(d.foreign_cash ?? {}).filter(([c]) => foreign.includes(c))),
      };
  const save = () => run(async () => {
    const r = await api.put<Rec>(`/services/${sid}/record`, body(), rec.data?.saved ? rec.data.updated_at : null);
    rec.setData({ ...r, saved: true });
  }, t('Saved.'));
  const verify = (v: boolean) => {
    if (!v && !confirmAction(t('Reopen this cash count? The offerings can then be changed again.'))) return;
    run(async () => {
      if (dirty) await api.put(`/services/${sid}/record`, body());
      const r = await api.post<Rec>(`/services/${sid}/record/verify`, { verified: v });
      rec.setData({ ...r, saved: true });
    }, v ? t('Marked as counted and verified.') : t('Reopened.'));
  };
  const finish = () => run(async () => {
    if (dirty) await api.put(`/services/${sid}/record`, body());
    const r = await api.post<Rec>(`/services/${sid}/record/finish`, {});
    rec.setData({ ...r, saved: true });
  }, t('Signing finished: the count is verified.'));
  const sign = () => run(async () => {
    if (dirty || !d.saved) await api.put(`/services/${sid}/record`, body());
    const r = await api.post<Rec>(`/services/${sid}/record/sign`, { name: signer, image: ink });
    rec.setData({ ...r, saved: true });
    setSigner('');
    setInk(null);
    setPadKey((k) => k + 1);
  }, t('Signed.'));
  const removeRecord = () => {
    if (!confirmAction(t('Delete this service record — attendance, visitors, notes and offerings? Only do this if it was entered by mistake. The change log keeps a copy.'))) return;
    run(async () => {
      await api.del(`/services/${sid}/record`);
      nav('/records');
    }, t('Deleted.'));
  };
  const unsign = (name: string) => {
    if (!confirmAction(t('Remove the signature of {name}?').replace('{name}', name))) return;
    run(async () => {
      const r = await api.post<Rec>(`/services/${sid}/record/unsign`, { name });
      rec.setData({ ...r, saved: true });
    }, t('Removed.'));
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
                <thead><tr><th>{t('Name')}</th>{!restricted && <th>{t('Contact')}</th>}<th>{t('How they came')}</th>{!restricted && <th>{t('Follow-up by')}</th>}<th>{t('Follow-up')} <InfoTip text={t('How far the follow-up has come. Records → Reports → New visitors counts each step.')} /></th>{!restricted && <th>{t('Notes')}</th>}{!restricted && <th />}</tr></thead>
                <tbody>
                  {d.visitors.map((v, i) => {
                    const upd = (p: Partial<Visitor>) => set({ visitors: d.visitors.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                    return (
                      <Fragment key={i}>
                      <tr>
                        <td><input value={v.name} onChange={(e) => upd({ name: e.target.value })} placeholder={t('Name')} /></td>
                        {!restricted && <td><input value={v.contact ?? ''} onChange={(e) => upd({ contact: e.target.value })} placeholder={t('Phone or e-mail')} /></td>}
                        <td><input value={v.source ?? ''} list="rec-sources" onChange={(e) => upd({ source: e.target.value })} placeholder={t('e.g. invited by a friend')} disabled={restricted} /></td>
                        {!restricted && <td><input value={v.follow_up_by ?? ''} onChange={(e) => upd({ follow_up_by: e.target.value })} /></td>}
                        <td><select value={v.status ?? 'new'} disabled={restricted} onChange={(e) => upd({ status: e.target.value === 'new' ? undefined : (e.target.value as VisitorStatus) })}>{VISITOR_STATUSES.map((s) => <option key={s} value={s}>{t(VISITOR_STATUS_LABEL[s])}</option>)}</select></td>
                        {!restricted && <td><input value={v.notes ?? ''} onChange={(e) => upd({ notes: e.target.value })} /></td>}
                        {!restricted && <td><button className="btn sm ghost icon danger" onClick={() => set({ visitors: d.visitors.filter((_, j) => j !== i) })} aria-label={t('Remove')}><Icon name="trash" /></button></td>}
                      </tr>
                      {!restricted && (v.prayer || v.about) && (
                        <tr className="rec-prayer"><td colSpan={7} className="small">
                          {v.about && <><strong>{t('About them')}:</strong> {v.about}{v.prayer ? ' · ' : ''}</>}
                          {v.prayer && <><strong>{t('Prayer request')}:</strong> {v.prayer}</>}
                        </td></tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <datalist id="rec-sources">{sourceOptions.map((s) => <option key={s} value={s} />)}</datalist>
          {!restricted && <div className="small muted pdpa">{t('Visitors’ details are personal data: record only what the church needs to follow up (PDPA).')}</div>}
        </section>

        {!restricted && canEdit && <VisitorCardsReview serviceId={sid} onAccepted={() => rec.reload()} />}

        <section className="card stack">
          <h3>{t('Notes for the team')}</h3>
          <textarea rows={4} value={d.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} placeholder={t('What went well, what to fix next time, prayer needs…')} />
        </section>

        {!restricted && (
          <div className="stack">
            <section className="card stack">
              <div className="row between rec-off-head">
                <h3>{t('Offerings')} <InfoTip text={t('One line per fund and payment method, e.g. General · Cash, Missions · Bank transfer.')} /></h3>
                <div className="rec-off-tools">
                  <label className="rec-inline small muted">{t('Currency')}
                    <select className="mini" value={cur} disabled={locked} onChange={(e) => set({ currency: e.target.value, cash: {} })}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                  </label>
                  <button className="btn sm" onClick={() => set({ offerings: [...d.offerings, { fund: funds[0] ?? 'General', method: locked ? 'transfer' : 'cash', amount: 0 }] })}><Icon name="plus" />{t('Add line')}</button>
                </div>
              </div>
              {locked && <div className="small muted">{t('The cash is verified and locked. Offerings by other methods (e.g. a bank transfer received later) can still be added.')}</div>}
              {d.offerings.length === 0 ? <div className="small muted">{t('No offerings entered yet.')}</div> : (
                <div className="table-wrap"><table className="t rec-lines">
                  <thead><tr><th>{t('Fund')}</th><th>{t('Method')}</th><th>{t('Currency')} <InfoTip text={t('For the odd gift in another currency, e.g. a USD note. Each currency is counted and totalled on its own; nothing is converted.')} /></th><th className="right">{t('Amount')}</th><th>{t('Note')}</th><th /></tr></thead>
                  <tbody>
                    {d.offerings.map((l, i) => (
                      <OfferingRow key={i} line={l} funds={funds} currency={cur} cashLocked={locked}
                        onChange={(p) => set({ offerings: d.offerings.map((x, j) => (j === i ? { ...x, ...p } : x)) })}
                        onRemove={() => set({ offerings: d.offerings.filter((_, j) => j !== i) })} />
                    ))}
                  </tbody>
                  <tfoot>
                    {OFFERING_METHODS.filter((m) => d.offerings.some((l) => l.method === m && (l.currency ?? cur) === cur)).map((m) => (
                      <tr key={m} className="small muted"><td /><td>{t(METHOD_LABEL[m])}</td><td /><td className="right">{money(methodTotal(d.offerings, m, cur, cur), cur)}</td><td colSpan={2} /></tr>
                    ))}
                    <tr><td><strong>{t('Total')}</strong></td><td /><td /><td className="right"><strong>{money(methodTotal(d.offerings, undefined, cur, cur), cur, true)}</strong></td><td colSpan={2} /></tr>
                    {foreign.map((c) => (
                      <tr key={c}><td><strong>{t('Total')} {c}</strong></td><td colSpan={2} className="small muted">{t('kept apart, not converted')}</td><td className="right"><strong>{money(methodTotal(d.offerings, undefined, c, cur), c, true)}</strong></td><td colSpan={2} /></tr>
                    ))}
                  </tfoot>
                </table></div>
              )}
            </section>

            <fieldset disabled={locked} className="bare stack">
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
              {foreign.map((c) => {
                const f = d.foreign_cash?.[c] ?? {};
                const got = foreignCounted(f);
                const due = methodTotal(d.offerings, 'cash', c, cur);
                return (
                  <div key={c} className="rec-foreign stack">
                    <h4>{t('Cash in {c}').replace('{c}', c)}</h4>
                    {DENOMINATIONS[c]
                      ? <CashCount currency={c} cash={f.cash ?? {}} onChange={(cash) => setForeign(c, { cash })} />
                      : <Field label={<>{t('Counted total')} <InfoTip text={t('Canon has no list of notes and coins for this currency: enter the total counted.')} /></>}><MoneyInput value={f.total ?? 0} currency={c} onChange={(v) => setForeign(c, { total: v ?? 0 })} /></Field>}
                    <div className={`callout small ${got === due ? '' : 'warn'}`}>
                      {t('Counted')}: <strong>{money(got, c, true)}</strong> · {t('Cash offerings')}: <strong>{money(due, c, true)}</strong>
                      {got !== due && <> · {t('Difference')}: <strong>{money(Math.abs(got - due), c, true)}</strong></>}
                    </div>
                    <Field label={<>{t('Value in {c} once exchanged').replace('{c}', cur)} <InfoTip text={t('Optional: what this cash was worth in the church’s currency when it was exchanged or banked. For the treasurer; it is not added to the totals.')} /></>}>
                      <MoneyInput value={f.converted ?? null} currency={cur} empty onChange={(v) => setForeign(c, { converted: v })} />
                    </Field>
                  </div>
                );
              })}
              <Field label={<>{t('Date counted')} <InfoTip text={t('The day the cash was counted. It is printed on the declaration; left empty, the service date is used.')} /></>}>
                <input type="date" value={d.counted_on ?? ''} max={today()} onChange={(e) => set({ counted_on: e.target.value || null })} style={{ width: 170 }} />
              </Field>
              {!onScreen && (
                <Field label={<>{t('Counted by')} <InfoTip text={t('At least {n} people count the cash together and sign the declaration.').replace('{n}', String(minCount))} /></>}>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    {[...d.counters, ...Array(Math.max(0, minCount - d.counters.length)).fill('')].map((c: string, i: number) => (
                      <input key={i} value={c} placeholder={`${t('Counter')} ${i + 1}`} style={{ width: 200 }}
                        onChange={(e) => { const next = [...d.counters, ...Array(Math.max(0, minCount - d.counters.length)).fill('')]; next[i] = e.target.value; set({ counters: next }); }} />
                    ))}
                    {d.counters.length >= minCount && d.counters.length < 6 && <button className="btn sm ghost" onClick={() => set({ counters: [...d.counters, ''] })}><Icon name="plus" />{t('Add counter')}</button>}
                  </div>
                </Field>
              )}
            </section>
            </fieldset>
          </div>
        )}
      </fieldset>

      {!restricted && onScreen && (
        <section className="card stack rec-signing">
          <h3>{t('Counters’ signatures')} <InfoTip text={t('Each counter signs here with a finger, pen or mouse once the count matches. When everyone has signed (at least the church’s minimum), press Finish signing to verify the count. Changing the cash before that removes the signatures.')} /></h3>
          {sigs.length > 0 && (
            <div className="rec-sigs">
              {sigs.map((g) => (
                <figure key={g.name} className="rec-sig">
                  <img src={g.image} alt={t('Signature of {name}').replace('{name}', g.name)} />
                  <figcaption>
                    <strong>{g.name}</strong>
                    <span className="small muted">{new Date(g.signed_at).toLocaleString(lang === 'en' ? 'en-GB' : 'zh-CN')}</span>
                    {canEdit && (!d.verified_at || isAdmin) && <button className="btn sm ghost icon danger" onClick={() => unsign(g.name)} disabled={busy} aria-label={t('Remove')}><Icon name="trash" /></button>}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
          {d.verified_at ? null : !canEdit ? null : problems.length || !d.offerings.length ? (
            <div className="small muted">{t('Signing opens when the offerings are entered and every cash count matches its cash lines.')}</div>
          ) : (
            <div className="stack">
              <div className="small muted">
                {sigs.length === 0 ? t('First counter: type your name and sign below.') : t('Next counter: type your name and sign below.')}
                {' '}{t('{n} signed · at least {m} needed').replace('{n}', String(sigs.length)).replace('{m}', String(minCount))}
              </div>
              <input value={signer} onChange={(e) => setSigner(e.target.value)} placeholder={t('Your name')} style={{ maxWidth: 320 }} />
              <SignaturePad key={padKey} onChange={setInk} />
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button className="btn" onClick={sign} disabled={busy || !signer.trim() || !ink}><Icon name="edit" />{t('Sign the count')}</button>
                {sigs.length >= minCount && <button className="btn primary" onClick={finish} disabled={busy || !!signer.trim() || !!ink}><Icon name="check" />{t('Finish – all counters have signed')}</button>}
              </div>
              {sigs.length >= minCount && (!!signer.trim() || !!ink) && <div className="small muted">{t('Sign or clear the pad before finishing.')}</div>}
            </div>
          )}
        </section>
      )}

      <div className="rec-actions">
        {!restricted && <Link className="btn" to={`/records/${sid}/declaration`} target="_blank"><Icon name="print" />{t('Print cash-count declaration')}</Link>}
        {isAdmin && d.saved && !d.verified_at && <button className="btn ghost danger" onClick={removeRecord} disabled={busy}><Icon name="trash" />{t('Delete record')}</button>}
        <div className="grow" />
        {canEdit && !restricted && (d.verified_at
          ? isAdmin && <button className="btn" onClick={() => verify(false)} disabled={busy}>{t('Reopen cash count')}</button>
          : !onScreen && <button className="btn" onClick={() => verify(true)} disabled={busy || !d.offerings.length}><Icon name="check" />{t('Mark as counted and verified')}</button>)}
        {canEdit && <button className="btn primary" onClick={save} disabled={busy || !dirty}>{t('Save')}</button>}
      </div>
      {locked && !restricted && <div className="small muted" style={{ textAlign: 'right' }}>{t('The cash count is verified, so the cash is locked. To correct it, an administrator reopens the count; it is then verified again.')}</div>}
    </div>
  );
}

function OfferingRow({ line, funds, currency: main, cashLocked, onChange, onRemove }: { line: OfferingLine; funds: string[]; currency: string; cashLocked?: boolean; onChange: (p: Partial<OfferingLine>) => void; onRemove: () => void }) {
  const { t } = useI18n();
  // once the count is verified, cash lines are fixed and other lines cannot become cash
  const frozen = !!cashLocked && line.method === 'cash';
  const currency = line.currency ?? main;
  const [text, setText] = useState(line.amount ? money(line.amount, currency).replace(/,/g, '') : '');
  const bad = parseMoney(text, currency) === null;
  const pickCurrency = (v: string) => {
    if (v === '…') {
      const code = (window.prompt(t('Currency code (three letters, e.g. THB)')) ?? '').trim().toUpperCase();
      if (/^[A-Z]{3}$/.test(code)) onChange({ currency: code === main ? undefined : code });
      return;
    }
    onChange({ currency: v === main ? undefined : v });
  };
  return (
    <tr>
      <td>
        <select value={line.fund} disabled={frozen} onChange={(e) => onChange({ fund: e.target.value })}>
          {[...new Set([...funds, line.fund])].map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </td>
      <td>
        <select value={line.method} disabled={frozen} onChange={(e) => onChange({ method: e.target.value as OfferingMethod })}>
          {OFFERING_METHODS.filter((m) => !cashLocked || frozen || m !== 'cash').map((m) => <option key={m} value={m}>{t(METHOD_LABEL[m])}</option>)}
        </select>
      </td>
      <td>
        <select className="rec-cur" value={currency} disabled={frozen} onChange={(e) => pickCurrency(e.target.value)}>
          {[...new Set([main, ...CURRENCIES, currency])].map((c) => <option key={c} value={c}>{c}</option>)}
          <option value="…">{t('Other…')}</option>
        </select>
      </td>
      <td className="right">
        <input inputMode="decimal" disabled={frozen} className={bad ? 'invalid' : ''} style={{ width: 130, textAlign: 'right' }} value={text}
          onChange={(e) => { setText(e.target.value); const v = parseMoney(e.target.value, currency); if (v !== null) onChange({ amount: v }); }} />
      </td>
      <td><input value={line.note ?? ''} onChange={(e) => onChange({ note: e.target.value || undefined })} /></td>
      <td>{!frozen && <button className="btn sm ghost icon danger" onClick={onRemove} aria-label={t('Remove')}><Icon name="trash" /></button>}</td>
    </tr>
  );
}

/** An amount typed as "12.50"; `empty` allows leaving it blank (null). */
function MoneyInput({ value, currency, onChange, empty }: { value: number | null; currency: string; onChange: (v: number | null) => void; empty?: boolean }) {
  const [text, setText] = useState(value ? money(value, currency).replace(/,/g, '') : '');
  const bad = parseMoney(text, currency) === null;
  return (
    <input inputMode="decimal" className={bad ? 'invalid' : ''} style={{ width: 150, textAlign: 'right' }} value={text} placeholder={empty ? '—' : '0.00'}
      onChange={(e) => {
        setText(e.target.value);
        if (empty && !e.target.value.trim()) return onChange(null);
        const v = parseMoney(e.target.value, currency);
        if (v !== null) onChange(v);
      }} />
  );
}

/** Sign with a finger, pen or mouse; reports the drawing as a PNG data URL (null when cleared). */
function SignaturePad({ onChange }: { onChange: (png: string | null) => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLCanvasElement>(null);
  const last = useRef<[number, number] | null>(null);
  const [blank, setBlank] = useState(true);
  const at = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    return [((e.clientX - r.left) * c.width) / r.width, ((e.clientY - r.top) * c.height) / r.height];
  };
  const stroke = (from: [number, number], to: [number, number]) => {
    const g = ref.current?.getContext('2d');
    if (!g) return;
    g.strokeStyle = '#1e2430';
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(...from);
    g.lineTo(...to);
    g.stroke();
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = at(e);
    last.current = p;
    stroke(p, [p[0] + 0.1, p[1] + 0.1]);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!last.current) return;
    const p = at(e);
    stroke(last.current, p);
    last.current = p;
  };
  const up = () => {
    if (!last.current) return;
    last.current = null;
    setBlank(false);
    onChange(ref.current?.toDataURL('image/png') ?? null);
  };
  const clear = () => {
    const c = ref.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    setBlank(true);
    onChange(null);
  };
  return (
    <div className="sig-pad">
      <canvas ref={ref} width={600} height={200} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label={t('Signature pad')} />
      {blank && <span className="sig-hint">{t('Sign here')}</span>}
      <button type="button" className="btn sm ghost" onClick={clear} disabled={blank}>{t('Clear')}</button>
    </div>
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
  const signed = r?.signatures ?? [];
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
            <tr><th>{both('Date counted', '点算日期')}</th><td>{fmtDate(r.counted_on ?? s.date, lang)}</td></tr>
          </tbody>
        </table>

        <h3>{both('Cash count', '现金点算')}</h3>
        <div className="decl-cash">
          <table><thead><tr><th className="right">{both('Note', '纸币')}</th><th className="right">{both('Count', '张数')}</th><th className="right">{both('Amount', '金额')}</th></tr></thead><tbody>{den.notes.map(line)}</tbody></table>
          <table><thead><tr><th className="right">{both('Coin', '硬币')}</th><th className="right">{both('Count', '枚数')}</th><th className="right">{both('Amount', '金额')}</th></tr></thead><tbody>{den.coins.map(line)}</tbody></table>
        </div>
        <p className="decl-total">{both('Total cash counted', '现金总额')}: <strong>{money(cashTotal(r.cash), cur, true)}</strong></p>

        {foreignCurrencies(r.offerings, cur).map((fc) => {
          const f = r.foreign_cash?.[fc] ?? {};
          const fd = DENOMINATIONS[fc];
          const fline = (dn: number) => {
            const n = f.cash?.[String(dn)] ?? 0;
            return n ? <tr key={dn}><td className="right">{denomLabel(dn, fc)}</td><td className="right">{n}</td><td className="right">{money(n * dn, fc)}</td></tr> : null;
          };
          return (
            <div key={fc}>
              <h3>{both(`Cash in ${fc}`, `${fc} 现金`)}</h3>
              {fd && f.cash && Object.values(f.cash).some(Boolean) && (
                <table className="decl-methods"><thead><tr><th className="right">{both('Note / coin', '面额')}</th><th className="right">{both('Count', '数量')}</th><th className="right">{both('Amount', '金额')}</th></tr></thead><tbody>{[...fd.notes, ...fd.coins].map(fline)}</tbody></table>
              )}
              <p className="decl-total">{both(`Total ${fc} cash counted`, `${fc} 现金总额`)}: <strong>{money(foreignCounted(f), fc, true)}</strong>
                {f.converted != null && <> · {both(`Value in ${cur} once exchanged`, `兑换后价值 (${cur})`)}: {money(f.converted, cur, true)}</>}</p>
            </div>
          );
        })}

        <h3>{both('Offerings by method', '奉献方式')}</h3>
        <table className="decl-methods">
          <tbody>
            {OFFERING_METHODS.filter((m) => r.offerings.some((l) => l.method === m && (l.currency ?? cur) === cur)).map((m) => (
              <tr key={m}><th>{t(METHOD_LABEL[m])}</th><td className="right">{money(methodTotal(r.offerings, m, cur, cur), cur)}</td></tr>
            ))}
            <tr className="sum"><th>{both('Total offerings', '奉献总额')}</th><td className="right">{money(methodTotal(r.offerings, undefined, cur, cur), cur, true)}</td></tr>
            {foreignCurrencies(r.offerings, cur).map((fc) => (
              <tr key={fc} className="sum"><th>{both(`Total offerings in ${fc} (not converted)`, `${fc} 奉献总额（未兑换）`)}</th><td className="right">{money(methodTotal(r.offerings, undefined, fc, cur), fc, true)}</td></tr>
            ))}
          </tbody>
        </table>

        <p className="decl-text">
          {lang === 'en'
            ? `We, the undersigned, declare that we counted the cash offering of the above service together, that the count above is correct, and that the cash was handled and kept as the church requires.`
            : `我们以下签名的同工声明：我们一同点算了上述聚会的现金奉献，以上点算正确无误，并已按教会规定处理及保管现金。 We, the undersigned, declare that we counted the cash offering of the above service together, that the count above is correct, and that the cash was handled and kept as the church requires.`}
        </p>
        <table className="decl-sign">
          <thead><tr><th>{both('Name', '姓名')}</th><th>{both('Signature', '签名')}</th><th>{both('Date', '日期')}</th></tr></thead>
          <tbody>
            {signed.length
              ? signed.map((g) => <tr key={g.name}><td>{g.name}</td><td className="decl-sig"><img src={g.image} alt="" /></td><td>{new Date(g.signed_at).toLocaleString(lang === 'en' ? 'en-GB' : 'zh-CN', { dateStyle: 'medium', timeStyle: 'short' })}</td></tr>)
              : counters.map((n, i) => <tr key={i}><td>{n}</td><td /><td>{n ? fmtDate(r.counted_on ?? s.date, lang, { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</td></tr>)}
          </tbody>
        </table>
        {r.verified_at && (signed.length
          ? <p className="small muted">{both('Signed on screen in Canon; the signatures belong to the count above.', '已在 Canon 屏幕上签名；签名对应以上点算。')}</p>
          : <p className="small muted">{both('Marked as verified in Canon by', '已在 Canon 中由以下人员确认')} {r.verified_by}, {new Date(r.verified_at).toLocaleString(lang === 'en' ? 'en-GB' : 'zh-CN')}</p>)}
      </div>
    </div>
  );
}
