// Book-keeping: bank statements. Import the bank's CSV (Canon finds its layout and remembers it for the account),
// match each statement line to what the books have, enter what the books don't (bank charges, interest, a direct
// debit), and see the reconciliation: the books, less what the bank hasn't shown yet, should equal the statement.
import { useState } from 'react';
import { api, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Empty, ErrorBox, Field, Loading, Modal, confirmAction, fmtDate, useAction, useSession } from '../../components/ui.tsx';
import { METHOD_LABEL, type OfferingMethod } from '../../../shared/records.ts';
import type { L10n } from '../../../shared/types.ts';
import { Icon } from '../../components/icons.tsx';
import type { BankCsvLayout } from '../../../shared/bookkeeping.ts';
import { AccountSelect, FundSelect, MoneyInput, TagSelect, fmtMoney, fmtSigned, useBooks } from './common.tsx';

interface StatementRow {
  id: number; account_id: number; account_code: string; starts_on: string; ends_on: string; opening_balance: number | null; closing_balance: number | null;
  file_name: string | null; imported_at: string; done_at: string | null; lines: number; open: number;
}
interface BookLine { id: number; journal_id: number; number: string; date: string; memo: string | null; jmemo: string | null; amount: number; kind: string }
interface SLine {
  id: number; date: string; description: string | null; reference: string | null; amount: number; status: 'open' | 'matched' | 'ignored';
  line_id: number | null; journal_id: number | null; matched: BookLine | null; suggestions: BookLine[];
  /** a draft made for this line (on this screen or by an AI assistant): posting it matches the line */
  draft_id: number | null;
  /** matched in a group: its book entries, and how many statement lines share it */
  group: { id: number; book: BookLine[]; lines: number } | null;
  /** groups this line could be matched in (several lines against one entry, or one line against several) */
  group_suggestions: { statement_line_ids: number[]; book: BookLine[]; total: number }[];
}
interface Statement {
  statement: StatementRow;
  lines: SLine[];
  /** open book entries near the statement's dates, to match by hand in a group */
  book_lines: BookLine[];
  reconciliation: { ends_on: string; book_balance: number; uncleared: BookLine[]; uncleared_total: number; expected_bank_balance: number; statement_balance: number | null; difference: number | null };
}

export function BankTab() {
  const { t, lang } = useI18n();
  const b = useBooks();
  const banks = b.accounts.filter((a) => a.kind === 'bank');
  const list = useApi<StatementRow[]>('/bookkeeping/bank/statements');
  const [importing, setImporting] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  if (open) return <StatementView id={open} onBack={() => { setOpen(null); list.reload(); }} />;
  return (
    <div className="stack">
      <div className="row between">
        <p className="small muted grow">{t('Export a statement from the bank’s website as CSV and import it here. Each line is then matched to the books, or entered.')}</p>
        {b.canEdit && <button className="btn primary" disabled={!banks.length} onClick={() => setImporting(true)}><Icon name="upload" />{t('Import a statement')}</button>}
      </div>
      {!banks.length && <div className="callout warn small">{t('No bank account in the chart yet: an account whose “What it is for” is Bank account.')}</div>}
      {list.error && <ErrorBox error={list.error} />}
      {!list.data ? <Loading /> : !list.data.length ? <Empty title={t('No statements imported yet.')} /> : (
        <div className="card flush table-wrap">
          <table className="t">
            <thead><tr><th>{t('Account')}</th><th>{t('Period')}</th><th className="bk-num">{t('Lines')}</th><th>{t('Status')}</th><th className="bk-num">{t('Closing balance')}</th></tr></thead>
            <tbody>
              {list.data.map((s) => (
                <tr key={s.id} className="click" onClick={() => setOpen(s.id)}>
                  <td><span className="code">{s.account_code}</span> <span className="small muted">{s.file_name}</span></td>
                  <td className="nowrap">{fmtDate(s.starts_on, lang)} – {fmtDate(s.ends_on, lang)}</td>
                  <td className="bk-num">{s.lines}</td>
                  <td>{s.done_at ? <span className="badge ok">{t('Reconciled')}</span> : s.open ? <span className="badge warn">{t('{n} to match').replace('{n}', String(s.open))}</span> : <span className="badge lapis">{t('All matched')}</span>}</td>
                  <td className="bk-num">{fmtSigned(s.closing_balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {importing && <ImportDialog onClose={() => setImporting(false)} onDone={(id) => { setImporting(false); list.reload(); setOpen(id); }} />}
    </div>
  );
}

const toBase64 = (f: File) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, ''));
  r.onerror = () => rej(r.error);
  r.readAsDataURL(f);
});

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: (statementId: number | null) => void }) {
  const { t } = useI18n();
  const b = useBooks();
  const banks = b.accounts.filter((a) => a.kind === 'bank' && a.active);
  const { run, busy } = useAction();
  const [account, setAccount] = useState<number | null>(banks[0]?.id ?? null);
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [preview, setPreview] = useState<{ rows: string[][]; layout: BankCsvLayout; saved: boolean; formats: string[] } | null>(null);
  const [layout, setLayout] = useState<BankCsvLayout | null>(null);
  const [split, setSplit] = useState(false);
  const [opening, setOpening] = useState(0);
  const [closing, setClosing] = useState(0);
  const [haveBal, setHaveBal] = useState(false);
  const choose = async (f: File | undefined) => {
    if (!f || !account) return;
    const data = await toBase64(f);
    setFile({ name: f.name, data });
    const p = await run(() => api.post<{ rows: string[][]; layout: BankCsvLayout; saved: boolean; formats: string[] }>('/bookkeeping/bank/preview', { account_id: account, file: data }));
    if (p) {
      setPreview(p);
      setLayout(p.layout);
      setSplit(!p.layout.amount);
    }
  };
  const headers = preview && layout ? (preview.rows[layout.header_row] ?? []).filter((h) => h.trim()) : [];
  const setL = (p: Partial<BankCsvLayout>) => setLayout((l) => (l ? { ...l, ...p } : l));
  const col = (k: 'date' | 'description' | 'amount' | 'debit' | 'credit' | 'reference', label: string, optional = false) => (
    <Field label={label}>
      <select value={layout?.[k] ?? ''} onChange={(e) => setL({ [k]: e.target.value || undefined })}>
        <option value="">{optional ? t('(none)') : t('Choose a column…')}</option>
        {headers.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    </Field>
  );
  const go = async () => {
    if (!file || !layout || !account) return;
    const l: BankCsvLayout = split ? { ...layout, amount: undefined } : { ...layout, debit: undefined, credit: undefined };
    const r = await run(() => api.post<{ statement_id: number | null; lines: number; already: number; skipped: string[] }>('/bookkeeping/bank/statements', {
      account_id: account, file: file.data, file_name: file.name, layout: l, opening_balance: haveBal ? opening : null, closing_balance: haveBal ? closing : null,
    }));
    if (r) {
      window.alert(t('{n} new line(s) imported.').replace('{n}', String(r.lines)) + (r.already ? ' ' + t('{n} were already imported before.').replace('{n}', String(r.already)) : '') + (r.skipped.length ? ' ' + t('{n} row(s) without a date or amount were skipped.').replace('{n}', String(r.skipped.length)) : ''));
      b.reload();
      onDone(r.statement_id);
    }
  };
  return (
    <Modal title={t('Import a bank statement')} onClose={onClose} size="lg" footer={
      <>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" disabled={busy || !layout || !layout.date || !(split ? layout.debit && layout.credit : layout.amount)} onClick={go}>{t('Import')}</button>
      </>
    }>
      <div className="stack">
        <div className="grid cols-2">
          <Field label={t('Bank account')}><AccountSelect value={account} kinds={['bank']} onChange={(v) => { setAccount(v); setPreview(null); setFile(null); }} /></Field>
          <Field label={t('Statement file (CSV or Excel)')}><input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => choose(e.target.files?.[0])} /></Field>
        </div>
        {preview && layout && (
          <>
            {preview.saved ? <div className="callout small">{t('Using the layout remembered from this account’s last import. Check it below.')}</div>
              : <div className="callout lapis small">{t('Canon guessed the layout: check each column below. It is remembered for next time.')}</div>}
            <div className="grid cols-3">
              <Field label={t('Column names are on row')}>
                <select value={layout.header_row} onChange={(e) => setL({ header_row: Number(e.target.value) })}>
                  {preview.rows.slice(0, 30).map((r, i) => <option key={i} value={i}>{i + 1}: {r.filter(Boolean).slice(0, 3).join(' · ').slice(0, 50)}</option>)}
                </select>
              </Field>
              {col('date', t('Date'))}
              <Field label={t('Dates are written')}>
                <select value={layout.date_format} onChange={(e) => setL({ date_format: e.target.value })}>
                  {preview.formats.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </Field>
              {col('description', t('Description'))}
              {col('reference', t('Reference'), true)}
              <Field label={t('Amounts')}>
                <select value={split ? 'split' : 'one'} onChange={(e) => setSplit(e.target.value === 'split')}>
                  <option value="one">{t('One column (money out negative)')}</option>
                  <option value="split">{t('Separate money-out and money-in columns')}</option>
                </select>
              </Field>
              {split ? <>{col('debit', t('Money out'))}{col('credit', t('Money in'))}</> : col('amount', t('Amount'))}
            </div>
            <div className="table-wrap bk-preview">
              <table className="t">
                <tbody>
                  {preview.rows.slice(layout.header_row, layout.header_row + 8).map((r, i) => (
                    <tr key={i} className={i === 0 ? 'bk-head-row' : ''}>{r.map((c, k) => <td key={k} className="small nowrap">{c}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label className="check"><input type="checkbox" checked={haveBal} onChange={(e) => setHaveBal(e.target.checked)} />{t('Enter the statement’s opening and closing balances (for the reconciliation)')}</label>
            {haveBal && (
              <div className="grid cols-3">
                <Field label={t('Opening balance')}><MoneyInput cents={opening} allowNegative onChange={setOpening} /></Field>
                <Field label={t('Closing balance')}><MoneyInput cents={closing} allowNegative onChange={setClosing} /></Field>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function StatementView({ id, onBack }: { id: number; onBack: () => void }) {
  const { t, lang } = useI18n();
  const b = useBooks();
  const { data, error, reload } = useApi<Statement>(`/bookkeeping/bank/statements/${id}`);
  const { run, busy } = useAction();
  const [entry, setEntry] = useState<SLine | null>(null);
  const [offering, setOffering] = useState<SLine | null>(null);
  const { can } = useSession();
  const mayOffer = can('contributions', 'edit');
  const [show, setShow] = useState<'open' | 'all'>('open');
  const [picked, setPicked] = useState<number[]>([]);
  const [grouping, setGrouping] = useState(false);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const s = data.statement;
  const r = data.reconciliation;
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    if (await run(async () => {
      await fn();
      return true;
    }, ok)) {
      setPicked([]);
      reload();
      b.reload();
    }
  };
  const lines = show === 'open' ? data.lines.filter((l) => l.status === 'open') : data.lines;
  const open = data.lines.filter((l) => l.status === 'open').length;
  return (
    <div className="stack">
      <div className="row">
        <button className="btn ghost" onClick={onBack}>← {t('Statements')}</button>
        <h3 className="grow">{b.accounts.find((a) => a.id === s.account_id)?.code} · {fmtDate(s.starts_on, lang)} – {fmtDate(s.ends_on, lang)}</h3>
        {b.canEdit && open > 0 && <button className="btn" disabled={busy} onClick={() => act(async () => {
          const m = await api.post<{ matched: number }>(`/bookkeeping/bank/statements/${id}/auto-match`);
          window.alert(t('{n} line(s) matched where there was exactly one entry for the same amount on the same day.').replace('{n}', String(m.matched)));
        })}><Icon name="wand" />{t('Match the obvious ones')}</button>}
        {b.canEdit && <button className="btn" disabled={busy} onClick={() => act(() => api.post(`/bookkeeping/bank/statements/${id}/done`, { done: !s.done_at }), t('Saved.'))}>{s.done_at ? t('Reopen') : <><Icon name="check" />{t('Mark reconciled')}</>}</button>}
        {b.canEdit && <button className="btn danger ghost" disabled={busy} onClick={async () => {
          if (!confirmAction(t('Remove this statement? Journals entered from it stay in the books.'))) return;
          if (await run(() => api.del(`/bookkeeping/bank/statements/${id}`), t('Deleted.'))) onBack();
        }}><Icon name="trash" /></button>}
      </div>

      <div className="card bk-recon">
        <div><div className="small muted">{t('Balance in the books')}</div><div className="bk-big">{fmtSigned(r.book_balance)}</div></div>
        <div><div className="small muted">{t('Less: not yet on a statement')}</div><div className="bk-big">{fmtSigned(r.uncleared_total)}</div></div>
        <div><div className="small muted">{t('So the bank should show')}</div><div className="bk-big">{fmtSigned(r.expected_bank_balance)}</div></div>
        <div><div className="small muted">{t('The statement shows')}</div><div className="bk-big">{r.statement_balance == null ? '—' : fmtSigned(r.statement_balance)}</div></div>
        <div>
          <div className="small muted">{t('Difference')}</div>
          <div className={`bk-big ${r.difference === 0 ? 'bk-ok' : r.difference ? 'bk-off' : ''}`}>{r.difference == null ? '—' : r.difference === 0 ? <><Icon name="check" /> 0.00</> : fmtSigned(r.difference)}</div>
        </div>
      </div>

      <div className="row between">
        <div className="small muted">{t('{n} of {total} line(s) still to match.').replace('{n}', String(open)).replace('{total}', String(data.lines.length))}</div>
        {b.canEdit && picked.length > 0 && <button className="btn" onClick={() => setGrouping(true)}><Icon name="link" />{t('Match the {n} ticked together…').replace('{n}', String(picked.length))}</button>}
        <select className="mini" value={show} onChange={(e) => setShow(e.target.value as 'open' | 'all')} aria-label={t('Show')}>
          <option value="open">{t('Still to match')}</option>
          <option value="all">{t('All lines')}</option>
        </select>
      </div>
      {!lines.length ? <Empty title={t('Every line is matched.')} /> : (
        <div className="card flush table-wrap">
          <table className="t">
            <thead><tr>{b.canEdit && <th style={{ width: 28 }} />}<th>{t('Date')}</th><th>{t('Description')}</th><th className="bk-num">{t('Money out')}</th><th className="bk-num">{t('Money in')}</th><th>{t('In the books')}</th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className={l.status === 'ignored' ? 'bk-ignored' : ''}>
                  {b.canEdit && <td>{l.status === 'open' && <input type="checkbox" aria-label={t('Tick to match together')} checked={picked.includes(l.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, l.id] : p.filter((x) => x !== l.id)))} />}</td>}
                  <td className="nowrap">{fmtDate(l.date, lang)}</td>
                  <td>{l.description}{l.reference && <div className="small muted">{l.reference}</div>}</td>
                  <td className="bk-num">{l.amount < 0 ? fmtMoney(-l.amount) : ''}</td>
                  <td className="bk-num">{l.amount > 0 ? fmtMoney(l.amount) : ''}</td>
                  <td>
                    {l.status === 'matched' && l.matched && (
                      <div className="row" style={{ gap: 6 }}>
                        <span className="badge ok"><Icon name="check" />{l.matched.number}</span>
                        <span className="small muted">{l.matched.memo ?? l.matched.jmemo}</span>
                        {b.canEdit && <button className="btn ghost small" disabled={busy} onClick={() => act(() => api.post(`/bookkeeping/bank/lines/${l.id}/unmatch`))}>{t('Unmatch')}</button>}
                      </div>
                    )}
                    {l.status === 'matched' && l.group && (
                      <div className="row" style={{ gap: 6 }}>
                        <span className="badge ok"><Icon name="link" />{l.group.book.map((x) => x.number).join(' + ')}</span>
                        <span className="small muted">{l.group.lines > 1 ? t('with {n} statement line(s)').replace('{n}', String(l.group.lines)) : t('one deposit, several entries')}</span>
                        {b.canEdit && <button className="btn ghost small" disabled={busy} onClick={() => confirmAction(t('Unmatch this group? Every line in it is unmatched.')) && act(() => api.post(`/bookkeeping/bank/lines/${l.id}/unmatch`))}>{t('Unmatch')}</button>}
                      </div>
                    )}
                    {l.status === 'ignored' && (
                      <div className="row" style={{ gap: 6 }}>
                        <span className="badge">{t('Ignored')}</span>
                        {b.canEdit && <button className="btn ghost small" disabled={busy} onClick={() => act(() => api.post(`/bookkeeping/bank/lines/${l.id}/ignore`, { ignored: false }))}>{t('Restore')}</button>}
                      </div>
                    )}
                    {l.status === 'open' && b.canEdit && (
                      <div className="row" style={{ gap: 6 }}>
                        {l.suggestions.map((x) => (
                          <button key={x.id} className="btn small" disabled={busy} title={x.memo ?? x.jmemo ?? ''} onClick={() => act(() => api.post(`/bookkeeping/bank/lines/${l.id}/match`, { line_id: x.id }))}>
                            <Icon name="link" />{x.number} · {fmtDate(x.date, lang, { day: 'numeric', month: 'short' })}
                          </button>
                        ))}
                        {l.group_suggestions.map((g) => (
                          <button key={`${g.statement_line_ids.join()}|${g.book.map((x) => x.id).join()}`} className="btn small" disabled={busy}
                            title={t('Together these add up to {amount}.').replace('{amount}', fmtMoney(Math.abs(g.total)))}
                            onClick={() => act(() => api.post('/bookkeeping/bank/match-group', { statement_line_ids: g.statement_line_ids, book_line_ids: g.book.map((x) => x.id) }))}>
                            <Icon name="link" />{g.book.map((x) => x.number).join(' + ')}{g.statement_line_ids.length > 1 ? ` · ${t('with {n} line(s)').replace('{n}', String(g.statement_line_ids.length))}` : ''}
                          </button>
                        ))}
                        {l.draft_id
                          ? <button className="btn small" onClick={() => b.go('journals', { open: String(l.draft_id) })}><Icon name="edit" />{t('Draft waiting')}</button>
                          : <button className="btn small" onClick={() => setEntry(l)}><Icon name="plus" />{t('Enter')}</button>}
                        {!l.draft_id && l.amount > 0 && mayOffer && <button className="btn small" onClick={() => setOffering(l)}><Icon name="gift" />{t('Offering…')}</button>}
                        <button className="btn ghost small" disabled={busy} onClick={() => act(() => api.post(`/bookkeeping/bank/lines/${l.id}/ignore`, { ignored: true }))}>{t('Ignore')}</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {r.uncleared.length > 0 && (
        <details className="card">
          <summary><strong>{t('In the books, not yet on a statement ({n})').replace('{n}', String(r.uncleared.length))}</strong></summary>
          <table className="t bk-mini" style={{ marginTop: 8 }}>
            <tbody>
              {r.uncleared.map((u) => (
                <tr key={u.id}><td className="nowrap">{fmtDate(u.date, lang)}</td><td><span className="code">{u.number}</span></td><td>{u.memo ?? u.jmemo}</td><td className="bk-num">{fmtSigned(u.amount)}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {offering && <OfferingDialog line={offering} onClose={() => setOffering(null)} onDone={() => { setOffering(null); reload(); b.reload(); }} />}
      {grouping && <GroupDialog lines={data.lines.filter((l) => picked.includes(l.id))} book={data.book_lines} onClose={() => setGrouping(false)} onMatch={(bookIds) => { setGrouping(false); void act(() => api.post('/bookkeeping/bank/match-group', { statement_line_ids: picked, book_line_ids: bookIds }), t('Matched.')); }} />}
      {entry && <EntryDialog line={entry} bankId={s.account_id} onClose={() => setEntry(null)} onDone={() => { setEntry(null); reload(); b.reload(); }} />}
    </div>
  );
}

/** A statement line the books don't have yet (a bank charge, interest, a direct debit): one entry against the bank. */
function EntryDialog({ line, bankId, onClose, onDone }: { line: SLine; bankId: number; onClose: () => void; onDone: () => void }) {
  const { t, lang } = useI18n();
  const b = useBooks();
  const { run, busy } = useAction();
  const general = b.funds.find((f) => f.restriction === 'unrestricted' && f.active)?.id ?? null;
  const [account, setAccount] = useState<number | null>(null);
  const [fund, setFund] = useState<number | null>(general);
  const [project, setProject] = useState<number | null>(null);
  const [ministry, setMinistry] = useState<number | null>(null);
  const [memo, setMemo] = useState(line.description ?? '');
  const save = async (post: boolean) => {
    if (!account || !fund) return;
    if (await run(() => api.post(`/bookkeeping/bank/lines/${line.id}/entry`, { account_id: account, fund_id: fund, project_id: project, ministry_id: ministry, memo, post }), post ? t('Posted.') : t('Saved.'))) onDone();
  };
  return (
    <Modal title={t('Enter a bank line')} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn" disabled={busy || !account || !fund} onClick={() => save(false)}>{t('Save draft')}</button>
        <button className="btn primary" disabled={busy || !account || !fund} onClick={() => save(true)}>{t('Post and match')}</button>
      </>
    }>
      <div className="stack">
        <div className="callout small">{fmtDate(line.date, lang)} · {line.description} · <strong>{line.amount < 0 ? t('Money out') : t('Money in')} {fmtMoney(Math.abs(line.amount))}</strong></div>
        <Field label={line.amount < 0 ? t('What it was for') : t('Where it came from')}>
          <AccountSelect value={account} onChange={setAccount} exclude={bankId} types={line.amount < 0 ? ['expense', 'asset', 'liability'] : ['income', 'asset', 'liability']} />
        </Field>
        <Field label={t('Fund‖books')}><FundSelect value={fund} onChange={setFund} /></Field>
        {(b.projects.length > 0 || b.ministries.length > 0) && (
          <div className="grid cols-2">
            {b.projects.length > 0 && <Field label={t('Project')}><TagSelect kind="projects" value={project} onChange={setProject} /></Field>}
            {b.ministries.length > 0 && <Field label={t('Ministry')}><TagSelect kind="ministries" value={ministry} onChange={setMinistry} /></Field>}
          </div>
        )}
        <Field label={t('Narration')}><input value={memo} onChange={(e) => setMemo(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

/**
 * A PayNow or transfer gift first seen on the statement: added to a service's offerings, so the service record and
 * the offering reports have it; the entry is drafted from the record and matched to this line when posted.
 */
function OfferingDialog({ line, onClose, onDone }: { line: SLine; onClose: () => void; onDone: () => void }) {
  const { t, lt, lang } = useI18n();
  const b = useBooks();
  const { run, busy } = useAction();
  const near = useApi<{ id: number; date: string; title: L10n; kind: string; verified: boolean }[]>(`/bookkeeping/bank/lines/${line.id}/services`);
  const [service, setService] = useState<number | null>(null);
  const [fund, setFund] = useState(b.overview.offering_funds[0] ?? '');
  const [method, setMethod] = useState<OfferingMethod>('paynow');
  const chosen = service ?? near.data?.[0]?.id ?? null;
  const save = async (post: boolean) => {
    if (!chosen || !fund) return;
    const r = await run(() => api.post<{ journal: { number: string | null } | null; matched: boolean }>(`/bookkeeping/bank/lines/${line.id}/offering`, { service_id: chosen, fund, method, post }));
    if (!r) return;
    window.alert(!r.journal
      ? t('Added to the service record. Its cash count isn’t verified yet: the entry is drafted when it is, and this line can be matched then.')
      : r.matched ? t('Added to the service record, posted as {n} and matched.').replace('{n}', r.journal.number ?? '')
        : post ? t('Added to the service record and posted as {n}.').replace('{n}', r.journal.number ?? '') : t('Added to the service record; its draft is waiting to be posted.'));
    onDone();
  };
  return (
    <Modal title={t('Add to a service’s offerings')} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn" disabled={busy || !chosen || !fund} onClick={() => save(false)}>{t('Add')}</button>
        <button className="btn primary" disabled={busy || !chosen || !fund} onClick={() => save(true)}>{t('Add, post and match')}</button>
      </>
    }>
      <div className="stack">
        <div className="callout small">{fmtDate(line.date, lang)} · {line.description} · <strong>{t('Money in')} {fmtMoney(line.amount)}</strong></div>
        <p className="small muted">{t('A gift by PayNow or transfer seen first on the bank statement: it is added to the service’s offerings, so the record and the offering reports have it too.')}</p>
        <Field label={t('Service')}>
          {near.error ? <ErrorBox error={near.error} /> : !near.data ? <Loading /> : !near.data.length ? <p className="small muted">{t('No service in the two weeks before this date.')}</p> : (
            <select value={chosen ?? ''} onChange={(e) => setService(Number(e.target.value) || null)}>
              {near.data.map((x) => <option key={x.id} value={x.id}>{fmtDate(x.date, lang)} · {lt(x.title)}{x.verified ? '' : ` (${t('not verified yet')})`}</option>)}
            </select>
          )}
        </Field>
        <div className="grid cols-2">
          <Field label={t('Offering fund')}>
            <select value={fund} onChange={(e) => setFund(e.target.value)}>
              {b.overview.offering_funds.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          <Field label={t('Method')}>
            <select value={method} onChange={(e) => setMethod(e.target.value as OfferingMethod)}>
              {(['paynow', 'transfer', 'card', 'cheque', 'other'] as OfferingMethod[]).map((m) => <option key={m} value={m}>{t(METHOD_LABEL[m])}</option>)}
            </select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/** Match the ticked statement lines with book entries whose total is the same (several gifts, one offering line; one deposit, several services). */
function GroupDialog({ lines, book, onClose, onMatch }: { lines: SLine[]; book: BookLine[]; onClose: () => void; onMatch: (bookIds: number[]) => void }) {
  const { t, lang } = useI18n();
  const [chosen, setChosen] = useState<number[]>([]);
  const bank = lines.reduce((n, l) => n + l.amount, 0);
  const books = book.filter((x) => chosen.includes(x.id)).reduce((n, x) => n + x.amount, 0);
  const diff = bank - books;
  return (
    <Modal title={t('Match together')} onClose={onClose} size="lg" footer={
      <>
        <span className={`grow small ${diff ? 'bk-off' : 'bk-ok'}`}>{diff ? t('Difference: {amount}').replace('{amount}', fmtSigned(diff)) : chosen.length ? t('The totals agree.') : ''}</span>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" disabled={!chosen.length || diff !== 0} onClick={() => onMatch(chosen)}>{t('Match')}</button>
      </>
    }>
      <div className="stack">
        <p className="small muted">{t('Tick the book entries these statement lines stand for. They match when the two totals are the same.')}</p>
        <div className="small"><strong>{t('Statement lines')}</strong>: {lines.map((l) => `${fmtDate(l.date, lang, { day: 'numeric', month: 'short' })} ${fmtSigned(l.amount)}`).join(' · ')} = <strong>{fmtSigned(bank)}</strong></div>
        {!book.length ? <p className="small muted">{t('No open book entries near these dates.')}</p> : (
          <table className="t bk-mini">
            <tbody>
              {book.map((x) => (
                <tr key={x.id} className="click" onClick={() => setChosen((c) => (c.includes(x.id) ? c.filter((y) => y !== x.id) : [...c, x.id]))}>
                  <td style={{ width: 28 }}><input type="checkbox" readOnly checked={chosen.includes(x.id)} aria-label={x.number} /></td>
                  <td className="nowrap">{fmtDate(x.date, lang)}</td>
                  <td><span className="code">{x.number}</span> <span className="small muted">{x.memo ?? x.jmemo}</span></td>
                  <td className="bk-num">{fmtSigned(x.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}
