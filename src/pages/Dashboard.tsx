import { Link } from 'react-router-dom';
import { HoverTip } from '../components/InfoTip.tsx';
import { hasAnyText } from '../../shared/labels.ts';
import { useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Bi, ErrorBox, Loading, PageHead, fmtDate, useSession } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import { SeasonChip } from '../components/brand.tsx';
import type { RosterWarning, ServiceListRow } from '../types-client.ts';
import { langInfo } from '../../shared/languages.ts';
import { greetingFor } from '../../shared/greeting.ts';

interface Dash {
  upcoming: (ServiceListRow & { warnings: RosterWarning[] })[];
  members: { status: string; n: number }[];
  birthdays: { in_days: number; date: string; name: string; person_id: number }[];
  coworkers: number;
  library: { songs: number; texts: number; bibles?: { code: string; lang: string; name: string }[] };
  /** the optional modules, when on and readable (null otherwise) */
  lending?: { on_loan: number; overdue: number; titles: number; to_check_in?: number } | null;
  equipment?: { items: number; maintenance_due: number } | null;
  bookkeeping?: { started: boolean; drafts: number; offering_drafts: number; to_match: number; claims?: { to_approve: number; to_pay: number } } | null;
}

export default function Dashboard() {
  const { t, lt, lang } = useI18n();
  const { user, canEdit, settings } = useSession();
  const seasons = settings?.season_colours !== false;
  const { data, error } = useApi<Dash>('/dashboard');
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!data) return <Loading />;
  const next = data.upcoming[0];
  const count = (s: string) => data.members.find((m) => m.status === s)?.n ?? 0;
  const bibleLangs = [...new Set((data.library.bibles ?? []).map((b) => b.lang))].map((l) => [l, (data.library.bibles ?? []).filter((b) => b.lang === l)] as const);
  // follows the time of day and the church year, a different one each day (shared/greeting.ts)
  const greeting = `${t(greetingFor(new Date()))}${lang === 'en' ? ', ' : '，'}${user.display_name}`;

  return (
    <div className="page">
      <PageHead eyebrow={fmtDate(new Date().toISOString().slice(0, 10), lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} title={greeting}>
        {canEdit && <Link className="btn primary" to="/services?new"><Icon name="plus" />{t('New service')}</Link>}
      </PageHead>

      <div className="grid cols-2">
        <div className="card">
          <div className="card-head">
            <h2><Icon name="calendar" width={18} height={18} />{t('Next service')}</h2>
            {next && <span className={`badge ${next.status === 'final' ? 'ok' : ''}`}>{t(next.status === 'final' ? 'Final' : 'Draft')}</span>}
          </div>
          {next ? (
            <div className="stack">
              <div>
                <div className="eyebrow">{fmtDate(next.date, lang, { weekday: 'long', day: 'numeric', month: 'long' })} · {next.start_time}{seasons && <SeasonChip date={next.date} season={next.season} />}</div>
                <h2 style={{ fontSize: 22 }}><Bi v={next.title} /></h2>
                {hasAnyText(next.sermon_title) && <div className="serif muted">“{lt(next.sermon_title)}”{next.sermon_ref ? ` · ${next.sermon_ref}` : ''}{next.preacher ? ` — ${next.preacher}` : ''}</div>}
              </div>
              {next.warnings.filter((w) => w.type !== 'unfilled').length > 0 && (
                <div className="callout warn small">{next.warnings.filter((w) => w.type !== 'unfilled').map((w) => w.message).join(' · ')}</div>
              )}
              {next.warnings.some((w) => w.type === 'unfilled') && (
                <div className="small muted">{t('Unassigned')}: {next.warnings.filter((w) => w.type === 'unfilled').map((w) => w.message).join(', ')}</div>
              )}
              <div className="row">
                <Link className="btn" to={`/services/${next.id}`}><Icon name="edit" />{t('Order of worship')}</Link>
                <Link className="btn" to={`/services/${next.id}/bulletin`}><Icon name="print" />{t('Bulletin')}</Link>
                <Link className="btn" to={`/services/${next.id}/slides`} target="_blank"><Icon name="monitor" />{t('Slides')}</Link>
              </div>
            </div>
          ) : (
            <div className="muted">{t('No services planned in the next eight weeks.')}</div>
          )}
        </div>

        <div className="card">
          <div className="card-head"><h2><Icon name="users" width={18} height={18} />{t('Members')}</h2><Link to="/members" className="small">{t('Open')} →</Link></div>
          <div className="grid cols-4 stats" style={{ gap: 10 }}>
            <div className="stat"><span className="n">{count('member')}</span><span className="l">{t('Member')}</span></div>
            <div className="stat"><span className="n">{count('regular')}</span><span className="l">{t('Regular')}</span></div>
            <div className="stat"><span className="n">{count('visitor')}</span><span className="l">{t('Visitor')}</span></div>
            <div className="stat"><span className="n">{data.coworkers}</span><span className="l">{t('Co-workers')}</span></div>
          </div>
          <hr />
          <h3 style={{ marginBottom: 8 }}><Icon name="cake" width={15} height={15} style={{ verticalAlign: -2, marginRight: 6 }} />{t('Upcoming birthdays')}</h3>
          {data.birthdays.length ? (
            <div className="stack tight">
              {data.birthdays.slice(0, 6).map((b) => (
                <div key={b.person_id} className="row between small">
                  <span>{b.name}</span>
                  <span className="muted">{b.in_days === 0 ? t('Today') : fmtDate(b.date, lang, { day: 'numeric', month: 'short' })}</span>
                </div>
              ))}
            </div>
          ) : <div className="muted small">—</div>}
        </div>
      </div>

      <div className="card flush mt">
        <div className="card-head" style={{ padding: '14px 18px 0' }}>
          <h2>{t('Upcoming')}</h2>
          <Link to="/volunteers" className="small">{t('Volunteer rota')} →</Link>
        </div>
        <div className="table-wrap">
          <table className="t">
            <tbody>
              {data.upcoming.map((s) => {
                const unfilled = s.warnings.filter((w) => w.type === 'unfilled').length;
                const issues = s.warnings.length - unfilled;
                return (
                  <tr key={s.id}>
                    <td className="nowrap">{seasons && <SeasonChip dotOnly date={s.date} season={s.season} className="svc-season" />}<Link to={`/services/${s.id}`}><strong>{fmtDate(s.date, lang)}</strong></Link></td>
                    <td><Bi v={s.title} /></td>
                    <td className="muted">{s.preacher}</td>
                    <td className="right nowrap">
                      {/* hover, or tap on a phone, to read what the warnings are */}
                      {issues > 0 && (
                        <HoverTip tap content={<WarningList items={s.warnings.filter((w) => w.type !== 'unfilled').map((w) => w.message)} />}>
                          <button type="button" className="badge warn badge-btn" aria-label={t('Rota warnings')}>{issues} ⚠</button>
                        </HoverTip>
                      )}{' '}
                      {unfilled > 0 ? (
                        <HoverTip tap content={<WarningList title={t('Unassigned')} items={s.warnings.filter((w) => w.type === 'unfilled').map((w) => w.message)} />}>
                          <button type="button" className="badge badge-btn">{t('{n} open roles').replace('{n}', String(unfilled))}</button>
                        </HoverTip>
                      ) : <span className="badge ok">{t('Fully rostered')}</span>}
                    </td>
                  </tr>
                );
              })}
              {!data.upcoming.length && <tr><td className="muted">—</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid cols-3 mt">
        <Link to="/library?tab=songs" className="card" style={{ color: 'inherit', textDecoration: 'none' }}>
          <div className="stat"><span className="n">{data.library.songs}</span><span className="l">{t('Hymns & songs')}</span></div>
        </Link>
        <Link to="/library?tab=texts" className="card" style={{ color: 'inherit', textDecoration: 'none' }}>
          <div className="stat"><span className="n">{data.library.texts}</span><span className="l">{t('Liturgical texts')}</span></div>
        </Link>
        <Link to="/library?tab=bible" className="card" style={{ color: 'inherit', textDecoration: 'none' }}>
          {/* the versions the church has, by language */}
          <div className="stat">
            <span className="l" style={{ fontWeight: 600, color: 'var(--ink)' }}>{t('Bible')}</span>
            {bibleLangs.length ? bibleLangs.map(([l, vs]) => (
              <span key={l} className="dash-bible">
                <span className="muted">{langInfo(l).native}</span> {vs.map((v) => <span key={v.code} className="badge" title={v.name}>{v.code}</span>)}
              </span>
            )) : <span className="muted small">{t('No Bible installed yet')}</span>}
          </div>
        </Link>
      </div>
      {(data.lending || data.equipment || data.bookkeeping) && (
        <div className="grid cols-3 mt">
          {data.lending && (
            <Link to={data.lending.overdue ? '/lending?tab=loans' : '/lending'} className="card" style={{ color: 'inherit', textDecoration: 'none' }}>
              <div className="stat">
                <span className="n">{data.lending.on_loan}</span>
                <span className="l">{t('Lending library: on loan')}</span>
                {data.lending.overdue > 0 && <span className="badge warn" style={{ alignSelf: 'flex-start' }}>{t('{n} overdue').replace('{n}', String(data.lending.overdue))}</span>}
                {!!data.lending.to_check_in && <span className="badge lapis" style={{ alignSelf: 'flex-start' }}>{t('To check in: {n}').replace('{n}', String(data.lending.to_check_in))}</span>}
              </div>
            </Link>
          )}
          {data.equipment && (
            <Link to="/equipment" className="card" style={{ color: 'inherit', textDecoration: 'none' }}>
              <div className="stat">
                <span className="n">{data.equipment.items}</span>
                <span className="l">{t('Asset register: items')}</span>
                {data.equipment.maintenance_due > 0 && <span className="badge warn" style={{ alignSelf: 'flex-start' }}>{t('Maintenance due: {n}').replace('{n}', String(data.equipment.maintenance_due))}</span>}
              </div>
            </Link>
          )}
          {data.bookkeeping && (
            <Link to={data.bookkeeping.drafts ? '/bookkeeping?tab=journals&status=draft' : '/bookkeeping'} className="card" style={{ color: 'inherit', textDecoration: 'none' }}>
              <div className="stat">
                <span className="n">{data.bookkeeping.started ? data.bookkeeping.drafts : '—'}</span>
                <span className="l">{data.bookkeeping.started ? t('Book-keeping: drafts to post') : t('Book-keeping: not started yet')}</span>
                {data.bookkeeping.offering_drafts > 0 && <span className="badge lapis" style={{ alignSelf: 'flex-start' }}>{t('Offerings: {n}').replace('{n}', String(data.bookkeeping.offering_drafts))}</span>}
                {data.bookkeeping.to_match > 0 && <span className="badge warn" style={{ alignSelf: 'flex-start' }}>{t('Bank lines to match: {n}').replace('{n}', String(data.bookkeeping.to_match))}</span>}
                {!!data.bookkeeping.claims?.to_approve && <span className="badge warn" style={{ alignSelf: 'flex-start' }}>{t('Claims waiting for approval: {n}').replace('{n}', String(data.bookkeeping.claims.to_approve))}</span>}
                {!!data.bookkeeping.claims?.to_pay && <span className="badge lapis" style={{ alignSelf: 'flex-start' }}>{t('Claims to pay: {n}').replace('{n}', String(data.bookkeeping.claims.to_pay))}</span>}
              </div>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/** The warnings behind a ⚠ badge, one per line (shown on hover, or on a tap on a phone). */
function WarningList({ items, title }: { items: string[]; title?: string }) {
  return (
    <div className="warning-list">
      {title && <div className="hover-tip-head">{title}</div>}
      <ul>{items.map((m, i) => <li key={i}>{m}</li>)}</ul>
    </div>
  );
}
