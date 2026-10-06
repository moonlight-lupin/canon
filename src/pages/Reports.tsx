// Records → Reports: attendance, offerings, new visitors, serving, songs and Scripture, membership, spaces — for a period and
// (in churches with several) a congregation. Each report can be printed or exported to CSV (opens in Excel).
// Offerings are only offered to editors and administrators (the server refuses them to read-only users), and a
// month's offerings print as a one-page summary for the treasurer.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { qs, useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { PageHead, Seg, fmtDate, today, useSession } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import { CongregationFilter, useCongregationFilter } from '../components/Congregations.tsx';
import type { ReportKind } from '../../shared/reports.ts';
import './records.css';
import './reports.css';
import { OfferingsTab } from './reports/OfferingsTab.tsx';
import { SpacesReport } from './reports/SpacesReport.tsx';
import { MembershipTab, ServingTab, VisitorsTab } from './reports/PeopleTabs.tsx';
import { AttendanceTab, ScriptureTab, SongsTab } from './reports/WorshipTabs.tsx';
import type { Ctx } from './reports/charts.tsx';
import { meetingGroups, type GroupRow } from './groups-common.tsx';

const TABS: { kind: ReportKind; label: string; money?: boolean }[] = [
  { kind: 'attendance', label: 'Attendance' },
  { kind: 'offerings', label: 'Offerings', money: true },
  { kind: 'visitors', label: 'New visitors' },
  { kind: 'serving', label: 'Serving' },
  { kind: 'songs', label: 'Songs' },
  { kind: 'scripture', label: 'Scripture' },
  { kind: 'membership', label: 'Membership' },
  { kind: 'spaces' as ReportKind, label: 'Spaces' },
];

type Preset = '3m' | '6m' | '12m' | 'ytd' | 'last' | 'custom';

const monthsAgo = (d: string, n: number) => {
  const dt = new Date(d + 'T00:00:00');
  dt.setMonth(dt.getMonth() - n);
  dt.setDate(dt.getDate() + 1);
  return dt.toISOString().slice(0, 10);
};

function presetRange(p: Preset): [string, string] {
  const t = today();
  const y = Number(t.slice(0, 4));
  if (p === '3m') return [monthsAgo(t, 3), t];
  if (p === '6m') return [monthsAgo(t, 6), t];
  if (p === 'ytd') return [`${y}-01-01`, t];
  if (p === 'last') return [`${y - 1}-01-01`, `${y - 1}-12-31`];
  return [monthsAgo(t, 12), t];
}

export default function Reports() {
  const { t, lang } = useI18n();
  const { canEdit, can, settings } = useSession();
  const [params, setParams] = useSearchParams();
  const tabs = TABS.filter((x) => (!x.money || can('contributions', 'read')) && (x.kind !== 'serving' || settings?.modules?.volunteers !== false));
  const kind = (tabs.find((x) => x.kind === params.get('tab'))?.kind ?? 'attendance') as ReportKind;
  const [preset, setPreset] = useState<Preset>('12m');
  const [custom, setCustom] = useState<[string, string]>(() => presetRange('12m'));
  const archived = useApi<{ years: number[] }>('/reports/archived-years');
  const [from, to] = preset === 'custom' ? custom : presetRange(preset);
  const [cong, setCong, congs] = useCongregationFilter('reports');
  // services (the default) or meetings, optionally of one group; serving and membership are about services and people
  const [of, setOf] = useState<'service' | 'meeting'>('service');
  const [group, setGroup] = useState<number | null>(null);
  const groups = useApi<GroupRow[]>('/groups');
  const byKind = kind !== 'serving' && kind !== 'membership' && (kind as string) !== 'spaces';
  const q = qs({ from, to, congregation: cong, ...(byKind && of === 'meeting' ? { kind: 'meeting', group } : {}) });
  const ctx: Ctx = { q, from, to, cong, congs };
  // years in archive files that this period touches: reports read the live records only
  const archivedIn = (archived.data?.years ?? []).filter((y) => String(y) >= from.slice(0, 4) && String(y) <= to.slice(0, 4));

  return (
    <div className="page rep-page">
      <PageHead eyebrow={t('Records')} title={t('Reports')} sub={t('Trends and summaries over a period, to print or export to Excel.')}>
        <CongregationFilter value={cong} onChange={setCong} list={congs} />
        {byKind && settings?.modules?.meetings !== false && <Seg value={of} onChange={setOf} options={[{ value: 'service', label: t('Services') }, { value: 'meeting', label: t('Meetings') }]} />}
        {byKind && of === 'meeting' && (
          <select value={group ?? ''} onChange={(e) => setGroup(Number(e.target.value) || null)} aria-label={t('Group')} style={{ maxWidth: 220 }}>
            <option value="">{t('All groups')}</option>
            {meetingGroups(groups.data).map((g) => <option key={g.id} value={g.id}>{g.name[lang] || g.name.en || g.name.zh}</option>)}
          </select>
        )}
      </PageHead>
      <div className="rep-bar-top no-print">
        <Seg<ReportKind> value={kind} onChange={(k) => setParams({ tab: k }, { replace: true })} options={tabs.map((x) => ({ value: x.kind, label: t(x.label) }))} />
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)} aria-label={t('Period')}>
            <option value="3m">{t('Last 3 months')}</option>
            <option value="6m">{t('Last 6 months')}</option>
            <option value="12m">{t('Last 12 months')}</option>
            <option value="ytd">{t('This year')}</option>
            <option value="last">{t('Last year')}</option>
            <option value="custom">{t('Choose dates…')}</option>
          </select>
          {preset === 'custom' && (
            <>
              <input type="date" value={custom[0]} max={custom[1]} onChange={(e) => e.target.value && setCustom([e.target.value, custom[1]])} aria-label={t('From')} />
              <span className="muted">–</span>
              <input type="date" value={custom[1]} min={custom[0]} onChange={(e) => e.target.value && setCustom([custom[0], e.target.value])} aria-label={t('To')} />
            </>
          )}
          <button className="btn" onClick={() => window.print()}><Icon name="print" />{t('Print')}</button>
        </div>
      </div>
      <p className="rep-period">{fmtDate(from, lang)} – {fmtDate(to, lang)}</p>
      {archivedIn.length > 0 && (
        <div className="callout small no-print">
          {t('Records from {years} are in archive files and are not included here. Administrators can open them under Settings → Security & privacy.').replace('{years}', archivedIn.join(', '))}
        </div>
      )}
      {kind === 'attendance' && <AttendanceTab {...ctx} />}
      {kind === 'offerings' && canEdit && <OfferingsTab {...ctx} />}
      {kind === 'visitors' && <VisitorsTab {...ctx} />}
      {kind === 'serving' && <ServingTab {...ctx} />}
      {kind === 'songs' && <SongsTab {...ctx} />}
      {kind === 'scripture' && <ScriptureTab {...ctx} />}
      {kind === 'membership' && <MembershipTab {...ctx} />}
      {(kind as string) === 'spaces' && <SpacesReport from={from} to={to} />}
    </div>
  );
}
