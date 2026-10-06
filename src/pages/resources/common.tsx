// Shared by the lending library and the asset register (0.15): a names-only member search (a librarian or asset
// keeper needs no access to the member register), and QR label sheets (A4 sticker sheets or a label printer).
import { FitToScreen } from '../../components/onscreen.ts';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { ErrorBox, Field, Loading, useDebounced, useSession } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import './resources.css';

export interface PersonHit { id: number; name: string; status: string; on_loan?: number; overdue?: number }

/** Type part of a name, pick the person. `endpoint` is the module's own names-only search. */
export function PersonSearch({ endpoint, value, onChange, placeholder, autoFocus }: {
  endpoint: '/lending/borrowers' | '/equipment/people';
  value: PersonHit | null;
  onChange: (p: PersonHit | null) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 200);
  const [hits, setHits] = useState<PersonHit[]>([]);
  useEffect(() => {
    if (!dq.trim()) return setHits([]);
    let live = true;
    api.get<PersonHit[]>(`${endpoint}?q=${encodeURIComponent(dq.trim())}`).then((r) => live && setHits(r)).catch(() => live && setHits([]));
    return () => {
      live = false;
    };
  }, [dq, endpoint]);
  if (value) {
    return (
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <strong>{value.name}</strong>
        {!!value.overdue && <span className="badge warn">{t('{n} overdue').replace('{n}', String(value.overdue))}</span>}
        <button type="button" className="btn sm ghost" onClick={() => onChange(null)}>{t('Change')}</button>
      </div>
    );
  }
  return (
    <div className="person-search">
      <input value={q} autoFocus={autoFocus} placeholder={placeholder ?? t('Type part of a name')} onChange={(e) => setQ(e.target.value)} aria-label={t('Member')} />
      {hits.length > 0 && (
        <ul className="person-hits" role="listbox">
          {hits.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => {
                onChange(p);
                setQ('');
              }}>
                {p.name}
                {!!p.on_loan && <span className="small muted"> · {t('{n} on loan').replace('{n}', String(p.on_loan))}</span>}
                {!!p.overdue && <span className="badge warn" style={{ marginLeft: 6 }}>{t('{n} overdue').replace('{n}', String(p.overdue))}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {dq.trim() && hits.length === 0 && <div className="small muted" style={{ marginTop: 4 }}>{t('No one on the member register by that name. Add them in Members first.')}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- labels

export type LabelLayout = 'a4-3x8' | 'a4-3x7' | 'a4-5x13' | 'roll-62x29';
interface Sheet { cols: number; rows: number; w: number; h: number; top: number; left: number; gapX: number; gapY: number; page: [number, number] }
/** Sticker sheets and label-printer rolls, in millimetres. */
export const LABEL_LAYOUTS: Record<LabelLayout, { name: string; sheet: Sheet }> = {
  'a4-3x8': { name: 'A4 sheet, 24 labels (70 × 37 mm)', sheet: { cols: 3, rows: 8, w: 70, h: 37, top: 0.5, left: 0, gapX: 0, gapY: 0, page: [210, 297] } },
  'a4-3x7': { name: 'A4 sheet, 21 labels (63.5 × 38.1 mm, e.g. Avery L7160)', sheet: { cols: 3, rows: 7, w: 63.5, h: 38.1, top: 15.15, left: 7.2, gapX: 2.5, gapY: 0, page: [210, 297] } },
  'a4-5x13': { name: 'A4 sheet, 65 small labels (38.1 × 21.2 mm, e.g. Avery L7651)', sheet: { cols: 5, rows: 13, w: 38.1, h: 21.2, top: 10.7, left: 4.7, gapX: 2.5, gapY: 0, page: [210, 297] } },
  'roll-62x29': { name: 'Label printer, 62 × 29 mm (one label per page)', sheet: { cols: 1, rows: 1, w: 62, h: 29, top: 0, left: 0, gapX: 0, gapY: 0, page: [62, 29] } },
};

export interface LabelData { id: number; number: string; qr: string; line1: string; line2?: string | null }

/** The print page for labels: choose the layout and where to start on a part-used sheet, then Print. */
export function LabelsPage({ kind }: { kind: 'lending' | 'equipment' }) {
  const { t, lt } = useI18n();
  const { settings } = useSession();
  const [sp] = useSearchParams();
  const param = kind === 'lending' ? 'copies' : 'items';
  const ids = sp.get(param) ?? '';
  const raw = useApi<{ base: string; labels: (Record<string, unknown> & { id: number; number: string; qr: string })[] }>(ids ? `/${kind}/labels?${param}=${ids}&base=${encodeURIComponent(location.origin)}` : null);
  const [layout, setLayout] = useState<LabelLayout>(() => {
    try {
      return (localStorage.getItem('canon.labels.layout') as LabelLayout) || 'a4-3x8';
    } catch {
      return 'a4-3x8';
    }
  });
  const [start, setStart] = useState(1);
  const choose = (l: LabelLayout) => {
    setLayout(l);
    setStart(1);
    try {
      localStorage.setItem('canon.labels.layout', l);
    } catch { /* not remembered */ }
  };
  const labels: LabelData[] = useMemo(() => (raw.data?.labels ?? []).map((r) => kind === 'lending'
    ? { id: r.id, number: r.number, qr: r.qr, line1: String(r.title ?? ''), line2: (r.shelf as string | null) ?? null }
    : { id: r.id, number: r.number, qr: r.qr, line1: String(r.name ?? ''), line2: (r.location as string | null) ?? null }), [raw.data, kind]);
  const s = LABEL_LAYOUTS[layout].sheet;
  const perPage = s.cols * s.rows;
  const cells: (LabelData | null)[] = [...Array.from({ length: Math.min(start - 1, perPage - 1) }, () => null), ...labels];
  const pages: (LabelData | null)[][] = [];
  for (let i = 0; i < cells.length; i += perPage) pages.push(cells.slice(i, i + perPage));
  const church = lt(settings?.church_name ?? {});
  const back = kind === 'lending' ? '/lending?tab=catalogue' : '/equipment';
  if (raw.error) return <ErrorBox error={raw.error} />;
  if (ids && !raw.data) return <Loading />;
  const small = layout === 'a4-5x13';
  return (
    <div className="labels-screen">
      <style>{`@media print { @page { size: ${s.page[0]}mm ${s.page[1]}mm; margin: 0; } }`}</style>
      <div className="labels-bar no-print">
        <Link className="btn sm ghost" to={back}><Icon name="chevronLeft" />{t('Back')}</Link>
        <Field label={t('Labels')}>
          <select value={layout} onChange={(e) => choose(e.target.value as LabelLayout)}>
            {(Object.keys(LABEL_LAYOUTS) as LabelLayout[]).map((k) => <option key={k} value={k}>{t(LABEL_LAYOUTS[k].name)}</option>)}
          </select>
        </Field>
        {perPage > 1 && (
          <Field label={t('Start at label')} hint={t('On a part-used sheet')}>
            <input type="number" min={1} max={perPage} value={start} style={{ width: 80 }} onChange={(e) => setStart(Math.max(1, Math.min(perPage, Number(e.target.value) || 1)))} />
          </Field>
        )}
        <div className="grow" />
        <span className="small muted">{t('Labels: {n}').replace('{n}', String(labels.length))}</span>
        <button className="btn sm primary" disabled={!labels.length} onClick={() => window.print()}><Icon name="print" />{t('Print')}</button>
      </div>
      <p className="small muted no-print labels-tip">{t('Print at 100% (not “fit to page”). The QR code opens the item in Canon at {address}, on a phone on the church network.').replace('{address}', raw.data?.base ?? '')}</p>
      <FitToScreen deps={[pages.length, s.page[0]]}>
      {pages.map((page, pi) => (
        <div key={pi} className="label-page" style={{ width: `${s.page[0]}mm`, height: `${s.page[1]}mm`, paddingTop: `${s.top}mm`, paddingLeft: `${s.left}mm` }}>
          <div className="label-grid" style={{ gridTemplateColumns: `repeat(${s.cols}, ${s.w}mm)`, gridAutoRows: `${s.h}mm`, columnGap: `${s.gapX}mm`, rowGap: `${s.gapY}mm` }}>
            {page.map((l, i) => (
              <div key={i} className={`label${small ? ' small' : ''}`}>
                {l && (
                  <>
                    {/* the QR code is drawn by Canon's own server */}
                    <div className="label-qr" dangerouslySetInnerHTML={{ __html: l.qr }} />
                    <div className="label-text">
                      <div className="label-number">{l.number}</div>
                      {!small && <div className="label-line1">{l.line1}</div>}
                      {!small && l.line2 && <div className="label-line2">{l.line2}</div>}
                      {!small && <div className="label-church">{church}</div>}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      </FitToScreen>
    </div>
  );
}
