// Reports: attendance, songs sung and the Scripture heatmap.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { qs, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Bi, Empty, ErrorBox, Loading, fmtDate } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import { InfoTip } from '../../components/InfoTip.tsx';
import { CONG_LABEL, CongregationBadge } from '../../components/Congregations.tsx';
import type { AttendanceReport, ScriptureReport, SongsReport } from '../../../shared/reports.ts';
import { Bars, both, type Ctx, download, LineChart, pct, Section, Stat, useReport } from './charts.tsx';
import '../records.css';
import '../reports.css';

export function AttendanceTab({ q, congs }: Ctx) {
  const { t, lt, lang } = useI18n();
  const { data: r, error } = useReport<AttendanceReport>('attendance', q);
  if (error) return <ErrorBox error={error} />;
  if (!r) return <Loading />;
  const s = r.summary;
  const change = s.average != null && r.previous.average ? Math.round(((s.average - r.previous.average) / r.previous.average) * 100) : null;
  const recorded = r.rows.filter((x) => x.recorded);
  return (
    <>
      <div className="rep-stats">
        <Stat label={t('Average attendance')} value={s.average != null ? Math.round(s.average) : null} sub={t('{n} of {m} services recorded').replace('{n}', String(s.recorded)).replace('{m}', String(s.services))} />
        <Stat label={t('Same period last year')} value={r.previous.average != null ? Math.round(r.previous.average) : null}
          sub={change != null ? <span className={change >= 0 ? 'ok-text' : 'warn-text'}>{change >= 0 ? '+' : ''}{change}%</span> : t('No records')} />
        <Stat label={t('Highest')} value={s.highest?.value} sub={s.highest ? fmtDate(s.highest.date, lang) : ''} />
        <Stat label={t('of whom children')} value={s.children_average != null ? Math.round(s.children_average) : null} sub={t('on average')} />
        <Stat label={t('Online')} value={s.online_average != null ? Math.round(s.online_average) : null} sub={t('on average')} />
        <Stat label={t('New visitors')} value={s.visitors} />
      </div>
      {!recorded.length ? <div className="card"><Empty title={t('No attendance recorded in this period')}>{t('Attendance is entered on each service’s record (Records → Service records).')}</Empty></div> : (
        <>
          <Section title={t('Attendance per service')} tip={t('Each dot is a service; the dashed line is the average of the last four.')}>
            <LineChart label={t('Attendance per service')} points={recorded.map((x) => ({ x: x.date, y: x.attendance }))} />
          </Section>
          <div className="rep-grid">
            <Section title={t('By month')} csv={() => download(`attendance-months-${r.period.from}.csv`, [['Month', 'Services', 'Average attendance', 'New visitors'], ...r.months.map((m) => [m.month, m.services, m.average, m.visitors])])}>
              <table className="t">
                <thead><tr><th>{t('Month')}</th><th className="right">{t('Services')}</th><th className="right">{t('Average')}</th><th className="right">{t('New visitors')}</th></tr></thead>
                <tbody>{r.months.map((m) => <tr key={m.month}><td>{m.month}</td><td className="right">{m.services}</td><td className="right">{m.average != null ? Math.round(m.average) : '—'}</td><td className="right">{m.visitors || ''}</td></tr>)}</tbody>
              </table>
            </Section>
            {r.congregations.length > 1 && (
              <Section title={lt(CONG_LABEL)}>
                <Bars items={r.congregations.map((c) => ({ key: String(c.congregation_id), label: congs.find((x) => x.id === c.congregation_id) ? lt(congs.find((x) => x.id === c.congregation_id)!.name) : t('Not set'), value: Math.round(c.average ?? 0), note: `(${c.recorded})` }))} />
              </Section>
            )}
          </div>
          <Section title={t('Services')} csv={() => download(`attendance-${r.period.from}-${r.period.to}.csv`, [['Date', 'Time', 'Service', 'Attendance', 'Children', 'Online', 'New visitors'], ...r.rows.map((x) => [x.date, x.start_time, both(x.title), x.attendance, x.children, x.online, x.visitors])])}>
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>{t('Date')}</th><th>{t('Service')}</th><th className="right">{t('Attendance')}</th><th className="right">{t('of whom children')}</th><th className="right">{t('Online')}</th><th className="right">{t('New visitors')}</th></tr></thead>
                <tbody>
                  {[...r.rows].reverse().map((x) => (
                    <tr key={x.service_id}>
                      <td className="nowrap"><Link to={`/records/${x.service_id}`}>{fmtDate(x.date, lang)}</Link></td>
                      <td><CongregationBadge id={x.congregation_id} list={congs} /> <Bi v={x.title} /></td>
                      <td className="right">{x.attendance ?? <span className="muted">—</span>}</td><td className="right">{x.children ?? ''}</td><td className="right">{x.online ?? ''}</td><td className="right">{x.visitors || ''}</td>
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

// ================================================================= offerings

export function SongsTab({ q }: Ctx) {
  const { t, lang } = useI18n();
  const { data: r, error } = useReport<SongsReport>('songs', q);
  const [showUnused, setShowUnused] = useState(false);
  if (error) return <ErrorBox error={error} />;
  if (!r) return <Loading />;
  const licensed = r.songs.filter((s) => !s.public_domain);
  return (
    <>
      <div className="rep-stats">
        <Stat label={t('Services')} value={r.services} />
        <Stat label={t('Songs sung')} value={r.songs.length} sub={t('{n} times in all').replace('{n}', String(r.songs.reduce((s, x) => s + x.times, 0)))} />
        <Stat label={t('Under copyright')} value={licensed.length} tip={t('Songs not marked public domain in the library: report their use to your licence (e.g. CCLI).')} />
        <Stat label={t('Not sung in this period')} value={r.unused.length} />
      </div>
      <Section title={t('Songs sung')} csv={() => download(`songs-${r.period.from}-${r.period.to}.csv`, [['Song', 'Times', 'First', 'Last', 'Public domain', 'Copyright', 'CCLI song number'], ...r.songs.map((s) => [both(s.title), s.times, s.first_used, s.last_used, s.public_domain ? 'yes' : 'no', s.copyright, s.ccli])])}>
        {!r.songs.length ? <div className="small muted">{t('No songs in the services of this period.')}</div> : (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>{t('Song')}</th><th className="right">{t('Times')}</th><th>{t('Last sung')}</th><th>{t('Copyright')}</th></tr></thead>
              <tbody>{r.songs.map((s) => <tr key={s.song_id}><td><Bi v={s.title} /></td><td className="right">{s.times}</td><td className="nowrap">{fmtDate(s.last_used, lang)}</td><td className="small">{s.public_domain ? <span className="muted">{t('Public domain')}</span> : <>{s.copyright}{s.ccli ? ` · CCLI ${s.ccli}` : ''}</>}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </Section>
      <Section title={t('Not sung in this period')} csv={() => download(`songs-not-sung-${r.period.to}.csv`, [['Song', 'Category', 'Last sung'], ...r.unused.map((s) => [both(s.title), s.category, s.last_used])])}>
        <button className="btn sm ghost no-print" onClick={() => setShowUnused(!showUnused)}><Icon name={showUnused ? 'chevronDown' : 'chevronRight'} />{t('{n} songs').replace('{n}', String(r.unused.length))}</button>
        {showUnused && (
          <table className="t">
            <thead><tr><th>{t('Song')}</th><th>{t('Last sung')}</th></tr></thead>
            <tbody>{r.unused.map((s) => <tr key={s.song_id}><td><Bi v={s.title} /></td><td>{s.last_used ? fmtDate(s.last_used, lang) : <span className="muted">{t('Never')}</span>}</td></tr>)}</tbody>
          </table>
        )}
      </Section>
    </>
  );
}

// ================================================================= Scripture: every book and chapter

export function ScriptureTab({ q, cong }: Ctx) {
  const { t, lang } = useI18n();
  const [years, setYears] = useState<number[]>([]);
  const [onlyCovered, setOnlyCovered] = useState(false);
  const [pick, setPick] = useState<{ book: number; ch: number } | null>(null);
  const url = years.length ? `/reports/scripture${qs({ years: years.join(','), congregation: cong })}` : `/reports/scripture${q}`;
  const { data: r, error } = useApi<ScriptureReport>(url);
  if (error) return <ErrorBox error={error} />;
  if (!r) return <Loading />;
  const tot = r.totals;
  const name = (b: ScriptureReport['books'][number]) => (lang === 'en' ? b.en : lang === 'zh-Hant' ? b.zhT : b.zh);
  const toggleYear = (y: number) => {
    setPick(null);
    setYears((ys) => (ys.includes(y) ? ys.filter((x) => x !== y) : [...ys, y].sort((a, b) => a - b)));
  };
  const picked = pick ? r.passages.filter((x) => x.chapters.some((c) => c.book === pick.book && c.chapters.includes(pick.ch))) : [];
  const unread = r.passages.filter((x) => !x.chapters.length);
  const groups: [string, number, number][] = [[t('Old Testament'), 0, 39], [t('New Testament'), 39, 66]];
  return (
    <>
      <div className="card rep-years no-print">
        <span className="small muted">{t('Years')} <InfoTip text={t('Choose one or more years (they need not follow each other) instead of the period above. Choose none to use the period.')} /></span>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {r.years_available.map((y) => (
            <button key={y} className={`year-chip${years.includes(y) ? ' on' : ''}`} aria-pressed={years.includes(y)} onClick={() => toggleYear(y)}>{y}</button>
          ))}
          {years.length > 0 && <button className="btn sm ghost" onClick={() => { setYears([]); setPick(null); }}>{t('Use the period')}</button>}
        </div>
        <label className="switch small"><input type="checkbox" checked={onlyCovered} onChange={(e) => setOnlyCovered(e.target.checked)} />{t('Only books with readings or sermons')}</label>
      </div>
      {years.length > 0 && <p className="rep-period">{t('Years')}: {years.join(', ')}</p>}
      <div className="rep-stats">
        <Stat label={t('Chapters read or preached')} value={`${tot.covered} / ${tot.chapters}`} sub={pct(tot.covered, tot.chapters)} />
        <Stat label={t('Read')} value={tot.read} sub={t('chapters')} />
        <Stat label={t('Preached')} value={tot.preached} sub={t('chapters')} />
        <Stat label={t('Old Testament')} value={pct(tot.ot_covered, 929) || '0%'} sub={`${tot.ot_covered} / 929`} />
        <Stat label={t('New Testament')} value={pct(tot.nt_covered, 260) || '0%'} sub={`${tot.nt_covered} / 260`} />
        <Stat label={t('Books')} value={`${tot.books_covered} / 66`} />
      </div>
      <Section title={t('Chapters read and preached')} tip={t('Readings are the Scripture items of each service; sermons are the sermon passage. A darker square was read or preached more often. Click a square to see when.')}
        csv={() => download(`scripture-chapters-${r.period.from}-${r.period.to}.csv`, [['Book', 'Chapter', 'Read', 'Preached'], ...r.books.flatMap((b) => b.read.map((n, i) => [b.en, i + 1, n, b.preached[i]]).filter((x) => x[2] || x[3]))])}>
        <div className="heat-legend small">
          <span><i className="heat-cell read l3" />{t('Read')}</span>
          <span><i className="heat-cell preached l3" />{t('Preached')}</span>
          <span><i className="heat-cell both l3" />{t('Read and preached')}</span>
          <span><i className="heat-cell" />{t('Not yet')}</span>
        </div>
        {groups.map(([label, a, b]) => {
          const list = r.books.slice(a, b).filter((bk) => !onlyCovered || bk.read.some(Boolean) || bk.preached.some(Boolean));
          if (!list.length) return null;
          return (
            <div key={label} className="heat-group">
              <h4>{label}</h4>
              {list.map((bk) => (
                <div key={bk.book} className="heat-row">
                  <div className="heat-book">{name(bk)}</div>
                  <div className="heat-cells">
                    {bk.read.map((rd, i) => {
                      const pr = bk.preached[i];
                      const kind = rd && pr ? 'both' : rd ? 'read' : pr ? 'preached' : '';
                      const n = rd + pr;
                      const on = pick?.book === bk.book && pick.ch === i + 1;
                      return (
                        <button key={i} className={`heat-cell ${kind} l${Math.min(3, n)}${on ? ' sel' : ''}`}
                          title={`${name(bk)} ${i + 1}${rd ? ` · ${t('Read')} ${rd}×` : ''}${pr ? ` · ${t('Preached')} ${pr}×` : ''}`}
                          aria-label={`${name(bk)} ${i + 1}`} onClick={() => setPick(on ? null : { book: bk.book, ch: i + 1 })} />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </Section>
      {pick && (
        <Section title={`${name(r.books[pick.book - 1])} ${pick.ch}`}>
          {!picked.length ? <div className="small muted">{t('Not read or preached in this period.')}</div> : (
            <table className="t">
              <tbody>{picked.map((x, i) => <tr key={i}><td className="nowrap"><Link to={`/services/${x.service_id}`}>{fmtDate(x.date, lang)}</Link></td><td><span className={`badge ${x.kind === 'sermon' ? 'reed' : 'lapis'}`}>{t(x.kind === 'sermon' ? 'Sermon' : 'Reading')}</span></td><td>{x.ref}</td></tr>)}</tbody>
            </table>
          )}
        </Section>
      )}
      <Section title={t('Readings and sermons')} csv={() => download(`scripture-${r.period.from}-${r.period.to}.csv`, [['Date', 'Kind', 'Passage'], ...r.passages.map((p) => [p.date, p.kind, p.ref])])}>
        {!r.passages.length ? <div className="small muted">{t('No readings or sermon passages in this period.')}</div> : (
          <details>
            <summary className="small">{t('{n} passages').replace('{n}', String(r.passages.length))}{unread.length ? ` · ${t('{n} not recognised as Bible references').replace('{n}', String(unread.length))}` : ''}</summary>
            <table className="t">
              <tbody>{r.passages.map((x, i) => <tr key={i}><td className="nowrap">{fmtDate(x.date, lang)}</td><td>{t(x.kind === 'sermon' ? 'Sermon' : 'Reading')}</td><td>{x.ref}{!x.chapters.length && <span className="small warn-text"> · {t('not recognised')}</span>}</td></tr>)}</tbody>
            </table>
          </details>
        )}
      </Section>
    </>
  );
}

// ================================================================= membership
