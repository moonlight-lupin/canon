// Member register: people, households and upcoming birthdays.
import { optionValue } from '../../shared/member-fields.ts';
import { useEffect, useState } from 'react';
import { qs, useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Empty, ErrorBox, Loading, PageHead, SearchBox, fmtDate, useDebounced, useSession } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import { CongregationBadge, CongregationFilter, useCongregationFilter } from '../components/Congregations.tsx';
import { CsvTools } from '../components/CsvTools.tsx';
import type { MemberStatus, PersonRow } from '../types-client.ts';
import { PersonName, STATUSES, STATUS_LABEL, StatusBadge } from './people-common.tsx';
import { BirthdaysTab } from './members/BirthdaysTab.tsx';
import { HouseholdsTab } from './members/HouseholdsTab.tsx';
import { PersonEditor } from './members/PersonEditor.tsx';
import { FamilyEditor } from './members/FamilyEditor.tsx';
import type { HouseholdWithMembers } from './members/common.ts';
import { Pager } from '../components/LogTools.tsx';

type Tab = 'people' | 'households' | 'birthdays';

/** People per page of the list. */
const PAGE = 100;

export default function Members() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('people');
  // everyone, only where a tab needs them all (households, birthdays); the People tab pages through the server
  const allPeople = useApi<{ total: number; rows: PersonRow[] }>(tab === 'people' ? null : '/people?limit=5000');
  const count = useApi<{ total: number }>('/people?limit=1');
  const households = useApi<HouseholdWithMembers[]>('/households');
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [family, setFamily] = useState(false);
  const [version, setVersion] = useState(0);

  const refreshAll = () => {
    if (tab !== 'people') allPeople.reload();
    count.reload();
    households.reload();
    setVersion((v) => v + 1);
  };

  return (
    <div className="page people-page">
      <PageHead eyebrow={t('Congregation')} title={t('Member register')} sub={count.data ? `${count.data.total} ${t('people')}` : undefined}>
        <MembersActions onAdd={() => setEditing('new')} onFamily={() => setFamily(true)} onImported={refreshAll} />
      </PageHead>
      <div className="tabs" role="tablist">
        {(['people', 'households', 'birthdays'] as Tab[]).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {t(k === 'people' ? 'People' : k === 'households' ? 'Households' : 'Birthdays')}
          </button>
        ))}
      </div>
      {tab === 'people' && <PeopleTab version={version} onOpen={setEditing} />}
      {tab === 'households' && (
        <HouseholdsTab
          households={households.data} error={households.error} people={allPeople.data?.rows ?? []}
          onChanged={refreshAll} onOpen={setEditing} onFamily={() => setFamily(true)}
        />
      )}
      {tab === 'birthdays' && <BirthdaysTab people={allPeople.data?.rows} onOpen={setEditing} />}
      {family && <FamilyEditor onClose={() => setFamily(false)} onSaved={refreshAll} />}
      {editing !== null && (
        <PersonEditor
          id={editing === 'new' ? null : editing}
          households={households.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={refreshAll}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- header actions: add, export, import

function MembersActions({ onAdd, onFamily, onImported }: { onAdd: () => void; onFamily: () => void; onImported: () => void }) {
  const { t } = useI18n();
  const { canEdit } = useSession();
  return (
    <>
      <CsvTools entity="members" label={t('Member register')} onImported={onImported} />
      {canEdit && <button className="btn" onClick={onFamily}><Icon name="plus" />{t('New family')}</button>}
      {canEdit && <button className="btn primary" onClick={onAdd}><Icon name="plus" />{t('Add person')}</button>}
    </>
  );
}

// ---------------------------------------------------------------- people list

function PeopleTab({ version, onOpen }: { version: number; onOpen: (id: number) => void }) {
  const { t, lang, lt } = useI18n();
  // read-only accounts are not sent contact details: leave the columns out
  const { canEdit } = useSession();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());
  const [status, setStatus] = useState<MemberStatus | 'all'>('all');
  const [cong, setCong, congs] = useCongregationFilter('members');
  // filter by one of the church's own yes / no or choice fields: "key=value"
  const { settings: st } = useSession();
  const filterable = (st?.member_fields ?? []).filter((d) => (d.type === 'yesno' || d.type === 'choice') && (canEdit || !d.sensitive));
  const [fieldFilter, setFieldFilter] = useState('');
  // a page at a time, filtered on the server (0.20.0: it loaded up to 5,000 people and filtered them here)
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [dq, status, cong, fieldFilter]);
  const { data, error, loading, reload } = useApi<{ total: number; rows: PersonRow[]; by_status?: Record<string, number> }>(
    `/people${qs({ q: dq, limit: PAGE, offset: (page - 1) * PAGE, congregation: cong, status: status === 'all' ? undefined : status, field: fieldFilter || undefined })}`,
  );
  useEffect(() => {
    if (version) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const counts = data?.by_status ?? {};
  const all = Object.values(counts).reduce((n, x) => n + x, 0);
  const rows = data?.rows ?? [];
  const yr = (d: string | null) => (d ? d.slice(0, 4) : '');

  return (
    <div className="stack">
      <div className="row people-filters">
        <div className="grow" style={{ minWidth: 220, maxWidth: 380 }}>
          <SearchBox value={q} onChange={setQ} placeholder={t('Name, 中文名, email or phone…')} />
        </div>
        <CongregationFilter value={cong} onChange={setCong} list={congs} />
        {filterable.length > 0 && (
          <select className="mini" value={fieldFilter} onChange={(e) => setFieldFilter(e.target.value)} aria-label={t('Member fields')} style={{ height: 32 }}>
            <option value="">{t('All members')}</option>
            {filterable.map((d) => (
              <optgroup key={d.key} label={lt(d.label)}>
                {(d.type === 'yesno' ? [['yes', t('Yes')], ['no', t('No')]] : (d.options ?? []).map((o) => [optionValue(o, st?.languages?.[0]), lt(o)])).map(([v, l]) => (
                  <option key={v} value={`${d.key}=${v}`}>{lt(d.label)}: {l}</option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
        <div className="fchips" role="group" aria-label={t('Status')}>
          <button className={`fchip${status === 'all' ? ' on' : ''}`} onClick={() => setStatus('all')}>
            {t('All')} <span className="n">{all}</span>
          </button>
          {STATUSES.map((s) => (
            <button key={s} className={`fchip${status === s ? ' on' : ''}`} onClick={() => setStatus(s)} disabled={!counts[s] && status !== s}>
              {t(STATUS_LABEL[s])} <span className="n">{counts[s] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>
      {error && <ErrorBox error={error} />}
      {loading && !data ? <Loading /> : rows.length === 0 ? (
        <div className="card"><Empty title={dq || status !== 'all' ? t('No matches.') : t('No people yet')}>{!dq && status === 'all' && <p>{t('Add people one by one or import a CSV file.')}</p>}</Empty></div>
      ) : (
        <div className="card flush table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>{t('Name')}</th>
                <th>{t('Status')}</th>
                <th>{t('Household')}</th>
                {canEdit && <th>{t('Phone')}</th>}
                {canEdit && <th>{t('Email')}</th>}
                <th>{t('Baptism / membership')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="click" onClick={() => onOpen(p.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(p.id)}>
                  <td className="nowrap"><PersonName p={p} /> <CongregationBadge id={p.congregation_id} list={congs} /></td>
                  <td><StatusBadge status={p.status} /></td>
                  <td className="muted">{p.household_name ?? ''}</td>
                  {canEdit && <td className="nowrap">{p.phone ?? ''}</td>}
                  {canEdit && <td>{p.email ?? ''}</td>}
                  <td className="small muted nowrap">
                    {p.baptism_date && <span title={fmtDate(p.baptism_date, lang)}>{t('Bapt.')} {yr(p.baptism_date)}</span>}
                    {p.baptism_date && p.membership_date && ' · '}
                    {p.membership_date && <span title={fmtDate(p.membership_date, lang)}>{t('Mem.')} {yr(p.membership_date)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(data?.total ?? 0) > PAGE && <Pager page={page} size={PAGE} total={data!.total} onPage={setPage} prev="Previous page" next="Next page" />}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- person editor
