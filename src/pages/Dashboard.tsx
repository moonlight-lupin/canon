import { Link } from 'react-router-dom';
import { hasAnyText } from '../../shared/labels.ts';
import { useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Bi, ErrorBox, Loading, PageHead, fmtDate, useSession } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import { SeasonChip } from '../components/brand.tsx';
import type { RosterWarning, ServiceListRow } from '../types-client.ts';

interface Dash {
  upcoming: (ServiceListRow & { warnings: RosterWarning[] })[];
  members: { status: string; n: number }[];
  birthdays: { in_days: number; date: string; name: string; person_id: number }[];
  coworkers: number;
  library: { songs: number; texts: number; verses: number; bibles?: string[] };
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
  const greeting = lang === 'zh' ? `平安，${user.display_name}` : `Grace and peace, ${user.display_name}`;

  return (
    <div className="page">
      <PageHead eyebrow={fmtDate(new Date().toISOString().slice(0, 10), lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} title={greeting}>
        {canEdit && <Link className="btn primary" to="/services?new"><Icon name="plus" />{t('New service')}</Link>}
      </PageHead>

      <div className="grid cols-2">
        <div className="card">
          <div className="card-head">
            <h2><Icon name="calendar" width={18} height={18} />{lang === 'zh' ? '下一堂聚会' : 'Next service'}</h2>
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
            <div className="muted">{lang === 'zh' ? '未来八周没有安排聚会。' : 'No services planned in the next eight weeks.'} <Link to="/services?new">{t('New service')} →</Link></div>
          )}
        </div>

        <div className="card">
          <div className="card-head"><h2><Icon name="users" width={18} height={18} />{t('Members')}</h2><Link to="/members" className="small">{t('Open')} →</Link></div>
          <div className="grid cols-4" style={{ gap: 10 }}>
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
                      {issues > 0 && <span className="badge warn">{issues} ⚠</span>}{' '}
                      {unfilled > 0 ? <span className="badge">{unfilled} {lang === 'zh' ? '岗位待排' : 'open roles'}</span> : <span className="badge ok">{lang === 'zh' ? '已排满' : 'Fully rostered'}</span>}
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
        <Link to="/library" className="card" style={{ color: 'inherit', textDecoration: 'none' }}>
          <div className="stat"><span className="n">{data.library.songs}</span><span className="l">{t('Hymns & songs')}</span></div>
        </Link>
        <Link to="/library" className="card" style={{ color: 'inherit', textDecoration: 'none' }}>
          <div className="stat"><span className="n">{data.library.texts}</span><span className="l">{t('Liturgical texts')}</span></div>
        </Link>
        <Link to="/library" className="card" style={{ color: 'inherit', textDecoration: 'none' }}>
          <div className="stat"><span className="n">{data.library.verses.toLocaleString()}</span><span className="l">{t('Bible')}{data.library.bibles?.length ? ` · ${data.library.bibles.join(' · ')}` : ''}</span></div>
        </Link>
      </div>
    </div>
  );
}
