// Shared pieces for long logs (Settings → Change log, AI / MCP → Activity log, a record's History): filters kept in
// one object, a server query with paging, and a pager. The server returns { rows, total, page, size }.
import { dateLocale } from '../../shared/languages.ts';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { qs, useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Icon } from './icons.tsx';
import { Empty, ErrorBox, Loading, Modal } from './ui.tsx';

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  size: number;
}

/** Filters + page for a log; changing a filter goes back to page 1. */
export function useLogQuery<T, F extends Record<string, string>>(path: string, initial: F, size = 50) {
  const [filters, setFilters] = useState<F>(initial);
  const [page, setPage] = useState(1);
  const query = useMemo(() => qs({ ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), page: String(page), size: String(size) }), [filters, page, size]);
  const res = useApi<Paged<T> & Record<string, unknown>>(`${path}${query}`);
  const set = (k: keyof F, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };
  const clear = () => {
    setFilters(initial);
    setPage(1);
  };
  const active = Object.entries(filters).some(([k, v]) => v && v !== initial[k]);
  /** the same filters without paging, for the Excel export */
  const exportQuery = qs(Object.fromEntries(Object.entries(filters).filter(([, v]) => v)));
  return { ...res, filters, set, clear, active, page, setPage, exportQuery };
}

export function Pager({ page, size, total, onPage, prev = 'Newer', next = 'Older' }: { page: number; size: number; total: number; onPage: (p: number) => void; prev?: string; next?: string }) {
  const { t } = useI18n();
  const pages = Math.max(1, Math.ceil(total / size));
  const from = total ? (page - 1) * size + 1 : 0;
  const to = Math.min(total, page * size);
  return (
    <div className="log-pager">
      <span className="small muted">{t('{from}–{to} of {total}').replace('{from}', String(from)).replace('{to}', String(to)).replace('{total}', String(total))}</span>
      <div className="row" style={{ gap: 4 }}>
        <button className="btn sm ghost" disabled={page <= 1} onClick={() => onPage(1)} aria-label={t('First page')}>«</button>
        <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}><Icon name="chevronLeft" />{t(prev)}</button>
        <span className="small">{page} / {pages}</span>
        <button className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t(next)}<Icon name="chevronRight" /></button>
      </div>
    </div>
  );
}

/** A row of filter controls with "Clear filters". */
export function FilterBar({ children, active, onClear, csv }: { children: ReactNode; active: boolean; onClear: () => void; csv?: string }) {
  const { t } = useI18n();
  return (
    <div className="log-filters">
      {children}
      {active && <button className="btn sm ghost" onClick={onClear}><Icon name="x" />{t('Clear filters')}</button>}
      {csv && <a className="btn sm log-export" href={csv} download title={t('Download every entry matching these filters (up to 20,000) for Excel.')}><Icon name="download" />{t('Export (Excel)')}</a>}
    </div>
  );
}

export const stamp = (s: string | null | undefined, lang: string) => {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
  return d.toLocaleString(dateLocale(lang), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// ---------------------------------------------------------------- the change log

export interface ChangeRow {
  id: number;
  at: string;
  user_name: string | null;
  via: 'web' | 'mcp' | 'import' | 'system';
  client: string | null;
  entity: string;
  entity_id: number | null;
  action: 'create' | 'update' | 'delete';
  name: string;
  summary: string | null;
  changes: Record<string, [unknown, unknown]>;
}

const VIA_LABEL: Record<ChangeRow['via'], string> = { web: 'In Canon', mcp: 'AI agent', import: 'CSV import', system: 'Canon' };
const ACTION_LABEL: Record<ChangeRow['action'], string> = { create: 'Added', update: 'Changed', delete: 'Deleted' };

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  // offering lines (a service record's offerings): "General · cash 120.00"
  if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === 'object' && 'amount' in x && 'method' in x)) {
    return (v as { fund?: string; method: string; amount: number; currency?: string }[])
      .map((x) => `${x.fund ?? ''} · ${x.method} ${x.currency ? `${x.currency} ` : ''}${(Number(x.amount) / 100).toFixed(2)}`).join('\n');
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const vals = Object.values(o);
    if (vals.length && vals.every((x) => typeof x === 'string')) return vals.join(' / ');
    return JSON.stringify(v);
  }
  return String(v);
};

/** One change: who, how, what, and the fields that changed (folded when there are many). */
export function ChangeList({ rows, entities }: { rows: ChangeRow[]; entities?: Record<string, { en: string; zh: string }> }) {
  const { t, lt, lang } = useI18n();
  const ent = (e: string) => (entities?.[e] ? (t(entities[e].en) !== entities[e].en ? t(entities[e].en) : lt(entities[e])) : e);
  return (
    <div className="table-wrap">
      <table className="t log-table">
        <thead><tr><th>{t('Time')}</th><th>{t('Who')}</th><th>{t('What')}</th><th>{t('Changes')}</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const fields = Object.entries(r.changes ?? {});
            return (
              <tr key={r.id}>
                <td className="nowrap small">{stamp(r.at, lang)}</td>
                <td className="nowrap">
                  {r.user_name ?? '—'}
                  <div className="small muted">{t(VIA_LABEL[r.via])}{r.client ? ` · ${r.client}` : ''}</div>
                </td>
                <td>
                  <span className={`badge ${r.action === 'delete' ? 'danger' : r.action === 'create' ? 'ok' : ''}`}>{t(ACTION_LABEL[r.action])}</span>{' '}
                  <span className="small muted">{ent(r.entity)}</span>
                  <div>{r.name}</div>
                </td>
                <td className="log-changes">
                  {r.summary && <div>{r.summary}</div>}
                  {fields.length > 0 && (r.action === 'update' ? (
                    <FieldChanges fields={fields} />
                  ) : (
                    <details>
                      <summary className="small muted">{t('{n} fields').replace('{n}', String(fields.length))}</summary>
                      <FieldChanges fields={fields} />
                    </details>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FieldChanges({ fields }: { fields: [string, [unknown, unknown]][] }) {
  const [all, setAll] = useState(false);
  const { t } = useI18n();
  const list = all ? fields : fields.slice(0, 6);
  return (
    <dl className="log-fields">
      {list.map(([k, [a, b]]) => (
        <Fragment key={k}>
          <dt>{k.replace(/_/g, ' ')}</dt>
          {/* several lines (a journal's lines, offerings): one above the other */}
          <dd className={(show(a) + show(b)).includes('\n') ? 'log-multi' : undefined}><span className="log-old">{show(a)}</span> → <span className="log-new">{show(b)}</span></dd>
        </Fragment>
      ))}
      {fields.length > 6 && !all && <dd><button className="btn sm ghost" onClick={() => setAll(true)}>{t('Show all {n}').replace('{n}', String(fields.length))}</button></dd>}
    </dl>
  );
}

/** "History" for one record (administrators): its changes, newest first, in a dialog. */
export function HistoryButton({ entity, id, label }: { entity: string; id: number; label?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn sm ghost" onClick={() => setOpen(true)}><Icon name="clock" />{label ?? t('History')}</button>
      {open && <HistoryDialog entity={entity} id={id} onClose={() => setOpen(false)} />}
    </>
  );
}

function HistoryDialog({ entity, id, onClose }: { entity: string; id: number; onClose: () => void }) {
  const { t } = useI18n();
  const q = useLogQuery<ChangeRow, { entity: string; entity_id: string }>('/change-log', { entity, entity_id: String(id) }, 20);
  const data = q.data as (Paged<ChangeRow> & { entities?: Record<string, { en: string; zh: string }> }) | undefined;
  return (
    <Modal title={t('History')} onClose={onClose} size="lg">
      {q.error && <ErrorBox error={q.error} />}
      {!data ? <Loading /> : !data.rows.length ? <Empty title={t('No changes recorded yet.')} /> : (
        <>
          <ChangeList rows={data.rows} entities={data.entities} />
          <Pager page={data.page} size={data.size} total={data.total} onPage={q.setPage} />
        </>
      )}
    </Modal>
  );
}
