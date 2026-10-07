// The lending library (0.15): lend & return (scan or type a copy's number), what is on loan (overdue first), the
// catalogue with its copies and labels, and the loan rules. /lending/copy/:number is what a copy's QR label opens.
import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Empty, ErrorBox, Field, Loading, Modal, PageHead, SearchBox, Seg, confirmAction, fmtDate, useAction, useDebounced, useSession } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import { InfoTip } from '../../components/InfoTip.tsx';
import { CsvTools } from '../../components/CsvTools.tsx';
import { langInfo } from '../../../shared/languages.ts';
import { PersonSearch, type PersonHit } from './common.tsx';
import './resources.css';

type Kind = 'book' | 'dvd' | 'curriculum' | 'other';
const KIND_LABEL: Record<Kind, string> = { book: 'Book', dvd: 'DVD', curriculum: 'Curriculum', other: 'Other' };

interface Book {
  id: number; title: string; subtitle: string | null; authors: string | null; isbn: string | null; publisher: string | null; year: number | null;
  kind: Kind; category: string | null; language: string | null; shelf: string | null; description: string | null; notes: string | null; has_cover: boolean; updated_at: string;
}
interface BookRow extends Book { copies: number; available: number; on_loan: number; numbers: string[] }
interface CopyLoan { id: number; person_id: number | null; borrower: string | null; elsewhere?: boolean; lent_on: string; due_on: string; renewals: number }
interface Copy { id: number; book_id: number; number: string; status: 'in' | 'lost' | 'withdrawn'; condition: string | null; acquired_on: string | null; notes: string | null; loan: CopyLoan | null }
interface BookFull extends Book { copies: Copy[]; history: { id: number; number: string; borrower: string | null; elsewhere?: boolean; lent_on: string; due_on: string; returned_on: string | null }[] }
interface Loan { id: number; copy_id: number; elsewhere?: boolean; number: string; book_id: number; title: string; authors: string | null; person_id: number | null; borrower: string | null; has_email: boolean; lent_on: string; due_on: string; returned_on: string | null; renewals: number; overdue_days: number; via: 'desk' | 'self'; return_pending_on: string | null }
interface Scan { copy: { id: number; number: string; status: Copy['status']; book_id: number }; book: Book; loan: (CopyLoan & { borrower: string | null }) | null }
interface Rules { loan_days: number; max_renewals: number; remind_days_before: number; send_reminders: boolean; self_service: boolean; rules_saved: boolean }

type Tab = 'lend' | 'loans' | 'catalogue' | 'rules';
const TABS: [Tab, string][] = [['lend', 'Lend & return'], ['loans', 'On loan'], ['catalogue', 'Catalogue'], ['rules', 'Loan rules']];

const coverUrl = (b: Pick<Book, 'id' | 'has_cover' | 'updated_at'>) => (b.has_cover ? `/api/lending/books/${b.id}/cover?v=${encodeURIComponent(b.updated_at)}` : null);
const localToday = () => new Date().toLocaleDateString('en-CA');
const plusDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00`);
  x.setDate(x.getDate() + n);
  return x.toLocaleDateString('en-CA');
};

export default function Lending() {
  const { t } = useI18n();
  const { can } = useSession();
  const canEdit = can('lending', 'edit');
  const [sp, setSp] = useSearchParams();
  const q = sp.get('tab') as Tab | null;
  const tab: Tab = q && TABS.some(([k]) => k === q) ? q : canEdit ? 'lend' : 'catalogue';
  const setTab = (k: Tab) => setSp(k === 'lend' ? {} : { tab: k }, { replace: true });
  const shown = TABS.filter(([k]) => canEdit || k === 'catalogue' || k === 'loans');
  return (
    <div className="page">
      <PageHead eyebrow={t('Resources')} title={t('Lending library')} sub={t('The church’s books, DVDs and curricula, lent to members.')} />
      <div className="tabs">
        {shown.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t(l)}</button>)}
      </div>
      {tab === 'lend' && canEdit && <LendTab />}
      {tab === 'loans' && <LoansTab />}
      {tab === 'catalogue' && <CatalogueTab />}
      {tab === 'rules' && canEdit && <RulesTab />}
    </div>
  );
}

// ---------------------------------------------------------------- lend & return

function LendTab() {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [scan, setScan] = useState<Scan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const look = async (q = code) => {
    if (!q.trim()) return;
    setError(null);
    try {
      setScan(await api.get<Scan>(`/lending/scan?q=${encodeURIComponent(q.trim())}`));
    } catch (e) {
      setScan(null);
      setError((e as Error).message);
    }
  };
  const done = () => {
    setScan(null);
    setCode('');
    input.current?.focus();
  };
  return (
    <div className="stack">
      <section className="card">
        <div className="scan-box">
          <Field label={<>{t('Copy number')} <InfoTip text={t('Type the number on the label (e.g. B0012), or scan its QR code with a scanner. Canon then offers to lend it or take it back.')} /></>}>
            <input ref={input} autoFocus value={code} placeholder="B0012" onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && look()} />
          </Field>
          <button className="btn primary" onClick={() => look()} disabled={!code.trim()}>{t('Find')}</button>
        </div>
        {error && <div className="scan-result"><ErrorBox error={error} /></div>}
        {scan && <div className="scan-result"><ScanCard scan={scan} onDone={done} onChanged={() => look(scan.copy.number)} /></div>}
      </section>
      <OverdueShort />
    </div>
  );
}

/** A copy: its book, and Lend / Return / Renew. Used by Lend & return and by the page a QR label opens. */
function ScanCard({ scan, onDone, onChanged }: { scan: Scan; onDone: () => void; onChanged: () => void }) {
  const { t, lang } = useI18n();
  const { can } = useSession();
  const canEdit = can('lending', 'edit');
  const { run, busy } = useAction();
  const rules = useApi<Rules>(canEdit ? '/lending/settings' : null);
  const [who, setWho] = useState<PersonHit | null>(null);
  const [due, setDue] = useState('');
  useEffect(() => {
    if (rules.data) setDue(plusDays(localToday(), rules.data.loan_days));
  }, [rules.data]);
  const { book, copy, loan } = scan;
  const lend = async () => {
    if (!who) return;
    if (await run(() => api.post('/lending/loans', { copy_id: copy.id, person_id: who.id, due_on: due || null }), t('Lent to {name}, due {date}.').replace('{name}', who.name).replace('{date}', fmtDate(due, lang)))) {
      setWho(null);
      onDone();
    }
  };
  const back = async () => {
    if (loan && await run(() => api.post(`/lending/loans/${loan.id}/return`, {}), t('Taken back.'))) onDone();
  };
  const renew = async () => {
    if (loan && await run(() => api.post(`/lending/loans/${loan.id}/renew`, {}), t('Renewed.'))) onChanged();
  };
  const overdue = loan && loan.due_on < localToday();
  const cover = coverUrl(book);
  return (
    <div className="card" style={{ background: 'var(--paper-2)' }}>
      <div className="book-head">
        {cover ? <img className="book-cover" src={cover} alt="" /> : <div className="book-cover-ph"><Icon name="book" /></div>}
        <div className="grow stack tight">
          <div><span className="code">{copy.number}</span> <span className="small muted">{t(KIND_LABEL[book.kind])}{book.shelf ? ` · ${t('Shelf')} ${book.shelf}` : ''}</span></div>
          <strong className="serif" style={{ fontSize: 18 }}>{book.title}</strong>
          {book.authors && <div className="small">{book.authors}</div>}
          {copy.status !== 'in' ? (
            <div className="callout warn small">{copy.status === 'lost' ? t('This copy is marked lost.') : t('This copy is withdrawn.')}</div>
          ) : loan ? (
            <div className="stack tight">
              <div>{t('On loan to')} <strong>{(loan.elsewhere ? t('another congregation') : loan.borrower) ?? t('(erased)')}</strong> · {t('due')} {fmtDate(loan.due_on, lang)}{' '}
                {overdue ? <span className="badge warn">{t('Overdue')}</span> : null}{loan.renewals ? <span className="small muted"> · {t('renewed {n}×').replace('{n}', String(loan.renewals))}</span> : null}</div>
              {canEdit && (
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn primary" onClick={back} disabled={busy}><Icon name="check" />{t('Take back')}</button>
                  <button className="btn" onClick={renew} disabled={busy}>{t('Renew')}</button>
                </div>
              )}
            </div>
          ) : canEdit ? (
            <div className="stack tight">
              <div><span className="badge ok">{t('Available')}</span></div>
              <div className="form-grid">
                <Field label={t('Borrower')}><PersonSearch endpoint="/lending/borrowers" value={who} onChange={setWho} autoFocus /></Field>
                <Field label={t('Due back')}><input type="date" value={due} min={localToday()} onChange={(e) => setDue(e.target.value)} /></Field>
              </div>
              <div><button className="btn primary" onClick={lend} disabled={busy || !who}><Icon name="book" />{t('Lend')}</button></div>
            </div>
          ) : (
            <div><span className="badge ok">{t('Available')}</span></div>
          )}
        </div>
      </div>
    </div>
  );
}

function OverdueShort() {
  const { t, lang } = useI18n();
  const { data } = useApi<Loan[]>('/lending/loans?status=overdue');
  if (!data?.length) return null;
  return (
    <section className="card stack tight">
      <h3 style={{ margin: 0 }}>{t('Overdue')} <span className="badge warn">{data.length}</span></h3>
      {data.slice(0, 8).map((l) => (
        <div key={l.id} className="small">
          <span className="code">{l.number}</span> {l.title} — {(l.elsewhere ? t('another congregation') : l.borrower) ?? t('(erased)')} · {t('due')} {fmtDate(l.due_on, lang)} ({t('{n} days').replace('{n}', String(l.overdue_days))})
        </div>
      ))}
      {data.length > 8 && <Link className="small" to="/lending?tab=loans">{t('All overdue')} →</Link>}
    </section>
  );
}

/** The page a copy's QR label opens. */
export function CopyPage() {
  const { number = '' } = useParams();
  const { t } = useI18n();
  const [n, setN] = useState(0);
  const { data, error } = useApi<Scan>(`/lending/scan?q=${encodeURIComponent(number)}&n=${n}`);
  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <PageHead eyebrow={t('Lending library')} title={number} />
      {error ? <ErrorBox error={error} /> : !data ? <Loading /> : <ScanCard scan={data} onDone={() => setN((x) => x + 1)} onChanged={() => setN((x) => x + 1)} />}
      <p className="small"><Link to="/lending">{t('Lending library')} →</Link></p>
    </div>
  );
}

// ---------------------------------------------------------------- on loan

function LoansTab() {
  const { t, lang } = useI18n();
  const { can } = useSession();
  const canEdit = can('lending', 'edit');
  const { run, busy } = useAction();
  const [status, setStatus] = useState<'open' | 'overdue' | 'pending' | 'returned'>('open');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const { data, error, reload } = useApi<Loan[]>(`/lending/loans?status=${status}&q=${encodeURIComponent(dq)}`);
  const act = async (l: Loan, what: 'return' | 'renew') => {
    if (await run(() => api.post(`/lending/loans/${l.id}/${what}`, {}), what === 'return' ? t('Taken back.') : t('Renewed.'))) reload();
  };
  return (
    <div className="stack">
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <Seg value={status} onChange={setStatus} options={[{ value: 'open', label: t('On loan') }, { value: 'overdue', label: t('Overdue') }, { value: 'pending', label: t('To check in') }, { value: 'returned', label: t('Returned') }]} />
        <div className="grow" style={{ maxWidth: 320 }}><SearchBox value={q} onChange={setQ} placeholder={t('Title, number or borrower')} /></div>
      </div>
      {canEdit && status !== 'returned' && <RemindersCard />}
      {error && <ErrorBox error={error} />}
      {!data ? <Loading /> : !data.length ? <Empty title={status === 'overdue' ? t('Nothing is overdue.') : status === 'open' ? t('Nothing is on loan.') : status === 'pending' ? t('Nothing to check in.') : t('No returned loans yet.')} /> : (
        <div className="card flush table-wrap">
          <table className="t">
            <thead><tr><th>{status === 'returned' ? t('Returned') : t('Due')}</th><th>{t('Copy number')}</th><th>{t('Title')}</th><th>{t('Borrower')}</th><th>{t('Lent')}</th><th /></tr></thead>
            <tbody>
              {data.map((l) => (
                <tr key={l.id} className={l.overdue_days ? 'loan-overdue' : ''}>
                  <td className="nowrap">{fmtDate(l.returned_on ?? l.due_on, lang)}{l.overdue_days > 0 && <div className="small" style={{ color: 'var(--warn)' }}>{t('{n} days overdue').replace('{n}', String(l.overdue_days))}</div>}</td>
                  <td className="nowrap"><span className="code">{l.number}</span></td>
                  <td>{l.title}{l.return_pending_on && !l.returned_on && <div><span className="badge lapis">{t('Returned by the borrower: check it in')}</span></div>}{l.via === 'self' && <div className="small muted">{t('Borrowed on a phone')}</div>}</td>
                  <td>{(l.elsewhere ? t('another congregation') : l.borrower) ?? <span className="muted">{t('(erased)')}</span>}{!l.has_email && !l.returned_on && l.borrower && <div className="small muted">{t('no e-mail address')}</div>}</td>
                  <td className="nowrap small muted">{fmtDate(l.lent_on, lang)}{l.renewals ? ` · ${t('renewed {n}×').replace('{n}', String(l.renewals))}` : ''}</td>
                  <td className="right nowrap">
                    {canEdit && !l.returned_on && <>
                      <button className="btn sm" disabled={busy} onClick={() => act(l, 'return')}>{l.return_pending_on ? t('Check in') : t('Take back')}</button>{' '}
                      {!l.return_pending_on && <button className="btn sm ghost" disabled={busy} onClick={() => act(l, 'renew')}>{t('Renew')}</button>}
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RemindersCard() {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const { data, reload } = useApi<{ due_soon: number; overdue: number; people: number }>('/lending/reminders');
  const rules = useApi<Rules>('/lending/settings');
  if (!data || !rules.data) return null;
  const send = async () => {
    const r = await run(() => api.post<{ sent: number; failed: number }>('/lending/reminders/send', {}));
    if (r) {
      run(async () => r, t('{n} reminder(s) sent.').replace('{n}', String(r.sent)) + (r.failed ? ` ${t('{n} failed.').replace('{n}', String(r.failed))}` : ''));
      reload();
    }
  };
  if (!data.people) return <p className="small muted" style={{ margin: 0 }}>{rules.data.send_reminders ? t('Reminders go out by e-mail each day; none are due today.') : t('No reminders are due today.')}</p>;
  return (
    <div className="callout row">
      <span className="grow small">
        {t('Reminders due today: {soon} due soon, {overdue} overdue ({people} borrowers with an e-mail address).').replace('{soon}', String(data.due_soon)).replace('{overdue}', String(data.overdue)).replace('{people}', String(data.people))}
        {rules.data.send_reminders ? ` ${t('They go out automatically once a day.')}` : ''}
      </span>
      <button className="btn sm" onClick={send} disabled={busy}><Icon name="mail" />{t('Send now')}</button>
    </div>
  );
}

// ---------------------------------------------------------------- the catalogue

function CatalogueTab() {
  const { t } = useI18n();
  const { can } = useSession();
  const canEdit = can('lending', 'edit');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [kind, setKind] = useState('');
  const [category, setCategory] = useState('');
  const [available, setAvailable] = useState(false);
  const cats = useApi<string[]>('/lending/categories');
  const { data, error, reload } = useApi<BookRow[]>(`/lending/books?q=${encodeURIComponent(dq)}&kind=${kind}&category=${encodeURIComponent(category)}${available ? '&available=1' : ''}`);
  const [open, setOpen] = useState<number | 'new' | null>(null);
  return (
    <div className="stack">
      <div className="row res-toolbar" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="grow" style={{ maxWidth: 360 }}><SearchBox value={q} onChange={setQ} placeholder={t('Title, author, ISBN or copy number')} /></div>
        <select className="mini" value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t('Kind')}>
          <option value="">{t('All kinds')}</option>
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{t(KIND_LABEL[k])}</option>)}
        </select>
        {!!cats.data?.length && (
          <select className="mini" value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t('Category')}>
            <option value="">{t('All categories')}</option>
            {cats.data.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <label className="check small"><input type="checkbox" checked={available} onChange={(e) => setAvailable(e.target.checked)} />{t('Available now')}</label>
        <div className="grow" />
        <CsvTools entity="books" label={t('Lending library')} onImported={() => { reload(); cats.reload(); }} />
        {canEdit && <button className="btn primary" onClick={() => setOpen('new')}><Icon name="plus" />{t('New book')}</button>}
      </div>
      {error && <ErrorBox error={error} />}
      {!data ? <Loading /> : !data.length ? (
        <Empty title={dq || kind || category || available ? t('Nothing matches.') : t('The catalogue is empty.')}>
          {canEdit && !dq && <p className="small muted">{t('Add books one by one (an ISBN fills in the rest), or bring in a whole list with Import CSV.')}</p>}
        </Empty>
      ) : (
        <div className="res-cards">
          {data.map((b) => (
            <button key={b.id} className="card res-card" onClick={() => setOpen(b.id)}>
              {coverUrl(b) ? <img className="book-cover" style={{ width: 48 }} src={coverUrl(b)!} alt="" /> : <div className="book-cover-ph" style={{ width: 48, height: 66 }}><Icon name="book" /></div>}
              <div className="grow">
                <div className="title">{b.title}</div>
                {b.authors && <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.authors}</div>}
                <div className="small" style={{ marginTop: 4 }}>
                  {b.copies === 0 ? <span className="muted">{t('No copies')}</span>
                    : b.available > 0 ? <span className="badge ok">{t('{n} of {m} in').replace('{n}', String(b.available)).replace('{m}', String(b.copies))}</span>
                      : <span className="badge warn">{t('All out')}</span>}
                  {b.shelf && <span className="muted"> · {b.shelf}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      {open !== null && <BookDialog id={open === 'new' ? null : open} categories={cats.data ?? []} onClose={() => setOpen(null)} onChanged={() => { reload(); cats.reload(); }} />}
    </div>
  );
}

interface Lookup { isbn: string; title: string; subtitle: string | null; authors: string | null; publisher: string | null; year: number | null; language: string | null; description: string | null; cover_url: string | null; source: string }

function BookDialog({ id, categories, onClose, onChanged }: { id: number | null; categories: string[]; onClose: () => void; onChanged: () => void }) {
  const { t, lang } = useI18n();
  const { can, settings } = useSession();
  const canEdit = can('lending', 'edit');
  const { run, busy } = useAction();
  const full = useApi<BookFull>(id ? `/lending/books/${id}` : null);
  const [b, setB] = useState<Partial<Book>>({ kind: 'book', title: '' });
  const [copies, setCopies] = useState(1);
  const [cover, setCover] = useState<string | null>(null);
  const [found, setFound] = useState<string | null>(null);
  useEffect(() => {
    if (full.data) setB(full.data);
  }, [full.data]);
  const set = (p: Partial<Book>) => setB((o) => ({ ...o, ...p }));
  const lookup = async () => {
    const r = await run(() => api.get<{ found: Lookup | null }>(`/lending/isbn/${encodeURIComponent((b.isbn ?? '').trim())}`));
    if (!r) return;
    if (!r.found) return setFound(t('No details found for this ISBN: type them in.'));
    const f = r.found;
    set({ isbn: f.isbn, title: f.title, subtitle: f.subtitle, authors: f.authors, publisher: f.publisher, year: f.year, language: f.language ?? b.language, description: f.description });
    setCover(f.cover_url);
    setFound(t('Filled in from {source}. Check the details, then Save.').replace('{source}', f.source));
  };
  const save = async () => {
    const fields = { title: b.title ?? '', subtitle: b.subtitle ?? null, authors: b.authors ?? null, isbn: b.isbn ?? null, publisher: b.publisher ?? null, year: b.year ?? null, kind: b.kind, category: b.category ?? null, language: b.language ?? null, shelf: b.shelf ?? null, description: b.description ?? null, notes: b.notes ?? null };
    const r = id
      ? await run(() => api.patch(`/lending/books/${id}`, { ...fields, cover_url: cover }), t('Saved.'))
      : await run(() => api.post('/lending/books', { ...fields, copies, cover_url: cover }), t('Saved.'));
    if (r) {
      onChanged();
      onClose();
    }
  };
  const remove = async () => {
    if (!id || !confirmAction(t('Delete “{title}” and its copies from the catalogue?').replace('{title}', b.title ?? ''))) return;
    if (await run(() => api.del(`/lending/books/${id}`), t('Deleted.'))) {
      onChanged();
      onClose();
    }
  };
  const addCopies = async (n: number) => {
    if (id && await run(() => api.post(`/lending/books/${id}/copies`, { count: n }), t('Saved.'))) {
      full.reload();
      onChanged();
    }
  };
  const copyPatch = async (c: Copy, p: Partial<Copy>) => {
    if (await run(() => api.patch(`/lending/copies/${c.id}`, p), t('Saved.'))) {
      full.reload();
      onChanged();
    }
  };
  const copyDelete = async (c: Copy) => {
    if (!confirmAction(t('Delete copy {n}?').replace('{n}', c.number))) return;
    if (await run(() => api.del(`/lending/copies/${c.id}`), t('Deleted.'))) {
      full.reload();
      onChanged();
    }
  };
  if (id && !full.data) return <Modal title={t('Book')} onClose={onClose}>{full.error ? <ErrorBox error={full.error} /> : <Loading />}</Modal>;
  const shownCover = cover ? `/api/lending/cover-preview?url=${encodeURIComponent(cover)}` : full.data ? coverUrl(full.data) : null;
  const ro = !canEdit;
  return (
    <Modal title={id ? b.title || t('Book') : t('New book')} onClose={onClose} size="lg" footer={
      <>
        {id && canEdit && <button className="btn ghost danger" onClick={remove} disabled={busy}><Icon name="trash" />{t('Delete')}</button>}
        <div className="grow" />
        <button className="btn" onClick={onClose}>{ro ? t('Close') : t('Cancel')}</button>
        {canEdit && <button className="btn primary" onClick={save} disabled={busy || !b.title?.trim()}>{t('Save')}</button>}
      </>
    }>
      <div className="stack">
        <div className="book-head">
          {shownCover ? <img className="book-cover lg" src={shownCover} alt="" /> : <div className="book-cover-ph" style={{ width: 110, height: 150 }}><Icon name="book" /></div>}
          <div className="grow stack tight">
            <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
              <Field label={<>{t('ISBN')} <InfoTip text={t('Type or scan the barcode number on the back of the book, then Look up: Canon fills in the title, author, publisher and cover from Open Library or Google Books (only the ISBN is sent). Without internet, type the details.')} /></>}>
                <input value={b.isbn ?? ''} disabled={ro} inputMode="numeric" placeholder="978…" onChange={(e) => set({ isbn: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && b.isbn && lookup()} style={{ width: 190 }} />
              </Field>
              {canEdit && <button className="btn" onClick={lookup} disabled={busy || !(b.isbn ?? '').trim()}><Icon name="search" />{t('Look up')}</button>}
              {canEdit && cover && <button className="btn ghost sm" onClick={() => setCover(null)}>{full.data?.has_cover ? t('Keep the old cover') : t('Without this cover')}</button>}
            </div>
            {found && <div className="small muted">{found}</div>}
            <Field label={t('Title')}><input value={b.title ?? ''} disabled={ro} onChange={(e) => set({ title: e.target.value })} /></Field>
          </div>
        </div>
        <div className="form-grid">
          <Field label={t('Subtitle')}><input value={b.subtitle ?? ''} disabled={ro} onChange={(e) => set({ subtitle: e.target.value })} /></Field>
          <Field label={t('Author(s)')}><input value={b.authors ?? ''} disabled={ro} onChange={(e) => set({ authors: e.target.value })} /></Field>
          <Field label={t('Publisher')}><input value={b.publisher ?? ''} disabled={ro} onChange={(e) => set({ publisher: e.target.value })} /></Field>
          <Field label={t('Year')}><input type="number" value={b.year ?? ''} disabled={ro} onChange={(e) => set({ year: e.target.value ? Number(e.target.value) : null })} style={{ width: 110 }} /></Field>
          <Field label={t('Kind')}>
            <select value={b.kind ?? 'book'} disabled={ro} onChange={(e) => set({ kind: e.target.value as Kind })}>
              {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{t(KIND_LABEL[k])}</option>)}
            </select>
          </Field>
          <Field label={t('Category')}>
            <input list="lending-cats" value={b.category ?? ''} disabled={ro} placeholder={t('e.g. Doctrine, Children, Missions')} onChange={(e) => set({ category: e.target.value })} />
            <datalist id="lending-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label={t('Language')}>
            <select value={b.language ?? ''} disabled={ro} onChange={(e) => set({ language: e.target.value || null })}>
              <option value="">—</option>
              {[...new Set([...(settings?.languages ?? []), ...(b.language ? [b.language] : [])])].map((l) => <option key={l} value={l}>{langInfo(l).native}</option>)}
            </select>
          </Field>
          <Field label={t('Shelf')}><input value={b.shelf ?? ''} disabled={ro} placeholder="A3" onChange={(e) => set({ shelf: e.target.value })} style={{ width: 120 }} /></Field>
          {!id && <Field label={t('Copies')}><input type="number" min={0} max={200} value={copies} onChange={(e) => setCopies(Math.max(0, Number(e.target.value) || 0))} style={{ width: 90 }} /></Field>}
        </div>
        <Field label={t('Description')}><textarea rows={3} value={b.description ?? ''} disabled={ro} onChange={(e) => set({ description: e.target.value })} /></Field>
        <Field label={t('Notes')}><textarea rows={2} value={b.notes ?? ''} disabled={ro} onChange={(e) => set({ notes: e.target.value })} /></Field>

        {full.data && (
          <section className="stack tight">
            <div className="row" style={{ alignItems: 'center', gap: 8 }}>
              <h3 style={{ margin: 0 }}>{t('Copies')}</h3>
              <div className="grow" />
              {!!full.data.copies.length && <Link className="btn sm" to={`/lending/labels?copies=${full.data.copies.map((c) => c.id).join(',')}`}><Icon name="qr" />{t('Print labels')}</Link>}
              {canEdit && <button className="btn sm" onClick={() => addCopies(1)} disabled={busy}><Icon name="plus" />{t('Add a copy')}</button>}
            </div>
            <div className="copy-list">
              {full.data.copies.map((c) => (
                <div key={c.id} className="copy-row">
                  <span className="code">{c.number}</span>
                  {c.loan ? <span className="small">{t('On loan to')} {(c.loan.elsewhere ? t('another congregation') : c.loan.borrower) ?? t('(erased)')} · {t('due')} {fmtDate(c.loan.due_on, lang)}</span>
                    : c.status === 'in' ? <span className="badge ok">{t('Available')}</span> : null}
                  <div className="grow" />
                  {canEdit && (
                    <select className="mini" value={c.status} onChange={(e) => copyPatch(c, { status: e.target.value as Copy['status'] })} aria-label={t('Status')} disabled={busy || !!c.loan}>
                      <option value="in">{t('In the library')}</option>
                      <option value="lost">{t('Lost')}</option>
                      <option value="withdrawn">{t('Withdrawn')}</option>
                    </select>
                  )}
                  <Link className="btn sm ghost" to={`/lending/labels?copies=${c.id}`} title={t('Print label')}><Icon name="qr" /></Link>
                  {canEdit && !c.loan && <button className="btn sm ghost icon" onClick={() => copyDelete(c)} aria-label={t('Delete')} disabled={busy}><Icon name="trash" /></button>}
                </div>
              ))}
              {!full.data.copies.length && <p className="small muted" style={{ margin: 0 }}>{t('No copies yet.')}</p>}
            </div>
          </section>
        )}
        {!!full.data?.history.length && (
          <section className="stack tight">
            <h3 style={{ margin: 0 }}>{t('Loans')}</h3>
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>{t('Copy number')}</th><th>{t('Borrower')}</th><th>{t('Lent')}</th><th>{t('Due')}</th><th>{t('Returned')}</th></tr></thead>
                <tbody>
                  {full.data.history.map((h) => (
                    <tr key={h.id}><td><span className="code">{h.number}</span></td><td>{(h.elsewhere ? t('another congregation') : h.borrower) ?? <span className="muted">{t('(erased)')}</span>}</td><td className="nowrap">{fmtDate(h.lent_on, lang)}</td><td className="nowrap">{fmtDate(h.due_on, lang)}</td><td className="nowrap">{h.returned_on ? fmtDate(h.returned_on, lang) : <span className="badge lapis">{t('On loan')}</span>}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- loan rules

function RulesTab() {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const { data, error, setData } = useApi<Rules>('/lending/settings');
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const set = (p: Partial<Rules>) => setData({ ...data, ...p });
  const save = () => run(async () => setData(await api.put<Rules>('/lending/settings', data)), t('Saved.'));
  return (
    <div className="stack">
    <section className="card stack" style={{ maxWidth: 640 }}>
      <div className="form-grid">
        <Field label={t('Loan period (days)')}><input type="number" min={1} max={365} value={data.loan_days} onChange={(e) => set({ loan_days: Number(e.target.value) || 1 })} style={{ width: 100 }} /></Field>
        <Field label={t('Renewals allowed')}><input type="number" min={0} max={20} value={data.max_renewals} onChange={(e) => set({ max_renewals: Number(e.target.value) || 0 })} style={{ width: 100 }} /></Field>
        <Field label={t('Remind this many days before')} hint={t('0 = no “due soon” reminder')}><input type="number" min={0} max={30} value={data.remind_days_before} onChange={(e) => set({ remind_days_before: Number(e.target.value) || 0 })} style={{ width: 100 }} /></Field>
      </div>
      <label className="check" style={{ alignItems: 'flex-start' }}>
        <input type="checkbox" checked={data.send_reminders} onChange={(e) => set({ send_reminders: e.target.checked })} />
        <span><strong>{t('Send reminders by e-mail each day')}</strong><br /><span className="small muted">{t('A “due soon” e-mail once, and an “overdue” e-mail once a week, to borrowers with an e-mail address, in their language. Uses the church’s e-mail account (Settings → E-mail).')}</span></span>
      </label>
      <div className="row end"><button className="btn primary" onClick={save} disabled={busy}>{t('Save')}</button></div>
    </section>
    <SelfServiceCard rules={data} onChanged={setData} />
    </div>
  );
}

interface Gate { key: 'email' | 'public_address' | 'library'; ok: boolean; problem?: string; detail?: string }
const GATE_TEXT: Record<Gate['key'], { name: string; fix: Record<string, string>; link: string }> = {
  email: {
    name: 'E-mail works',
    fix: { not_tested: 'Send a test e-mail in Settings → E-mail (needed again after the e-mail settings change).', failing: 'E-mail stopped working. Check Settings → E-mail and send a test e-mail.' },
    link: '/settings?tab=email',
  },
  public_address: {
    name: 'A public https address that reaches this Canon',
    fix: { none: 'Set the public address in Settings → AI / MCP.', http: 'The public address must start with https:// (codes would otherwise cross the internet unencrypted).', unreachable: 'The public address doesn’t reach this Canon. Check the address, the tunnel or the reverse proxy.', unchecked: 'Not checked yet.' },
    link: '/settings?tab=mcp',
  },
  library: {
    name: 'The lending library is on and its rules are saved',
    fix: { off: 'Switch the Lending library on in Settings → Modules.', rules: 'Save the loan rules above.' },
    link: '/lending?tab=rules',
  },
};

function SelfServiceCard({ rules, onChanged }: { rules: Rules; onChanged: (r: Rules) => void }) {
  const { t } = useI18n();
  const { isAdmin } = useSession();
  const { run, busy } = useAction();
  const [check, setCheck] = useState(0);
  const { data, reload } = useApi<{ wanted: boolean; on: boolean; gates: Gate[] }>(`/lending/self-service${check ? '?check=1' : ''}`);
  useEffect(() => {
    if (check) reload();
  }, [check]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <section className="card"><Loading /></section>;
  // switching it on needs every gate (the rules are saved by the same click)
  const ready = data.gates.every((g) => g.ok || (g.key === 'library' && g.problem === 'rules'));
  const set = (on: boolean) => run(async () => {
    onChanged(await api.put<Rules>('/lending/settings', { ...rules, self_service: on }));
    reload();
  }, on ? t('Self-service is on.') : t('Self-service is off.'));
  return (
    <section className="card stack" style={{ maxWidth: 640 }}>
      <div className="row" style={{ alignItems: 'center' }}>
        <h3 style={{ margin: 0 }} className="grow">{t('Self-service')} <InfoTip text={t('Members borrow, renew and say they’ve returned books on their own phones, without a Canon account: they scan a book’s QR label and sign in with a code e-mailed to the address on the member register. Reminder e-mails get a Renew link. A returned book waits for the librarian to check it in.')} /></h3>
        {data.wanted ? (data.on ? <span className="badge ok">{t('On')}</span> : <span className="badge warn">{t('Paused')}</span>) : <span className="badge">{t('Off')}</span>}
      </div>
      <div className="sec-list">
        {data.gates.map((g) => (
          <div key={g.key} className={`sec-item ${g.ok ? 'ok' : 'warn'}`}>
            <span className={`badge ${g.ok ? 'ok' : 'warn'} sec-mark`} aria-hidden="true">{g.ok ? '✓' : '!'}</span>
            <div className="grow">
              <strong>{t(GATE_TEXT[g.key].name)}</strong>
              {g.ok && g.detail && <div className="small muted">{g.detail}</div>}
              {!g.ok && <div className="small">{t(GATE_TEXT[g.key].fix[g.problem ?? ''] ?? '')}{g.detail && g.problem !== 'http' ? <span className="muted"> ({g.detail})</span> : null}</div>}
              {!g.ok && (isAdmin || g.key === 'library') && <a className="small" href={GATE_TEXT[g.key].link}>{t('Open')} →</a>}
            </div>
          </div>
        ))}
      </div>
      {data.wanted && !data.on && <p className="small callout warn" style={{ margin: 0 }}>{t('Self-service is switched on but paused until every check passes. Phones are asked to see the librarian meanwhile; it resumes by itself.')}</p>}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm ghost" onClick={() => setCheck((n) => n + 1)} disabled={busy}><Icon name="refresh" />{t('Check again')}</button>
        <div className="grow" />
        {data.wanted
          ? <button className="btn" onClick={() => set(false)} disabled={busy}>{t('Switch self-service off')}</button>
          : <button className="btn primary" onClick={() => set(true)} disabled={busy || !ready} title={ready ? undefined : t('Every check must pass first')}>{t('Switch self-service on')}</button>}
      </div>
      {data.on && <p className="small muted" style={{ margin: 0 }}>{t('Print the labels again after switching it on: new labels carry the public address, so they work away from church Wi-Fi.')}</p>}
    </section>
  );
}
