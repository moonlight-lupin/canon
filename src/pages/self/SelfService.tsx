// Lending library self-service (0.15): what a member sees on their phone, with no Canon account. A copy's QR label
// opens /lending/copy/<number> (this page when not signed in to Canon); /self/loans lists their loans;
// /self/renew/<token> is the renewal link in reminder e-mails. They sign in with a code e-mailed to the address on
// the member register. Plain fetch (not the app's api helper): a 401 here must not sign a staff member out.
import { UI_LANGS, langInfo } from '../../../shared/languages.ts';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Route, Routes, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n.tsx';
import { fmtDate } from '../../components/ui.tsx';
import { ReedMark } from '../../components/icons.tsx';
import type { L10n } from '../../../shared/types.ts';
import '../resources/resources.css';

interface Copy { number: string; book_id: number; title: string; authors: string | null; shelf: string | null; has_cover: boolean; updated_at: string; status: 'available' | 'out' | 'returned' | 'unavailable'; due_on: string | null; loan_days: number }
interface MyLoan { id: number; number: string; title: string; due_on: string; overdue_days: number; renewals: number; can_renew: boolean; returned: boolean }
interface Session { token: string; name: string; at: number }

const KEY = 'canon.library.self';
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

class SelfError extends Error {
  status: number;
  paused: boolean;
  constructor(message: string, status: number, paused: boolean) {
    super(message);
    this.status = status;
    this.paused = paused;
  }
}
async function call<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const r = await fetch(`/api/self${path}`, {
    method, credentials: 'omit',
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { 'X-Self-Token': token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as { error?: string; paused?: boolean };
  if (!r.ok) throw new SelfError(j.error ?? `HTTP ${r.status}`, r.status, !!j.paused);
  return j as T;
}

export default function SelfService() {
  return (
    <Routes>
      <Route path="/self/loans" element={<Shell><MyLoans /></Shell>} />
      <Route path="/self/renew/:token" element={<Shell><RenewLink /></Shell>} />
      <Route path="/lending/copy/:number" element={<Shell><CopyCard /></Shell>} />
      <Route path="*" element={<Shell><MyLoans /></Shell>} />
    </Routes>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { t, lt, lang, setLang } = useI18n();
  const [church, setChurch] = useState<{ church_name: L10n; on: boolean; languages?: string[] } | null>(null);
  // the interface languages this church uses (English always)
  const choices = UI_LANGS.filter((l) => l === 'en' || (church?.languages ?? ['zh']).includes(l));
  useEffect(() => {
    call<{ church_name: L10n; on: boolean }>('GET', '/status').then(setChurch).catch(() => setChurch({ church_name: {}, on: false }));
  }, []);
  return (
    <div className="self-page">
      <header className="self-head">
        <ReedMark className="brand-mark" />
        <div className="grow">
          <div className="eyebrow">{t('Lending library')}</div>
          <strong className="serif">{lt(church?.church_name ?? {}) || 'Canon'}</strong>
        </div>
        {choices.length > 1 && (
          <select className="sm" value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t('Language')}>
            {choices.map((l) => <option key={l} value={l}>{langInfo(l).native}</option>)}
          </select>
        )}
      </header>
      {church && !church.on ? <Paused /> : children}
    </div>
  );
}

const Paused = () => {
  const { t } = useI18n();
  return <div className="card self-card"><p>{t('Self-service is paused at the moment. Please see the librarian.')}</p></div>;
};

/** Sign in with a code sent to the e-mail address the church has for you. */
function SignIn({ onDone }: { onDone: (s: Session, loans: MyLoan[]) => void }) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await call('POST', '/code', { email });
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await call<{ token: string; name: string; loans: MyLoan[] }>('POST', '/verify', { email, code });
      const s = { token: r.token, name: r.name, at: Date.now() };
      saveSession(s);
      onDone(s, r.loans);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack tight">
      {!sent ? (
        <>
          <label className="self-label">{t('Your e-mail address (as the church has it)')}</label>
          <input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && email && send()} />
          <button className="btn primary self-btn" disabled={busy || !email.includes('@')} onClick={send}>{t('Send me a code')}</button>
        </>
      ) : (
        <>
          <p className="small">{t('If this address is on the church’s member list, a 6-digit code is on its way. It works for 10 minutes.')}</p>
          <label className="self-label">{t('Code')}</label>
          <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && verify()} className="self-code" />
          <button className="btn primary self-btn" disabled={busy || code.length !== 6} onClick={verify}>{t('Sign in')}</button>
          <button className="btn ghost sm" onClick={() => { setSent(false); setCode(''); }}>{t('Use another address')}</button>
        </>
      )}
      {error && <p className="small" style={{ color: 'var(--danger, #a33)' }}>{error}</p>}
    </div>
  );
}

function CopyCard() {
  const { number = '' } = useParams();
  const { t, lang } = useI18n();
  const [copy, setCopy] = useState<Copy | null>(null);
  const [error, setError] = useState<SelfError | null>(null);
  const [session, setSession] = useState<Session | null>(readSession);
  const [signing, setSigning] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => call<Copy>('GET', `/copy/${encodeURIComponent(number)}`).then(setCopy).catch((e) => setError(e as SelfError));
  useEffect(() => {
    void load();
  }, [number]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error?.paused) return <Paused />;
  if (error) return <div className="card self-card"><p>{error.message}</p></div>;
  if (!copy) return <div className="card self-card"><p className="muted">…</p></div>;
  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      setDone(await fn());
      await load();
    } catch (e) {
      const se = e as SelfError;
      if (se.status === 401) {
        saveSession(null);
        setSession(null);
        setSigning(true);
      }
      setDone(se.message);
    } finally {
      setBusy(false);
    }
  };
  const borrow = (s: Session) => act(async () => {
    const r = await call<{ due_on: string }>('POST', '/borrow', { number: copy.number }, s.token);
    return t('Borrowed. Please bring it back by {date}.').replace('{date}', fmtDate(r.due_on, lang));
  });
  const giveBack = () => act(async () => {
    await call('POST', '/return', { number: copy.number });
    return t('Thank you! The librarian will check it in.');
  });
  return (
    <div className="card self-card stack">
      <div className="book-head">
        {copy.has_cover ? <img className="book-cover" src={`/api/self/books/${copy.book_id}/cover?v=${encodeURIComponent(copy.updated_at)}`} alt="" /> : null}
        <div className="grow stack tight">
          <span className="code">{copy.number}</span>
          <strong className="serif" style={{ fontSize: 19 }}>{copy.title}</strong>
          {copy.authors && <span className="small">{copy.authors}</span>}
          {copy.status === 'available' && <span className="badge ok">{t('Available')}</span>}
          {copy.status === 'out' && <span className="badge warn">{t('On loan, due {date}').replace('{date}', fmtDate(copy.due_on, lang))}</span>}
          {copy.status === 'returned' && <span className="badge lapis">{t('Returned: waiting for the librarian')}</span>}
          {copy.status === 'unavailable' && <span className="badge">{t('Not available')}</span>}
        </div>
      </div>
      {done && <p className="callout small">{done}</p>}
      {copy.status === 'available' && !done && (
        session ? (
          <button className="btn primary self-btn" disabled={busy} onClick={() => borrow(session)}>{t('Borrow it ({name})').replace('{name}', session.name)}</button>
        ) : signing ? (
          <SignIn onDone={(s) => { setSession(s); setSigning(false); void borrow(s); }} />
        ) : (
          <button className="btn primary self-btn" onClick={() => setSigning(true)}>{t('Borrow it')}</button>
        )
      )}
      {copy.status === 'out' && !done && (
        <button className="btn self-btn" disabled={busy} onClick={giveBack}>{t('I’m bringing it back')}</button>
      )}
      {copy.status === 'available' && <p className="small muted">{t('A loan lasts {n} days.').replace('{n}', String(copy.loan_days))}</p>}
      <Link className="small" to="/self/loans">{t('My loans')} →</Link>
    </div>
  );
}

function MyLoans() {
  const { t, lang } = useI18n();
  const [session, setSession] = useState<Session | null>(readSession);
  const [loans, setLoans] = useState<MyLoan[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!session) return;
    call<MyLoan[]>('GET', '/loans', undefined, session.token).then(setLoans).catch((e: SelfError) => {
      if (e.paused) setPaused(true);
      saveSession(null);
      setSession(null);
    });
  }, [session]);
  if (paused) return <Paused />;
  if (!session) {
    return (
      <div className="card self-card stack">
        <h2 style={{ margin: 0 }}>{t('My loans')}</h2>
        <SignIn onDone={(s, l) => { setSession(s); setLoans(l); }} />
      </div>
    );
  }
  const renew = async (l: MyLoan) => {
    try {
      const r = await call<{ due_on: string; loans: MyLoan[] }>('POST', `/loans/${l.id}/renew`, {}, session.token);
      setLoans(r.loans);
      setMsg(t('Renewed until {date}.').replace('{date}', fmtDate(r.due_on, lang)));
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <div className="card self-card stack">
      <div className="row" style={{ alignItems: 'center' }}>
        <h2 style={{ margin: 0 }} className="grow">{t('My loans')}</h2>
        <button className="btn ghost sm" onClick={() => { saveSession(null); setSession(null); setLoans(null); }}>{t('Sign out')}</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>{session.name}</p>
      {msg && <p className="callout small">{msg}</p>}
      {!loans ? <p className="muted">…</p> : !loans.length ? <p>{t('You have nothing on loan.')}</p> : loans.map((l) => (
        <div key={l.id} className="copy-row">
          <div className="grow">
            <strong>{l.title}</strong> <span className="code small">{l.number}</span>
            <div className="small">
              {l.returned ? t('Returned: waiting for the librarian') : <>{t('due')} {fmtDate(l.due_on, lang)}{l.overdue_days > 0 && <span className="badge warn" style={{ marginLeft: 6 }}>{t('{n} days overdue').replace('{n}', String(l.overdue_days))}</span>}</>}
            </div>
          </div>
          {l.can_renew && <button className="btn sm" onClick={() => renew(l)}>{t('Renew')}</button>}
        </div>
      ))}
      <p className="small muted">{t('To borrow, scan the QR code on the book’s label.')}</p>
    </div>
  );
}

function RenewLink() {
  const { token = '' } = useParams();
  const { t, lang } = useI18n();
  const [info, setInfo] = useState<{ number: string; title: string; due_on: string; renewals: number; can_renew: boolean } | null>(null);
  const [error, setError] = useState<SelfError | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    call<NonNullable<typeof info>>('GET', `/renew-link/${encodeURIComponent(token)}`).then(setInfo).catch((e) => setError(e as SelfError));
  }, [token]);
  if (error?.paused) return <Paused />;
  if (error) return <div className="card self-card"><p>{error.message}</p></div>;
  if (!info) return <div className="card self-card"><p className="muted">…</p></div>;
  const renew = async () => {
    setBusy(true);
    try {
      const r = await call<{ due_on: string }>('POST', `/renew-link/${encodeURIComponent(token)}`);
      setDone(t('Renewed until {date}.').replace('{date}', fmtDate(r.due_on, lang)));
    } catch (e) {
      setDone((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card self-card stack">
      <strong className="serif" style={{ fontSize: 19 }}>{info.title}</strong>
      <span className="small"><span className="code">{info.number}</span> · {t('due')} {fmtDate(info.due_on, lang)}</span>
      {done ? <p className="callout small">{done}</p>
        : info.can_renew ? <button className="btn primary self-btn" disabled={busy} onClick={renew}>{t('Renew')}</button>
          : <p className="small">{t('This loan can’t be renewed again. Please bring it back, or see the librarian.')}</p>}
    </div>
  );
}
