// Printable timed cue sheet for the service team: times, leaders, AV cues, notes, roster.
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../api.ts';
import { tr, useI18n } from '../i18n.tsx';
import { ErrorBox, Loading, Seg } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import type { L10n, Lang, RenderedItem, RenderedService } from '../types-client.ts';
import { Bi, LABEL, biText, formatDate, hasAny, itemSubtitles, langOptions, timeRange, type LangMode } from './content.tsx';
import { isChinese } from '../../shared/languages.ts';
import { postureL10n } from '../../shared/labels.ts';
import { buildSlides } from './slideModel.ts';
import './outputs.css';

type Orientation = 'portrait' | 'landscape';

/** The AV cue for an item in a label language (fixed phrases translated with tr()). */
function avCue(it: RenderedItem, n: number, l: Lang): string {
  if (!it.on_slides) return '—';
  const fill = (key: string, ref = '') => tr(key, l).replace('{n}', String(n)).replace('{ref}', ref);
  const one = n === 1;
  if (it.kind === 'section') return tr('Section slide', l);
  if (it.kind === 'sermon') return tr('Sermon title slide', l);
  if (it.kind === 'song') return it.song ? fill(one ? 'Lyrics: {n} slide' : 'Lyrics: {n} slides') : tr('Title slide (no song chosen)', l);
  if (it.kind === 'scripture') {
    const ref = it.scripture?.ref ?? {};
    if (!hasAny(ref)) return tr('Title slide (no reference)', l);
    return fill(one ? 'Reading: {ref} · {n} slide' : 'Reading: {ref} · {n} slides', biText(ref, [l]));
  }
  if (it.paras) return fill(one ? 'Text: {n} slide' : 'Text: {n} slides');
  return tr('Title slide', l);
}

/** Initial label language: the UI language if the service has it (or the same Chinese family), else the first. */
function initialLabelMode(ui: Lang, langs: Lang[]): LangMode {
  if (langs.includes(ui)) return ui;
  const sameFamily = langs.find((l) => isChinese(l) && isChinese(ui));
  return sameFamily ?? langs[0] ?? 'en';
}

export default function RunSheet() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const { data: r, error } = useApi<RenderedService>(`/services/${id}/render`);
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [labelSel, setLabelMode] = useState<LangMode | null>(null);
  const svcLangs: Lang[] = r?.languages.length ? r.languages : ['en'];
  const labelMode: LangMode = labelSel ?? initialLabelMode(lang, svcLangs);

  const labelLangs: Lang[] = labelMode === 'both' ? svcLangs : [labelMode];
  /** A fixed label in the chosen label language(s). */
  const L = (en: string) => labelLangs.map((l) => tr(en, l)).filter((v, i, a) => a.indexOf(v) === i).join(' ');
  const cueText = (it: RenderedItem, n: number) => labelLangs.map((l) => avCue(it, n, l)).filter((x, i, a) => x && a.indexOf(x) === i).join(' / ');

  const slideCounts = useMemo(() => {
    const m = new Map<number, number>();
    if (!r) return m;
    for (const s of buildSlides(r, r.languages)) if (s.itemId) m.set(s.itemId, (m.get(s.itemId) ?? 0) + 1);
    return m;
  }, [r]);

  const teams = useMemo(() => {
    const out: { team: L10n; rows: RenderedService['roster'] }[] = [];
    for (const row of r?.roster ?? []) {
      const k = biText(row.team, r!.languages);
      let g = out.find((x) => biText(x.team, r!.languages) === k);
      if (!g) out.push((g = { team: row.team, rows: [] }));
      g.rows.push(row);
    }
    return out;
  }, [r]);

  if (error) return <div className="out-page"><ErrorBox error={error} /></div>;
  if (!r) return <Loading />;

  const langs = svcLangs;
  const printCss = `@page { size: A4 ${orientation}; margin: 12mm; }
@media print { html, body, #root { height: auto !important; background: #fff !important; } }`;

  return (
    <div className="out rs-out">
      <style>{printCss}</style>
      <div className="out-bar no-print">
        <Link to={`/services/${id}`} className="btn ghost sm"><Icon name="chevronLeft" />{t('Back')}</Link>
        <div className="out-bar-title"><Bi v={r.title} langs={langs} /> <span className="muted">· {t('Run sheet')}</span></div>
        {langs.length > 1 && (
          <>
            <label className="out-ctl"><span>{t('Labels')}</span></label>
            <Seg<LangMode> value={labelMode} onChange={setLabelMode} options={langOptions(langs, t)} />
          </>
        )}
        <Seg<Orientation> value={orientation} onChange={setOrientation} options={[{ value: 'portrait', label: t('A4 portrait') }, { value: 'landscape', label: t('A4 landscape') }]} />
        <button className="btn primary sm" onClick={() => window.print()}><Icon name="print" />{t('Print')}</button>
      </div>

      <div className={`rs-sheet ${orientation}`}>
        <header className="rs-head">
          <div>
            <div className="rs-eyebrow">{L('Run sheet')} · <Bi v={r.church.name} langs={langs} sep=" · " /></div>
            <h1 className="rs-title"><Bi v={r.title} langs={langs} sep="  " /></h1>
            <div className="rs-date">{formatDate(r.date, langs)}</div>
          </div>
          <div className="rs-meta">
            <div className="rs-time">{timeRange(r)}</div>
            {r.preacher && <div><span className="rs-k">{L('Preacher')}</span> {r.preacher}</div>}
            {hasAny(r.sermon_title) && (
              <div><span className="rs-k">{L('Sermon')}</span> <Bi v={r.sermon_title} langs={langs} sep=" · " />{hasAny(r.sermon_ref) && <> ({biText(r.sermon_ref, langs.slice(0, 1))})</>}</div>
            )}
            {r.status !== 'final' && <div className="rs-draft">{L('Draft')}</div>}
          </div>
        </header>

        <table className="rs-table">
          <thead>
            <tr>
              <th className="c-time">{L('Time')}</th>
              <th className="c-dur">{L('min')}</th>
              <th className="c-item">{L('Item')}</th>
              <th className="c-who">{L('Leader / role')}</th>
              <th className="c-av">{L('AV cue')}</th>
              <th className="c-notes">{L('Notes')}</th>
            </tr>
          </thead>
          <tbody>
            {r.items.map((it) =>
              it.kind === 'section' ? (
                <tr key={it.id} className="rs-section">
                  <td className="c-time">{it.start}</td>
                  <td colSpan={5}>
                    <Bi v={it.title} langs={langs} sep="  ·  " />
                    {it.notes && <span className="rs-secnote"> — {it.notes}</span>}
                  </td>
                </tr>
              ) : (
                <tr key={it.id}>
                  <td className="c-time">{it.start}</td>
                  <td className="c-dur">{it.duration_min}</td>
                  <td className="c-item">
                    <div className="rs-ititle"><Bi v={it.title} langs={langs} /></div>
                    {itemSubtitles(it, r, langs).map((s, i) => (
                      <div key={i} className="rs-isub"><Bi v={s} langs={langs} sep="  ·  " /></div>
                    ))}
                    {it.posture && <span className="rs-flag rs-posture"><Bi v={postureL10n(it.posture, labelLangs)} langs={labelLangs} sep=" · " /></span>}
                    {!it.in_bulletin && <span className="rs-flag">{L('Not in bulletin')}</span>}
                  </td>
                  <td className="c-who">
                    {it.leader && <div className="rs-leader">{it.leader}</div>}
                    {it.role_name && <div className="rs-role"><Bi v={it.role_name} langs={labelLangs} /></div>}
                  </td>
                  <td className="c-av">{cueText(it, slideCounts.get(it.id) ?? 0)}</td>
                  <td className="c-notes">{it.notes}</td>
                </tr>
              ),
            )}
            <tr className="rs-end">
              <td className="c-time">{r.end_time}</td>
              <td colSpan={5}>{L('End')}</td>
            </tr>
          </tbody>
        </table>

        {teams.length > 0 && (
          <section className="rs-roster">
            <h2 className="rs-h2"><Bi v={LABEL.servingToday} langs={labelLangs} sep=" · " /></h2>
            <div className="rs-teams">
              {teams.map((g) => (
                <div key={biText(g.team, langs)} className="rs-team">
                  <div className="rs-team-name"><Bi v={g.team} langs={labelLangs} /></div>
                  {g.rows.map((row, i) => (
                    <div key={i} className="rs-team-row">
                      <span className="rs-role"><Bi v={row.role} langs={labelLangs} /></span>
                      <span>{row.people.join(', ')}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        )}
        {r.notes && (
          <section className="rs-roster">
            <h2 className="rs-h2">{L('Notes')}</h2>
            <p className="rs-svcnotes">{r.notes}</p>
          </section>
        )}
      </div>
    </div>
  );
}
