// Settings → Security & privacy (administrators): a checklist in plain words, and who looked at member records.
// The Storage card (on the Backups tab) lives here too.
import { Link } from 'react-router-dom';
import { api, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { ErrorBox, Loading, useAction } from '../../components/ui.tsx';
import { InfoTip } from '../../components/InfoTip.tsx';
import { Icon } from '../../components/icons.tsx';
import { ChangeList, FilterBar, Pager, stamp, useLogQuery, type ChangeRow } from '../../components/LogTools.tsx';
import { useState } from 'react';
import { qs } from '../../api.ts';
import { Bi, Field, Modal, Seg, confirmAction, fmtDate, useSession } from '../../components/ui.tsx';
import { money } from '../../../shared/records.ts';
import type { L10n } from '../../types-client.ts';

type CheckStatus = 'ok' | 'warn' | 'todo' | 'info';
interface CheckItem { key: string; status: CheckStatus; title: string; detail: string; link?: string }
const BADGE: Record<CheckStatus, string> = { ok: 'ok', warn: 'warn', todo: 'warn', info: '' };
const MARK: Record<CheckStatus, string> = { ok: '✓', warn: '!', todo: '…', info: 'i' };

export function SecurityTab() {
  const { t } = useI18n();
  const { data, error, setData } = useApi<{ checklist: CheckItem[]; security: { disk_encryption: boolean; require_admin_2fa?: boolean } }>('/security');
  const { run, busy } = useAction();
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const setTwoStep = (v: boolean) => run(async () => {
    await api.put('/security', { require_admin_2fa: v });
    setData(await api.get('/security'));
  }, t('Saved.'));
  const setDisk = (v: boolean) => run(async () => {
    await api.put('/security', { disk_encryption: v });
    setData(await api.get('/security'));
  }, t('Saved.'));
  return (
    <div className="stack">
      <section className="card stack">
        <h3>{t('Security checklist')} <InfoTip text={t('What protects members’ personal data, in plain words. Canon checks what it can; some things only you can confirm.')} /></h3>
        <div className="sec-list">
          {data.checklist.map((c) => (
            <div key={c.key} className={`sec-item ${c.status}`}>
              <span className={`badge ${BADGE[c.status]} sec-mark`} aria-hidden="true">{MARK[c.status]}</span>
              <div className="grow">
                <strong>{t(c.title)}</strong>
                <div className="small">{c.detail}</div>
                <div className="row" style={{ gap: 8, marginTop: 4 }}>
                  {c.key === 'disk' && (c.status === 'ok'
                    ? <button className="btn sm ghost" onClick={() => setDisk(false)} disabled={busy}>{t('Undo')}</button>
                    : <button className="btn sm" onClick={() => setDisk(true)} disabled={busy}><Icon name="check" />{t('Done: the disk is encrypted')}</button>)}
                  {c.key === 'two_step' && (data.security.require_admin_2fa
                    ? <button className="btn sm ghost" onClick={() => setTwoStep(false)} disabled={busy}>{t('Stop requiring it')}</button>
                    : <button className="btn sm" onClick={() => setTwoStep(true)} disabled={busy}><Icon name="lock" />{t('Require it for administrators')}</button>)}
                  {c.link && <Link className="small" to={c.link}>{t('Open')} →</Link>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
      <KeepingCard onChanged={async () => setData(await api.get('/security'))} />
      <MemberViewsCard />
    </div>
  );
}

interface ArchiveYear { year: number; records: number; changes: number; ai: number; views: number }
interface ArchiveFile extends ArchiveYear { name: string; size: number; duplicates?: number }

/** How long visitors' details are kept; archiving old years; the archive files. */
function KeepingCard({ onChanged }: { onChanged: () => void }) {
  const { t } = useI18n();
  const { settings, reloadSettings } = useSession();
  const files = useApi<ArchiveFile[]>('/archives');
  const { run, busy } = useAction();
  const [preview, setPreview] = useState<ArchiveYear[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const r = settings?.retention;
  if (!r) return <Loading />;
  const save = (p: Partial<typeof r>) => run(async () => {
    await api.put('/log-retention', p);
    reloadSettings();
    onChanged();
  }, t('Saved.'));
  const check = () => run(async () => setPreview((await api.post<{ years: ArchiveYear[] }>('/archives/run', { dry_run: true })).years));
  const archive = () => {
    if (!confirmAction(t('Move these years out of the live database into archive files? They can still be opened (read-only) here.'))) return;
    run(async () => {
      await api.post('/archives/run', {});
      setPreview(null);
      files.reload();
      onChanged();
    }, t('Archived.'));
  };
  return (
    <section className="card stack">
      <h3>{t('Keeping and archiving')} <InfoTip text={t('Personal data should be kept only as long as it is needed, and old records can move out of the live database into one read-only file per year. Archive files are copied with every backup.')} /></h3>
      <div className="row" style={{ gap: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label={<>{t('Erase visitors’ contact details after')} <InfoTip text={t('Phone or e-mail, prayer request, how they described themselves and notes are erased this many months after the service: from service records, archive files and the change log. Names, how they came and follow-up stay, so reports still count them. Backups keep their copies until they are removed (Settings → Backups → keep the newest).')} /></>}>
          <select value={r.visitor_contact_months} onChange={(e) => save({ visitor_contact_months: Number(e.target.value) })} disabled={busy}>
            {[6, 12, 18, 24, 36, 60].map((m) => <option key={m} value={m}>{t('{n} months').replace('{n}', String(m))}</option>)}
            <option value={0}>{t('Never (keep)')}</option>
          </select>
        </Field>
        <Field label={<>{t('Archive records older than')} <InfoTip text={t('Service records (with their offerings) and log entries of whole years older than this move to an archive file. The services themselves stay in Canon. Charities usually keep financial records for years: archiving keeps them, it does not delete them.')} /></>}>
          <select value={r.archive_years} onChange={(e) => save({ archive_years: Number(e.target.value) })} disabled={busy}>
            {[3, 5, 7, 10].map((y) => <option key={y} value={y}>{t('{n} years').replace('{n}', String(y))}</option>)}
            <option value={0}>{t('Never (keep all years)')}</option>
          </select>
        </Field>
        <button className="btn" onClick={check} disabled={busy || !r.archive_years}>{t('Check what can be archived')}</button>
      </div>
      {!!r.archive_years && !!r.change_log_months && r.change_log_months < r.archive_years * 12 && (
        <div className="callout small">
          {t('The change log keeps {m} months, so its entries are removed before they are old enough to archive: archives will hold service records, not their history. To archive the history too, keep the change log longer (Settings → Change log).').replace('{m}', String(r.change_log_months))}
        </div>
      )}
      {preview && (
        <div className="callout small">
          {!preview.length ? t('Nothing to archive yet.') : (
            <>
              <div>{t('Ready to archive:')}</div>
              <ul>{preview.map((y) => <li key={y.year}><strong>{y.year}</strong>: {t('{r} service records, {c} change-log entries, {a} AI activity entries').replace('{r}', String(y.records)).replace('{c}', String(y.changes)).replace('{a}', String(y.ai))}</li>)}</ul>
              <button className="btn primary sm" onClick={archive} disabled={busy}>{t('Archive now')}</button>
            </>
          )}
        </div>
      )}
      {(files.data?.length ?? 0) > 0 && (
        <table className="t">
          <thead><tr><th>{t('Archive')}</th><th className="right">{t('Service records')}</th><th className="right">{t('Change log')}</th><th className="right">{t('Size')}</th><th /></tr></thead>
          <tbody>
            {files.data!.map((f) => (
              <tr key={f.year}>
                <td><strong>{f.year}</strong>{(f.duplicates ?? 0) > 0 && <> <span className="badge warn" title={t('Archived by Canon 0.11.0: download the archive and compare the records before bringing one back.')}>{t('{n} services with two records').replace('{n}', String(f.duplicates))}</span></>}</td><td className="right">{f.records}</td><td className="right">{f.changes}</td><td className="right">{(f.size / 1e6).toFixed(1)} MB</td>
                <td className="right nowrap">
                  <button className="btn sm" onClick={() => setOpen(f.year)}><Icon name="eye" />{t('Open')}</button>{' '}
                  <a className="btn sm ghost" href={`/api/archives/${f.year}/download`}><Icon name="download" />{t('Download')}</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open != null && <ArchiveViewer year={open} onClose={() => setOpen(null)} onChanged={() => files.reload()} />}
    </section>
  );
}

/** One archived year, read-only: its service records and its change log. */
function ArchiveViewer({ year, onClose, onChanged }: { year: number; onClose: () => void; onChanged: () => void }) {
  const { t, lang } = useI18n();
  const { run, busy } = useAction();
  const bringBack = (serviceId: number) => {
    if (!confirmAction(t('Bring this record back into Canon to correct it? It leaves the archive until the next archiving, and the change is logged.'))) return;
    run(async () => {
      await api.post(`/archives/${year}/records/${serviceId}/restore`, {});
      recs.reload();
      onChanged();
    }, t('Brought back: it can be corrected on Service records.'));
  };
  const [view, setView] = useState<'records' | 'changes'>('records');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const recs = useApi<{ service_id: number; date: string; start_time: string; title: L10n; attendance: number | null; visitors: number; totals: Record<string, number>; verified: boolean }[]>(`/archives/${year}/records`);
  const changes = useApi<{ rows: ChangeRow[]; total: number; page: number; size: number }>(view === 'changes' ? `/archives/${year}/changes${qs({ q, page: String(page) })}` : null);
  return (
    <Modal title={`${t('Archive')} ${year}`} onClose={onClose} size="lg">
      <div className="stack">
        <Seg value={view} onChange={setView} options={[{ value: 'records', label: t('Service records') }, { value: 'changes', label: t('Change log') }]} />
        {view === 'records' ? (!recs.data ? <Loading /> : (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>{t('Date')}</th><th>{t('Service')}</th><th className="right">{t('Attendance')}</th><th className="right">{t('New visitors')}</th><th className="right">{t('Offerings')}</th><th /></tr></thead>
              <tbody>
                {recs.data.map((r, i) => (
                  <tr key={`${r.service_id}-${i}`}>
                    <td className="nowrap">{fmtDate(r.date, lang)}</td><td><Bi v={r.title} /></td><td className="right">{r.attendance ?? '—'}</td><td className="right">{r.visitors || ''}</td>
                    <td className="right nowrap">{Object.entries(r.totals).map(([c, v]) => money(v, c, true)).join(' · ')}</td>
                    <td className="nowrap">{r.verified && <span className="badge ok">{t('Verified')}</span>} <button className="btn sm ghost" disabled={busy} onClick={() => bringBack(r.service_id)} title={t('Bring this record back into Canon to correct it')}>{t('Bring back')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )) : (
          <>
            <input type="search" placeholder={t('Search names and values…')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} style={{ maxWidth: 280 }} />
            {!changes.data ? <Loading /> : (
              <>
                <ChangeList rows={changes.data.rows} entities={undefined} />
                <Pager page={changes.data.page} size={changes.data.size} total={changes.data.total} onPage={setPage} />
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}


interface ViewRow { id: number; at: string; user_name: string | null; person_id: number | null; person_name: string | null; via: 'web' | 'mcp' | 'export'; detail: string | null }
const VIA_LABEL: Record<ViewRow['via'], string> = { web: 'Member page', mcp: 'AI agent', export: 'CSV export' };

/** Who opened members' pages, which AI agents read members, and who exported the register. */
function MemberViewsCard() {
  const { t, lang } = useI18n();
  const log = useLogQuery<ViewRow, { user: string; via: string; from: string; to: string; q: string }>('/member-views', { user: '', via: '', from: '', to: '', q: '' });
  const f = log.filters;
  const data = log.data as (ReturnType<typeof useLogQuery>['data'] & { users?: { id: number; name: string }[] }) | undefined;
  const rows = (data?.rows ?? []) as ViewRow[];
  return (
    <section className="card flush">
      <div className="card-head" style={{ padding: '14px 16px 0' }}>
        <h3>{t('Who viewed member records')} <InfoTip text={t('Each time someone opens a member’s page, an AI assistant reads a member, or the members list is exported. The same person opening the same page within 10 minutes counts once. Kept as long as the change log.')} /></h3>
      </div>
      <FilterBar active={log.active} onClear={log.clear} csv={`/api/member-views.csv${log.exportQuery}`}>
        <select className="mini" value={f.user} onChange={(e) => log.set('user', e.target.value)} aria-label={t('Who')}>
          <option value="">{t('Everyone')}</option>
          {data?.users?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select className="mini" value={f.via} onChange={(e) => log.set('via', e.target.value)} aria-label={t('How')}>
          <option value="">{t('Any way')}</option>
          {(Object.keys(VIA_LABEL) as ViewRow['via'][]).map((v) => <option key={v} value={v}>{t(VIA_LABEL[v])}</option>)}
        </select>
        <span className="log-dates">
          <input className="mini" type="date" value={f.from} onChange={(e) => log.set('from', e.target.value)} aria-label={t('From')} />
          <span className="small muted">–</span>
          <input className="mini" type="date" value={f.to} onChange={(e) => log.set('to', e.target.value)} aria-label={t('To')} />
        </span>
        <input className="mini" type="search" placeholder={t('Search members…')} value={f.q} onChange={(e) => log.set('q', e.target.value)} style={{ width: 180 }} />
      </FilterBar>
      {log.error && <ErrorBox error={log.error} />}
      {!data ? <Loading /> : !rows.length ? <div className="small muted" style={{ padding: '0 16px 14px' }}>{t('Nothing recorded yet.')}</div> : (
        <>
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>{t('Time')}</th><th>{t('Who')}</th><th>{t('How')}</th><th>{t('Member')}</th></tr></thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.id}>
                    <td className="nowrap">{stamp(v.at, lang)}</td>
                    <td>{v.user_name ?? '—'}</td>
                    <td>{t(VIA_LABEL[v.via])}</td>
                    <td>{v.person_name ?? (v.detail ? <span className="muted">{v.detail}</span> : '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '0 16px 12px' }}><Pager page={data.page} size={data.size} total={data.total} onPage={log.setPage} /></div>
        </>
      )}
    </section>
  );
}

interface Storage {
  database: { bytes: number; path: string };
  tables: { name: string; label: string; bytes: number }[];
  backups: { dir: string; count: number; bytes: number; last: string | null };
  free_bytes: number | null;
  growth_per_month: number | null;
  warnings: string[];
}
const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

/** How much space Canon uses (Backups tab). */
export function StorageCard() {
  const { t } = useI18n();
  const { data, error } = useApi<Storage>('/storage');
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const max = Math.max(1, ...data.tables.map((x) => x.bytes));
  return (
    <section className="card stack">
      <h3>{t('Storage')} <InfoTip text={t('How much space Canon uses, what uses it, and the free space on the drive. Growth is measured from one reading a day.')} /></h3>
      {data.warnings.map((w) => <div key={w} className="callout warn small">{w}</div>)}
      <div className="rep-stats" style={{ marginBottom: 0 }}>
        <div className="card rep-stat"><div className="small muted">{t('Database')}</div><div className="rep-big">{mb(data.database.bytes)}</div></div>
        <div className="card rep-stat"><div className="small muted">{t('Growth per month')}</div><div className="rep-big">{data.growth_per_month == null ? '—' : mb(data.growth_per_month)}</div>{data.growth_per_month == null && <div className="small muted">{t('Measured after a few days')}</div>}</div>
        <div className="card rep-stat"><div className="small muted">{t('Backups')}</div><div className="rep-big">{mb(data.backups.bytes)}</div><div className="small muted">{t('{n} files').replace('{n}', String(data.backups.count))}</div></div>
        <div className="card rep-stat"><div className="small muted">{t('Free on the drive')}</div><div className="rep-big">{data.free_bytes == null ? '—' : mb(data.free_bytes)}</div></div>
      </div>
      <table className="rep-bars">
        <tbody>
          {data.tables.map((x) => (
            <tr key={x.name}><th>{t(x.label)}</th><td className="rep-bar-cell"><div className="rep-bar" style={{ width: `${(x.bytes / max) * 100}%` }} /></td><td className="right nowrap">{mb(x.bytes)}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="small muted">{data.database.path}</div>
    </section>
  );
}
