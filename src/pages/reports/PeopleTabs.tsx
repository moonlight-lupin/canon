// Reports: new visitors' follow-up, serving load and membership.
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n.tsx';
import { Empty, ErrorBox, Loading, fmtDate } from '../../components/ui.tsx';
import { CONG_LABEL, CongregationBadge } from '../../components/Congregations.tsx';
import { VISITOR_STATUS_LABEL } from '../../../shared/records.ts';
import type { MembershipReport, ServingReport, VisitorsReport, VisitorStatus } from '../../../shared/reports.ts';
import { STATUS_LABEL } from '../people-common.tsx';
import type { MemberStatus } from '../../types-client.ts';
import { Bars, both, Columns, type Ctx, download, pct, Section, Stat, useReport } from './charts.tsx';
import '../records.css';
import '../reports.css';

export function VisitorsTab({ q, congs }: Ctx) {
  const { t, lang } = useI18n();
  const { data: r, error } = useReport<VisitorsReport>('visitors', q);
  if (error) return <ErrorBox error={error} />;
  if (!r) return <Loading />;
  const total = r.funnel.new;
  const hasContact = r.visitors.some((v) => 'contact' in v);
  return (
    <>
      <div className="rep-stats">
        <Stat label={t('New visitors')} value={total} tip={t('Counted as entries on service records: someone who came twice and was entered twice counts twice. Canon does not link visitors across services, so these are not numbers of different people.')} />
        <Stat label={t('Contacted')} value={r.funnel.contacted} sub={pct(r.funnel.contacted, total)} />
        <Stat label={t('Came back')} value={r.funnel.returning} sub={pct(r.funnel.returning, total)} />
        <Stat label={t('Joined the church')} value={r.funnel.joined} sub={pct(r.funnel.joined, total)} />
      </div>
      {!total ? <div className="card"><Empty title={t('No new visitors recorded in this period')} /></div> : (
        <>
          <div className="rep-grid">
            <Section title={t('Follow-up')} tip={t('Set each visitor’s follow-up on the service record: Contacted, Came back, Joined the church. A visitor who joined is counted in every step before it. Each step counts visitor entries on service records, not different people.')}>
              <Bars items={(['new', 'contacted', 'returning', 'joined'] as VisitorStatus[]).map((s) => ({ key: s, label: t(VISITOR_STATUS_LABEL[s]), value: r.funnel[s], note: pct(r.funnel[s], total) }))} />
            </Section>
            {(r.abouts?.length ?? 0) > 0 && (
              <Section title={t('Who they are')} tip={t('How visitors described themselves on the visitor form (counted; who said what stays on the service records).')}>
                <Bars items={r.abouts!.map((a) => ({ key: a.about, label: a.about, value: a.count }))} />
              </Section>
            )}
            <Section title={t('How they came')}>
              {r.sources.length ? <Bars items={r.sources.slice(0, 12).map((s) => ({ key: s.source, label: s.source, value: s.count }))} /> : <div className="small muted">{t('Not recorded.')}</div>}
            </Section>
          </div>
          <Section title={t('By month')}><Columns items={r.months.map((m) => ({ label: m.month, value: m.count }))} /></Section>
          <Section title={t('Visitors')} csv={() => download(`visitors-${r.period.from}-${r.period.to}.csv`, [['Date', 'Service', 'Name', ...(hasContact ? ['Contact'] : []), 'How they came', 'Follow-up by', 'Follow-up'], ...r.visitors.map((v) => [v.date, both(v.title), v.name, ...(hasContact ? [v.contact] : []), v.source, v.follow_up_by, VISITOR_STATUS_LABEL[v.status]])])}>
            {hasContact && <div className="small muted pdpa">{t('Visitors’ details are personal data: keep exports safe and delete them when done (PDPA).')}</div>}
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>{t('Date')}</th><th>{t('Name')}</th>{hasContact && <th>{t('Contact')}</th>}<th>{t('How they came')}</th><th>{t('Follow-up by')}</th><th>{t('Follow-up')}</th></tr></thead>
                <tbody>
                  {r.visitors.map((v, i) => (
                    <tr key={i}>
                      <td className="nowrap"><Link to={`/records/${v.service_id}`}>{fmtDate(v.date, lang)}</Link> <CongregationBadge id={v.congregation_id} list={congs} /></td>
                      <td>{v.name}</td>{hasContact && <td>{v.contact ?? ''}</td>}<td>{v.source ?? ''}</td><td>{v.follow_up_by ?? ''}</td>
                      <td><span className={`badge ${v.status === 'joined' ? 'ok' : v.status === 'new' ? '' : 'lapis'}`}>{t(VISITOR_STATUS_LABEL[v.status])}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </>
  );
}

// ================================================================= serving

export function ServingTab({ q }: Ctx) {
  const { t, lt, lang } = useI18n();
  const { data: r, error } = useReport<ServingReport>('serving', q);
  if (error) return <ErrorBox error={error} />;
  if (!r) return <Loading />;
  const hard = r.roles.filter((x) => x.services > 0 && (x.short > 0 || x.qualified < x.needed * 2));
  return (
    <>
      <div className="rep-stats">
        <Stat label={t('Services')} value={r.services} />
        <Stat label={t('People serving')} value={r.people.filter((p) => p.served).length} />
        <Stat label={t('Most often')} value={r.people[0]?.served ?? null} sub={r.people[0]?.name} />
        <Stat label={t('Team members not rostered')} value={r.idle.length} tip={t('Members of a serving team who were not on the rota in this period.')} />
      </div>
      {hard.length > 0 && (
        <Section title={t('Roles that are hard to fill')} tip={t('Roles that were short of people at some services, or have fewer than twice as many qualified people as each service needs.')}>
          <table className="t">
            <thead><tr><th>{t('Team')}</th><th>{t('Role')}</th><th className="right">{t('Needed')}</th><th className="right">{t('Short at')}</th><th className="right">{t('Declined')}</th><th className="right">{t('Qualified people')}</th></tr></thead>
            <tbody>{hard.map((x) => <tr key={x.role_id}><td>{lt(x.team)}</td><td>{lt(x.role)}</td><td className="right">{x.needed}</td><td className="right">{x.short ? <span className="warn-text">{t('{n} of {m} services').replace('{n}', String(x.short)).replace('{m}', String(x.services))}</span> : ''}</td><td className="right">{x.declined || ''}</td><td className="right">{x.qualified}</td></tr>)}</tbody>
          </table>
        </Section>
      )}
      <Section title={t('How often each person served')} csv={() => download(`serving-${r.period.from}-${r.period.to}.csv`, [['Name', 'Teams', 'Served', 'Confirmed', 'Declined', 'Last served'], ...r.people.map((p) => [p.name, p.teams.join('; '), p.served, p.confirmed, p.declined, p.last_served])])}>
        {!r.people.length ? <div className="small muted">{t('Nobody was on the rota in this period.')}</div> : (
          <Bars items={r.people.slice(0, 40).map((p) => ({ key: String(p.person_id), label: p.name, value: p.served, note: p.declined ? `(${t('declined')} ${p.declined})` : undefined }))} />
        )}
      </Section>
      {r.idle.length > 0 && (
        <Section title={t('Team members not rostered')} csv={() => download(`not-rostered-${r.period.to}.csv`, [['Name', 'Teams', 'Last served'], ...r.idle.map((p) => [p.name, p.teams.join('; '), p.last_served])])}>
          <table className="t">
            <thead><tr><th>{t('Name')}</th><th>{t('Teams')}</th><th>{t('Last served')}</th></tr></thead>
            <tbody>{r.idle.map((p) => <tr key={p.person_id}><td>{p.name}</td><td className="small">{p.teams.join(', ')}</td><td>{p.last_served ? fmtDate(p.last_served, lang) : <span className="muted">{t('Never')}</span>}</td></tr>)}</tbody>
          </table>
        </Section>
      )}
    </>
  );
}

// ================================================================= songs and Scripture

export function MembershipTab({ q, congs }: Ctx) {
  const { t, lt, lang } = useI18n();
  const { data: r, error } = useReport<MembershipReport>('membership', q);
  if (error) return <ErrorBox error={error} />;
  if (!r) return <Loading />;
  const n = (s: string) => r.by_status.find((x) => x.status === s)?.count ?? 0;
  const GENDER: Record<string, string> = { M: 'Male', F: 'Female', unknown: 'Not recorded' };
  return (
    <>
      <div className="rep-stats">
        <Stat label={t('Members')} value={n('member')} />
        <Stat label={t('Regulars')} value={n('regular')} />
        <Stat label={t('Joined in this period')} value={r.joined.length} tip={t('Membership date in this period.')} />
        <Stat label={t('Baptised in this period')} value={r.baptised.length} />
        <Stat label={t('Added to the register')} value={r.added} />
      </div>
      <div className="rep-grid">
        <Section title={t('By status')} csv={() => download('membership-status.csv', [['Status', 'People'], ...r.by_status.map((s) => [s.status, s.count])])}>
          <Bars items={r.by_status.map((s) => ({ key: s.status, label: t(STATUS_LABEL[s.status as MemberStatus] ?? s.status), value: s.count }))} />
        </Section>
        <Section title={t('By age')} tip={t('Members and regulars, by age at the end of the period.')} csv={() => download('membership-age.csv', [['Age', 'People'], ...r.age_bands.map((b) => [b.band, b.count])])}>
          <Bars items={r.age_bands.map((b) => ({ key: b.band, label: b.band === 'unknown' ? t('No birth date') : b.band, value: b.count }))} />
        </Section>
        <Section title={t('By gender')}>
          <Bars items={r.by_gender.map((g) => ({ key: g.gender, label: t(GENDER[g.gender] ?? g.gender), value: g.count }))} />
        </Section>
        {congs.length > 0 && (
          <Section title={lt(CONG_LABEL)}>
            <Bars items={r.by_congregation.map((c) => ({ key: String(c.congregation_id), label: congs.find((x) => x.id === c.congregation_id) ? lt(congs.find((x) => x.id === c.congregation_id)!.name) : t('Not set'), value: c.count }))} />
          </Section>
        )}
      </div>
      {(r.joined.length > 0 || r.baptised.length > 0) && (
        <div className="rep-grid">
          <Section title={t('Joined')}>
            <table className="t"><tbody>{r.joined.map((p) => <tr key={p.person_id}><td>{p.name}</td><td className="nowrap">{fmtDate(p.date, lang)}</td></tr>)}</tbody></table>
          </Section>
          <Section title={t('Baptised')}>
            <table className="t"><tbody>{r.baptised.map((p) => <tr key={p.person_id}><td>{p.name}</td><td className="nowrap">{fmtDate(p.date, lang)}</td></tr>)}</tbody></table>
          </Section>
        </div>
      )}
    </>
  );
}
