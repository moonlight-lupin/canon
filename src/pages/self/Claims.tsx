// Expense claims on a phone (0.17.1): /self/claims lists a member's claims (and, for an approver, those waiting for
// them); /self/claims/<id> is one claim — its claimant fills in the lines, photographs the receipts, says where to
// repay them and signs; an approver looks at the receipts and approves (signing), sends it back or rejects it.
// Someone signed in to Canon is signed in here too (as their linked member); others sign in with a code e-mailed to
// the address on their member record. Plain fetch, not the app's api helper: a 401 here must not sign anyone out.
import { UI_LANGS, langInfo } from '../../../shared/languages.ts';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n.tsx';
import { fmtDate, today } from '../../components/ui.tsx';
import { Icon, ReedMark } from '../../components/icons.tsx';
import { ReceiptViewer } from '../../components/ReceiptViewer.tsx';
import { SignaturePad } from '../records/CashCount.tsx';
import { CLAIM_STATUS_LABEL, type Claim, type ClaimStatus } from '../../../shared/bookkeeping.ts';
import type { L10n } from '../../../shared/types.ts';
import '../resources/resources.css';
import '../records.css';

/** A stored UTC time as the local day (YYYY-MM-DD), for showing dates. */
const localDay = (s: string) => {
  const d = new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

interface Session { token: string; name: string; at: number; /** signed in through a Canon account in this browser */ canon?: boolean }
interface Status { sign_in: boolean; church_name: L10n; languages: string[]; currency: string; ministries: { id: number; name: L10n }[]; projects: { id: number; name: L10n }[] }
type View = Claim & { may_edit: boolean; may_withdraw: boolean; may_approve: boolean; needed: number; problems: string[]; office_typed_pay_to: boolean };
interface Mine {
  name: string; approver: boolean; last_pay_to: string | null;
  mine: { id: number; number: string | null; purpose: string | null; status: ClaimStatus; total: number; files: number; created_at: string }[];
  to_approve: { id: number; number: string | null; claimant: string; purpose: string | null; total: number; submitted_at: string | null }[];
}

const KEY = 'canon.claims.self';
const readSession = (): Session | null => {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Session | null;
    return s && Date.now() - s.at < 110 * 60_000 ? s : null;
  } catch {
    return null;
  }
};
const saveSession = (s: Session | null) => {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch { /* this page only */ }
};

class ClaimError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
async function call<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const isFile = body instanceof Blob;
  const r = await fetch(`/api/self/claims${path}`, {
    method, credentials: 'omit',
    headers: { ...(body !== undefined ? { 'Content-Type': isFile ? (body as Blob).type || 'application/octet-stream' : 'application/json' } : {}), ...(token ? { 'X-Self-Token': token } : {}) },
    body: body === undefined ? undefined : isFile ? (body as Blob) : JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new ClaimError(j.error ?? `HTTP ${r.status}`, r.status);
  return j as T;
}

/** Signed in to Canon in this browser: a claims sign-in for the account's member, with no code. */
async function canonSession(): Promise<Session | null> {
  try {
    const me = await fetch('/api/me', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)) as { user?: unknown; csrf?: string } | null;
    if (!me?.user || !me.csrf) return null;
    const r = await fetch('/api/me/claims-session', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': me.csrf, 'Content-Type': 'application/json' }, body: '{}' });
    if (!r.ok) return null;
    const t = (await r.json()) as { token: string; name: string };
    return { token: t.token, name: t.name, at: Date.now(), canon: true };
  } catch {
    return null;
  }
}

const money = (cents: number, cur?: string) => `${cur ? `${cur} ` : ''}${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS_BADGE: Record<ClaimStatus, string> = { draft: '', submitted: 'warn', approved: 'lapis', rejected: 'danger', paid: 'ok', withdrawn: '' };

export default function ClaimsSelf() {
  const [session, setSession] = useState<Session | null>(readSession);
  const [status, setStatus] = useState<Status | null>(null);
  const [checked, setChecked] = useState(!!session);
  useEffect(() => {
    call<Status>('GET', '/status').then(setStatus).catch(() => setStatus(null));
    if (!session) {
      canonSession().then((s) => {
        if (s) {
          saveSession(s);
          setSession(s);
        }
        setChecked(true);
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const signOut = () => {
    saveSession(null);
    setSession(null);
  };
  return (
    <Shell status={status} session={session} onSignOut={signOut}>
      {!checked || !status ? <div className="card self-card"><p className="muted">…</p></div>
        : !session ? <SignInCard status={status} onDone={(s) => { saveSession(s); setSession(s); }} />
          : (
            <Routes>
              <Route path="/self/claims/:id" element={<ClaimPage session={session} status={status} onExpired={signOut} />} />
              <Route path="*" element={<Home session={session} status={status} onExpired={signOut} />} />
            </Routes>
          )}
    </Shell>
  );
}

function Shell({ status, session, onSignOut, children }: { status: Status | null; session: Session | null; onSignOut: () => void; children: ReactNode }) {
  const { t, lt, lang, setLang } = useI18n();
  const choices = UI_LANGS.filter((l) => l === 'en' || (status?.languages ?? ['zh']).includes(l));
  return (
    <div className="self-page claims-self">
      <header className="self-head">
        <ReedMark className="brand-mark" />
        <div className="grow">
          <div className="eyebrow">{t('Expense claims')}{session?.canon && <> · <a href="/">{t('Back to Canon')}</a></>}</div>
          <strong className="serif">{lt(status?.church_name ?? {}) || 'Canon'}</strong>
        </div>
        {choices.length > 1 && (
          <select className="sm" value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t('Language')}>
            {choices.map((l) => <option key={l} value={l}>{langInfo(l).native}</option>)}
          </select>
        )}
      </header>
      {children}
      {session && (
        <p className="small muted" style={{ marginTop: 18, textAlign: 'center' }}>
          {session.name} · {session.canon ? <a href="/">{t('Back to Canon')}</a> : <button className="btn ghost sm" onClick={onSignOut}>{t('Sign out')}</button>}
        </p>
      )}
    </div>
  );
}

function SignInCard({ status, onDone }: { status: Status; onDone: (s: Session) => void }) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!status.sign_in) {
    return (
      <div className="card self-card stack tight">
        <p>{t('Sign in to Canon in this browser, then open this page again. (Signing in with a code by e-mail is not switched on: ask the treasurer.)')}</p>
        <a className="btn primary self-btn" href="/">{t('Sign in to Canon')}</a>
      </div>
    );
  }
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card self-card stack tight">
      {!sent ? (
        <>
          <label className="self-label">{t('Your e-mail address (as the church has it)')}</label>
          <input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn primary self-btn" disabled={busy || !email.includes('@')} onClick={() => run(async () => { await call('POST', '/code', { email }); setSent(true); })}>{t('Send me a code')}</button>
        </>
      ) : (
        <>
          <p className="small">{t('If this address is on the church’s member list, a 6-digit code is on its way. It works for 10 minutes.')}</p>
          <label className="self-label">{t('Code')}</label>
          <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} className="self-code" />
          <button className="btn primary self-btn" disabled={busy || code.length !== 6} onClick={() => run(async () => {
            const r = await call<{ token: string; name: string }>('POST', '/verify', { email, code });
            onDone({ token: r.token, name: r.name, at: Date.now() });
          })}>{t('Sign in')}</button>
          <button className="btn ghost sm" onClick={() => { setSent(false); setCode(''); }}>{t('Use another address')}</button>
        </>
      )}
      {error && <p className="small" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  );
}

function useLoad<T>(fn: () => Promise<T>, deps: unknown[], onExpired: () => void) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => fn().then((d) => { setData(d); setError(null); }).catch((e: ClaimError) => (e.status === 401 ? onExpired() : setError(e.message)));
  useEffect(() => {
    void load();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, reload: load, setData };
}

function Home({ session, status, onExpired }: { session: Session; status: Status; onExpired: () => void }) {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const m = useLoad(() => call<Mine>('GET', '/mine', undefined, session.token), [session.token], onExpired);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      const c = await call<View>('POST', '', { pay_to: m.data?.last_pay_to ?? null, lines: [{ date: today(), description: '', payee: null, amount: 0 }] }, session.token);
      nav(`/self/claims/${c.id}`);
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (m.error) return <div className="card self-card"><p>{m.error}</p></div>;
  if (!m.data) return <div className="card self-card"><p className="muted">…</p></div>;
  return (
    <div className="stack">
      {m.data.to_approve.length > 0 && (
        <div className="card self-card stack tight">
          <h3>{t('Waiting for your approval')}</h3>
          {m.data.to_approve.map((c) => (
            <Link key={c.id} to={`/self/claims/${c.id}`} className="claim-row">
              <span className="grow"><strong>{c.claimant}</strong><div className="small muted">{c.number} · {c.purpose}</div></span>
              <strong>{money(c.total)}</strong>
            </Link>
          ))}
        </div>
      )}
      <button className="btn primary self-btn" disabled={busy} onClick={start}><Icon name="plus" />{t('New claim')}</button>
      <div className="card self-card stack tight">
        <h3>{t('Your claims')}</h3>
        {!m.data.mine.length ? <p className="small muted">{t('None yet. A claim can have several receipts: one line for each.')}</p> : m.data.mine.map((c) => (
          <Link key={c.id} to={`/self/claims/${c.id}`} className="claim-row">
            <span className="grow">
              <strong>{c.purpose || t('Expense claim')}</strong>
              <div className="small muted">{c.number ?? t('Draft')} · {fmtDate(localDay(c.created_at), lang)}</div>
            </span>
            <span style={{ textAlign: 'right' }}>
              <strong>{money(c.total)}</strong>
              <div><span className={`badge ${STATUS_BADGE[c.status]}`}>{t(CLAIM_STATUS_LABEL[c.status])}</span></div>
            </span>
          </Link>
        ))}
      </div>
      <p className="small muted">{t('Currency')}: {status.currency}</p>
    </div>
  );
}

/** A receipt: fetched with the sign-in token (an <img> can't send it), shown from memory. */
function Receipt({ id, mime, name, token, onRemove }: { id: number; mime: string; name: string; token: string; onRemove?: () => void }) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    fetch(`/api/self/claims/files/${id}`, { headers: { 'X-Self-Token': token }, credentials: 'omit' }).then((r) => (r.ok ? r.blob() : null)).then((b) => {
      if (b) {
        u = URL.createObjectURL(b);
        setUrl(u);
      }
    });
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [id, token]);
  return (
    <div className="claim-receipt">
      {mime === 'application/pdf'
        ? <a href={url ?? '#'} target="_blank" rel="noreferrer" className="claim-pdf"><Icon name="file" />{name}</a>
        : url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={name} /></a> : <span className="muted small">…</span>}
      {onRemove && <button className="btn ghost sm" onClick={onRemove} aria-label={t('Remove')}><Icon name="x" /></button>}
    </div>
  );
}

/** A phone photo shrunk to at most 2000 px (receipts stay readable, uploads stay small); PDFs as they are. */
async function shrink(f: File): Promise<Blob> {
  if (f.type === 'application/pdf' || (f.size < 1_500_000 && ['image/png', 'image/jpeg', 'image/webp'].includes(f.type))) return f;
  try {
    const img = await createImageBitmap(f);
    const k = Math.min(1, 2000 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('photo'))), 'image/jpeg', 0.85));
  } catch {
    return f;
  }
}

interface EditLine { id?: number; date: string; description: string; payee: string; amount: string; ministry_id: number | null }
const toEdit = (c: Claim): EditLine[] => c.lines.map((l) => ({ id: l.id, date: l.date ?? '', description: l.description, payee: l.payee ?? '', amount: l.amount ? (l.amount / 100).toFixed(2) : '', ministry_id: l.ministry_id ?? null }));
const cents = (s: string) => Math.round((Number(s.replace(/[,\s]/g, '')) || 0) * 100);

function ClaimPage({ session, status, onExpired }: { session: Session; status: Status; onExpired: () => void }) {
  const { t, lt, lang } = useI18n();
  const { id = '' } = useParams();
  const nav = useNavigate();
  const v = useLoad(() => call<View>('GET', `/${id}`, undefined, session.token), [id, session.token], onExpired);
  const [purpose, setPurpose] = useState('');
  const [ministry, setMinistry] = useState<number | null>(null);
  const [payTo, setPayTo] = useState('');
  const [lines, setLines] = useState<EditLine[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ink, setInk] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const fileFor = useRef<number | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const c = v.data;
  useEffect(() => {
    if (!c) return;
    setPurpose(c.purpose ?? '');
    setMinistry(c.ministry_id);
    setPayTo(c.pay_to ?? '');
    setLines(toEdit(c));
    setDirty(false);
  }, [c?.id, c?.revision, c?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  if (v.error) return <div className="card self-card stack tight"><p>{v.error}</p><Link to="/self/claims">{t('Back')}</Link></div>;
  if (!c) return <div className="card self-card"><p className="muted">…</p></div>;
  const act = async (fn: () => Promise<View | void>, then?: (r: View | void) => void) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r) v.setData(r);
      then?.(r);
    } catch (e) {
      if ((e as ClaimError).status === 401) onExpired();
      else window.alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const body = () => ({
    purpose: purpose.trim() || null, ministry_id: ministry, pay_to: payTo.trim() || null,
    lines: lines.map((l) => ({ id: l.id, date: l.date || null, description: l.description, payee: l.payee || null, amount: cents(l.amount), ministry_id: l.ministry_id ?? ministry })),
  });
  const save = () => act(() => call<View>('PUT', `/${c.id}`, body(), session.token), () => setDirty(false));
  const set = (i: number, p: Partial<EditLine>) => {
    setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
    setDirty(true);
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    // unsaved changes first, so the photo lands on the right line
    if (dirty) await call<View>('PUT', `/${c.id}`, body(), session.token);
    const line = fileFor.current;
    let last: View | null = null;
    await act(async () => {
      for (const f of Array.from(files)) {
        const blob = await shrink(f);
        last = await call<View>('POST', `/${c.id}/files?name=${encodeURIComponent(f.name.replace(/\.\w+$/, blob.type === 'image/jpeg' ? '.jpg' : '$&'))}${line ? `&line_id=${line}` : ''}`, blob, session.token);
      }
      return last ?? undefined;
    }, () => setDirty(false));
    if (picker.current) picker.current.value = '';
  };
  const addPhoto = (lineId: number | null) => {
    fileFor.current = lineId;
    picker.current?.click();
  };
  const total = c.may_edit ? lines.reduce((n, l) => n + cents(l.amount), 0) : c.total;
  const receiptsOf = (lineId: number | null) => c.files.filter((f) => f.line_id === lineId);
  return (
    <div className="stack">
      <Link to="/self/claims" className="small">← {t('Your claims')}</Link>
      <div className="card self-card stack tight">
        <div className="row between">
          <strong>{c.number ?? t('New claim')}</strong>
          <span className={`badge ${STATUS_BADGE[c.status]}`}>{t(CLAIM_STATUS_LABEL[c.status])}</span>
        </div>
        <div className="small muted">{c.claimant}</div>
        <div className="claim-total">{money(total, status.currency)}</div>
        {c.note && (c.status === 'draft' || c.status === 'rejected') && <div className="callout warn small">{c.status === 'draft' ? t('Sent back:') : t('Not approved:')} {c.note}</div>}
        {c.approver_paid && <div className="small muted">{t('Paid by one of its approvers.')}</div>}
      </div>

      {c.may_edit ? (
        <>
          <div className="card self-card stack tight">
            <label className="self-label">{t('What the claim is for')}</label>
            <input value={purpose} onChange={(e) => { setPurpose(e.target.value); setDirty(true); }} placeholder={t('e.g. Youth camp supplies')} />
            {status.ministries.length > 0 && (
              <>
                <label className="self-label">{t('Ministry')}</label>
                <select value={ministry ?? ''} onChange={(e) => { setMinistry(Number(e.target.value) || null); setDirty(true); }}>
                  <option value="">{t('Not for a particular ministry')}</option>
                  {status.ministries.map((m) => <option key={m.id} value={m.id}>{lt(m.name)}</option>)}
                </select>
              </>
            )}
          </div>
          {lines.map((l, i) => (
            <div key={l.id ?? `n${i}`} className="card self-card stack tight">
              <div className="row between"><strong>{t('Receipt {n}').replace('{n}', String(i + 1))}</strong>
                {lines.length > 1 && <button className="btn ghost sm" onClick={() => { setLines((ls) => ls.filter((_, k) => k !== i)); setDirty(true); }}><Icon name="trash" />{t('Remove')}</button>}
              </div>
              <label className="self-label">{t('What it was for')}</label>
              <input value={l.description} onChange={(e) => set(i, { description: e.target.value })} placeholder={t('e.g. Snacks for the cell group')} />
              <div className="grid cols-2" style={{ gap: 8 }}>
                <div><label className="self-label">{t('Date on the receipt')}</label><input type="date" value={l.date} onChange={(e) => set(i, { date: e.target.value })} /></div>
                <div><label className="self-label">{t('Amount')}</label><input inputMode="decimal" value={l.amount} onChange={(e) => set(i, { amount: e.target.value.replace(/[^\d.,]/g, '') })} placeholder="0.00" /></div>
              </div>
              <label className="self-label">{t('Shop or payee')}</label>
              <input value={l.payee} onChange={(e) => set(i, { payee: e.target.value })} />
              <div className="claim-receipts">
                {l.id ? receiptsOf(l.id).map((f) => <Receipt key={f.id} id={f.id} mime={f.mime} name={f.name} token={session.token} onRemove={() => act(() => call<View>('DELETE', `/files/${f.id}`, undefined, session.token))} />) : null}
              </div>
              <button className="btn" disabled={busy} onClick={() => (l.id ? addPhoto(l.id) : save())}><Icon name="upload" />{l.id ? t('Add a photo of the receipt') : t('Save first, then add the photo')}</button>
            </div>
          ))}
          <button className="btn" onClick={() => { setLines((ls) => [...ls, { date: today(), description: '', payee: '', amount: '', ministry_id: null }]); setDirty(true); }}><Icon name="plus" />{t('Another receipt')}</button>
          {receiptsOf(null).length > 0 && (
            <div className="card self-card stack tight">
              <strong>{t('Other receipts')}</strong>
              <div className="claim-receipts">{receiptsOf(null).map((f) => <Receipt key={f.id} id={f.id} mime={f.mime} name={f.name} token={session.token} onRemove={() => act(() => call<View>('DELETE', `/files/${f.id}`, undefined, session.token))} />)}</div>
            </div>
          )}
          <div className="card self-card stack tight">
            <label className="self-label">{t('Where to repay you')}</label>
            <input value={payTo} onChange={(e) => { setPayTo(e.target.value); setDirty(true); }} placeholder={t('e.g. PayNow mobile number, or bank and account number')} />
            <p className="small muted">{t('Only you and the treasurer see this.')}</p>
          </div>
          <input ref={picker} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => upload(e.target.files)} />
          {dirty && <button className="btn primary self-btn" disabled={busy} onClick={save}>{t('Save')}</button>}
          {!dirty && (
            <div className="card self-card stack tight">
              <h3>{t('Sign and submit')}</h3>
              {c.problems.length > 0 ? (
                <ul className="small">{c.problems.map((p) => <li key={p}>{p}</li>)}</ul>
              ) : (
                <>
                  <p className="small">{t('I declare these were spent for the church, and have not been claimed before.')}</p>
                  <SignaturePad onChange={setInk} />
                  <button className="btn primary self-btn" disabled={busy || !ink} onClick={() => act(() => call<View>('POST', `/${c.id}/submit`, { image: ink, name: session.name }, session.token))}>{t('Sign and submit')}</button>
                </>
              )}
            </div>
          )}
          <button className="btn ghost danger" disabled={busy} onClick={() => window.confirm(t('Delete this claim?')) && act(async () => { await call('DELETE', `/${c.id}`, undefined, session.token); }, () => nav('/self/claims'))}><Icon name="trash" />{t('Delete this claim')}</button>
        </>
      ) : (
        <>
          {c.purpose && <div className="card self-card"><strong>{c.purpose}</strong></div>}
          {c.lines.map((l, i) => (
            <div key={l.id ?? i} className="card self-card stack tight">
              <div className="row between"><strong>{l.description}</strong><strong>{money(l.amount)}</strong></div>
              <div className="small muted">{l.date ? fmtDate(l.date, lang) : ''}{l.payee ? ` · ${l.payee}` : ''}</div>
            </div>
          ))}
          {c.files.length > 0 && (
            <div className="card self-card">
              <ReceiptViewer files={c.files} lines={c.lines} load={(f) => fetch(`/api/self/claims/files/${f.id}`, { headers: { 'X-Self-Token': session.token }, credentials: 'omit' }).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status))))).then((b) => URL.createObjectURL(b))} />
            </div>
          )}
          {c.signature && (
            <div className="card self-card stack tight">
              <span className="small muted">{c.signature.via === 'paper' ? t('Signed on paper') : t('Signed by {name} on {date}').replace('{name}', c.signature.name).replace('{date}', fmtDate(localDay(c.signature.signed_at), lang))}</span>
              {c.signature.image && <img className="claim-ink" src={c.signature.image} alt="" />}
            </div>
          )}
          {c.approvals.length > 0 && (
            <div className="card self-card stack tight">
              {c.approvals.map((a) => (
                <div key={a.id} className="small">
                  <strong>{a.name}</strong> · {a.decision === 'approved' ? t('approved') : a.decision === 'returned' ? t('sent it back') : t('did not approve')} · {fmtDate(localDay(a.at), lang)}
                  {a.note && <div className="muted">{a.note}</div>}
                </div>
              ))}
              {c.status === 'submitted' && c.needed > 1 && <div className="small muted">{t('This claim needs {n} approvals.').replace('{n}', String(c.needed))}</div>}
            </div>
          )}
          {c.office_typed_pay_to && (
            <div className="callout warn small">{t('Where to repay this claim was typed in by the office, not by the claimant. Before approving, check with the claimant (or on the form they signed) that the money goes to them.')}</div>
          )}
          {c.may_approve && (
            <div className="card self-card stack tight">
              <h3>{t('Your decision')}</h3>
              <p className="small">{t('Check each receipt against its line. Approve by signing, or send it back to the claimant to change, or reject it.')}</p>
              <SignaturePad onChange={setInk} />
              <button className="btn primary self-btn" disabled={busy || !ink} onClick={() => act(() => call<View>('POST', `/${c.id}/decide`, { decision: 'approved', image: ink }, session.token))}><Icon name="check" />{t('Approve')}</button>
              <label className="self-label">{t('Or say why, for the claimant')}</label>
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="row">
                <button className="btn grow" disabled={busy || !note.trim()} onClick={() => act(() => call<View>('POST', `/${c.id}/decide`, { decision: 'returned', note }, session.token))}>{t('Send back')}</button>
                <button className="btn danger grow" disabled={busy || !note.trim()} onClick={() => act(() => call<View>('POST', `/${c.id}/decide`, { decision: 'rejected', note }, session.token))}>{t('Reject')}</button>
              </div>
            </div>
          )}
          {c.may_withdraw && <button className="btn ghost" disabled={busy} onClick={() => window.confirm(t('Withdraw this claim?')) && act(() => call<View>('POST', `/${c.id}/withdraw`, undefined, session.token))}>{t('Withdraw this claim')}</button>}
        </>
      )}
    </div>
  );
}
