// The service planner: the service's details (date, title, preacher, languages, cover, templates…).
import { useState } from 'react';
import { useContentLangs, useI18n } from '../../i18n.tsx';
import { Field, L10nInput, useSession, L10nEditScope, L10nSwitcher } from '../../components/ui.tsx';
import { MAX_SERVICE_LANGS, langInfo } from '../../../shared/languages.ts';
import { SEASON_KEYS } from '../../components/brand.tsx';
import { SEASONS, seasonOf } from '../../../shared/season.ts';
import type { Lang, ServiceFull } from '../../types-client.ts';
import { BulletinTemplateField, SlideThemeField } from '../presentation-pickers.tsx';
import { InfoTip } from '../../components/InfoTip.tsx';
import { CongregationField } from '../../components/Congregations.tsx';
import { BibleSelect, useChurchBible } from '../../components/BibleTools.tsx';

export type CoverStyle = NonNullable<ServiceFull['cover']['style']>;

export const COVER_STYLES: CoverStyle[] = ['plain', 'cross', 'logo', 'verse'];

export const COVER_LABEL: Record<CoverStyle, string> = { plain: 'Plain', cross: 'Cross', logo: 'Church logo', verse: 'Verse of the week' };

export function DetailsCard({ svc, onSave, canEdit }: { svc: ServiceFull; onSave: (p: Partial<ServiceFull>) => Promise<void>; canEdit: boolean }) {
  const { t, lt } = useI18n();
  const { settings } = useSession();
  const churchLangs = [...new Set([...useContentLangs(), ...svc.languages])];
  const churchBible = useChurchBible();
  const [d, setD] = useState(svc);
  const set = <K extends keyof ServiceFull>(k: K, v: ServiceFull[K]) => setD((x) => ({ ...x, [k]: v }));
  const toggleLang = (l: Lang) => {
    const has = d.languages.includes(l);
    const next = churchLangs.filter((x) => (x === l ? !has : d.languages.includes(x)));
    if (next.length && next.length <= MAX_SERVICE_LANGS) set('languages', next);
  };
  return (
    <L10nEditScope>
    <div className="card" style={{ marginBottom: 16 }}>
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        <div className="form-grid">
          <Field label={t('Date')}><input type="date" value={d.date} onChange={(e) => set('date', e.target.value)} /></Field>
          <Field label={t('Start time')}><input type="time" value={d.start_time} onChange={(e) => set('start_time', e.target.value)} /></Field>
          <Field label={t('Preacher')}><input value={d.preacher ?? ''} onChange={(e) => set('preacher', e.target.value)} /></Field>
          <Field label={t('Sermon text')}><input value={d.sermon_ref ?? ''} placeholder="Isaiah 6:1-8" onChange={(e) => set('sermon_ref', e.target.value)} /></Field>
          <Field label={<>{t('Reference')} <InfoTip text={t('Your own short code for this service, e.g. EN-2026-12-25: letters, digits and - _ . without spaces. People and AI assistants can then name it.')} /></>}>
            <input value={d.ref ?? ''} maxLength={40} onChange={(e) => set('ref', e.target.value.replace(/\s+/g, '') || null)} />
          </Field>
          <Field label={t('Languages')}>
            <div className="row">
              {churchLangs.map((l) => (
                <label key={l} className="check"><input type="checkbox" checked={d.languages.includes(l)} onChange={() => toggleLang(l)} />{langInfo(l).native}</label>
              ))}
            </div>
          </Field>
          <Field label={t('Bible versions')} hint={t('For every reading in this service; a reading can choose its own.')}>
            <div className="bible-pick">
              {d.languages.map((l) => (
                <label key={l}>
                  {langInfo(l).short}
                  <BibleSelect lang={l} value={d.bibles?.[l] ?? ''} inheritLabel={`${t('Church default')} (${churchBible(l) ?? '—'})`}
                    onChange={(c) => set('bibles', { ...(d.bibles ?? {}), [l]: c })} />
                </label>
              ))}
            </div>
          </Field>
          <CongregationField value={d.congregation_id} onChange={(v) => set('congregation_id', v)} />
          <Field label={t('Liturgical season')}>
            <select value={d.season ?? ''} onChange={(e) => set('season', (e.target.value || null) as ServiceFull['season'])}>
              <option value="">{t('Auto')} — {lt(SEASONS[seasonOf(d.date || svc.date)].name)}</option>
              {SEASON_KEYS.map((k) => <option key={k} value={k}>{lt(SEASONS[k].name)}</option>)}
            </select>
          </Field>
          <Field label={t('Bulletin cover')}>
            <select value={d.cover?.style ?? ''} onChange={(e) => set('cover', { ...d.cover, style: (e.target.value || undefined) as CoverStyle | undefined })}>
              <option value="">{t('Church default')} — {t(COVER_LABEL[settings?.bulletin_cover ?? 'cross'])}</option>
              {COVER_STYLES.map((c) => <option key={c} value={c}>{t(COVER_LABEL[c])}</option>)}
            </select>
          </Field>
          {(d.cover?.style ?? settings?.bulletin_cover) === 'verse' && (
            <Field label={t('Cover verse')} hint={t('Printed in every language of the service.')}>
              <input value={d.cover?.verse_ref ?? ''} placeholder="Psalm 95:6" onChange={(e) => set('cover', { ...d.cover, verse_ref: e.target.value || undefined })} />
            </Field>
          )}
          <BulletinTemplateField value={d.bulletin_template_id ?? null} onChange={(v) => set('bulletin_template_id', v)} />
          <SlideThemeField value={d.slide_theme_id ?? null} onChange={(v) => set('slide_theme_id', v)} />
        </div>
        <div className="l10n-section-head"><span /><L10nSwitcher min={2} /></div>
        <Field label={t('Title')}><L10nInput value={d.title} onChange={(v) => set('title', v)} /></Field>
        <Field label={t('Sermon title')}><L10nInput value={d.sermon_title} onChange={(v) => set('sermon_title', v)} /></Field>
        <Field label={t('Theme')}><L10nInput value={d.theme} onChange={(v) => set('theme', v)} /></Field>
        <Field label={t('Notes')}><textarea rows={2} value={d.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
        <div className="row end">
          <button className="btn primary" onClick={() => onSave({
            date: d.date, start_time: d.start_time, preacher: d.preacher || null, sermon_ref: d.sermon_ref || null,
            languages: d.languages, title: d.title, sermon_title: d.sermon_title, theme: d.theme, notes: d.notes || null,
            season: d.season ?? null, cover: { style: d.cover?.style, verse_ref: d.cover?.verse_ref?.trim() || undefined },
            slide_theme_id: d.slide_theme_id ?? null, bulletin_template_id: d.bulletin_template_id ?? null, congregation_id: d.congregation_id ?? null, ref: d.ref || null,
            bibles: Object.fromEntries(Object.entries(d.bibles ?? {}).filter(([l, c]) => c && d.languages.includes(l))),
          })}>{t('Save')}</button>
        </div>
      </fieldset>
    </div>
    </L10nEditScope>
  );
}

// ------------------------------------------------------------------ item editor
