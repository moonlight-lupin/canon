// Reusable CSV tools for a list screen: "Download template", "Export" and "Import CSV…".
// Import is a two-step dialog: the file is checked first (dry run, nothing saved) and a preview lists new rows,
// changes and problems in plain language; only then can the user import. Server: server/routes/csv.ts.
import { useMemo, useRef, useState, type DragEvent } from 'react';
import { api, qs, useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Loading, Modal, useAction, useSession, useToast } from './ui.tsx';
import { Icon } from './icons.tsx';
import './csv.css';

/** CSV types holding personal data: read-only accounts can neither import nor export them (PDPA). */
const PII = new Set(['members', 'coworkers', 'groups', 'team_members', 'unavailability']);

/** Diff fields that are not CSV columns. */
const FIELD_LABEL: Record<string, string> = { song: 'Song', member: 'Member', group: 'Group', items: 'Items', person_id: 'Person' };

type Action = 'create' | 'update' | 'unchanged' | 'error';
interface PreviewRow {
  row: number;
  to_row?: number;
  label: string;
  action: Action;
  changes?: { field: string; from: string; to: string }[];
  errors?: string[];
  warnings?: string[];
}
interface Preview {
  applied: boolean;
  notes: string[];
  fatal: string | null;
  counts: Record<Action, number>;
  rows: PreviewRow[];
}
interface Guide {
  label: string;
  intro: string;
  general: string[];
  columns: { key: string; label: string; description: string; required: boolean; values: string[] | null; example: string | null }[];
}

export function CsvTools({
  entity, label, onImported, params, size = 'sm',
}: {
  entity: string;
  /** what is imported, shown in the dialog title, e.g. t('Members') */
  label: string;
  onImported?: () => void;
  /** extra query parameters, e.g. { hymnal_id: 3 } */
  params?: Record<string, string | number>;
  size?: 'sm' | 'md';
}) {
  const { t, lang } = useI18n();
  const { user, canEdit } = useSession();
  const [open, setOpen] = useState(false);
  const pii = PII.has(entity);
  if (!user.role_def?.member_details && pii) return null;
  const q = qs({ ...params, lang });
  const cls = `btn${size === 'sm' ? ' sm' : ''}`;
  return (
    <div className="csv-tools">
      {canEdit && (
        <a className={`${cls} ghost`} href={`/api/csv/${entity}/template.csv${q}`} download title={t('A CSV file with the right columns and a few example rows')}>
          <Icon name="file" />{t('Download template')}
        </a>
      )}
      <a className={cls} href={`/api/csv/${entity}/export.csv${q}`} download title={t('Download everything as a CSV file for Excel')}>
        <Icon name="download" />{t('Export')}
      </a>
      {canEdit && (
        <button type="button" className={cls} onClick={() => setOpen(true)}>
          <Icon name="upload" />{t('Import CSV…')}
        </button>
      )}
      {open && <ImportDialog entity={entity} label={label} params={params} onClose={() => setOpen(false)} onImported={onImported} />}
    </div>
  );
}

function ImportDialog({ entity, label, params, onClose, onImported }: { entity: string; label: string; params?: Record<string, string | number>; onClose: () => void; onImported?: () => void }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { run, busy } = useAction();
  const guide = useApi<Guide>(`/csv/${entity}/guide${qs({ ...params, lang })}`);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const labels = useMemo(() => new Map((guide.data?.columns ?? []).map((c) => [c.key, c.label])), [guide.data]);

  const check = async (f: File) => {
    setFile(f);
    setPreview(null);
    const p = await run(() => api.post<Preview>(`/csv/${entity}/import${qs({ ...params, dry_run: 1, lang })}`, f));
    if (p) setPreview(p);
    else setFile(null);
  };
  const apply = async (skipErrors: boolean) => {
    if (!file) return;
    const p = await run(() => api.post<Preview>(`/csv/${entity}/import${qs({ ...params, skip_errors: skipErrors ? 1 : undefined, lang })}`, file));
    if (!p) return;
    const parts = [`${p.counts.create} ${t('added')}`, `${p.counts.update} ${t('updated')}`];
    if (p.counts.error) parts.push(`${p.counts.error} ${t('skipped')}`);
    toast(`${t('Imported')}: ${parts.join(' · ')}`);
    onImported?.();
    onClose();
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) check(f);
  };

  const c = preview?.counts;
  const n = c ? c.create + c.update : 0;
  const errors = preview?.rows.filter((r) => r.action === 'error') ?? [];
  const changes = preview?.rows.filter((r) => r.action === 'create' || r.action === 'update') ?? [];
  const warned = preview?.rows.filter((r) => r.action !== 'error' && r.warnings?.length) ?? [];

  const footer = (
    <>
      <button className="btn left" onClick={onClose}>{t('Cancel')}</button>
      {preview && <button className="btn" onClick={() => input.current?.click()} disabled={busy}>{t('Choose another file')}</button>}
      {preview && !preview.fatal && c!.error > 0 && n > 0 && (
        <button className="btn" onClick={() => apply(true)} disabled={busy}>{t('Import valid rows and skip errors')}</button>
      )}
      {preview && !preview.fatal && n > 0 && (
        <button className="btn primary" onClick={() => apply(false)} disabled={busy || c!.error > 0} title={c!.error > 0 ? t('Fix the problems first, or skip them') : undefined}>
          <Icon name="upload" />{t('Import {n} rows').replace('{n}', String(n))}
        </button>
      )}
    </>
  );

  return (
    <Modal title={`${t('Import CSV')} · ${label}`} onClose={onClose} size="lg" footer={footer}>
      <input ref={input} type="file" accept=".csv,.txt,text/csv,text/plain" hidden onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (f) check(f);
      }} />
      <div className="stack">
        {!preview && !busy && (
          <>
            {guide.data && <p className="small muted" style={{ margin: 0 }}>{guide.data.intro}</p>}
            <div
              className={`csv-drop${over ? ' over' : ''}`} role="button" tabIndex={0}
              onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
            >
              <Icon name="upload" />
              <strong>{t('Choose a CSV file or drop it here')}</strong>
              <span className="small">{t('Nothing is saved yet: you will see a preview first.')}</span>
            </div>
            <div className="small muted">
              {t('Tip: start from the template, fill it in Excel, then Save As "CSV UTF-8 (Comma delimited)".')}{' '}
              <a href={`/api/csv/${entity}/template.csv${qs({ ...params, lang })}`} download>{t('Download template')}</a>
            </div>
          </>
        )}
        {busy && !preview && <><div className="small muted">{t('Checking the file…')} {file?.name}</div><Loading /></>}

        {preview && (
          <>
            <div className="small muted"><Icon name="file" style={{ width: 14, height: 14, verticalAlign: -2 }} /> {file?.name}</div>
            {preview.notes.length > 0 && <div className="callout lapis small">{preview.notes.map((x) => <div key={x}>{x}</div>)}</div>}
            {preview.fatal ? (
              <div className="callout warn">{preview.fatal}</div>
            ) : (
              <>
                <div className="csv-summary">
                  <span className="badge ok">{c!.create} {t('new')}</span>
                  <span className="badge lapis">{c!.update} {t('to update')}</span>
                  <span className="badge">{c!.unchanged} {t('unchanged')}</span>
                  <span className={`badge${c!.error ? ' danger' : ''}`}>{c!.error} {t('with problems')}</span>
                </div>
                {c!.error > 0 && (
                  <>
                    <div className="callout warn small">
                      {n > 0
                        ? t('Some rows have problems. Fix them in Excel and choose the file again, or import the valid rows and skip the others.')
                        : t('Every row has a problem. Fix them in Excel and choose the file again.')}
                    </div>
                    <div className="csv-rows" aria-label={t('Problems')}>
                      {errors.map((r) => <RowLine key={r.row} r={r} labels={labels} />)}
                    </div>
                  </>
                )}
                {warned.length > 0 && (
                  <details className="csv-details" open={warned.length <= 5}>
                    <summary>{t('Notes')} ({warned.length})</summary>
                    <div className="csv-rows">{warned.map((r) => <RowLine key={r.row} r={r} labels={labels} warningsOnly />)}</div>
                  </details>
                )}
                {changes.length > 0 && (
                  <details className="csv-details" open={!c!.error && changes.length <= 8}>
                    <summary>{t('Show what will change')} ({changes.length})</summary>
                    <div className="csv-rows">{changes.map((r) => <RowLine key={r.row} r={r} labels={labels} />)}</div>
                  </details>
                )}
                {n === 0 && c!.error === 0 && <div className="callout small">{t('Everything in this file is already in Canon. There is nothing to import.')}</div>}
              </>
            )}
          </>
        )}

        <details className="csv-details" open={!!preview?.fatal}>
          <summary>{t('Column guide')}</summary>
          {!guide.data ? <Loading /> : <ColumnGuide g={guide.data} intro={!!preview} />}
        </details>
      </div>
    </Modal>
  );
}

function RowLine({ r, labels, warningsOnly }: { r: PreviewRow; labels: Map<string, string>; warningsOnly?: boolean }) {
  const { t } = useI18n();
  const tag = { create: t('New'), update: t('Update'), unchanged: '', error: '' }[r.action];
  return (
    <div className={`csv-row ${r.action}`}>
      <span className="rn">{t('Row {n}').replace('{n}', `${r.row}${r.to_row ? `–${r.to_row}` : ''}`)}</span>
      <div>
        <div>
          {!warningsOnly && tag && <span className={`badge ${r.action === 'create' ? 'ok' : 'lapis'}`} style={{ marginRight: 6 }}>{tag}</span>}
          <strong>{r.label}</strong>
        </div>
        {r.errors && <ul>{r.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        {r.warnings && (warningsOnly || r.action === 'error') && <ul>{r.warnings.map((e) => <li key={e} className="warn-line">{e}</li>)}</ul>}
        {!warningsOnly && r.changes && r.changes.length > 0 && (
          <dl className="csv-diff">
            {r.changes.map((ch, i) => (
              <div key={i} style={{ display: 'contents' }}>
                <dt>{labels.get(ch.field) ?? t(FIELD_LABEL[ch.field] ?? ch.field)}</dt>
                <dd>
                  {r.action === 'update' && ch.from && <><del>{ch.from}</del> → </>}
                  {ch.to ? <ins>{ch.to}</ins> : <span className="muted">({t('empty')})</span>}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}

function ColumnGuide({ g, intro }: { g: Guide; intro: boolean }) {
  const { t } = useI18n();
  return (
    <div className="stack tight">
      {intro && <p className="small" style={{ margin: '4px 0' }}>{g.intro}</p>}
      <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>{g.general.map((x) => <li key={x}>{x}</li>)}</ul>
      <div className="table-wrap">
        <table className="t csv-guide">
          <thead><tr><th>{t('Column')}</th><th>{t('Required')}</th><th>{t('What to enter')}</th><th>{t('Example')}</th></tr></thead>
          <tbody>
            {g.columns.map((c) => (
              <tr key={c.key}>
                <td><code>{c.key}</code><div className="small muted">{c.label}</div></td>
                <td>{c.required ? <span className="badge reed">{t('For new rows')}</span> : <span className="muted small">{t('Optional')}</span>}</td>
                <td>
                  {c.description}
                  {c.values && <div className="vals mt">{c.values.map((v) => <code key={v}>{v}</code>)}</div>}
                </td>
                <td className="small">{c.example}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
