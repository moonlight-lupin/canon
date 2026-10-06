// Printable timed cue sheet for the service team: times, leaders, AV cues with slide numbers, notes, roster.
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../api.ts';
import { tr, useI18n } from '../i18n.tsx';
import { ErrorBox, Loading, Seg } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import type { L10n, Lang, RenderedItem, RenderedService } from '../types-client.ts';
import { Bi, LABEL, biText, formatDate, hasAny, itemSubtitles, langOptions, langsFor, modeFor, timeRange, type LangMode } from './content.tsx';
import { isChinese } from '../../shared/languages.ts';
import { postureL10n } from '../../shared/labels.ts';
import { buildSlides, slideNumbers, type ItemSlideNumbers } from './slideModel.ts';
import type { SlideTheme } from '../../shared/slide-theme.ts';
import './outputs.css';

type Orientation = 'portrait' | 'landscape';

/** The AV cue for an item in a label language (fixed phrases translated with tr()). */
function avCue(it: RenderedItem, n: number, l: Lang): string {
  if (!it.on_slides) return n ? tr('QR code / note slide', l) : '—';
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
  // slide counts follow the service's slide theme (its lines per slide)
  const { data: themes } = useApi<SlideTheme[]>('/slide-themes');
  const limits = themes?.find((x) => x.id === r?.slide_theme_id)?.vars;
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [labelSel, setLabelMode] = useState<LangMode | null>(null);
  const svcLangs: Lang[] = r?.languages.length ? r.languages : ['en'];
  const labelMode: LangMode = labelSel ?? initialLabelMode(lang, svcLangs);

  const labelLangs: Lang[] = labelMode === 'both' ? svcLangs : [labelMode];
  /** A fixed label in the chosen label language(s). */
  const L = (en: string) => labelLangs.map((l) => tr(en, l)).filter((v, i, a) => a.indexOf(v) === i).join(' ');
  const cueText = (it: RenderedItem, n: number) => labelLangs.map((l) => avCue(it, n, l)).filter((x, i, a) => x && a.indexOf(x) === i).join(' / ');

  // the deck as the slides window opens it (its usual languages, the service's slide theme): the same numbers as the
  // slide footer and "number + Enter"
  const deck = useMemo(() => (r ? buildSlides(r, langsFor(modeFor(r.languages), r.languages), limits) : []), [r, limits]);
  const numbers = useMemo(() => slideNumbers(deck), [deck]);
  const count = (n?: ItemSlideNumbers) => (n ? n.last - n.first + 1 : 0);
  const range = (n?: ItemSlideNumbers) => (!n ? '' : n.first === n.last ? String(n.first) : `${n.first}–${n.last}`);
  /** Where each stanza starts: "1 → 7", "2 → 10", "Refrain → 8, 11, 14"; only when an item has more than one part. */
  const partsText = (n?: ItemSlideNumbers): string[] => {
    if (!n || n.parts.length < 2 && !n.parts.some((p) => p.blocks)) return [];
    // the stanzas in order, then the refrain (every place it comes), then a QR code / note slide
    const rank = (p: ItemSlideNumbers['parts'][number]) => (p.blocks ? 2 : p.refrain ? 1 : 0);
    return [...n.parts].sort((a, b) => rank(a) - rank(b)).map((p) => {
      const label = p.blocks ? L('QR code / note') : [...new Set(labelLangs.map((l) => p.label[l]).filter(Boolean))].join(' ');
      return `${label} → ${p.at.join(', ')}`;
    });
  };

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
            {deck.length > 0 && <div><span className="rs-k">{L('Slides')}</span> {deck.length}</div>}
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
              <th className="c-slide">{L('Slide')}</th>
              <th className="c-av">{L('AV cue')}</th>
              <th className="c-notes">{L('Notes')}</th>
            </tr>
          </thead>
          <tbody>
            {r.items.map((it) =>
              it.kind === 'section' ? (
                <tr key={it.id} className="rs-section">
                  <td className="c-time">{it.start}</td>
                  <td colSpan={6}>
                    <Bi v={it.title} langs={langs} sep="  ·  " />
                    {it.notes && <span className="rs-secnote"> — {it.notes}</span>}
                    {numbers.get(it.id) && <span className="rs-secslide">{L('Slide')} {range(numbers.get(it.id))}</span>}
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
                  <td className="c-slide">{range(numbers.get(it.id))}</td>
                  <td className="c-av">
                    {cueText(it, count(numbers.get(it.id)))}
                    {partsText(numbers.get(it.id)).length > 0 && <div className="rs-parts">{partsText(numbers.get(it.id)).map((p) => <span key={p} className="rs-part">{p}</span>)}</div>}
                  </td>
                  <td className="c-notes">{it.notes}</td>
                </tr>
              ),
            )}
            <tr className="rs-end">
              <td className="c-time">{r.end_time}</td>
              <td colSpan={6}>{L('End')}</td>
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
        {deck.length > 0 && <p className="rs-slidenote">{L('Slide numbers count the title slide as 1 and follow the service as it is now: print again after changes.')}</p>}
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
