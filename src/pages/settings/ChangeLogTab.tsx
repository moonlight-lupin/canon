// Settings → Change log: who changed what and when, and how long the log is kept.
import { api } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Empty, ErrorBox, Loading, useAction, useSession } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import { ChangeList, FilterBar, Pager, useLogQuery, type ChangeRow, type Paged } from '../../components/LogTools.tsx';
import '../people.css';

/** From / to dates for a log filter. */
export function DateRange({ from, to, onFrom, onTo }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <span className="log-dates">
      <input className="mini" type="date" value={from} onChange={(e) => onFrom(e.target.value)} aria-label={t('From')} title={t('From')} />
      <span className="small muted">–</span>
      <input className="mini" type="date" value={to} onChange={(e) => onTo(e.target.value)} aria-label={t('To')} title={t('To')} />
    </span>
  );
}

/** "Keep: 12 months" — how long a log is kept (administrators). */
export function KeepMonths({ which }: { which: 'change_log_months' | 'mcp_audit_months' }) {
  const { t } = useI18n();
  const { settings, reloadSettings } = useSession();
  const { run } = useAction();
  const cur = settings?.retention ?? { change_log_months: 24, mcp_audit_months: 12 };
  const save = (n: number) => run(async () => {
    await api.put('/log-retention', { ...cur, [which]: n });
    reloadSettings();
  }, t('Saved.'));
  return (
    <label className="small muted row" style={{ gap: 6 }} title={t('Older entries are deleted once a day.')}>
      {t('Keep')}
      <select className="mini" value={cur[which]} onChange={(e) => save(Number(e.target.value))}>
        {[3, 6, 12, 24, 36, 60].map((n) => <option key={n} value={n}>{t('{n} months').replace('{n}', String(n))}</option>)}
        <option value={0}>{t('Everything')}</option>
      </select>
    </label>
  );
}

// ---------------------------------------------------------------- change log

export type ChangeFilters = { entity: string; user: string; via: string; action: string; from: string; to: string; q: string };

/** Settings → Change log: every change by a person, an AI agent or a CSV import. */
export function ChangeLogTab() {
  const { t, lt } = useI18n();
  const log = useLogQuery<ChangeRow, ChangeFilters>('/change-log', { entity: '', user: '', via: '', action: '', from: '', to: '', q: '' });
  const { filters: f, set } = log;
  const data = log.data as (Paged<ChangeRow> & { users: { id: number | null; name: string }[]; entities: Record<string, { en: string; zh: string }> }) | undefined;
  return (
    <div className="card flush">
      <div className="card-head" style={{ padding: '14px 16px 0' }}>
        <div>
          <h2>{t('Change log')}</h2>
          <div className="small muted">{t('Who changed what and when: in Canon, through an AI agent, or by CSV import. Only administrators can see it.')}</div>
        </div>
        <div className="row">
          <KeepMonths which="change_log_months" />
          <button className="btn ghost sm icon" onClick={log.reload} aria-label={t('Refresh')} title={t('Refresh')}><Icon name="refresh" /></button>
        </div>
      </div>
      <FilterBar active={log.active} onClear={log.clear} csv={`/api/change-log.csv${log.exportQuery}`}>
        <select className="mini" value={f.entity} onChange={(e) => set('entity', e.target.value)} aria-label={t('What')}>
          <option value="">{t('Everything')}</option>
          {data && Object.entries(data.entities).map(([k, v]) => <option key={k} value={k}>{t(v.en) !== v.en ? t(v.en) : lt(v)}</option>)}
        </select>
        <select className="mini" value={f.user} onChange={(e) => set('user', e.target.value)} aria-label={t('Who')}>
          <option value="">{t('Everyone')}</option>
          {data?.users.filter((u) => u.id != null).map((u) => <option key={u.id!} value={u.id!}>{u.name}</option>)}
        </select>
        <select className="mini" value={f.via} onChange={(e) => set('via', e.target.value)} aria-label={t('How')}>
          <option value="">{t('Any way')}</option>
          <option value="web">{t('In Canon')}</option>
          <option value="mcp">{t('AI agent')}</option>
          <option value="import">{t('CSV import')}</option>
        </select>
        <select className="mini" value={f.action} onChange={(e) => set('action', e.target.value)} aria-label={t('Action')}>
          <option value="">{t('Added, changed, deleted')}</option>
          <option value="create">{t('Added')}</option>
          <option value="update">{t('Changed')}</option>
          <option value="delete">{t('Deleted')}</option>
        </select>
        <DateRange from={f.from} to={f.to} onFrom={(v) => set('from', v)} onTo={(v) => set('to', v)} />
        <input className="mini" type="search" placeholder={t('Search names and values…')} value={f.q} onChange={(e) => set('q', e.target.value)} style={{ width: 190 }} />
      </FilterBar>
      {log.error && <ErrorBox error={log.error} />}
      {!data ? <Loading /> : !data.rows.length ? <Empty title={log.active ? t('Nothing matches these filters.') : t('No changes recorded yet.')} /> : (
        <>
          <ChangeList rows={data.rows} entities={data.entities} />
          <div style={{ padding: '0 16px 12px' }}><Pager page={data.page} size={data.size} total={data.total} onPage={log.setPage} /></div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- public address (for claude.ai)
