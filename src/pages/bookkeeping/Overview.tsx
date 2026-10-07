// Book-keeping: starting the books (start date, financial year, the church chart of accounts), and the overview —
// money on hand, drafts waiting, the opening balances, how offerings reach the books, and closing a period.
import { useState } from 'react';
import { api } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Field, Modal, confirmAction, fmtDate, today, useAction, useSession } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import { InfoTip } from '../../components/InfoTip.tsx';
import { METHOD_LABEL, OFFERING_METHODS } from '../../../shared/records.ts';
import { totals, yearStart, type BkLine } from '../../../shared/bookkeeping.ts';
import { AccountSelect, FundSelect, MoneyInput, fmtMoney, fmtSigned, monthName, useBooks } from './common.tsx';

export function SetupForm({ onDone }: { onDone?: () => void }) {
  const { t, lang } = useI18n();
  const b = useBooks();
  const s = b.overview.settings;
  const { run, busy } = useAction();
  const [start, setStart] = useState(s.start_date ?? `${today().slice(0, 4)}-01-01`);
  const [yem, setYem] = useState(s.year_end_month || 12);
  const [template, setTemplate] = useState(!b.accounts.length);
  const save = async () => {
    const r = await run(() => api.put('/bookkeeping/setup', { start_date: start, year_end_month: yem, template }), t('Saved.'));
    if (r) {
      b.reload();
      onDone?.();
    }
  };
  return (
    <div className="card bk-setup stack">
      {!s.start_date && (
        <>
          <h2>{t('Start the books')}</h2>
          <p className="muted">{t('Choose the day Canon’s books begin — usually the first day of a financial year. You then enter what the church had and owed that day (the opening balances), and record everything after it here.')}</p>
        </>
      )}
      <div className="grid cols-3">
        <Field label={t('The books start on')}><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label={t('The financial year ends in')}>
          <select value={yem} onChange={(e) => setYem(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{monthName(m, lang)}</option>)}
          </select>
        </Field>
      </div>
      {!b.accounts.length && (
        <label className="check"><input type="checkbox" checked={template} onChange={(e) => setTemplate(e.target.checked)} />{t('Start from the church chart of accounts and funds (General, Missions, Building, Benevolence) — rename, add or retire them afterwards')}</label>
      )}
      {start && start !== yearStart(start, yem) && <div className="callout warn small">{t('This isn’t the first day of a financial year. That works, but the first year’s reports will cover part of a year.')}</div>}
      <div className="row end">
        {onDone && <button className="btn" onClick={onDone}>{t('Cancel')}</button>}
        <button className="btn primary" disabled={busy || !start} onClick={save}>{s.start_date ? t('Save') : t('Start the books')}</button>
      </div>
    </div>
  );
}

export function OverviewTab() {
  const { t, lt, lang } = useI18n();
  const b = useBooks();
  const o = b.overview;
  const s = o.settings;
  const { isAdmin } = useSession();
  const { run, busy } = useAction();
  const [editStart, setEditStart] = useState(false);
  const [opening, setOpening] = useState(false);
  const [mapping, setMapping] = useState(false);
  const openingPosted = o.opening?.status === 'posted';
  const postOfferings = async () => {
    const list = await run(() => api.get<{ id: number }[]>('/bookkeeping/journals?status=draft&kind=offering&limit=500'));
    if (!list?.length) return;
    if (!confirmAction(t('Post {n} offering draft(s)? Posted journals can’t be changed, only reversed.').replace('{n}', String(list.length)))) return;
    const r = await run(() => api.post<{ posted: string[]; failed: { id: number; error: string }[] }>('/bookkeeping/journals/post', { ids: list.map((j) => j.id) }));
    if (r) {
      window.alert(t('Posted: {n}.').replace('{n}', String(r.posted.length)) + (r.failed.length ? '\n' + t('Still drafts (open them in Journals to see why): {n}.').replace('{n}', String(r.failed.length)) : ''));
      b.reload();
    }
  };
  return (
    <div className="stack">
      <div className="grid cols-3">
        <div className="card">
          <div className="card-head"><h3>{t('Money on hand')}</h3><span className="small muted">{fmtDate(today(), lang)}</span></div>
          {!o.money.length ? <p className="muted small">{t('No bank or cash balances yet.')}</p> : (
            <table className="t bk-mini">
              <tbody>
                {o.money.map((m) => (
                  <tr key={m.account_id} className="click" onClick={() => b.go('reports', { report: 'ledger', account: String(m.account_id) })}>
                    <td>{lt(m.name)}</td><td className="bk-num">{fmtSigned(m.amount)}</td>
                  </tr>
                ))}
                <tr className="bk-total"><td>{t('Total')} ({o.currency})</td><td className="bk-num">{fmtSigned(o.money.reduce((n, m) => n + m.amount, 0))}</td></tr>
              </tbody>
            </table>
          )}
        </div>
        <div className="card stack tight">
          <div className="card-head"><h3>{t('Waiting to be posted')}</h3></div>
          <div className="bk-big">{o.drafts}</div>
          <div className="small muted">{t('draft journals, {n} of them offerings').replace('{n}', String(o.offering_drafts))}</div>
          <div className="row">
            {o.drafts > 0 && <button className="btn" onClick={() => b.go('journals', { status: 'draft' })}>{t('Review drafts')}</button>}
            {b.canEdit && o.offering_drafts > 0 && <button className="btn primary" disabled={busy} onClick={postOfferings}>{t('Post the offering drafts')}</button>}
          </div>
        </div>
        <div className="card stack tight">
          <div className="card-head">
            <h3>{t('The books')}</h3>
            {b.canEdit && !openingPosted && !editStart && <button className="btn ghost small" onClick={() => setEditStart(true)}><Icon name="edit" />{t('Change')}</button>}
          </div>
          <div className="small">{t('Started on')} <strong>{fmtDate(s.start_date, lang)}</strong></div>
          <div className="small">{t('The financial year ends in')} <strong>{monthName(s.year_end_month, lang)}</strong></div>
          <div className="small">{t('Closed up to')} <strong>{s.closed_through ? fmtDate(s.closed_through, lang) : t('nothing closed yet')}</strong></div>
          <div className="small">{t('Currency')} <strong>{o.currency}</strong></div>
        </div>
      </div>
      {editStart && <SetupForm onDone={() => setEditStart(false)} />}

      <div className="card">
        <div className="card-head">
          <h3>{t('Opening balances')}<InfoTip text={t('What the church had and owed on the day the books start, and how its funds stood. Entered once; posted like any journal.')} /></h3>
          {openingPosted ? <span className="badge ok">{t('Posted')} {o.opening!.number}</span> : o.opening ? <span className="badge warn">{t('Draft')}</span> : null}
        </div>
        {openingPosted ? (
          <p className="small muted">{t('To correct them, reverse the opening journal in Journals and enter them again.')} <button className="btn ghost small" onClick={() => b.go('journals', { open: String(o.opening!.id) })}>{t('Open')}</button></p>
        ) : (
          <div className="row">
            <p className="small muted grow">{t('Enter the bank and cash balances, anything owed to or by the church, and each fund’s balance on {date}.').replace('{date}', fmtDate(s.start_date, lang))}</p>
            {b.canEdit && <button className="btn primary" onClick={() => setOpening(true)}>{o.opening ? t('Continue the opening balances') : t('Enter the opening balances')}</button>}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h3>{t('Offerings into the books')}</h3>
          {b.canEdit && <button className="btn ghost small" onClick={() => setMapping(true)}><Icon name="edit" />{t('Change')}</button>}
        </div>
        <p className="small muted">
          {s.offering_drafts
            ? t('When a cash count is verified, Canon drafts its journal: each payment method into its account, each fund’s offerings into its income. You post it here.')
            : t('Verified offerings are not drafted into the books.')}
        </p>
        {s.offering_drafts && b.canEdit && <OfferingSync />}
      </div>

      <ClosingCard isAdmin={isAdmin} />
      {opening && <OpeningDialog onClose={() => setOpening(false)} />}
      {mapping && <MappingDialog onClose={() => setMapping(false)} />}
    </div>
  );
}

function OfferingSync() {
  const { t } = useI18n();
  const b = useBooks();
  const { run, busy } = useAction();
  const [from, setFrom] = useState(b.overview.settings.start_date ?? today());
  const [to, setTo] = useState(today());
  const go = async () => {
    const r = await run(() => api.post<{ services: number; drafted: number }>('/bookkeeping/offerings/sync', { from, to }));
    if (r) {
      window.alert(t('{n} verified service(s) checked; {d} draft(s) waiting.').replace('{n}', String(r.services)).replace('{d}', String(r.drafted)));
      b.reload();
    }
  };
  return (
    <details className="small">
      <summary>{t('Draft offerings verified before the books started, or check them again')}</summary>
      <div className="row" style={{ marginTop: 8 }}>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t('From')} />
        <span className="muted">–</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t('To')} />
        <button className="btn" disabled={busy} onClick={go}><Icon name="refresh" />{t('Draft what’s missing')}</button>
      </div>
    </details>
  );
}

function ClosingCard({ isAdmin }: { isAdmin: boolean }) {
  const { t, lang } = useI18n();
  const b = useBooks();
  const s = b.overview.settings;
  const { run, busy } = useAction();
  const lastMonthEnd = () => {
    const d = new Date(today() + 'T00:00:00Z');
    d.setUTCDate(0);
    return d.toISOString().slice(0, 10);
  };
  const [date, setDate] = useState(lastMonthEnd());
  const [reopenTo, setReopenTo] = useState('');
  const close = async () => {
    if (!confirmAction(t('Close the books up to {date}? Nothing dated on or before it can then be posted.').replace('{date}', fmtDate(date, lang)))) return;
    if (await run(() => api.post('/bookkeeping/close', { date }), t('Saved.'))) b.reload();
  };
  const reopen = async () => {
    if (await run(() => api.post('/bookkeeping/reopen', { date: reopenTo || null }), t('Saved.'))) b.reload();
  };
  if (!b.canEdit) return null;
  return (
    <div className="card">
      <div className="card-head"><h3>{t('Closing a period')}<InfoTip text={t('After a month or year is checked (and the bank reconciled), close it: nothing on or before that date can be posted. Reports need no closing journal — each year’s surplus stays in its fund.')} /></h3></div>
      <div className="row">
        <span className="small">{t('Close the books up to')}</span>
        <input type="date" value={date} min={s.closed_through ?? undefined} onChange={(e) => setDate(e.target.value)} aria-label={t('Close the books up to')} />
        <button className="btn" disabled={busy || !date} onClick={close}><Icon name="lock" />{t('Close')}</button>
      </div>
      {isAdmin && s.closed_through && (
        <div className="row" style={{ marginTop: 10 }}>
          <span className="small">{t('Reopen: closed up to')}</span>
          <input type="date" value={reopenTo} max={s.closed_through} onChange={(e) => setReopenTo(e.target.value)} aria-label={t('Reopen: closed up to')} />
          <span className="small muted">{t('(empty = nothing closed)')}</span>
          <button className="btn" disabled={busy} onClick={reopen}>{t('Reopen')}</button>
        </div>
      )}
    </div>
  );
}

/** The opening balances as a guided journal: what the church had and owed, then how its funds stood. */
function OpeningDialog({ onClose }: { onClose: () => void }) {
  const { t, lt, lang } = useI18n();
  const b = useBooks();
  const s = b.overview.settings;
  const { run, busy } = useAction();
  const fb = b.accounts.find((a) => a.kind === 'fund_balance' && a.active);
  const general = b.funds.find((f) => f.restriction === 'unrestricted' && f.active) ?? b.funds[0];
  const items = b.accounts.filter((a) => a.active && (a.type === 'asset' || a.type === 'liability'));
  // from the draft, if there is one: account → signed amount (assets debit, liabilities credit), fund → its balance
  const draft = b.overview.opening && b.overview.opening.status === 'draft' ? b.overview.opening : null;
  const [amounts, setAmounts] = useState<Record<number, number>>(() => {
    const m: Record<number, number> = {};
    for (const l of draft?.lines ?? []) {
      const a = b.accounts.find((x) => x.id === l.account_id);
      if (!a || a.kind === 'fund_balance') continue;
      m[a.id] = (m[a.id] ?? 0) + (a.type === 'asset' ? l.debit - l.credit : l.credit - l.debit);
    }
    return m;
  });
  const [fundAmt, setFundAmt] = useState<Record<number, number>>(() => {
    const m: Record<number, number> = {};
    for (const l of draft?.lines ?? []) if (l.account_id === fb?.id) m[l.fund_id] = (m[l.fund_id] ?? 0) + l.credit - l.debit;
    return m;
  });
  const assets = items.filter((a) => a.type === 'asset').reduce((n, a) => n + (amounts[a.id] ?? 0), 0);
  const owed = items.filter((a) => a.type === 'liability').reduce((n, a) => n + (amounts[a.id] ?? 0), 0);
  const net = assets - owed;
  const inFunds = Object.values(fundAmt).reduce((n, v) => n + v, 0);
  const rest = net - inFunds;
  const lines = (): BkLine[] => {
    const out: BkLine[] = [];
    for (const a of items) {
      const v = amounts[a.id] ?? 0;
      if (!v) continue;
      const debitSide = a.type === 'asset' ? v > 0 : v < 0;
      out.push({ account_id: a.id, fund_id: general.id, debit: debitSide ? Math.abs(v) : 0, credit: debitSide ? 0 : Math.abs(v) });
    }
    for (const [fid, v] of Object.entries(fundAmt)) {
      if (!v || !fb) continue;
      out.push({ account_id: fb.id, fund_id: Number(fid), debit: v < 0 ? -v : 0, credit: v > 0 ? v : 0 });
    }
    return out;
  };
  const save = async (post: boolean) => {
    const body = { date: s.start_date, memo: t('Opening balances'), kind: 'opening', lines: lines() };
    const j = await run(() => (draft ? api.put<{ id: number }>(`/bookkeeping/journals/${draft.id}`, body) : api.post<{ id: number }>('/bookkeeping/journals', body)));
    if (!j) return;
    if (post) {
      if (!confirmAction(t('Post the opening balances? Posted journals can’t be changed, only reversed.'))) return;
      if (!(await run(() => api.post(`/bookkeeping/journals/${j.id}/post`), t('Posted.')))) {
        b.reload();
        return;
      }
    }
    b.reload();
    onClose();
  };
  if (!fb || !general) {
    return (
      <Modal title={t('Opening balances')} onClose={onClose}>
        <p>{t('The chart needs an active account of the kind “Fund balances” and at least one fund first (Accounts and funds).')}</p>
      </Modal>
    );
  }
  return (
    <Modal title={t('Opening balances on {date}').replace('{date}', fmtDate(s.start_date, lang))} onClose={onClose} size="lg" footer={
      <>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn" disabled={busy} onClick={() => save(false)}>{t('Save draft')}</button>
        <button className="btn primary" disabled={busy || rest !== 0 || !net} onClick={() => save(true)}>{t('Save and post')}</button>
      </>
    }>
      <div className="grid cols-2">
        <div className="stack tight">
          <h3>{t('What the church had and owed')}</h3>
          <p className="small muted">{t('From the bank statements and records for that day. Leave out what is nothing.')}</p>
          <table className="t bk-mini">
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td>{a.code} {lt(a.name)}{a.type === 'liability' && <span className="badge" style={{ marginLeft: 6 }}>{t('owed')}</span>}</td>
                  <td className="bk-num"><MoneyInput cents={amounts[a.id] ?? 0} allowNegative onChange={(c) => setAmounts((m) => ({ ...m, [a.id]: c }))} label={a.code} /></td>
                </tr>
              ))}
              <tr className="bk-total"><td>{t('Net assets')}</td><td className="bk-num">{fmtSigned(net)}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="stack tight">
          <h3>{t('How the funds stood')}</h3>
          <p className="small muted">{t('The funds together hold the net assets. Restricted and designated funds first; the general fund usually takes the rest.')}</p>
          <table className="t bk-mini">
            <tbody>
              {b.funds.filter((f) => f.active).map((f) => (
                <tr key={f.id}>
                  <td>{f.code} {lt(f.name)}</td>
                  <td className="bk-num"><MoneyInput cents={fundAmt[f.id] ?? 0} allowNegative onChange={(c) => setFundAmt((m) => ({ ...m, [f.id]: c }))} label={f.code} /></td>
                </tr>
              ))}
              <tr className="bk-total"><td>{t('Not yet in a fund')}</td><td className={`bk-num${rest ? ' bk-off' : ''}`}>{fmtSigned(rest)}</td></tr>
            </tbody>
          </table>
          {rest !== 0 && <button className="btn small" onClick={() => setFundAmt((m) => ({ ...m, [general.id]: (m[general.id] ?? 0) + rest }))}>{t('Put the rest in {fund}').replace('{fund}', lt(general.name))}</button>}
        </div>
      </div>
      <p className="small muted" style={{ marginTop: 12 }}>{t('Saved as one journal on the start date: assets as debits, what is owed and the fund balances as credits ({amount} each side).').replace('{amount}', fmtMoney(totals(lines()).debit))}</p>
    </Modal>
  );
}

function MappingDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const b = useBooks();
  const s = b.overview.settings;
  const { run, busy } = useAction();
  const [on, setOn] = useState(s.offering_drafts);
  const [methods, setMethods] = useState<Record<string, number | null>>({ ...s.method_accounts } as Record<string, number | null>);
  const [fmap, setFmap] = useState({ ...s.fund_map });
  const save = async () => {
    const fund_map = Object.fromEntries(Object.entries(fmap).filter(([, v]) => v.fund_id && v.income_account_id));
    if (await run(() => api.put('/bookkeeping/offering-mapping', { offering_drafts: on, method_accounts: methods, fund_map }), t('Saved.'))) {
      b.reload();
      onClose();
    }
  };
  const missing = b.overview.offering_funds.filter((f) => !fmap[f]?.fund_id || !fmap[f]?.income_account_id);
  return (
    <Modal title={t('Offerings into the books')} onClose={onClose} size="lg" footer={
      <>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" disabled={busy} onClick={save}>{t('Save')}</button>
      </>
    }>
      <div className="stack">
        <label className="check"><input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />{t('Draft a journal when a cash count is verified')}</label>
        <div className="grid cols-2">
          <div className="stack tight">
            <h3>{t('Where each payment method goes')}</h3>
            <table className="t bk-mini">
              <tbody>
                {OFFERING_METHODS.map((m) => (
                  <tr key={m}>
                    <td>{t(METHOD_LABEL[m])}</td>
                    <td><AccountSelect value={methods[m] ?? null} types={['asset']} onChange={(id) => setMethods((x) => ({ ...x, [m]: id }))} label={t(METHOD_LABEL[m])} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted">{t('Cash and cheques usually go to “Offerings not yet banked” until the deposit; PayNow and transfers straight to the bank.')}</p>
          </div>
          <div className="stack tight">
            <h3>{t('Each offering fund')}</h3>
            {!b.overview.offering_funds.length && <p className="small muted">{t('Offering funds are set in Settings → Offerings.')}</p>}
            {b.overview.offering_funds.map((name) => (
              <div key={name} className="bk-fundmap">
                <strong>{name}</strong>
                <FundSelect value={fmap[name]?.fund_id} onChange={(id) => setFmap((x) => ({ ...x, [name]: { ...x[name], fund_id: id ?? 0 } }))} />
                <AccountSelect value={fmap[name]?.income_account_id} types={['income']} label={t('Income account')} empty={t('Income account…')} onChange={(id) => setFmap((x) => ({ ...x, [name]: { ...x[name], income_account_id: id ?? 0 } }))} />
              </div>
            ))}
            {missing.length > 0 && <div className="callout warn small">{t('Until they have a fund and an income account, offerings to {funds} are drafted into the general fund (with a note on the draft).').replace('{funds}', missing.join(', '))}</div>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
