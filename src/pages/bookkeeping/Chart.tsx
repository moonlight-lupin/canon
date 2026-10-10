// Book-keeping: the chart of accounts, the funds, and the project and ministry tags. An account or fund already used
// in a journal can be renamed or retired, not deleted (and an account's type can't change).
import { useState } from 'react';
import { api } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { ErrorBox, Field, L10nInput, Modal, Seg, confirmAction, useAction } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import {
  ACCOUNT_KINDS, ACCOUNT_TYPES, ACCOUNT_TYPE_LABEL, FUND_RESTRICTIONS, FUND_RESTRICTION_LABEL,
  type AccountKind, type AccountType, type BkAccount, type BkFund, type BkTag, type FundRestriction,
} from '../../../shared/bookkeeping.ts';
import type { L10n } from '../../../shared/types.ts';
import { useBooks } from './common.tsx';

const KIND_LABEL: Record<AccountKind, string> = {
  bank: 'Bank account', cash: 'Cash', undeposited: 'Offerings not yet banked', foreign_cash: 'Foreign cash',
  fund_balance: 'Fund balances', fund_transfer: 'Transfers between funds', other: '—',
};

type Part = 'accounts' | 'funds' | 'projects' | 'ministries';

export function ChartTab() {
  const { t, lt } = useI18n();
  const b = useBooks();
  const [part, setPart] = useState<Part>('accounts');
  const [open, setOpen] = useState<number | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const tags = part === 'projects' ? b.projects : b.ministries;
  return (
    <div className="stack">
      <div className="row between">
        <Seg<Part> value={part} onChange={(p) => { setPart(p); setOpen(null); }} options={[
          { value: 'accounts', label: t('Chart of accounts') }, { value: 'funds', label: t('Funds‖books') }, { value: 'projects', label: t('Projects') }, { value: 'ministries', label: t('Ministries') },
        ]} />
        <div className="grow" />
        {b.canEdit && (part === 'accounts' || part === 'funds') && <button className="btn" onClick={() => setImporting(true)}><Icon name="upload" />{t('Import…')}</button>}
        {b.canEdit && <button className="btn primary" onClick={() => setOpen('new')}><Icon name="plus" />{part === 'accounts' ? t('New account') : part === 'funds' ? t('New fund') : part === 'projects' ? t('New project') : t('New ministry')}</button>}
      </div>
      {part === 'accounts' && (
        <div className="grid cols-2">
          {ACCOUNT_TYPES.map((ty) => (
            <div key={ty} className="card flush">
              <h3 className="bk-card-title">{t(ACCOUNT_TYPE_LABEL[ty])}</h3>
              <table className="t">
                <tbody>
                  {b.accounts.filter((a) => a.type === ty).map((a) => (
                    <tr key={a.id} className={b.canEdit ? 'click' : ''} onClick={() => b.canEdit && setOpen(a.id)}>
                      <td className="nowrap" style={{ width: 60 }}><span className="code">{a.code}</span></td>
                      <td>{lt(a.name)}{!a.active && <span className="badge" style={{ marginLeft: 6 }}>{t('Retired')}</span>}</td>
                      <td className="small muted">{a.kind !== 'other' ? t(KIND_LABEL[a.kind]) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
      {part === 'funds' && (
        <div className="card flush">
          <table className="t">
            <thead><tr><th>{t('Code')}</th><th>{t('Fund‖books')}</th><th>{t('Restriction')}</th></tr></thead>
            <tbody>
              {b.funds.map((f) => (
                <tr key={f.id} className={b.canEdit ? 'click' : ''} onClick={() => b.canEdit && setOpen(f.id)}>
                  <td style={{ width: 60 }}><span className="code">{f.code}</span></td>
                  <td>{lt(f.name)}{!f.active && <span className="badge" style={{ marginLeft: 6 }}>{t('Retired')}</span>}{f.description && <div className="small muted">{f.description}</div>}</td>
                  <td>{t(FUND_RESTRICTION_LABEL[f.restriction])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted bk-note">{t('Restricted: given for a purpose the church must keep to. Designated: set aside by the church itself, and can be released. Endowment: the gift itself is kept.')}</p>
        </div>
      )}
      {(part === 'projects' || part === 'ministries') && (
        <div className="card flush">
          {!tags.length ? <p className="muted small bk-note">{part === 'projects' ? t('No projects yet: a project (a building appeal, a mission trip) can be tagged on any line, across funds and years.') : t('No ministries yet: tag lines with a ministry or department to see what each spends.')}</p> : (
            <table className="t">
              <tbody>
                {tags.map((x) => (
                  <tr key={x.id} className={b.canEdit ? 'click' : ''} onClick={() => b.canEdit && setOpen(x.id)}>
                    <td style={{ width: 80 }}><span className="code">{x.code}</span></td>
                    <td>{lt(x.name)}{!x.active && <span className="badge" style={{ marginLeft: 6 }}>{t('Retired')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {importing && (part === 'accounts' || part === 'funds') && <ChartImport part={part} onClose={() => setImporting(false)} onDone={() => { setImporting(false); b.reload(); }} />}
      {open !== null && part === 'accounts' && <AccountDialog a={open === 'new' ? null : b.accounts.find((a) => a.id === open)!} onClose={() => setOpen(null)} />}
      {open !== null && part === 'funds' && <FundDialog f={open === 'new' ? null : b.funds.find((f) => f.id === open)!} onClose={() => setOpen(null)} />}
      {open !== null && (part === 'projects' || part === 'ministries') && <TagDialog kind={part} x={open === 'new' ? null : tags.find((x) => x.id === open)!} onClose={() => setOpen(null)} />}
    </div>
  );
}

function useSaver(path: string, id: number | null, onClose: () => void) {
  const { t } = useI18n();
  const b = useBooks();
  const { run, busy } = useAction();
  return {
    busy,
    save: async (body: unknown) => {
      if (await run(() => (id ? api.patch(`${path}/${id}`, body) : api.post(path, body)), t('Saved.'))) {
        b.reload();
        onClose();
      }
    },
    del: async () => {
      if (!id || !await confirmAction(t('Delete it? (Anything already used in a journal can only be retired.)'), { danger: true, ok: t('Delete') })) return;
      if (await run(() => api.del(`${path}/${id}`), t('Deleted.'))) {
        b.reload();
        onClose();
      }
    },
  };
}

function Foot({ id, busy, onClose, onSave, onDelete }: { id: number | null; busy: boolean; onClose: () => void; onSave: () => void; onDelete: () => void }) {
  const { t } = useI18n();
  return (
    <>
      {id && <button className="btn danger ghost" disabled={busy} onClick={onDelete}><Icon name="trash" />{t('Delete')}</button>}
      <div className="grow" />
      <button className="btn" onClick={onClose}>{t('Cancel')}</button>
      <button className="btn primary" disabled={busy} onClick={onSave}>{t('Save')}</button>
    </>
  );
}

function AccountDialog({ a, onClose }: { a: BkAccount | null; onClose: () => void }) {
  const { t } = useI18n();
  const [code, setCode] = useState(a?.code ?? '');
  const [name, setName] = useState<L10n>(a?.name ?? {});
  const [type, setType] = useState<AccountType>(a?.type ?? 'expense');
  const [kind, setKind] = useState<AccountKind>(a?.kind ?? 'other');
  const [active, setActive] = useState(a?.active ?? true);
  const [description, setDescription] = useState(a?.description ?? '');
  const s = useSaver('/bookkeeping/accounts', a?.id ?? null, onClose);
  return (
    <Modal title={a ? `${a.code}` : t('New account')} onClose={onClose} footer={<Foot id={a?.id ?? null} busy={s.busy} onClose={onClose} onDelete={s.del} onSave={() => s.save({ code, name, type, kind, active, description: description || null })} />}>
      <div className="stack">
        <div className="grid cols-2">
          <Field label={t('Code')} hint={t('Numbers group the accounts: 1… assets, 2… liabilities, 3… funds, 4… income, 5… expenses.')}><input value={code} onChange={(e) => setCode(e.target.value)} /></Field>
          <Field label={t('Type')}>
            <select value={type} onChange={(e) => setType(e.target.value as AccountType)}>
              {ACCOUNT_TYPES.map((x) => <option key={x} value={x}>{t(ACCOUNT_TYPE_LABEL[x])}</option>)}
            </select>
          </Field>
        </div>
        <Field label={t('Name')}><L10nInput value={name} onChange={setName} /></Field>
        <Field label={t('What it is for')} hint={t('Canon needs to know which accounts are the bank (for statements), which hold offerings, and which hold the fund balances.')}>
          <select value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
            {ACCOUNT_KINDS.map((x) => <option key={x} value={x}>{x === 'other' ? t('Anything else') : t(KIND_LABEL[x])}</option>)}
          </select>
        </Field>
        <Field label={t('Description')}><input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{t('In use (untick to retire it: it stays in old journals and reports)')}</label>
      </div>
    </Modal>
  );
}

function FundDialog({ f, onClose }: { f: BkFund | null; onClose: () => void }) {
  const { t } = useI18n();
  const [code, setCode] = useState(f?.code ?? '');
  const [name, setName] = useState<L10n>(f?.name ?? {});
  const [restriction, setRestriction] = useState<FundRestriction>(f?.restriction ?? 'designated');
  const [active, setActive] = useState(f?.active ?? true);
  const [description, setDescription] = useState(f?.description ?? '');
  const s = useSaver('/bookkeeping/funds', f?.id ?? null, onClose);
  return (
    <Modal title={f ? f.code : t('New fund')} onClose={onClose} footer={<Foot id={f?.id ?? null} busy={s.busy} onClose={onClose} onDelete={s.del} onSave={() => s.save({ code, name, restriction, active, description: description || null })} />}>
      <div className="stack">
        <div className="grid cols-2">
          <Field label={t('Code')}><input value={code} onChange={(e) => setCode(e.target.value)} /></Field>
          <Field label={t('Restriction')}>
            <select value={restriction} onChange={(e) => setRestriction(e.target.value as FundRestriction)}>
              {FUND_RESTRICTIONS.map((x) => <option key={x} value={x}>{t(FUND_RESTRICTION_LABEL[x])}</option>)}
            </select>
          </Field>
        </div>
        <Field label={t('Name')}><L10nInput value={name} onChange={setName} /></Field>
        <Field label={t('Purpose')}><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('What the money may be used for')} /></Field>
        <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{t('In use (untick to retire it: it stays in old journals and reports)')}</label>
      </div>
    </Modal>
  );
}

function TagDialog({ kind, x, onClose }: { kind: 'projects' | 'ministries'; x: BkTag | null; onClose: () => void }) {
  const { t } = useI18n();
  const [code, setCode] = useState(x?.code ?? '');
  const [name, setName] = useState<L10n>(x?.name ?? {});
  const [active, setActive] = useState(x?.active ?? true);
  const s = useSaver(`/bookkeeping/tags/${kind}`, x?.id ?? null, onClose);
  return (
    <Modal title={x ? x.code : kind === 'projects' ? t('New project') : t('New ministry')} onClose={onClose} footer={<Foot id={x?.id ?? null} busy={s.busy} onClose={onClose} onDelete={s.del} onSave={() => s.save({ code, name, active })} />}>
      <div className="stack">
        <Field label={t('Code')}><input value={code} onChange={(e) => setCode(e.target.value)} /></Field>
        <Field label={t('Name')}><L10nInput value={name} onChange={setName} /></Field>
        <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{t('In use (untick to retire it: it stays in old journals and reports)')}</label>
      </div>
    </Modal>
  );
}

interface ChartPreview { fatal: string | null; rows: { row: number; code: string; action: 'create' | 'update' | 'unchanged' | 'error'; errors: string[]; changes: string[] }[]; counts: Record<string, number> }

/** The chart of accounts or the funds from an Excel or CSV file: new codes are added, known ones updated; previewed first. */
function ChartImport({ part, onClose, onDone }: { part: 'accounts' | 'funds'; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ChartPreview | null>(null);
  const check = async (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setPreview(await run(() => api.upload<ChartPreview>(`/bookkeeping/import/chart/${part}?dry_run=1`, f)) ?? null);
  };
  const go = async () => {
    if (!file) return;
    const r = await run(() => api.upload<ChartPreview>(`/bookkeeping/import/chart/${part}`, file), t('Saved.'));
    if (r) onDone();
  };
  const changes = (preview?.counts.create ?? 0) + (preview?.counts.update ?? 0);
  const LABEL: Record<string, string> = { create: t('New'), update: t('To update'), unchanged: t('Unchanged'), error: t('With problems') };
  return (
    <Modal title={part === 'accounts' ? t('Import the chart of accounts') : t('Import the funds')} onClose={onClose} size="lg" footer={
      <>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" disabled={busy || !changes} onClick={go}>{t('Import {n} change(s)').replace('{n}', String(changes))}</button>
      </>
    }>
      <div className="stack">
        <p className="small">{t('Download the current list, change it or add rows in Excel, and choose the file. Rows are matched by code: a new code is added, a known one updated. Nothing is deleted, and an account already used keeps its type.')}</p>
        <div className="row">
          <a className="btn" href={`/api/bookkeeping/import/chart/${part}.xlsx`} download><Icon name="download" />{t('Download the current list')}</a>
          <label className="btn primary"><Icon name="upload" />{t('Choose a file (Excel or CSV)')}
            <input type="file" hidden accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => check(e.target.files?.[0])} />
          </label>
          {file && <span className="small muted">{file.name}</span>}
        </div>
        {preview?.fatal && <ErrorBox error={preview.fatal} />}
        {preview && !preview.fatal && (
          <>
            <div className="row small">{Object.entries(preview.counts).map(([k, n]) => <span key={k} className="badge">{LABEL[k]}: {n}</span>)}</div>
            <table className="t bk-mini">
              <tbody>
                {preview.rows.filter((r) => r.action !== 'unchanged').map((r) => (
                  <tr key={r.row}>
                    <td className="nowrap small muted">{t('Row {n}').replace('{n}', String(r.row))}</td>
                    <td><span className="code">{r.code}</span></td>
                    <td className="small">{LABEL[r.action]}{r.changes.length ? `: ${r.changes.join(', ')}` : ''}{r.errors.length ? <span style={{ color: 'var(--danger)' }}> {r.errors.join(' ')}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </Modal>
  );
}
