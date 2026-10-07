// Book-keeping: journals — the list (drafts first), a journal's lines, drafting and posting, reversing a posted one.
// Posted journals never change; drafts (the treasurer's, offerings', the bank's, an AI assistant's) can be edited.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Empty, ErrorBox, Field, Loading, Modal, SearchBox, confirmAction, fmtDate, today, useAction, useDebounced } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import { useCongregations } from '../../components/Congregations.tsx';
import { ChangeList, type ChangeRow } from '../../components/LogTools.tsx';
import { JOURNAL_KIND_LABEL, totals, type BkJournal, type BkLine, type JournalKind } from '../../../shared/bookkeeping.ts';
import { AccountSelect, FundSelect, MoneyInput, TagSelect, fmtMoney, useBooks, useNames } from './common.tsx';

type Row = BkJournal & { total_debit: number; total_credit: number };

export function JournalsTab() {
  const { t, lang } = useI18n();
  const b = useBooks();
  const [sp, setSp] = useSearchParams();
  const status = sp.get('status') ?? '';
  const kind = sp.get('kind') ?? '';
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [account, setAccount] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const { data, error, reload } = useApi<Row[]>(`/bookkeeping/journals${qs({ status, kind, from, to, account_id: account, q: dq, limit: 300 })}`);
  const [picked, setPicked] = useState<number[]>([]);
  const [importing, setImporting] = useState(false);
  const { run, busy } = useAction();
  const openId = sp.get('open');
  const open = openId === 'new' ? 'new' : Number(openId) || null;
  const setParam = (k: string, v: string | null) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    setSp(n, { replace: true });
  };
  const changed = () => {
    reload();
    b.reload();
  };
  const drafts = (data ?? []).filter((j) => j.status === 'draft');
  const postPicked = async () => {
    if (!confirmAction(t('Post {n} draft(s)? Posted journals can’t be changed, only reversed.').replace('{n}', String(picked.length)))) return;
    const r = await run(() => api.post<{ posted: string[]; failed: { id: number; error: string }[] }>('/bookkeeping/journals/post', { ids: picked }));
    if (r) {
      window.alert(t('Posted: {n}.').replace('{n}', String(r.posted.length)) + (r.failed.length ? '\n' + t('Still drafts (open them in Journals to see why): {n}.').replace('{n}', String(r.failed.length)) : ''));
      setPicked([]);
      changed();
    }
  };
  return (
    <div className="stack">
      <div className="row bk-toolbar">
        <div className="grow" style={{ maxWidth: 300 }}><SearchBox value={q} onChange={setQ} placeholder={t('Narration or number')} /></div>
        <select className="mini" value={status} onChange={(e) => setParam('status', e.target.value)} aria-label={t('Status')}>
          <option value="">{t('Drafts and posted')}</option>
          <option value="draft">{t('Drafts')}</option>
          <option value="posted">{t('Posted')}</option>
        </select>
        <select className="mini" value={kind} onChange={(e) => setParam('kind', e.target.value)} aria-label={t('Kind')}>
          <option value="">{t('All kinds')}</option>
          {(Object.keys(JOURNAL_KIND_LABEL) as JournalKind[]).map((k) => <option key={k} value={k}>{t(JOURNAL_KIND_LABEL[k])}</option>)}
        </select>
        <div className="bk-acc-filter"><AccountSelect value={account} onChange={setAccount} empty={t('Any account')} /></div>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t('From')} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t('To')} />
        <div className="grow" />
        <a className="btn" href={`/api/bookkeeping/export/journals.xlsx${qs({ from: from || b.overview.settings.start_date, to: to || today() })}`}><Icon name="download" />{t('Export (Excel)')}</a>
        <a className="btn ghost" href={`/api/bookkeeping/export/journals.csv${qs({ from: from || b.overview.settings.start_date, to: to || today() })}`} title={t('For accounting software that imports a manual journal file')}>{t('CSV')}</a>
        {b.canEdit && <button className="btn" onClick={() => setImporting(true)}><Icon name="upload" />{t('Import…')}</button>}
        {b.canEdit && picked.length > 0 && <button className="btn" disabled={busy} onClick={postPicked}><Icon name="check" />{t('Post {n} selected').replace('{n}', String(picked.length))}</button>}
        {b.canEdit && <button className="btn primary" onClick={() => setParam('open', 'new')}><Icon name="plus" />{t('New journal')}</button>}
      </div>
      {error && <ErrorBox error={error} />}
      {!data ? <Loading /> : !data.length ? <Empty title={status || kind || from || to || account || dq ? t('Nothing matches.') : t('No journals yet.')} /> : (
        <div className="card flush table-wrap">
          <table className="t">
            <thead>
              <tr>
                {b.canEdit && <th style={{ width: 28 }}>{drafts.length > 0 && <input type="checkbox" aria-label={t('Select all drafts')} checked={picked.length === drafts.length} onChange={(e) => setPicked(e.target.checked ? drafts.map((j) => j.id) : [])} />}</th>}
                <th>{t('Number')}</th><th>{t('Date')}</th><th>{t('Narration')}</th><th>{t('Kind')}</th><th className="bk-num">{t('Amount')}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((j) => (
                <tr key={j.id} className="click" onClick={() => setParam('open', String(j.id))}>
                  {b.canEdit && (
                    <td onClick={(e) => e.stopPropagation()}>
                      {j.status === 'draft' && <input type="checkbox" aria-label={t('Select')} checked={picked.includes(j.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, j.id] : p.filter((x) => x !== j.id)))} />}
                    </td>
                  )}
                  <td className="nowrap">{j.number ? <span className="code">{j.number}</span> : <span className="badge warn">{t('Draft')}</span>}</td>
                  <td className="nowrap">{fmtDate(j.date, lang)}</td>
                  <td>
                    {j.memo}
                    {j.reversed_by_id && <span className="badge" style={{ marginLeft: 6 }}>{t('Reversed')}</span>}
                    {j.created_via === 'mcp' && <span className="badge lapis" style={{ marginLeft: 6 }}>{t('AI draft')}</span>}
                  </td>
                  <td className="nowrap small">{t(JOURNAL_KIND_LABEL[j.kind])}</td>
                  <td className="bk-num nowrap">{fmtMoney(j.total_debit)}{j.status === 'draft' && j.total_debit !== j.total_credit && <> <Icon name="alert" className="bk-warn-ic" aria-label={t('Not balanced')} /></>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {importing && <ImportJournals onClose={() => setImporting(false)} onDone={() => { setImporting(false); setParam('status', 'draft'); changed(); }} />}
      {open !== null && <JournalDialog id={open === 'new' ? null : open} onClose={() => setParam('open', null)} onChanged={changed} />}
    </div>
  );
}

const blank = (fund_id?: number): BkLine => ({ account_id: 0, fund_id: fund_id ?? 0, debit: 0, credit: 0, memo: null, project_id: null, ministry_id: null, congregation_id: null });

/** One journal: editable while a draft (and the role may edit), read-only once posted, with Reverse. */
export function JournalDialog({ id, onClose, onChanged }: { id: number | null; onClose: () => void; onChanged: () => void }) {
  const { t, lt, lang } = useI18n();
  const b = useBooks();
  const n = useNames();
  const congs = useCongregations();
  const { run, busy } = useAction();
  const full = useApi<BkJournal & { problems: string[] }>(id ? `/bookkeeping/journals/${id}` : null);
  const general = b.funds.find((f) => f.restriction === 'unrestricted' && f.active)?.id;
  const [date, setDate] = useState(today());
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<BkLine[]>([blank(general), blank(general)]);
  const [reverse, setReverse] = useState<{ date: string; memo: string } | null>(null);
  const [history, setHistory] = useState(false);
  useEffect(() => {
    if (!full.data) return;
    setDate(full.data.date);
    setMemo(full.data.memo ?? '');
    setLines(full.data.lines.length ? full.data.lines : [blank(general), blank(general)]);
  }, [full.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const j = full.data;
  const editable = b.canEdit && (!j || j.status === 'draft');
  const tot = totals(lines);
  const diff = tot.debit - tot.credit;
  const showProject = b.projects.length > 0 || lines.some((l) => l.project_id);
  const showMinistry = b.ministries.length > 0 || lines.some((l) => l.ministry_id);
  const showCong = congs.length > 1 || lines.some((l) => l.congregation_id);
  const set = (i: number, p: Partial<BkLine>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const body = () => ({
    date, memo: memo.trim() || null, ...(j?.kind === 'opening' ? { kind: 'opening' } : {}),
    lines: lines.filter((l) => l.account_id || l.debit || l.credit).map((l) => ({
      account_id: l.account_id, fund_id: l.fund_id, project_id: l.project_id ?? null, ministry_id: l.ministry_id ?? null, congregation_id: l.congregation_id ?? null,
      debit: l.debit, credit: l.credit, memo: l.memo ?? null, orig_currency: l.orig_currency ?? null, orig_amount: l.orig_amount ?? null, rate: l.rate ?? null,
    })),
  });
  const save = async (post: boolean) => {
    const saved = await run(() => (id ? api.put<BkJournal>(`/bookkeeping/journals/${id}`, body()) : api.post<BkJournal>('/bookkeeping/journals', body())), post ? undefined : t('Saved.'));
    if (!saved) return;
    if (post) {
      if (!confirmAction(t('Post this journal? Posted journals can’t be changed, only reversed.'))) {
        onChanged();
        if (!id) onClose();
        else full.reload();
        return;
      }
      const p = await run(() => api.post<BkJournal>(`/bookkeeping/journals/${saved.id}/post`), t('Posted.'));
      onChanged();
      if (!p) {
        if (id) full.reload();
        else onClose();
        return;
      }
    } else onChanged();
    onClose();
  };
  const del = async () => {
    if (!id || !confirmAction(t('Delete this draft?'))) return;
    if (await run(() => api.del(`/bookkeeping/journals/${id}`), t('Deleted.'))) {
      onChanged();
      onClose();
    }
  };
  const doReverse = async () => {
    if (!id || !reverse) return;
    if (await run(() => api.post(`/bookkeeping/journals/${id}/reverse`, { date: reverse.date, memo: reverse.memo || undefined }), t('Reversed.'))) {
      onChanged();
      setReverse(null);
      full.reload();
    }
  };
  const title = !id ? t('New journal') : !j ? t('Journal') : j.number ? `${t('Journal')} ${j.number}` : `${t(JOURNAL_KIND_LABEL[j.kind])} — ${t('Draft')}`;
  return (
    <Modal title={title} onClose={onClose} size="lg" footer={
      <>
        {editable && id && <button className="btn danger ghost" disabled={busy} onClick={del}><Icon name="trash" />{t('Delete draft')}</button>}
        {id && <button className={`btn ghost${history ? ' on' : ''}`} onClick={() => setHistory((h) => !h)}><Icon name="clock" />{t('History')}</button>}
        <div className="grow" />
        <button className="btn" onClick={onClose}>{editable ? t('Cancel') : t('Close')}</button>
        {editable && <button className="btn" disabled={busy} onClick={() => save(false)}>{t('Save draft')}</button>}
        {editable && <button className="btn primary" disabled={busy || !tot.balanced} onClick={() => save(true)}>{t('Save and post')}</button>}
        {b.canEdit && j?.status === 'posted' && !j.reversed_by_id && !reverse && <button className="btn" onClick={() => setReverse({ date: today(), memo: '' })}><Icon name="refresh" />{t('Reverse…')}</button>}
      </>
    }>
      {id && !j ? (full.error ? <ErrorBox error={full.error} /> : <Loading />) : (
        <div className="stack">
          {j?.created_via === 'mcp' && j.status === 'draft' && <div className="callout lapis small">{t('Drafted by an AI assistant: check every line before posting.')}</div>}
          {j?.kind === 'offering' && j.service_id && <div className="small">{t('From the offerings of')} <Link to={`/records/${j.service_id}`}>{t('the service record')}</Link></div>}
          {j?.reverses_id && <div className="small muted">{t('This journal reverses another.')}</div>}
          {j?.reversed_by_id && <div className="callout small">{t('This journal has been reversed: together they cancel out.')}</div>}
          {j?.status === 'posted' && <div className="small muted">{t('Posted by {who} on {date}.').replace('{who}', j.posted_by ?? '').replace('{date}', fmtDate(j.posted_at?.slice(0, 10), lang))}</div>}
          <div className="grid cols-3">
            <Field label={t('Date')}><input type="date" value={date} disabled={!editable || j?.kind === 'opening'} onChange={(e) => setDate(e.target.value)} /></Field>
            <div style={{ gridColumn: 'span 2' }}><Field label={t('Narration')}><input value={memo} disabled={!editable} onChange={(e) => setMemo(e.target.value)} placeholder={t('What this journal is for')} /></Field></div>
          </div>
          <div className="table-wrap">
            <table className="t bk-lines">
              <thead>
                <tr>
                  <th>{t('Account')}</th><th>{t('Fund‖books')}</th>
                  {showProject && <th>{t('Project')}</th>}
                  {showMinistry && <th>{t('Ministry')}</th>}
                  {showCong && <th>{t('Congregation')}</th>}
                  <th className="bk-num">{t('Debit')}</th><th className="bk-num">{t('Credit')}</th><th>{t('Note')}</th>
                  {editable && <th />}
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => editable ? (
                  <tr key={i}>
                    <td><AccountSelect value={l.account_id || null} onChange={(v) => set(i, { account_id: v ?? 0 })} /></td>
                    <td><FundSelect value={l.fund_id || null} onChange={(v) => set(i, { fund_id: v ?? 0 })} /></td>
                    {showProject && <td><TagSelect kind="projects" value={l.project_id} onChange={(v) => set(i, { project_id: v })} /></td>}
                    {showMinistry && <td><TagSelect kind="ministries" value={l.ministry_id} onChange={(v) => set(i, { ministry_id: v })} /></td>}
                    {showCong && (
                      <td>
                        <select value={l.congregation_id ?? ''} onChange={(e) => set(i, { congregation_id: Number(e.target.value) || null })} aria-label={t('Congregation')}>
                          <option value="">—</option>
                          {congs.map((c) => <option key={c.id} value={c.id}>{lt(c.name)}</option>)}
                        </select>
                      </td>
                    )}
                    <td className="bk-num"><MoneyInput cents={l.debit} label={t('Debit')} onChange={(c) => set(i, { debit: c, credit: c ? 0 : l.credit })} /></td>
                    <td className="bk-num"><MoneyInput cents={l.credit} label={t('Credit')} onChange={(c) => set(i, { credit: c, debit: c ? 0 : l.debit })} /></td>
                    <td><input value={l.memo ?? ''} onChange={(e) => set(i, { memo: e.target.value })} aria-label={t('Note')} /></td>
                    <td><button className="btn ghost icon" aria-label={t('Remove')} onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}><Icon name="x" /></button></td>
                  </tr>
                ) : (
                  <tr key={i}>
                    <td>{n.account(l.account_id)}</td>
                    <td className="nowrap">{n.fundCode(l.fund_id)}</td>
                    {showProject && <td>{n.project(l.project_id)}</td>}
                    {showMinistry && <td>{n.ministry(l.ministry_id)}</td>}
                    {showCong && <td>{lt(congs.find((c) => c.id === l.congregation_id)?.name)}</td>}
                    <td className="bk-num">{l.debit ? fmtMoney(l.debit) : ''}</td>
                    <td className="bk-num">{l.credit ? fmtMoney(l.credit) : ''}</td>
                    <td className="small">{l.memo}{l.orig_currency && <span className="muted"> ({l.orig_currency} {fmtMoney(l.orig_amount)})</span>}</td>
                  </tr>
                ))}
                <tr className="bk-total">
                  <td colSpan={2 + (showProject ? 1 : 0) + (showMinistry ? 1 : 0) + (showCong ? 1 : 0)}>
                    {editable && <button className="btn small" onClick={() => setLines((ls) => [...ls, blank(ls[ls.length - 1]?.fund_id || general)])}><Icon name="plus" />{t('Add a line')}</button>}
                    {diff !== 0 && <span className="bk-off" style={{ marginLeft: 10 }}>{t('Not balanced by {amount}').replace('{amount}', fmtMoney(Math.abs(diff)))}</span>}
                  </td>
                  <td className="bk-num">{fmtMoney(tot.debit)}</td>
                  <td className="bk-num">{fmtMoney(tot.credit)}</td>
                  <td colSpan={editable ? 2 : 1} />
                </tr>
              </tbody>
            </table>
          </div>
          {editable && !!full.data?.problems?.length && (
            <div className="callout warn small">
              <strong>{t('Before it can be posted:')}</strong>
              <ul>{full.data.problems.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
          {history && id && <JournalHistory id={id} />}
          {reverse && (
            <div className="card stack tight">
              <h3>{t('Reverse this journal')}</h3>
              <p className="small muted">{t('A new posted journal with every line the other way round, so the two cancel out. Then enter it again correctly, if needed.')}</p>
              <div className="row">
                <input type="date" value={reverse.date} onChange={(e) => setReverse({ ...reverse, date: e.target.value })} aria-label={t('Date')} />
                <input className="grow" value={reverse.memo} onChange={(e) => setReverse({ ...reverse, memo: e.target.value })} placeholder={t('Why (optional)')} aria-label={t('Why (optional)')} />
                <button className="btn" onClick={() => setReverse(null)}>{t('Cancel')}</button>
                <button className="btn primary" disabled={busy} onClick={doReverse}>{t('Reverse')}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Every change to a journal (its lines too) and, for offerings, the cash count behind it — newest first. */
function JournalHistory({ id }: { id: number }) {
  const { t } = useI18n();
  const h = useApi<{ rows: (ChangeRow & { this_journal: boolean })[]; entities: Record<string, { en: string; zh: string }> }>(`/bookkeeping/journals/${id}/history`);
  return (
    <div className="card stack tight bk-history">
      <h3>{t('History')}</h3>
      <p className="small muted">{t('Every change to this journal, its lines included, before and after it was posted. For offerings, also the cash count’s changes and any earlier drafts for the service.')}</p>
      {h.error ? <ErrorBox error={h.error} /> : !h.data ? <Loading /> : !h.data.rows.length ? <p className="small muted">{t('No changes recorded yet.')}</p> : <ChangeList rows={h.data.rows} entities={h.data.entities} />}
    </div>
  );
}

interface ImportPreview {
  fatal: string | null;
  ignored: string[];
  journals: { ref: string; date: string | null; memo: string | null; rows: number[]; lines: unknown[]; debit: number; credit: number; errors: string[]; problems: string[] }[];
  imported?: number[];
}

/** Journals from an Excel or CSV file (the template, or another Canon's export): previewed, then imported as drafts. */
function ImportJournals({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t, lang } = useI18n();
  const { run, busy } = useAction();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const check = async (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setPreview(await run(() => api.upload<ImportPreview>('/bookkeeping/import/journals?dry_run=1', f)) ?? null);
  };
  const ok = (preview?.journals ?? []).filter((j) => !j.errors.length);
  const go = async () => {
    if (!file) return;
    const r = await run(() => api.upload<ImportPreview>('/bookkeeping/import/journals', file));
    if (r) {
      window.alert(t('{n} journal(s) imported as drafts. Review them, then post.').replace('{n}', String(r.imported?.length ?? 0)));
      onDone();
    }
  };
  return (
    <Modal title={t('Import journals')} onClose={onClose} size="lg" footer={
      <>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" disabled={busy || !ok.length} onClick={go}>{t('Import {n} as drafts').replace('{n}', String(ok.length))}</button>
      </>
    }>
      <div className="stack">
        <p className="small">{t('One row per line; the rows of a journal share its reference in the Journal column. Accounts and funds by their code. Journals come in as drafts: nothing is posted until you post it.')}</p>
        <div className="row">
          <a className="btn" href="/api/bookkeeping/import/journals-template.xlsx" download><Icon name="download" />{t('Download the template')}</a>
          <label className="btn primary"><Icon name="upload" />{t('Choose a file (Excel or CSV)')}
            <input type="file" hidden accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => check(e.target.files?.[0])} />
          </label>
          {file && <span className="small muted">{file.name}</span>}
        </div>
        {preview?.fatal && <ErrorBox error={preview.fatal} />}
        {!!preview?.ignored.length && <p className="small muted">{t('Ignored columns:')} {preview.ignored.join(', ')}</p>}
        {preview && !preview.fatal && (
          <div className="table-wrap">
            <table className="t bk-mini">
              <thead><tr><th>{t('Journal')}</th><th>{t('Date')}</th><th>{t('Narration')}</th><th className="bk-num">{t('Lines')}</th><th className="bk-num">{t('Debit')}</th><th className="bk-num">{t('Credit')}</th><th /></tr></thead>
              <tbody>
                {preview.journals.map((j) => (
                  <tr key={j.ref}>
                    <td className="nowrap"><span className="code">{j.ref}</span></td>
                    <td className="nowrap">{j.date ? fmtDate(j.date, lang) : ''}</td>
                    <td>{j.memo}</td>
                    <td className="bk-num">{j.lines.length}</td>
                    <td className="bk-num">{fmtMoney(j.debit)}</td>
                    <td className="bk-num">{fmtMoney(j.credit)}</td>
                    <td className="small">
                      {j.errors.length ? <span style={{ color: 'var(--danger)' }}>{t('Not imported:')} {j.errors.join(' ')}</span>
                        : j.problems.length ? <span style={{ color: 'var(--warn)' }}>{t('Draft; before posting:')} {j.problems.join(' ')}</span>
                          : <span className="badge ok">{t('Ready')}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
