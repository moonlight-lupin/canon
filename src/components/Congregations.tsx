// Congregations of one church (English, Chinese, Indonesian services …): the shared list, a select, a badge, a
// filter that remembers its choice per page, and the editor in Settings → Church. With no congregations defined,
// every piece renders nothing, so a single-congregation church never sees them.
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Bi, Field, L10nInput, Seg, confirmAction, useAction } from './ui.tsx';
import { Icon } from './icons.tsx';
import { InfoTip } from './InfoTip.tsx';
import { langInfo } from '../../shared/languages.ts';
import type { L10n, Lang } from '../types-client.ts';

/** "Congregation" here means one of the church's congregations (所属堂), not the sidebar's 会众 heading. */
export const CONG_LABEL: L10n = { en: 'Congregation', zh: '所属堂', 'zh-Hant': '所屬堂' };
export const CONGS_LABEL: L10n = { en: 'Congregations', zh: '各堂', 'zh-Hant': '各堂' };

export interface Congregation {
  id: number;
  name: L10n;
  code: string;
  languages: Lang[];
  color: string;
  sort: number;
  active: boolean;
}

// one fetch shared by every component; refreshCongregations() after a change
let cache: Congregation[] | null = null;
let pending: Promise<Congregation[]> | null = null;
const listeners = new Set<(c: Congregation[]) => void>();
export function refreshCongregations() {
  pending = api.get<Congregation[]>('/congregations').then((c) => {
    cache = c;
    pending = null;
    listeners.forEach((f) => f(c));
    return c;
  });
  return pending;
}

/** The church's congregations ([] when it has none). */
export function useCongregations(): Congregation[] {
  const [list, setList] = useState<Congregation[]>(cache ?? []);
  useEffect(() => {
    listeners.add(setList);
    if (!cache && !pending) refreshCongregations().catch(() => undefined);
    return () => {
      listeners.delete(setList);
    };
  }, []);
  return list;
}

/** Small coloured label, e.g. "EN" / "华". */
export function CongregationBadge({ id, list }: { id: number | null | undefined; list: Congregation[] }) {
  const { lt } = useI18n();
  const c = id ? list.find((x) => x.id === id) : undefined;
  if (!c) return null;
  return (
    <span className="badge cong-badge" style={{ borderColor: c.color, color: c.color }} title={lt(c.name)}>{c.code || lt(c.name)}</span>
  );
}

/** A "Congregation" select for a form; nothing when the church has no congregations. */
export function CongregationField({ value, onChange, hint, wholeChurchLabel }: { value: number | null | undefined; onChange: (v: number | null) => void; hint?: string; wholeChurchLabel?: string }) {
  const { t, lt } = useI18n();
  const list = useCongregations();
  if (!list.length) return null;
  return (
    <Field label={<>{lt(CONG_LABEL)}{hint && <> <InfoTip text={hint} /></>}</>}>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">{wholeChurchLabel ?? t('Whole church')}</option>
        {list.filter((c) => c.active || c.id === value).map((c) => <option key={c.id} value={c.id}>{lt(c.name)}{c.code ? ` (${c.code})` : ''}</option>)}
      </select>
    </Field>
  );
}

/** "All · EN · 华 · ID" filter buttons; remembers the choice per page in this browser. */
export function useCongregationFilter(page: string): [number | null, (v: number | null) => void, Congregation[]] {
  const list = useCongregations();
  const key = `canon.cong.${page}`;
  const [v, setV] = useState<number | null>(() => {
    try {
      return Number(localStorage.getItem(key)) || null;
    } catch {
      return null;
    }
  });
  const set = (n: number | null) => {
    setV(n);
    try {
      if (n) localStorage.setItem(key, String(n));
      else localStorage.removeItem(key);
    } catch {
      /* private window: not remembered */
    }
  };
  // a remembered congregation that was deleted falls back to all
  const valid = v && list.some((c) => c.id === v) ? v : null;
  return [list.length ? valid : null, set, list];
}

export function CongregationFilter({ value, onChange, list }: { value: number | null; onChange: (v: number | null) => void; list: Congregation[] }) {
  const { t, lt } = useI18n();
  if (!list.length) return null;
  return (
    <div className="cong-filter" role="group" aria-label={lt(CONG_LABEL)}>
      <Seg<string>
        value={value ? String(value) : ''}
        onChange={(v) => onChange(v ? Number(v) : null)}
        options={[{ value: '', label: t('All') }, ...list.filter((c) => c.active).map((c) => ({ value: String(c.id), label: <span title={lt(c.name)}>{c.code || lt(c.name)}</span> }))]}
      />
    </div>
  );
}

// ---------------------------------------------------------------- Settings → Church: the list of congregations

export function CongregationsCard({ churchLangs }: { churchLangs: Lang[] }) {
  const { t, lt } = useI18n();
  const list = useCongregations();
  const { run, busy } = useAction();
  const [edit, setEdit] = useState<Partial<Congregation> | null>(null);
  const save = () => edit && run(async () => {
    const body = { name: edit.name, code: edit.code ?? '', languages: edit.languages ?? [], color: edit.color ?? '#64748b', active: edit.active ?? true };
    if (edit.id) await api.patch(`/congregations/${edit.id}`, body);
    else await api.post('/congregations', body);
    await refreshCongregations();
    setEdit(null);
  }, t('Saved.'));
  const remove = (c: Congregation) => {
    if (!confirmAction(t('Delete this congregation? Its services, members and groups stay; they just lose the tag.'))) return;
    run(async () => {
      await api.del(`/congregations/${c.id}`);
      await refreshCongregations();
    }, t('Deleted.'));
  };
  const toggleLang = (l: Lang) => setEdit((e) => e && ({ ...e, languages: (e.languages ?? []).includes(l) ? (e.languages ?? []).filter((x) => x !== l) : [...(e.languages ?? []), l].slice(0, 3) }));

  return (
    <section className="card stack">
      <div className="row between">
        <div>
          <h3>{lt(CONGS_LABEL)} <InfoTip text={t('For one church with several congregations, e.g. English, Chinese and Indonesian services. Services, service templates, members and groups can then belong to one, and lists can be filtered by it. Leave empty if your church has one congregation.')} /></h3>
          <div className="small muted">{list.length ? t('Shown as a filter on Services, Members, Groups and the rota.') : t('None — Canon treats the church as one congregation.')}</div>
        </div>
        <button className="btn sm" onClick={() => setEdit({ name: {}, code: '', languages: [], color: '#2f4a7a', active: true })}><Icon name="plus" />{t('Add congregation')}</button>
      </div>
      {list.length > 0 && (
        <div className="table-wrap">
          <table className="t">
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className={c.active ? '' : 'muted'}>
                  <td className="nowrap"><span className="badge cong-badge" style={{ borderColor: c.color, color: c.color }}>{c.code || '—'}</span></td>
                  <td><Bi v={c.name} /></td>
                  <td className="small muted">{c.languages.map((l) => langInfo(l).native).join(' · ')}</td>
                  <td className="small muted">{c.active ? '' : t('Not active')}</td>
                  <td className="right nowrap">
                    <button className="btn sm ghost" onClick={() => setEdit(c)}><Icon name="edit" />{t('Edit')}</button>
                    <button className="btn sm ghost icon danger" onClick={() => remove(c)} aria-label={t('Delete')} title={t('Delete')}><Icon name="trash" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && (
        <div className="callout stack" style={{ background: 'var(--paper-2)' }}>
          <div className="form-grid">
            <Field label={t('Name')}><L10nInput value={edit.name ?? {}} onChange={(n) => setEdit({ ...edit, name: n })} /></Field>
            <Field label={<>{t('Short label')} <InfoTip text={t('Two or three letters on badges and filters, e.g. EN, 华, ID.')} /></>}>
              <input value={edit.code ?? ''} maxLength={8} onChange={(e) => setEdit({ ...edit, code: e.target.value })} style={{ width: 100 }} />
            </Field>
            <Field label={t('Colour')}>
              <span className="pr-colour"><input type="color" value={edit.color ?? '#64748b'} onChange={(e) => setEdit({ ...edit, color: e.target.value })} /><code>{edit.color}</code></span>
            </Field>
          </div>
          <Field label={<>{t('Languages of its services')} <InfoTip text={t('New services for this congregation start with these languages (up to 3).')} /></>}>
            <div className="row">
              {churchLangs.map((l) => (
                <label key={l} className="check"><input type="checkbox" checked={(edit.languages ?? []).includes(l)} onChange={() => toggleLang(l)} />{langInfo(l).native}</label>
              ))}
            </div>
          </Field>
          {edit.id && (
            <Field label={t('Status')}>
              <div><Seg<'on' | 'off'> value={edit.active === false ? 'off' : 'on'} onChange={(v) => setEdit({ ...edit, active: v === 'on' })} options={[{ value: 'on', label: t('Active') }, { value: 'off', label: t('Not active') }]} /></div>
            </Field>
          )}
          <div className="row end">
            <button className="btn" onClick={() => setEdit(null)}>{t('Cancel')}</button>
            <button className="btn primary" onClick={save} disabled={busy || !Object.values(edit.name ?? {}).some((v) => v?.trim())}>{t('Save')}</button>
          </div>
        </div>
      )}
      {!list.length && !edit && <div className="small muted">{lt({ en: 'Example: “English service” (EN), “华文堂” (华), “Indonesian service” (ID).', zh: '例如：“English service”（EN）、“华文堂”（华）、“印尼堂”（ID）。' })}</div>}
    </section>
  );
}
