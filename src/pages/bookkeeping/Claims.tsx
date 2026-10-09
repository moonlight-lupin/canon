// Book-keeping → Claims (0.17.1): every expense claim for the office — waiting for approval, approved and to pay,
// paid. A claim's receipts, signature and approvals; how each line is booked (account, fund, ministry, project);
// paying it; a claim handed in on paper entered for a member. The approvers (named people, optionally for some
// ministries and up to an amount), the amount above which two must approve, and phone sign-in are set here too.
// Claimants and approvers themselves use /self/claims (also from inside Canon: My claims).
import { useEffect, useState } from 'react';
import { api, qs, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Empty, ErrorBox, Field, Loading, Modal, SearchBox, confirmAction, fmtDate, today, useAction, useDebounced, useSession } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import { ReceiptViewer } from '../../components/ReceiptViewer.tsx';
import { InfoTip } from '../../components/InfoTip.tsx';
import { CLAIM_STATUS_LABEL, type Claim, type ClaimApprover, type ClaimStatus } from '../../../shared/bookkeeping.ts';
import { AccountSelect, FundSelect, MoneyInput, TagSelect, fmtMoney, useBooks, useNames } from './common.tsx';

/** A stored UTC time as the local day (YYYY-MM-DD), for showing dates. */
const localDay = (s: string) => {
  const d = new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

type Row = { id: number; number: string | null; claimant: string; purpose: string | null; status: ClaimStatus; total: number; files: number; submitted_at: string | null; paid_on: string | null; approver_paid: boolean; created_via: string; created_at: string };
type Full = Claim & { needed: number; approvers: { person_id: number; name: string }[]; problems: string[]; link: string };
const BADGE: Record<ClaimStatus, string> = { draft: '', submitted: 'warn', approved: 'lapis', rejected: 'danger', paid: 'ok', withdrawn: '' };

export function ClaimsTab() {
  const { t, lang } = useI18n();
  const b = useBooks();
  const [status, setStatus] = useState<string>('open');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const { data, error, reload } = useApi<{ claims: Row[]; counts: { to_approve: number; to_pay: number; to_pay_total: number } }>(`/bookkeeping/claims${qs({ status, q: dq })}`);
  const [open, setOpen] = useState<number | null>(null);
  const [paper, setPaper] = useState(false);
  const [settings, setSettings] = useState(false);
  const [share, setShare] = useState(false);
  const changed = () => {
    reload();
    b.reload();
  };
  return (
    <div className="stack">
      {data && (
        <div className="row small">
          <span className="badge warn">{t('Waiting for approval: {n}').replace('{n}', String(data.counts.to_approve))}</span>
          <span className="badge lapis">{t('Approved, to pay: {n} ({amount})').replace('{n}', String(data.counts.to_pay)).replace('{amount}', fmtMoney(data.counts.to_pay_total))}</span>
        </div>
      )}
      <div className="row bk-toolbar">
        <div className="grow" style={{ maxWidth: 280 }}><SearchBox value={q} onChange={setQ} placeholder={t('Claimant, number or what for')} /></div>
        <select className="mini" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('Status')}>
          <option value="open">{t('Waiting for approval or payment')}</option>
          <option value="">{t('All claims')}</option>
          {(Object.keys(CLAIM_STATUS_LABEL) as ClaimStatus[]).map((s) => <option key={s} value={s}>{t(CLAIM_STATUS_LABEL[s])}</option>)}
        </select>
        <div className="grow" />
        <button className="btn" onClick={() => setShare(true)}><Icon name="qr" />{t('Link for members')}</button>
        {b.canEdit && <button className="btn" onClick={() => setSettings(true)}><Icon name="settings" />{t('Approvers and settings')}</button>}
        {b.canEdit && <button className="btn primary" onClick={() => setPaper(true)}><Icon name="plus" />{t('Enter a paper claim')}</button>}
      </div>
      {error && <ErrorBox error={error} />}
      {!data ? <Loading /> : !data.claims.length ? <Empty title={status === 'open' ? t('No claims waiting.') : t('No claims.')} /> : (
        <div className="card flush table-wrap">
          <table className="t">
            <thead><tr><th>{t('Number')}</th><th>{t('Claimant')}</th><th>{t('What for')}</th><th>{t('Status')}</th><th className="bk-num">{t('Amount')}</th></tr></thead>
            <tbody>
              {data.claims.map((c) => (
                <tr key={c.id} className="click" onClick={() => setOpen(c.id)}>
                  <td className="nowrap">{c.number ? <span className="code">{c.number}</span> : <span className="muted small">{fmtDate(localDay(c.created_at), lang)}</span>}</td>
                  <td>{c.claimant}{c.created_via === 'mcp' && <span className="badge lapis" style={{ marginLeft: 6 }}>{t('AI draft')}</span>}</td>
                  <td>{c.purpose}<span className="small muted"> · {t('{n} receipt(s)').replace('{n}', String(c.files))}</span></td>
                  <td className="nowrap"><span className={`badge ${BADGE[c.status]}`}>{t(CLAIM_STATUS_LABEL[c.status])}</span>{c.approver_paid && <span className="badge warn" style={{ marginLeft: 6 }} title={t('Paid by one of its approvers.')}>{t('Approver paid')}</span>}</td>
                  <td className="bk-num">{fmtMoney(c.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open !== null && <ClaimDialog id={open} onClose={() => setOpen(null)} onChanged={changed} />}
      {paper && <PaperClaim onClose={() => setPaper(false)} onMade={(id) => { setPaper(false); changed(); setOpen(id); }} />}
      {settings && <ClaimSettings onClose={() => setSettings(false)} />}
      {share && <ShareLink onClose={() => setShare(false)} />}
    </div>
  );
}

/** The claim's receipts and other documents, in a viewer that stays inside the dialog. */
function Receipts({ c }: { c: Claim }) {
  return <ReceiptViewer files={c.files} lines={c.lines} load={(f) => Promise.resolve(`/api/bookkeeping/claims/files/${f.id}`)} />;
}

function ClaimDialog({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { t, lang } = useI18n();
  const b = useBooks();
  const n = useNames();
  const { user } = useSession();
  const { run, busy } = useAction();
  const full = useApi<Full>(`/bookkeeping/claims/${id}`);
  const [booking, setBooking] = useState<Full['lines']>([]);
  const [dirty, setDirty] = useState(false);
  const [pay, setPay] = useState<{ date: string; bank: number | null; ref: string } | null>(null);
  useEffect(() => {
    if (full.data) {
      setBooking(full.data.lines);
      setDirty(false);
    }
  }, [full.data]);
  const c = full.data;
  const after = (r: unknown) => {
    if (r) {
      full.reload();
      onChanged();
    }
  };
  if (!c) return <Modal title={t('Expense claim')} onClose={onClose}>{full.error ? <ErrorBox error={full.error} /> : <Loading />}</Modal>;
  const bookingOpen = b.canEdit && c.status !== 'rejected' && c.status !== 'withdrawn';
  const setLine = (i: number, p: Partial<Full['lines'][number]>) => {
    setBooking((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
    setDirty(true);
  };
  const saveBooking = () => run(() => api.put(`/bookkeeping/claims/${c.id}/booking`, {
    ministry_id: c.ministry_id, project_id: c.project_id, fund_id: c.fund_id,
    lines: booking.map((l) => ({ id: l.id!, account_id: l.account_id ?? null, fund_id: l.fund_id ?? null, ministry_id: l.ministry_id ?? null, project_id: l.project_id ?? null })),
  }), t('Saved.')).then(after);
  const iApprove = c.status === 'submitted' && c.approvers.some((a) => a.person_id === user.person_id);
  return (
    <Modal title={`${c.number ?? t('Expense claim')} · ${c.claimant}`} onClose={onClose} size="lg" footer={
      <>
        {b.canEdit && (c.status === 'draft' || c.status === 'withdrawn' || c.status === 'rejected') && <button className="btn danger ghost" disabled={busy} onClick={() => confirmAction(t('Delete this claim?')) && run(() => api.del(`/bookkeeping/claims/${c.id}`), t('Deleted.')).then((r) => { if (r) { onChanged(); onClose(); } })}><Icon name="trash" />{t('Delete')}</button>}
        {b.canEdit && (c.status === 'draft' || c.status === 'submitted') && <button className="btn ghost" disabled={busy} onClick={() => confirmAction(t('Withdraw this claim?')) && run(() => api.post(`/bookkeeping/claims/${c.id}/withdraw`)).then(after)}>{t('Withdraw')}</button>}
        <div className="grow" />
        <button className="btn" onClick={() => navigator.clipboard?.writeText(c.link).then(() => window.alert(t('Link copied.')))}><Icon name="link" />{t('Copy the claim’s link')}</button>
        {iApprove && <a className="btn primary" href={`/self/claims/${c.id}`} target="_blank" rel="noopener">{t('Approve or send back…')}</a>}
        {b.canEdit && c.status === 'draft' && <button className="btn" disabled={busy || c.problems.length > 0} title={c.problems.join(' ')} onClick={() => confirmAction(t('Record that the claimant signed this claim on paper? Attach the signed form among the receipts first.')) && run(() => api.post(`/bookkeeping/claims/${c.id}/submit-paper`)).then(after)}>{t('Signed on paper: submit')}</button>}
        {b.canEdit && c.status === 'approved' && !pay && <button className="btn primary" onClick={() => setPay({ date: today(), bank: b.accounts.find((a) => a.kind === 'bank' && a.active)?.id ?? null, ref: '' })}>{t('Pay…')}</button>}
      </>
    }>
      <div className="stack">
        <div className="row">
          <span className={`badge ${BADGE[c.status]}`}>{t(CLAIM_STATUS_LABEL[c.status])}</span>
          <strong>{fmtMoney(c.total)}</strong>
          {c.purpose && <span>{c.purpose}</span>}
          {c.ministry_id && <span className="small muted">{n.ministry(c.ministry_id)}</span>}
          {c.created_via === 'mcp' && <span className="badge lapis">{t('AI draft')}</span>}
        </div>
        {c.note && <div className="callout warn small">{c.note}</div>}
        {c.approver_paid && <div className="callout small">{t('Paid by one of its approvers.')}</div>}
        {b.canEdit && c.pay_to && <div className="small">{t('Repay to')}: <strong>{c.pay_to}</strong>{c.pay_to_by === 'office' && <span className="muted"> · {t('typed in by the office: approvers are told')}</span>}</div>}

        <div className="table-wrap">
          <table className="t bk-lines">
            <thead><tr><th>{t('Date')}</th><th>{t('What for')}</th><th className="bk-num">{t('Amount')}</th><th>{t('Account')}</th><th>{t('Fund‖books')}</th>{b.ministries.length > 0 && <th>{t('Ministry')}</th>}{b.projects.length > 0 && <th>{t('Project')}</th>}</tr></thead>
            <tbody>
              {booking.map((l, i) => (
                <tr key={l.id ?? i}>
                  <td className="nowrap small">{l.date ? fmtDate(l.date, lang) : ''}</td>
                  <td>{l.description}{l.payee && <div className="small muted">{l.payee}</div>}</td>
                  <td className="bk-num">{fmtMoney(l.amount)}</td>
                  <td>{bookingOpen ? <AccountSelect value={l.account_id} types={['expense', 'asset']} empty={t('Default expense account')} onChange={(v) => setLine(i, { account_id: v })} /> : n.account(l.account_id) || <span className="muted small">{t('Default')}</span>}</td>
                  <td>{bookingOpen ? <FundSelect value={l.fund_id} empty={t('General fund')} onChange={(v) => setLine(i, { fund_id: v })} /> : n.fundCode(l.fund_id)}</td>
                  {b.ministries.length > 0 && <td>{bookingOpen ? <TagSelect kind="ministries" value={l.ministry_id} onChange={(v) => setLine(i, { ministry_id: v })} /> : n.ministry(l.ministry_id)}</td>}
                  {b.projects.length > 0 && <td>{bookingOpen ? <TagSelect kind="projects" value={l.project_id} onChange={(v) => setLine(i, { project_id: v })} /> : n.project(l.project_id)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {dirty && <div className="row end"><button className="btn primary" disabled={busy} onClick={saveBooking}>{t('Save how it is booked')}</button></div>}
        {bookingOpen && <p className="small muted">{t('How each line is booked doesn’t change what the claimant signed. A line without an account goes to the default expense account (Approvers and settings).')}</p>}

        <h3>{t('Receipts')}</h3>
        <Receipts c={c} />
        {b.canEdit && c.status === 'draft' && <PaperUpload claimId={c.id} onDone={() => full.reload()} />}

        {c.signature && (
          <div className="stack tight">
            <span className="small muted">{c.signature.via === 'paper' ? t('Signed on paper (recorded by {who})').replace('{who}', c.signature.by ?? '') : t('Signed by {name} on {date}').replace('{name}', c.signature.name).replace('{date}', fmtDate(localDay(c.signature.signed_at), lang))}</span>
            {c.signature.image && <img className="claim-ink" src={c.signature.image} alt="" />}
          </div>
        )}
        <div className="stack tight">
          <h3>{t('Approvals')} <InfoTip text={t('Named approvers decide claims on their phones (or from My claims in Canon). Nobody approves their own claim.')} /></h3>
          {c.approvals.length ? c.approvals.map((a) => (
            <div key={a.id} className="row small">
              <strong>{a.name}</strong>
              <span>{a.decision === 'approved' ? t('approved') : a.decision === 'returned' ? t('sent it back') : t('did not approve')}</span>
              <span className="muted">{fmtDate(localDay(a.at), lang)}</span>
              {a.note && <span className="muted">· {a.note}</span>}
              {a.image && <img className="claim-ink" src={a.image} alt="" />}
            </div>
          )) : <p className="small muted">{t('None yet.')}</p>}
          {c.status === 'submitted' && (
            <p className="small muted">
              {t('Needs {n} approval(s). Who may approve it: {names}.').replace('{n}', String(c.needed)).replace('{names}', c.approvers.map((a) => a.name).join(', ') || t('nobody yet: add an approver (Approvers and settings)'))}
            </p>
          )}
        </div>

        {(c.approval_journal_id || c.payment_journal_id) && (
          <div className="row small">
            {c.approval_journal_id && <button className="btn sm" onClick={() => b.go('journals', { open: String(c.approval_journal_id) })}><Icon name="ledger" />{t('The expense journal')}</button>}
            {c.payment_journal_id && <button className="btn sm" onClick={() => b.go('journals', { open: String(c.payment_journal_id) })}><Icon name="ledger" />{t('The payment journal')}</button>}
            {c.paid_on && <span className="muted">{t('Paid on {date} by {who}').replace('{date}', fmtDate(c.paid_on, lang)).replace('{who}', c.paid_by ?? '')}{c.payment_ref ? ` · ${c.payment_ref}` : ''}</span>}
          </div>
        )}
        {c.status === 'approved' && !b.overview.started && <div className="callout warn small">{t('The books haven’t been started: the expense will be drafted once they are.')}</div>}

        {pay && (
          <div className="card stack tight">
            <h3>{t('Pay this claim')}</h3>
            <p className="small muted">{t('Repay the claimant first (e.g. by PayNow or bank transfer), then record it here: Canon drafts Dr Claims to repay / Cr the bank, matched later on the bank statement.')}</p>
            <div className="grid cols-3">
              <Field label={t('Paid on')}><input type="date" value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></Field>
              <Field label={t('From')}><AccountSelect value={pay.bank} kinds={['bank', 'cash']} onChange={(v) => setPay({ ...pay, bank: v })} /></Field>
              <Field label={t('Reference')}><input value={pay.ref} onChange={(e) => setPay({ ...pay, ref: e.target.value })} placeholder={t('e.g. the transfer reference')} /></Field>
            </div>
            {c.approvals.some((a) => a.person_id === user.person_id && a.decision === 'approved') && <div className="callout warn small">{t('You approved this claim. You may pay it too; the claim will be marked “approver paid”.')}</div>}
            <div className="row end">
              <button className="btn" onClick={() => setPay(null)}>{t('Cancel')}</button>
              <button className="btn" disabled={busy || !pay.bank} onClick={() => run(() => api.post(`/bookkeeping/claims/${c.id}/pay`, { date: pay.date, bank_account_id: pay.bank, reference: pay.ref || null, post: false }), t('Saved.')).then((r) => { setPay(null); after(r); })}>{t('Record (draft)')}</button>
              <button className="btn primary" disabled={busy || !pay.bank} onClick={() => run(() => api.post(`/bookkeeping/claims/${c.id}/pay`, { date: pay.date, bank_account_id: pay.bank, reference: pay.ref || null, post: true }), t('Posted.')).then((r) => { setPay(null); after(r); })}>{t('Record and post')}</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function PaperUpload({ claimId, onDone }: { claimId: number; onDone: () => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  return (
    <label className="btn" style={{ alignSelf: 'flex-start' }}>
      <Icon name="upload" />{busy ? t('Uploading…') : t('Add receipts or the signed form')}
      <input type="file" hidden multiple accept="image/png,image/jpeg,image/webp,application/pdf" onChange={async (e) => {
        for (const f of Array.from(e.target.files ?? [])) await run(() => api.upload(`/bookkeeping/claims/${claimId}/files?name=${encodeURIComponent(f.name)}`, f));
        onDone();
      }} />
    </label>
  );
}

/** A claim handed in on paper: the office types it in for the member, attaches the scans, records the signature. */
function PaperClaim({ onClose, onMade }: { onClose: () => void; onMade: (id: number) => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const people = useApi<{ id: number; name: string }[]>(dq.trim().length >= 2 ? `/bookkeeping/claim-people?q=${encodeURIComponent(dq)}` : null);
  const [who, setWho] = useState<{ id: number; name: string } | null>(null);
  const [purpose, setPurpose] = useState('');
  const [payTo, setPayTo] = useState('');
  const [lines, setLines] = useState([{ date: today(), description: '', payee: '', amount: 0 }]);
  const set = (i: number, p: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const save = () => who && run(() => api.post<{ id: number }>('/bookkeeping/claims', { person_id: who.id, purpose: purpose || null, pay_to: payTo || null, lines: lines.map((l) => ({ ...l, payee: l.payee || null })) })).then((r) => r && onMade(r.id));
  return (
    <Modal title={t('Enter a paper claim')} onClose={onClose} size="lg" footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" disabled={busy || !who} onClick={save}>{t('Save')}</button></>}>
      <div className="stack">
        {who ? <div className="row"><strong>{who.name}</strong><button className="btn ghost sm" onClick={() => setWho(null)}>{t('Change')}</button></div> : (
          <Field label={t('Claimant (a member)')}>
            <SearchBox value={q} onChange={setQ} placeholder={t('Name')} />
            {people.data?.map((p) => <button key={p.id} className="btn ghost sm" onClick={() => setWho(p)}>{p.name}</button>)}
          </Field>
        )}
        <div className="grid cols-2">
          <Field label={t('What the claim is for')}><input value={purpose} onChange={(e) => setPurpose(e.target.value)} /></Field>
          <Field label={t('Repay to')}><input value={payTo} onChange={(e) => setPayTo(e.target.value)} /></Field>
        </div>
        <table className="t bk-lines">
          <thead><tr><th>{t('Date')}</th><th>{t('What for')}</th><th>{t('Shop or payee')}</th><th className="bk-num">{t('Amount')}</th><th /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td><input type="date" value={l.date} onChange={(e) => set(i, { date: e.target.value })} /></td>
                <td><input value={l.description} onChange={(e) => set(i, { description: e.target.value })} /></td>
                <td><input value={l.payee} onChange={(e) => set(i, { payee: e.target.value })} /></td>
                <td className="bk-num"><MoneyInput cents={l.amount} onChange={(c) => set(i, { amount: c })} /></td>
                <td>{lines.length > 1 && <button className="btn ghost icon" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))} aria-label={t('Remove')}><Icon name="x" /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setLines((ls) => [...ls, { date: today(), description: '', payee: '', amount: 0 }])}><Icon name="plus" />{t('Another receipt')}</button>
        <p className="small muted">{t('Then attach the receipts and the signed form, and record that it was signed on paper.')}</p>
      </div>
    </Modal>
  );
}

function ClaimSettings({ onClose }: { onClose: () => void }) {
  const { t, lt } = useI18n();
  const b = useBooks();
  const { run, busy } = useAction();
  const s = useApi<{ settings: typeof b.overview.settings; sign_in: { wanted: boolean; on: boolean; gates: { key: string; ok: boolean; problem?: string }[] } }>('/bookkeeping/claim-settings');
  const approvers = useApi<ClaimApprover[]>('/bookkeeping/claim-approvers');
  const [form, setForm] = useState<{ self: boolean; two: number; payable: number | null; dflt: number | null } | null>(null);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const people = useApi<{ id: number; name: string; email: boolean }[]>(dq.trim().length >= 2 ? `/bookkeeping/claim-people?q=${encodeURIComponent(dq)}` : null);
  useEffect(() => {
    if (s.data && !form) setForm({ self: s.data.settings.claims_self_service, two: s.data.settings.claims_two_above ?? 0, payable: s.data.settings.claims_payable_account_id, dflt: s.data.settings.claims_default_account_id });
  }, [s.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveApprover = (a: Partial<ClaimApprover> & { person_id: number }, id?: number) => run(() => (id ? api.patch(`/bookkeeping/claim-approvers/${id}`, a) : api.post('/bookkeeping/claim-approvers', a))).then((r) => r && approvers.reload());
  const save = () => form && run(() => api.put('/bookkeeping/claim-settings', { claims_self_service: form.self, claims_two_above: form.two || null, claims_payable_account_id: form.payable, claims_default_account_id: form.dflt }), t('Saved.')).then((r) => { if (r) { s.reload(); b.reload(); } });
  return (
    <Modal title={t('Approvers and settings')} onClose={onClose} size="lg" footer={<><button className="btn" onClick={onClose}>{t('Close')}</button><button className="btn primary" disabled={busy || !form} onClick={save}>{t('Save settings')}</button></>}>
      {!form || !approvers.data ? <Loading /> : (
        <div className="stack">
          <h3>{t('Approvers')} <InfoTip text={t('People, not a role: anyone on the member list, with or without a Canon account. They approve on their phone (signing in with a code by e-mail, or from My claims in Canon). Nobody approves their own claim.')} /></h3>
          {!approvers.data.length && <p className="small muted">{t('No approvers yet: claims wait until there is one.')}</p>}
          <table className="t bk-mini">
            <tbody>
              {approvers.data.map((a) => (
                <tr key={a.id}>
                  <td><strong>{a.name}</strong>{!a.email && <div className="small" style={{ color: 'var(--warn)' }}>{t('No e-mail address: can approve only from a Canon account linked to them')}</div>}</td>
                  <td>
                    {b.ministries.length === 0 ? <span className="small muted">{t('Every claim')}</span> : <>
                    <select multiple value={(a.ministry_ids ?? []).map(String)} aria-label={t('Ministries')} onChange={(e) => saveApprover({ person_id: a.person_id, ministry_ids: Array.from(e.target.selectedOptions).map((o) => Number(o.value)), max_amount: a.max_amount, active: a.active }, a.id)} style={{ minWidth: 140 }}>
                      {b.ministries.map((m) => <option key={m.id} value={m.id}>{lt(m.name)}</option>)}
                    </select>
                    <div className="small muted">{a.ministry_ids?.length ? t('These ministries only') : t('Every claim')}</div>
                    </>}
                  </td>
                  <td><span className="small muted">{t('Up to')}</span> <MoneyInput cents={a.max_amount ?? 0} onChange={(c) => saveApprover({ person_id: a.person_id, ministry_ids: a.ministry_ids, max_amount: c || null, active: a.active }, a.id)} label={t('Up to')} /><div className="small muted">{t('(empty = any amount)')}</div></td>
                  <td><label className="check small"><input type="checkbox" checked={a.active} onChange={(e) => saveApprover({ person_id: a.person_id, ministry_ids: a.ministry_ids, max_amount: a.max_amount, active: e.target.checked }, a.id)} />{t('Active')}</label></td>
                  <td><button className="btn ghost icon" aria-label={t('Remove')} onClick={() => confirmAction(t('Remove this approver?')) && run(() => api.del(`/bookkeeping/claim-approvers/${a.id}`)).then(() => approvers.reload())}><Icon name="x" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Field label={t('Add an approver')}>
            <SearchBox value={q} onChange={setQ} placeholder={t('A member’s name')} />
            <div className="row">{people.data?.filter((p) => !approvers.data!.some((a) => a.person_id === p.id)).map((p) => <button key={p.id} className="btn sm" onClick={() => { setQ(''); void saveApprover({ person_id: p.id }); }}><Icon name="plus" />{p.name}</button>)}</div>
          </Field>

          <h3>{t('Rules')}</h3>
          <div className="grid cols-2">
            <Field label={t('Two approvers above')} hint={t('Claims above this amount need two different approvers. Empty = one is always enough.')}><MoneyInput cents={form.two} onChange={(c) => setForm({ ...form, two: c })} /></Field>
            <Field label={t('Claims to repay (liability)')}><AccountSelect value={form.payable} types={['liability']} empty={t('Default: account 2100')} onChange={(v) => setForm({ ...form, payable: v })} /></Field>
            <Field label={t('Default expense account')} hint={t('For lines nobody has booked yet; the office can change each line before the expense is posted.')}><AccountSelect value={form.dflt} types={['expense']} empty={t('Default: account 5990')} onChange={(v) => setForm({ ...form, dflt: v })} /></Field>
          </div>

          <h3>{t('Signing in on a phone')}</h3>
          <label className="check"><input type="checkbox" checked={form.self} onChange={(e) => setForm({ ...form, self: e.target.checked })} />{t('Members may sign in with a code sent to the e-mail address on their member record')}</label>
          {s.data && (
            <ul className="small">
              {s.data.sign_in.gates.map((g) => <li key={g.key}>{g.ok ? '✓' : '✗'} {g.key === 'email' ? t('E-mail works (Settings → E-mail: send a test)') : t('A public https address (Settings → AI / MCP), so phones reach Canon from anywhere')}</li>)}
            </ul>
          )}
          <p className="small muted">{t('Without it, people with a Canon account still claim and approve from My claims.')}</p>
        </div>
      )}
    </Modal>
  );
}

function ShareLink({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const l = useApi<{ link: string; public: boolean; qr: string }>('/bookkeeping/claims-link');
  return (
    <Modal title={t('Link for members')} onClose={onClose}>
      {!l.data ? <Loading /> : (
        <div className="stack" style={{ alignItems: 'center' }}>
          <p className="small">{t('Members open this to make a claim on their phone; approvers, to approve. Share it, or print the QR code for the notice board.')}</p>
          <div style={{ width: 200 }} dangerouslySetInnerHTML={{ __html: l.data.qr }} />
          <code className="code">{l.data.link}</code>
          {!l.data.public && <div className="callout warn small">{t('Canon has no public address yet: this link works on the church’s network only (Settings → AI / MCP).')}</div>}
          <div className="row"><button className="btn" onClick={() => navigator.clipboard?.writeText(l.data!.link)}><Icon name="copy" />{t('Copy')}</button><button className="btn" onClick={() => window.print()}><Icon name="print" />{t('Print')}</button></div>
        </div>
      )}
    </Modal>
  );
}
