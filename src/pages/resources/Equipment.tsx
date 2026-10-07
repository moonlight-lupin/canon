// The asset register (0.15): the church's equipment and property — the register with filters, an item's details,
// photos and receipts and its maintenance log, and labels. /equipment/item/:number is what an item's QR label opens.
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Empty, ErrorBox, Field, Loading, Modal, PageHead, SearchBox, confirmAction, fmtDate, useAction, useDebounced, useSession } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import { InfoTip } from '../../components/InfoTip.tsx';
import { CsvTools } from '../../components/CsvTools.tsx';
import { PersonSearch, type PersonHit } from './common.tsx';
import './resources.css';

type Condition = 'good' | 'fair' | 'poor' | 'broken';
type Status = 'in_use' | 'stored' | 'out_of_service';
type FileKind = 'photo' | 'receipt' | 'warranty' | 'other';
const CONDITION_LABEL: Record<Condition, string> = { good: 'Good', fair: 'Fair', poor: 'Poor', broken: 'Broken' };
const STATUS_LABEL: Record<Status, string> = { in_use: 'In use', stored: 'In storage', out_of_service: 'Out of service' };
const FILE_LABEL: Record<FileKind, string> = { photo: 'Photo', receipt: 'Receipt', warranty: 'Warranty', other: 'Other' };

interface Item {
  id: number; number: string; name: string; category: string | null; make_model: string | null; serial_no: string | null; location: string | null;
  custodian_id: number | null; bought_on: string | null; price: number | null; supplier: string | null; warranty_until: string | null;
  condition: Condition; status: Status; maintenance_every_months: number | null; next_maintenance_on: string | null; notes: string | null;
}
interface Row extends Item { custodian: string | null; photo_id: number | null; maintenance_due: boolean; elsewhere?: boolean }
interface Maint { id: number; done_on: string; what: string; cost: number | null; done_by: string | null; notes: string | null }
interface FileRow { id: number; kind: FileKind; name: string; mime: string; size: number; created_at: string }
interface Full extends Item { custodian: string | null; maintenance: Maint[]; files: FileRow[] }

const money = (n: number | null, currency: string) => (n == null ? '' : `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export default function Equipment() {
  const { t, lang } = useI18n();
  const { can } = useSession();
  const canEdit = can('equipment', 'edit');
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');
  const [status, setStatus] = useState('');
  const [due, setDue] = useState(false);
  const lists = useApi<{ categories: string[]; locations: string[] }>('/equipment/lists');
  const { data, error, reload } = useApi<Row[]>(`/equipment/items?q=${encodeURIComponent(dq)}&category=${encodeURIComponent(category)}&location=${encodeURIComponent(location)}&status=${status}${due ? '&due=1' : ''}`);
  const openId = Number(sp.get('open')) || null;
  const [open, setOpen] = useState<number | 'new' | null>(openId);
  const close = () => {
    setOpen(null);
    if (openId) setSp({}, { replace: true });
  };
  return (
    <div className="page">
      <PageHead eyebrow={t('Resources')} title={t('Asset register')} sub={t('The church’s equipment and property: where it is, who looks after it, and its upkeep.')} />
      <div className="stack">
        <div className="row res-toolbar" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="grow" style={{ maxWidth: 340 }}><SearchBox value={q} onChange={setQ} placeholder={t('Name, number, serial number or place')} /></div>
          {!!lists.data?.categories.length && (
            <select className="mini" value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t('Category')}>
              <option value="">{t('All categories')}</option>
              {lists.data.categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {!!lists.data?.locations.length && (
            <select className="mini" value={location} onChange={(e) => setLocation(e.target.value)} aria-label={t('Location')}>
              <option value="">{t('All places')}</option>
              {lists.data.locations.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <select className="mini" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('Status')}>
            <option value="">{t('Any status')}</option>
            {(Object.keys(STATUS_LABEL) as Status[]).map((s) => <option key={s} value={s}>{t(STATUS_LABEL[s])}</option>)}
          </select>
          <label className="check small"><input type="checkbox" checked={due} onChange={(e) => setDue(e.target.checked)} />{t('Maintenance due')}</label>
          <div className="grow" />
          {!!data?.length && <Link className="btn" to={`/equipment/labels?items=${data.map((r) => r.id).join(',')}`}><Icon name="qr" />{t('Print labels')}</Link>}
          <CsvTools entity="equipment" label={t('Asset register')} onImported={() => { reload(); lists.reload(); }} />
          {canEdit && <button className="btn primary" onClick={() => setOpen('new')}><Icon name="plus" />{t('New item')}</button>}
        </div>
        {error && <ErrorBox error={error} />}
        {!data ? <Loading /> : !data.length ? <Empty title={dq || category || location || status || due ? t('Nothing matches.') : t('The register is empty.')} /> : (
          <div className="card flush table-wrap">
            <table className="t">
              <thead><tr><th>{t('Number')}</th><th>{t('Item')}</th><th>{t('Place')}</th><th>{t('Looked after by')}</th><th>{t('Condition')}</th><th>{t('Next maintenance')}</th></tr></thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => setOpen(r.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(r.id)}>
                    <td className="nowrap"><span className="code">{r.number}</span></td>
                    <td>
                      <div className="row" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'center' }}>
                        {r.photo_id ? <img className="thumb" style={{ width: 36, height: 36 }} src={`/api/equipment/files/${r.photo_id}`} alt="" /> : null}
                        <div><strong>{r.name}</strong>{(r.make_model || r.category) && <div className="small muted">{[r.category, r.make_model].filter(Boolean).join(' · ')}</div>}</div>
                      </div>
                    </td>
                    <td>{r.location}</td>
                    <td>{r.elsewhere ? <span className="muted">{t('another congregation')}</span> : r.custodian}</td>
                    <td className="nowrap">{t(CONDITION_LABEL[r.condition])}{r.status !== 'in_use' && <div className="small muted">{t(STATUS_LABEL[r.status])}</div>}</td>
                    <td className="nowrap">{r.next_maintenance_on ? fmtDate(r.next_maintenance_on, lang) : ''}{r.maintenance_due && <> <span className="badge warn">{t('Due')}</span></>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {due && !!data?.length && <p className="small"><a href="/api/equipment/maintenance-due.xlsx">{t('Download the list (Excel)')}</a></p>}
      </div>
      {open !== null && <ItemDialog id={open === 'new' ? null : open} lists={lists.data ?? { categories: [], locations: [] }} onClose={close} onChanged={() => { reload(); lists.reload(); }} />}
    </div>
  );
}

function ItemDialog({ id, lists, onClose, onChanged }: { id: number | null; lists: { categories: string[]; locations: string[] }; onClose: () => void; onChanged: () => void }) {
  const { t, lang } = useI18n();
  const { can, settings } = useSession();
  const canEdit = can('equipment', 'edit');
  const ro = !canEdit;
  const { run, busy } = useAction();
  const currency = (settings as unknown as { offering?: { currency?: string } })?.offering?.currency ?? '';
  const full = useApi<Full>(id ? `/equipment/items/${id}` : null);
  const [x, setX] = useState<Partial<Item>>({ condition: 'good', status: 'in_use', name: '' });
  const [who, setWho] = useState<PersonHit | null>(null);
  useEffect(() => {
    if (!full.data) return;
    setX(full.data);
    setWho(full.data.custodian_id ? { id: full.data.custodian_id, name: full.data.custodian ?? '', status: '' } : null);
  }, [full.data]);
  const set = (p: Partial<Item>) => setX((o) => ({ ...o, ...p }));
  const save = async () => {
    const body = {
      number: x.number?.trim() || undefined, name: x.name ?? '', category: x.category ?? null, make_model: x.make_model ?? null, serial_no: x.serial_no ?? null,
      location: x.location ?? null, custodian_id: who?.id ?? null, bought_on: x.bought_on || null, price: x.price ?? null, supplier: x.supplier ?? null,
      warranty_until: x.warranty_until || null, condition: x.condition, status: x.status, maintenance_every_months: x.maintenance_every_months ?? null,
      next_maintenance_on: x.next_maintenance_on || null, notes: x.notes ?? null,
    };
    const r = id ? await run(() => api.patch(`/equipment/items/${id}`, body), t('Saved.')) : await run(() => api.post('/equipment/items', body), t('Saved.'));
    if (r) {
      onChanged();
      onClose();
    }
  };
  const remove = async () => {
    if (!id || !confirmAction(t('Delete {number} ({name}) from the register, with its photos, receipts and maintenance log?').replace('{number}', x.number ?? '').replace('{name}', x.name ?? ''))) return;
    if (await run(() => api.del(`/equipment/items/${id}`), t('Deleted.'))) {
      onChanged();
      onClose();
    }
  };
  if (id && !full.data) return <Modal title={t('Item')} onClose={onClose}>{full.error ? <ErrorBox error={full.error} /> : <Loading />}</Modal>;
  const d = (k: keyof Item) => (x[k] as string | null | undefined) ?? '';
  return (
    <Modal title={id ? `${x.number} · ${x.name}` : t('New item')} onClose={onClose} size="lg" footer={
      <>
        {id && canEdit && <button className="btn ghost danger" onClick={remove} disabled={busy}><Icon name="trash" />{t('Delete')}</button>}
        {id && <Link className="btn ghost" to={`/equipment/labels?items=${id}`}><Icon name="qr" />{t('Print label')}</Link>}
        <div className="grow" />
        <button className="btn" onClick={onClose}>{ro ? t('Close') : t('Cancel')}</button>
        {canEdit && <button className="btn primary" onClick={save} disabled={busy || !x.name?.trim()}>{t('Save')}</button>}
      </>
    }>
      <div className="stack">
        <div className="form-grid">
          <Field label={t('Name')}><input value={d('name')} disabled={ro} autoFocus={!id} placeholder={t('e.g. Projector, Keyboard, Folding tables')} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label={t('Number')} hint={id ? undefined : t('Empty = the next free number (E0001 …)')}><input value={d('number')} disabled={ro} placeholder="E0001" onChange={(e) => set({ number: e.target.value })} style={{ width: 140 }} /></Field>
          <Field label={t('Category')}>
            <input list="eq-cats" value={d('category')} disabled={ro} placeholder={t('e.g. AV, Music, Furniture, Kitchen')} onChange={(e) => set({ category: e.target.value })} />
            <datalist id="eq-cats">{lists.categories.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label={t('Make and model')}><input value={d('make_model')} disabled={ro} onChange={(e) => set({ make_model: e.target.value })} /></Field>
          <Field label={t('Serial number')}><input value={d('serial_no')} disabled={ro} onChange={(e) => set({ serial_no: e.target.value })} /></Field>
          <Field label={t('Place')}>
            <input list="eq-places" value={d('location')} disabled={ro} placeholder={t('e.g. Sanctuary, Store room 2')} onChange={(e) => set({ location: e.target.value })} />
            <datalist id="eq-places">{lists.locations.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label={t('Looked after by')}>{ro ? <span>{who?.name ?? '—'}</span> : <PersonSearch endpoint="/equipment/people" value={who} onChange={setWho} />}</Field>
          <Field label={t('Condition')}>
            <select value={x.condition ?? 'good'} disabled={ro} onChange={(e) => set({ condition: e.target.value as Condition })}>
              {(Object.keys(CONDITION_LABEL) as Condition[]).map((c) => <option key={c} value={c}>{t(CONDITION_LABEL[c])}</option>)}
            </select>
          </Field>
          <Field label={t('Status')}>
            <select value={x.status ?? 'in_use'} disabled={ro} onChange={(e) => set({ status: e.target.value as Status })}>
              {(Object.keys(STATUS_LABEL) as Status[]).map((c) => <option key={c} value={c}>{t(STATUS_LABEL[c])}</option>)}
            </select>
          </Field>
        </div>
        <h3 style={{ margin: '6px 0 0' }}>{t('Purchase')}</h3>
        <div className="form-grid">
          <Field label={t('Bought on')}><input type="date" value={d('bought_on')} disabled={ro} onChange={(e) => set({ bought_on: e.target.value })} /></Field>
          <Field label={`${t('Price')}${currency ? ` (${currency})` : ''}`}><input type="number" min={0} step="0.01" value={x.price ?? ''} disabled={ro} onChange={(e) => set({ price: e.target.value === '' ? null : Number(e.target.value) })} style={{ width: 140 }} /></Field>
          <Field label={t('Supplier')}><input value={d('supplier')} disabled={ro} onChange={(e) => set({ supplier: e.target.value })} /></Field>
          <Field label={t('Warranty until')}><input type="date" value={d('warranty_until')} disabled={ro} onChange={(e) => set({ warranty_until: e.target.value })} /></Field>
        </div>
        <h3 style={{ margin: '6px 0 0' }}>{t('Maintenance')}</h3>
        <div className="form-grid">
          <Field label={<>{t('Every (months)')} <InfoTip text={t('How often it is serviced. Recording maintenance then sets the next date that many months later.')} /></>}>
            <input type="number" min={1} max={120} value={x.maintenance_every_months ?? ''} disabled={ro} onChange={(e) => set({ maintenance_every_months: e.target.value ? Number(e.target.value) : null })} style={{ width: 100 }} />
          </Field>
          <Field label={t('Next maintenance')}><input type="date" value={d('next_maintenance_on')} disabled={ro} onChange={(e) => set({ next_maintenance_on: e.target.value })} /></Field>
        </div>
        <Field label={t('Notes')}><textarea rows={2} value={d('notes')} disabled={ro} onChange={(e) => set({ notes: e.target.value })} /></Field>
        {full.data && <FilesSection item={full.data} canEdit={canEdit} onChanged={() => { full.reload(); onChanged(); }} />}
        {full.data && <MaintenanceSection item={full.data} canEdit={canEdit} currency={currency} lang={lang} onChanged={() => { full.reload(); onChanged(); }} />}
      </div>
    </Modal>
  );
}

function FilesSection({ item, canEdit, onChanged }: { item: Full; canEdit: boolean; onChanged: () => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [kind, setKind] = useState<FileKind>('photo');
  const upload = async (file: File | undefined) => {
    if (!file) return;
    const ok = await run(async () => {
      if (file.size > 10 * 1024 * 1024) throw new Error(t('The file is larger than 10 MB.'));
      return api.upload(`/equipment/items/${item.id}/files?kind=${kind}&name=${encodeURIComponent(file.name)}`, file);
    }, t('Saved.'));
    if (ok) onChanged();
  };
  const remove = async (f: FileRow) => {
    if (!confirmAction(t('Delete {name}?').replace('{name}', f.name))) return;
    if (await run(() => api.del(`/equipment/files/${f.id}`), t('Deleted.'))) onChanged();
  };
  return (
    <section className="stack tight">
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>{t('Photos and receipts')}</h3>
        <div className="grow" />
        {canEdit && (
          <>
            <select className="mini" value={kind} onChange={(e) => setKind(e.target.value as FileKind)} aria-label={t('Kind')}>
              {(Object.keys(FILE_LABEL) as FileKind[]).map((k) => <option key={k} value={k}>{t(FILE_LABEL[k])}</option>)}
            </select>
            <label className="btn sm"><Icon name="upload" />{t('Add a file')}<input type="file" hidden accept="image/png,image/jpeg,image/webp,application/pdf" disabled={busy} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} /></label>
          </>
        )}
      </div>
      {!item.files.length ? <p className="small muted" style={{ margin: 0 }}>{t('No photos or receipts yet. Photos, PDF receipts and warranties up to 10 MB.')}</p> : (
        <div className="file-grid">
          {item.files.map((f) => (
            <div key={f.id} className="file-tile">
              <a href={`/api/equipment/files/${f.id}`} target="_blank" rel="noreferrer">
                {f.mime.startsWith('image/') ? <img src={`/api/equipment/files/${f.id}`} alt={f.name} /> : <div className="pdf">PDF</div>}
              </a>
              <div className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.name}>{t(FILE_LABEL[f.kind])} · {f.name}</div>
              <div className="row" style={{ gap: 4 }}>
                <a className="btn sm ghost" href={`/api/equipment/files/${f.id}?download=1`}><Icon name="download" /></a>
                {canEdit && <button className="btn sm ghost icon" onClick={() => remove(f)} aria-label={t('Delete')} disabled={busy}><Icon name="trash" /></button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function MaintenanceSection({ item, canEdit, currency, lang, onChanged }: { item: Full; canEdit: boolean; currency: string; lang: string; onChanged: () => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [m, setM] = useState({ done_on: new Date().toLocaleDateString('en-CA'), what: '', cost: '', done_by: '' });
  const add = async () => {
    const ok = await run(() => api.post(`/equipment/items/${item.id}/maintenance`, { done_on: m.done_on || null, what: m.what, cost: m.cost === '' ? null : Number(m.cost), done_by: m.done_by || null }), t('Saved.'));
    if (ok) {
      setM({ ...m, what: '', cost: '', done_by: '' });
      onChanged();
    }
  };
  const remove = async (x: Maint) => {
    if (!confirmAction(t('Delete this maintenance entry?'))) return;
    if (await run(() => api.del(`/equipment/maintenance/${x.id}`), t('Deleted.'))) onChanged();
  };
  return (
    <section className="stack tight">
      <h3 style={{ margin: 0 }}>{t('Maintenance log')}</h3>
      {canEdit && (
        <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label={t('Date')}><input type="date" value={m.done_on} onChange={(e) => setM({ ...m, done_on: e.target.value })} /></Field>
          <Field label={t('What was done')} className="grow"><input value={m.what} placeholder={t('e.g. Lamp replaced, tuned, serviced')} onChange={(e) => setM({ ...m, what: e.target.value })} /></Field>
          <Field label={t('Cost')}><input type="number" min={0} step="0.01" value={m.cost} onChange={(e) => setM({ ...m, cost: e.target.value })} style={{ width: 100 }} /></Field>
          <Field label={t('By')}><input value={m.done_by} placeholder={t('Person or company')} onChange={(e) => setM({ ...m, done_by: e.target.value })} /></Field>
          <button className="btn" onClick={add} disabled={busy || !m.what.trim()}><Icon name="plus" />{t('Record')}</button>
        </div>
      )}
      {!item.maintenance.length ? <p className="small muted" style={{ margin: 0 }}>{t('Nothing recorded yet.')}</p> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>{t('Date')}</th><th>{t('What was done')}</th><th>{t('Cost')}</th><th>{t('By')}</th><th /></tr></thead>
            <tbody>
              {item.maintenance.map((x) => (
                <tr key={x.id}>
                  <td className="nowrap">{fmtDate(x.done_on, lang)}</td><td>{x.what}</td><td className="nowrap">{money(x.cost, currency)}</td><td>{x.done_by}</td>
                  <td className="right">{canEdit && <button className="btn sm ghost icon" onClick={() => remove(x)} aria-label={t('Delete')} disabled={busy}><Icon name="trash" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** The page an item's QR label opens: what it is, where it belongs, its upkeep. */
export function ItemPage() {
  const { number = '' } = useParams();
  const { t, lang } = useI18n();
  const { can, settings } = useSession();
  const currency = (settings as unknown as { offering?: { currency?: string } })?.offering?.currency ?? '';
  const [n, setN] = useState(0);
  const { data, error } = useApi<Full>(`/equipment/scan?q=${encodeURIComponent(number)}&n=${n}`);
  const [open, setOpen] = useState(false);
  const photo = data?.files.find((f) => f.kind === 'photo');
  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <PageHead eyebrow={t('Asset register')} title={data ? `${data.number} · ${data.name}` : number} />
      {error ? <ErrorBox error={error} /> : !data ? <Loading /> : (
        <section className="card stack">
          <div className="book-head">
            {photo ? <img className="thumb" style={{ width: 110, height: 110 }} src={`/api/equipment/files/${photo.id}`} alt="" /> : null}
            <div className="grow stack tight">
              {data.make_model && <div>{data.make_model}{data.serial_no ? <span className="small muted"> · {t('Serial number')} {data.serial_no}</span> : null}</div>}
              <div><strong>{t('Place')}:</strong> {data.location ?? '—'}</div>
              <div><strong>{t('Looked after by')}:</strong> {data.custodian ?? '—'}</div>
              <div><strong>{t('Condition')}:</strong> {t(CONDITION_LABEL[data.condition])} · {t(STATUS_LABEL[data.status])}</div>
              {data.next_maintenance_on && <div><strong>{t('Next maintenance')}:</strong> {fmtDate(data.next_maintenance_on, lang)}</div>}
              {data.price != null && <div className="small muted">{t('Bought')} {data.bought_on ? fmtDate(data.bought_on, lang) : ''} · {money(data.price, currency)}</div>}
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" onClick={() => setOpen(true)}>{can('equipment', 'edit') ? t('Open and edit') : t('Open')}</button>
            <Link className="btn ghost" to="/equipment">{t('Asset register')} →</Link>
          </div>
        </section>
      )}
      {open && data && <ItemDialog id={data.id} lists={{ categories: [], locations: [] }} onClose={() => setOpen(false)} onChanged={() => setN((x) => x + 1)} />}
    </div>
  );
}
