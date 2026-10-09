// Settings → Church: name, languages, paper, contact details and the public address.
import { useEffect, useState } from 'react';
import { api, useApi } from '../../api.ts';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n.tsx';
import { LogoField } from '../../components/LogoField.tsx';
import { ErrorBox, Field, L10nInput, Loading, Seg, useAction, useSession } from '../../components/ui.tsx';
import { CongregationsCard } from '../../components/Congregations.tsx';
import type { PaperSize, Settings as SettingsT } from '../../types-client.ts';
import '../people.css';

/** The time zones this browser knows (IANA names), for Settings → Church → Time zone. */
const ZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone');
  } catch {
    return ['Asia/Singapore', 'Asia/Kuala_Lumpur', 'Asia/Jakarta', 'Asia/Hong_Kong', 'Asia/Taipei', 'Australia/Sydney', 'Europe/London', 'America/New_York', 'UTC'];
  }
})();

export type Translation = { code: string; lang: string; name: string; license: string; verses: number };

export const COVER_LABEL: Record<SettingsT['bulletin_cover'], string> = { plain: 'Plain', cross: 'Cross', logo: 'Church logo', verse: 'Verse of the week' };

export const PAPERS: { value: PaperSize; label: string }[] = [
  { value: 'a4-booklet', label: 'A4 landscape, folded (A5 booklet)' },
  { value: 'a4', label: 'A4 portrait' },
  { value: 'a5', label: 'A5 single pages' },
  { value: 'letter-booklet', label: 'US Letter, folded (booklet)' },
  { value: 'letter', label: 'US Letter portrait' },
];

export function ChurchTab() {
  const { t } = useI18n();
  const { reloadSettings } = useSession();
  const settings = useApi<SettingsT>('/settings');
  const [d, setD] = useState<SettingsT | null>(null);
  const { run, busy } = useAction();
  useEffect(() => {
    if (settings.data) setD(settings.data);
  }, [settings.data]);

  if (settings.error) return <ErrorBox error={settings.error} />;
  if (!d) return <Loading />;
  const set = <K extends keyof SettingsT>(k: K, v: SettingsT[K]) => setD((x) => (x ? { ...x, [k]: v } : x));

  // Only this tab's fields: languages and Bibles are saved by the Languages tab.
  const save = async () => {
    const patch: Partial<SettingsT> = {
      church_name: d.church_name, church_address: d.church_address, church_contact: d.church_contact, ccli_license: d.ccli_license,
      default_start_time: d.default_start_time, time_zone: d.time_zone ?? '', bilingual_layout: d.bilingual_layout,
      season_colours: d.season_colours, bulletin_cover: d.bulletin_cover,
    };
    const ok = await run(() => api.patch<SettingsT>('/settings', patch), t('Saved.'));
    if (ok) {
      settings.setData(ok);
      reloadSettings();
    }
  };

  return (
    <div className="stack">
    <div className="card stack">
      <Field label={t('Church name')}><L10nInput value={d.church_name} onChange={(v) => set('church_name', v)} /></Field>
      <Field label={t('Church logo')}><LogoField /></Field>
      <div className="form-grid">
        <Field label={t('Address')} className="span-all"><input value={d.church_address} onChange={(e) => set('church_address', e.target.value)} /></Field>
        <Field label={t('Contact line')} hint={t('Printed on the bulletin, e.g. phone · email · website')} className="span-all">
          <input value={d.church_contact} onChange={(e) => set('church_contact', e.target.value)} />
        </Field>
        <Field label={t('CCLI licence number')}><input value={d.ccli_license} onChange={(e) => set('ccli_license', e.target.value)} /></Field>
        <Field label={t('Default start time')}><input type="time" value={d.default_start_time} onChange={(e) => e.target.value && set('default_start_time', e.target.value)} /></Field>
        <Field label={t('Time zone')} hint={t('What “today” is: the date of claims and journals, reports up to today, the rota and meetings ahead, when the visitor form opens.')}>
          <select value={d.time_zone ?? ''} onChange={(e) => set('time_zone', e.target.value)}>
            <option value="">{t('The computer Canon runs on ({zone})').replace('{zone}', (d as SettingsT & { computer_zone?: string }).computer_zone ?? '')}</option>
            {ZONES.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
          </select>
        </Field>
      </div>
      <h3 className="sect mt">{t('Bulletin & slides')}</h3>
      <div className="form-grid">
        <Field label={t('Bilingual layout')}>
          <div><Seg<'parallel' | 'stacked'> value={d.bilingual_layout} onChange={(v) => set('bilingual_layout', v)}
            options={[{ value: 'parallel', label: t('Side by side') }, { value: 'stacked', label: t('Stacked') }]} /></div>
        </Field>
        <div className="span-all callout small">
          {t('Paper size, what each bulletin prints, and slide colours and fonts are set in templates and themes.')}{' '}
          <Link to="/bulletin-templates">{t('Bulletin templates')} →</Link>{' · '}<Link to="/slide-templates">{t('Slide templates')} →</Link>
        </div>
        <Field label={t('Bulletin cover')} hint={t('Each service can choose its own.')}>
          <select value={d.bulletin_cover} onChange={(e) => set('bulletin_cover', e.target.value as SettingsT['bulletin_cover'])}>
            {(['plain', 'cross', 'logo', 'verse'] as const).map((c) => <option key={c} value={c}>{t(COVER_LABEL[c])}</option>)}
          </select>
        </Field>
        <Field label={t('Season colours')} hint={t('Accent services, bulletins and slides with the colour of the church year.')}>
          <label className="check" style={{ minHeight: 34 }}>
            <input type="checkbox" checked={d.season_colours} onChange={(e) => set('season_colours', e.target.checked)} />
            {t('Show liturgical season colours')}
          </label>
        </Field>
      </div>
      <div className="row end"><button className="btn primary" onClick={save} disabled={busy}>{t('Save')}</button></div>
    </div>
    <CongregationsCard churchLangs={d.languages} />
    </div>
  );
}

// ---------------------------------------------------------------- users
