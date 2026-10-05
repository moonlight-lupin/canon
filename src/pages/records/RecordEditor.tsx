// Records → one service record: attendance, visitors, notes and offerings.
import { Fragment, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { useCanRecord, Bi, ErrorBox, Field, Loading, confirmAction, fmtDate, today, useAction, useSession } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import { InfoTip } from '../../components/InfoTip.tsx';
import { HistoryButton } from '../../components/LogTools.tsx';
import { VisitorCardsReview } from '../VisitorForm.tsx';
import { sourceLabel } from '../../../shared/visitor-form.ts';
import { CongregationBadge, useCongregations } from '../../components/Congregations.tsx';
import {
  CURRENCIES, DENOMINATIONS, METHOD_LABEL, OFFERING_METHODS, cashTotal, countProblems, foreignCounted,
  foreignCurrencies, methodTotal, money, parseMoney, VISITOR_STATUSES, VISITOR_STATUS_LABEL, type ForeignCash,
  type OfferingLine, type OfferingMethod, type ServiceRecord, type Visitor, type VisitorStatus,
} from '../../../shared/records.ts';
import type { ServiceFull } from '../../types-client.ts';
import { CashCount, SignaturePad } from './CashCount.tsx';
import '../records.css';

export type Rec = ServiceRecord & { saved: boolean; hidden?: string[] };

export function RecordEditor() {
  const { id } = useParams();
  const sid = Number(id);
  const nav = useNavigate();
  const { t, lang } = useI18n();
  const { canEdit: editor, isAdmin, settings, user } = useSession();
  const canRecord = useCanRecord();
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
  // the church asks counters to approve from their own accounts (Settings → Offerings)
  const ownOnly = onScreen && !!(settings?.offering as { own_accounts?: boolean } | undefined)?.own_accounts;
  const minCount = Math.min(6, Math.max(2, settings?.offering?.min_counters ?? 2));
  const [signer, setSigner] = useState('');
  const [ink, setInk] = useState<string | null>(null);
  const [padKey, setPadKey] = useState(0);

  if (svc.error || rec.error) return <div className="page"><ErrorBox error={(svc.error ?? rec.error)!} /></div>;
  if (!svc.data || !d) return <div className="page"><Loading /></div>;
  const s = svc.data;
  const restricted = !!d.hidden?.length;
  // a meeting may take no offering: then its record is headcount, visitors and notes only
  const takesOffering = s.offering !== false;
  const noMoney = restricted || !takesOffering;
  const isMeeting = s.kind === 'meeting';
  // editors, or the leader of this meeting (lib/leaders.ts on the server)
  const canEdit = editor || canRecord(s);
  const archivedYear = (d as Rec & { archived_year?: number | null }).archived_year ?? null;
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
  const approvedAccounts = new Set(sigs.filter((g) => g.via === 'account' && g.account_id).map((g) => g.account_id)).size;
  const setForeign = (c: string, p: Partial<ForeignCash>) => set({ foreign_cash: { ...d.foreign_cash, [c]: { ...d.foreign_cash?.[c], ...p } } });

  const body = () => restricted
    ? { attendance: d.attendance, children: d.children, online: d.online, notes: d.notes }
    : !takesOffering
      ? { attendance: d.attendance, children: d.children, online: d.online, notes: d.notes, visitors: d.visitors }
    : locked
      ? { attendance: d.attendance, children: d.children, online: d.online, notes: d.notes, visitors: d.visitors, offerings: d.offerings }
      : {
        attendance: d.attendance, children: d.children, online: d.online, notes: d.notes, visitors: d.visitors, offerings: d.offerings, cash: d.cash, counters: d.counters, currency: d.currency, counted_on: d.counted_on ?? null,
        // counts of currencies no longer in the offerings are dropped
        foreign_cash: Object.fromEntries(Object.entries(d.foreign_cash ?? {}).filter(([c]) => foreign.includes(c))),
      };
  // the revision this screen started from (0: no record yet), sent with every save so nobody's work is overwritten
  const base = () => String(rec.data?.saved ? rec.data.revision ?? 0 : 0);
  const put = () => api.put<Rec>(`/services/${sid}/record`, body(), base());
  const save = () => run(async () => {
    const r = await put();
    rec.setData({ ...r, saved: true });
  }, t('Saved.'));
  const verify = (v: boolean) => {
    if (!v && !confirmAction(t('Reopen this cash count? The offerings can then be changed again.'))) return;
    run(async () => {
      if (dirty) await put();
      const r = await api.post<Rec>(`/services/${sid}/record/verify`, { verified: v });
      rec.setData({ ...r, saved: true });
    }, v ? t('Marked as counted and verified.') : t('Reopened.'));
  };
  const finish = () => run(async () => {
    if (dirty) await put();
    const r = await api.post<Rec>(`/services/${sid}/record/finish`, {});
    rec.setData({ ...r, saved: true });
  }, t('Signing finished: the count is verified.'));
  // a counter approves from their own account (who is signed in is what counts)
  const approve = () => run(async () => {
    if (dirty || !d.saved) await put();
    const r = await api.post<Rec>(`/services/${sid}/record/approve`, {});
    rec.setData({ ...r, saved: true });
  }, t('Approved.'));
  const sign = () => run(async () => {
    if (dirty || !d.saved) await put();
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

  if (archivedYear) {
    return (
      <div className="page rec-page">
        <div className="rec-head">
          <Link className="btn sm ghost" to="/records"><Icon name="chevronLeft" />{t('Service records')}</Link>
          <h1><Bi v={s.title} /></h1>
          <span className="muted">{fmtDate(s.date, lang)} · {s.start_time}</span>
          <CongregationBadge id={s.congregation_id} list={congs} />
          <div className="grow" />
          {isMeeting
          ? <Link className="btn sm ghost" to={`/meetings/${sid}`}><Icon name="clock" />{t('Open the meeting')}</Link>
          : <Link className="btn sm ghost" to={`/services/${sid}`}><Icon name="calendar" />{t('Open the service')}</Link>}
          {isAdmin && d.saved && <HistoryButton entity="service_records" id={d.id} />}
        </div>
        <section className="card stack">
          <h3>{t('Archived')}</h3>
          <p className="muted" style={{ margin: 0 }}>
            {t('This record is in the {year} archive, so it is read-only and not counted in reports. Administrators can open the archive, or bring the record back to correct it, under Settings → Security & privacy.').replace('{year}', String(archivedYear))}
          </p>
          {isAdmin && <div><Link className="btn sm" to="/settings?tab=security"><Icon name="eye" />{t('Open the archive')}</Link></div>}
        </section>
      </div>
    );
  }
  return (
    <div className="page rec-page">
      <div className="rec-head">
        <Link className="btn sm ghost" to="/records"><Icon name="chevronLeft" />{t('Service records')}</Link>
        <h1><Bi v={s.title} /></h1>
        <span className="muted">{fmtDate(s.date, lang)} · {s.start_time}</span>
        <CongregationBadge id={s.congregation_id} list={congs} />
        <div className="grow" />
        {isMeeting
          ? <Link className="btn sm ghost" to={`/meetings/${sid}`}><Icon name="clock" />{t('Open the meeting')}</Link>
          : <Link className="btn sm ghost" to={`/services/${sid}`}><Icon name="calendar" />{t('Open the service')}</Link>}
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
                        <td data-label={t('Name')}><input value={v.name} onChange={(e) => upd({ name: e.target.value })} placeholder={t('Name')} /></td>
                        {!restricted && <td data-label={t('Contact')}><input value={v.contact ?? ''} onChange={(e) => upd({ contact: e.target.value })} placeholder={t('Phone or e-mail')} /></td>}
                        <td data-label={t('How they came')}><input value={v.source ?? ''} list="rec-sources" onChange={(e) => upd({ source: e.target.value })} placeholder={t('e.g. invited by a friend')} disabled={restricted} /></td>
                        {!restricted && <td data-label={t('Follow-up by')}><input value={v.follow_up_by ?? ''} onChange={(e) => upd({ follow_up_by: e.target.value })} /></td>}
                        <td data-label={t('Follow-up')}><select value={v.status ?? 'new'} disabled={restricted} onChange={(e) => upd({ status: e.target.value === 'new' ? undefined : (e.target.value as VisitorStatus) })}>{VISITOR_STATUSES.map((s) => <option key={s} value={s}>{t(VISITOR_STATUS_LABEL[s])}</option>)}</select></td>
                        {!restricted && <td data-label={t('Notes')}><input value={v.notes ?? ''} onChange={(e) => upd({ notes: e.target.value })} /></td>}
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

        {!restricted && editor && <VisitorCardsReview serviceId={sid} onAccepted={() => rec.reload()} />}

        <section className="card stack">
          <h3>{t('Notes for the team')}</h3>
          <textarea rows={4} value={d.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} placeholder={t('What went well, what to fix next time, prayer needs…')} />
        </section>

        {!noMoney && (
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

      {!noMoney && onScreen && (
        <section className="card stack rec-signing">
          <h3>{t('Counters’ signatures')} <InfoTip text={t('Each counter signs here with a finger, pen or mouse once the count matches. When everyone has signed (at least the church’s minimum), press Finish signing to verify the count. Changing the cash before that removes the signatures.')} /></h3>
          {sigs.length > 0 && (
            <div className="rec-sigs">
              {sigs.map((g) => (
                <figure key={g.name} className="rec-sig">
                  {g.via === 'account'
                    ? <div className="rec-sig-approved"><Icon name="check" />{t('Approved from own account')}</div>
                    : <img src={g.image} alt={t('Signature of {name}').replace('{name}', g.name)} />}
                  <figcaption>
                    <strong>{g.name}</strong>
                    <span className="small muted">{new Date(g.signed_at).toLocaleString(lang === 'en' ? 'en-GB' : 'zh-CN')}{g.via !== 'account' && g.by ? ` · ${t('on {name}’s screen').replace('{name}', g.by)}` : ''}</span>
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
                {ownOnly
                  ? t('Each counter signs in to Canon on their own account and approves the count here.')
                  : sigs.length === 0 ? t('First counter: type your name and sign below.') : t('Next counter: type your name and sign below.')}
                {' '}{(ownOnly ? t('{n} approved from own accounts · at least {m} needed') : t('{n} signed · at least {m} needed')).replace('{n}', String(ownOnly ? approvedAccounts : sigs.length)).replace('{m}', String(minCount))}
              </div>
              {!ownOnly && (
                <>
                  <input value={signer} onChange={(e) => setSigner(e.target.value)} placeholder={t('Your name')} style={{ maxWidth: 320 }} />
                  <SignaturePad key={padKey} onChange={setInk} />
                </>
              )}
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {!ownOnly && <button className="btn" onClick={sign} disabled={busy || !signer.trim() || !ink}><Icon name="edit" />{t('Sign the count')}</button>}
                <button className={ownOnly ? 'btn primary' : 'btn'} onClick={approve} disabled={busy || (!ownOnly && (!!signer.trim() || !!ink))}><Icon name="check" />{t('Approve from my account ({name})').replace('{name}', user.display_name)}</button>
                {(ownOnly ? approvedAccounts : sigs.length) >= minCount && <button className="btn primary" onClick={finish} disabled={busy || !!signer.trim() || !!ink}><Icon name="check" />{t('Finish – all counters have signed')}</button>}
              </div>
              {sigs.length >= minCount && (!!signer.trim() || !!ink) && <div className="small muted">{t('Sign or clear the pad before finishing.')}</div>}
            </div>
          )}
        </section>
      )}

      <div className="rec-actions">
        {!noMoney && <Link className="btn" to={`/records/${sid}/declaration`} target="_blank"><Icon name="print" />{t('Print cash-count declaration')}</Link>}
        {isAdmin && d.saved && !d.verified_at && <button className="btn ghost danger" onClick={removeRecord} disabled={busy}><Icon name="trash" />{t('Delete record')}</button>}
        <div className="grow" />
        {canEdit && !noMoney && (d.verified_at
          ? isAdmin && <button className="btn" onClick={() => verify(false)} disabled={busy}>{t('Reopen cash count')}</button>
          : !onScreen && <button className="btn" onClick={() => verify(true)} disabled={busy || !d.offerings.length}><Icon name="check" />{t('Mark as counted and verified')}</button>)}
        {canEdit && <button className="btn primary" onClick={save} disabled={busy || !dirty}>{t('Save')}</button>}
      </div>
      {locked && !noMoney && <div className="small muted" style={{ textAlign: 'right' }}>{t('The cash count is verified, so the cash is locked. To correct it, an administrator reopens the count; it is then verified again.')}</div>}
    </div>
  );
}

export function OfferingRow({ line, funds, currency: main, cashLocked, onChange, onRemove }: { line: OfferingLine; funds: string[]; currency: string; cashLocked?: boolean; onChange: (p: Partial<OfferingLine>) => void; onRemove: () => void }) {
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
      <td data-label={t('Fund')}>
        <select value={line.fund} disabled={frozen} onChange={(e) => onChange({ fund: e.target.value })}>
          {[...new Set([...funds, line.fund])].map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </td>
      <td data-label={t('Method')}>
        <select value={line.method} disabled={frozen} onChange={(e) => onChange({ method: e.target.value as OfferingMethod })}>
          {OFFERING_METHODS.filter((m) => !cashLocked || frozen || m !== 'cash').map((m) => <option key={m} value={m}>{t(METHOD_LABEL[m])}</option>)}
        </select>
      </td>
      <td data-label={t('Currency')}>
        <select className="rec-cur" value={currency} disabled={frozen} onChange={(e) => pickCurrency(e.target.value)}>
          {[...new Set([main, ...CURRENCIES, currency])].map((c) => <option key={c} value={c}>{c}</option>)}
          <option value="…">{t('Other…')}</option>
        </select>
      </td>
      <td className="right" data-label={t('Amount')}>
        <input inputMode="decimal" disabled={frozen} className={bad ? 'invalid' : ''} style={{ width: 130, textAlign: 'right' }} value={text}
          onChange={(e) => { setText(e.target.value); const v = parseMoney(e.target.value, currency); if (v !== null) onChange({ amount: v }); }} />
      </td>
      <td data-label={t('Note')}><input value={line.note ?? ''} onChange={(e) => onChange({ note: e.target.value || undefined })} /></td>
      <td>{!frozen && <button className="btn sm ghost icon danger" onClick={onRemove} aria-label={t('Remove')}><Icon name="trash" /></button>}</td>
    </tr>
  );
}

/** An amount typed as "12.50"; `empty` allows leaving it blank (null). */
export function MoneyInput({ value, currency, onChange, empty }: { value: number | null; currency: string; onChange: (v: number | null) => void; empty?: boolean }) {
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
