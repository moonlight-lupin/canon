// Settings → Security & privacy (administrators): a checklist in plain words, and who looked at member records.
// The Storage card (on the Backups tab) lives here too.
import { Link } from 'react-router-dom';
import { api, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { ErrorBox, Loading, useAction } from '../../components/ui.tsx';
import { InfoTip } from '../../components/InfoTip.tsx';
import { Icon } from '../../components/icons.tsx';
import { FilterBar, Pager, stamp, useLogQuery } from '../../components/LogTools.tsx';

type CheckStatus = 'ok' | 'warn' | 'todo' | 'info';
interface CheckItem { key: string; status: CheckStatus; title: string; detail: string; link?: string }
const BADGE: Record<CheckStatus, string> = { ok: 'ok', warn: 'warn', todo: 'warn', info: '' };
const MARK: Record<CheckStatus, string> = { ok: '✓', warn: '!', todo: '…', info: 'i' };

export function SecurityTab() {
  const { t } = useI18n();
  const { data, error, setData } = useApi<{ checklist: CheckItem[]; security: { disk_encryption: boolean } }>('/security');
  const { run, busy } = useAction();
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
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
                  {c.link && <Link className="small" to={c.link}>{t('Open')} →</Link>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
      <MemberViewsCard />
    </div>
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
