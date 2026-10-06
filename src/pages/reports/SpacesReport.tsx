// Reports → Spaces (0.15.4): how much each of the church's spaces is used in the period, the double bookings, and
// what is booked in the coming four weeks (whatever period is chosen), to plan ahead.
import { Link } from 'react-router-dom';
import { useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Bi, Empty, ErrorBox, Loading, fmtDate, today, useSession } from '../../components/ui.tsx';
import { bookingLink, type Booking } from '../../components/Spaces.tsx';
import type { L10n } from '../../types-client.ts';
import { Section, Stat } from './charts.tsx';
import '../reports.css';

interface Row { id: number; name: L10n; capacity: number | null; archived: boolean; bookings: number; services: number; meetings: number; events: number; hours: number }
interface Report { from: string; to: string; spaces: Row[]; clashes: { space_id: number; date: string; a: Booking; b: Booking }[]; upcoming: Booking[] }

const TYPE_LABEL: Record<Booking['type'], string> = { service: 'Service', meeting: 'Meeting', event: 'Event' };

export function SpacesReport({ from, to }: { from: string; to: string }) {
  const { t, lang, lt } = useI18n();
  const { isAdmin } = useSession();
  const period = useApi<Report>(`/spaces/report?from=${from}&to=${to}`);
  const start = today();
  const ahead = useApi<Report>(`/spaces/report?from=${start}&to=${new Date(Date.parse(`${start}T00:00:00Z`) + 27 * 86400_000).toISOString().slice(0, 10)}`);
  if (period.error) return <ErrorBox error={period.error} />;
  if (!period.data || !ahead.data) return <Loading />;
  const r = period.data;
  const nameOf = (id: number) => lt(r.spaces.find((s) => s.id === id)?.name ?? ahead.data!.spaces.find((s) => s.id === id)?.name ?? {});
  if (!r.spaces.length && !ahead.data.spaces.length) {
    return <div className="card"><Empty title={t('No spaces yet')}>{isAdmin ? <Link to="/settings?tab=spaces">{t('Add them in Settings → Spaces')}</Link> : t('An administrator adds them in Settings → Spaces.')}</Empty></div>;
  }
  const when = (b: Booking) => `${fmtDate(b.date, lang)}${b.end_date !== b.date ? ` – ${fmtDate(b.end_date, lang)}` : ''}${b.start_time ? ` · ${b.start_time}–${b.end_time}` : ` · ${t('all day')}`}`;
  const total = r.spaces.reduce((n, s) => n + s.bookings, 0);
  return (
    <>
      <div className="rep-stats">
        <Stat label={t('Bookings')} value={total} />
        <Stat label={t('Hours booked')} value={Math.round(r.spaces.reduce((n, s) => n + s.hours, 0))} />
        <Stat label={t('Double bookings')} value={r.clashes.length} tip={t('The same space booked by two services, meetings or events at overlapping times. A service lasts from its start time for the minutes of its order of service; a meeting or a service without items, an hour; an event without times, all day.')} />
        <Stat label={t('Coming 4 weeks')} value={ahead.data.upcoming.length} sub={ahead.data.clashes.length ? `${t('Double bookings')}: ${ahead.data.clashes.length}` : undefined} />
      </div>
      <div className="rep-grid">
        <Section title={t('Use per space')}>
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>{t('Space')}</th><th className="right">{t('Services')}</th><th className="right">{t('Meetings')}</th><th className="right">{t('Events')}</th><th className="right">{t('Hours')}</th></tr></thead>
              <tbody>
                {r.spaces.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{lt(s.name)}</strong>{s.capacity ? <span className="small muted"> · {s.capacity}</span> : null}</td>
                    <td className="right">{s.services}</td><td className="right">{s.meetings}</td><td className="right">{s.events}</td><td className="right">{s.hours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
        <Section title={t('Double bookings')}>
          {![...ahead.data.clashes, ...r.clashes].length ? <p className="muted small" style={{ margin: 0 }}>{t('None.')}</p> : (
            <ul className="stack tight" style={{ margin: 0, paddingLeft: 18 }}>
              {[...new Map([...ahead.data.clashes, ...r.clashes].map((c) => [`${c.a.type}${c.a.id}-${c.b.type}${c.b.id}`, c])).values()].map((c) => (
                <li key={`${c.a.type}${c.a.id}-${c.b.type}${c.b.id}`}>
                  <strong>{nameOf(c.space_id)}</strong>{c.date >= start && <span className="badge warn" style={{ marginLeft: 6 }}>{t('coming')}</span>}
                  <div className="small"><Link to={bookingLink(c.a)}><Bi v={c.a.title} /></Link> · {when(c.a)}</div>
                  <div className="small"><Link to={bookingLink(c.b)}><Bi v={c.b.title} /></Link> · {when(c.b)}</div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      <Section title={t('Booked in the coming 4 weeks')}>
        {!ahead.data.upcoming.length ? <p className="muted small" style={{ margin: 0 }}>{t('Nothing booked.')}</p> : (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>{t('When')}</th><th>{t('Space')}</th><th>{t('What')}</th><th /></tr></thead>
              <tbody>
                {ahead.data.upcoming.map((b) => (
                  <tr key={`${b.type}-${b.id}`}>
                    <td className="nowrap small">{when(b)}</td>
                    <td>{nameOf(b.space_id)}</td>
                    <td><Link to={bookingLink(b)}><Bi v={b.title} /></Link></td>
                    <td className="small muted">{t(TYPE_LABEL[b.type])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
