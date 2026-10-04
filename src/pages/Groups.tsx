// Groups: committees, fellowships 团契, cell groups 小组 and ministries — cards by kind, detail modal with members and terms.
import { useMemo, useState } from 'react';
import { qs, useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Bi, Empty, ErrorBox, Loading, PageHead, useSession } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import { CsvTools } from '../components/CsvTools.tsx';
import type { GroupKind } from '../types-client.ts';
import { GroupDetailModal, GroupFormModal, KINDS, KIND_LABEL, KIND_PLURAL, RoleLabel, groupStyle, type GroupRow } from './groups-common.tsx';
import './people.css';

type Filter = GroupKind | 'all';

export default function Groups() {
  const { t } = useI18n();
  const { canEdit } = useSession();
  const [inactive, setInactive] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const { data, error, loading, reload } = useApi<GroupRow[]>(`/groups${qs({ inactive: inactive ? 1 : undefined })}`);
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const counts = useMemo(() => {
    const m = new Map<Filter, number>([['all', data?.length ?? 0]]);
    for (const g of data ?? []) m.set(g.kind, (m.get(g.kind) ?? 0) + 1);
    return m;
  }, [data]);
  const shown = (data ?? []).filter((g) => filter === 'all' || g.kind === filter);
  const sections = filter === 'all'
    ? KINDS.map((k) => ({ kind: k, items: shown.filter((g) => g.kind === k) })).filter((s) => s.items.length)
    : [{ kind: filter, items: shown }];
  const activeCount = (data ?? []).filter((g) => g.active).length;

  return (
    <div className="page people-page">
      <PageHead eyebrow={t('Congregation')} title={t('Groups')} sub={data ? `${activeCount} ${t('active groups')}` : undefined}>
        <label className="check">
          <input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} />
          {t('Show inactive')}
        </label>
        <CsvTools entity="groups" label={t('Groups')} onImported={reload} />
        {canEdit && <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" />{t('Add group')}</button>}
      </PageHead>

      <div className="fchips" role="group" aria-label={t('Kind')} style={{ marginBottom: 16 }}>
        {(['all', ...KINDS] as Filter[]).map((k) => (
          <button key={k} type="button" className={`fchip${filter === k ? ' on' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}
            disabled={k !== 'all' && !counts.get(k)}>
            {k === 'all' ? t('All') : t(KIND_PLURAL[k])}
            <span className="n">{counts.get(k) ?? 0}</span>
          </button>
        ))}
      </div>

      {error && <ErrorBox error={error} />}
      {loading && !data ? <Loading /> : !shown.length ? (
        <div className="card">
          <Empty title={t('No groups yet')}>
            <p>{t('Committees, fellowships, cell groups and ministries — with their members, roles and terms.')}</p>
          </Empty>
        </div>
      ) : (
        sections.map((s) => (
          <section key={s.kind} className="cw-section">
            {filter === 'all' && <h2>{t(KIND_PLURAL[s.kind as GroupKind])}<span className="badge">{s.items.length}</span></h2>}
            <div className="grid cols-3">
              {s.items.map((g) => <GroupCard key={g.id} g={g} onOpen={() => setOpen(g.id)} />)}
            </div>
          </section>
        ))
      )}

      {creating && (
        <GroupFormModal group={null} kind={filter !== 'all' ? filter : undefined} nextSort={data?.length ?? 0}
          onClose={() => setCreating(false)} onSaved={(g) => { reload(); setOpen(g.id); }} />
      )}
      {open && <GroupDetailModal groupId={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}

function GroupCard({ g, onOpen }: { g: GroupRow; onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <button type="button" className={`card grp-card${g.active ? '' : ' inactive'}`} style={groupStyle(g.color)} onClick={onOpen}>
      <div className="row between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <div className="gname"><Bi v={g.name} /></div>
        <span className="badge">{t(KIND_LABEL[g.kind])}</span>
      </div>
      {g.meeting && <div className="gmeta"><Icon name="clock" />{g.meeting}</div>}
      {!g.active && <div><span className="badge">{t('Inactive')}</span></div>}
      <div className="gfoot">
        <div className="grp-leaders">
          {g.leaders.map((l) => (
            <span key={l.person_id}>{l.name} <span className="r">· <RoleLabel role={l.role} /></span></span>
          ))}
        </div>
        <span className="grp-count"><Icon name="users" width={12} height={12} style={{ verticalAlign: -1, marginRight: 3 }} />{g.member_count}</span>
      </div>
    </button>
  );
}
