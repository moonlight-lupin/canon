// Small presentation controls used by the service planner: the slide theme and bulletin template of a service,
// and an item's "In bulletin" choice (hidden / template default / title only / full text).
import { useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Field, useSession } from '../components/ui.tsx';
import type { ItemKind, ServiceItem } from '../types-client.ts';
import type { BulletinTemplate, SlideTheme } from '../../shared/presentation.ts';
import './presentation.css';

/** Slide theme for a service; '' = the church default (named). */
export function SlideThemeField({ value, onChange, label }: { value: number | null; onChange: (v: number | null) => void; label?: string }) {
  const { t, lt } = useI18n();
  const { settings } = useSession();
  const { data: themes } = useApi<SlideTheme[]>('/slide-themes');
  const legacy = settings?.slide_theme === 'light' ? 'papyrus' : 'ink';
  const def = themes?.find((x) => x.id === settings?.default_slide_theme_id) ?? themes?.find((x) => x.builtin === legacy);
  return (
    <Field label={label ?? t('Slide theme')}>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">{t('Church default')}{def ? ` — ${lt(def.name)}` : ''}</option>
        {themes?.filter((x) => !x.hidden || x.id === value).map((x) => <option key={x.id} value={x.id}>{x.ref ? `${x.ref} · ` : ''}{lt(x.name)}</option>)}
      </select>
    </Field>
  );
}

/** Bulletin template for a service; '' = the church default (named). */
export function BulletinTemplateField({ value, onChange, hint }: { value: number | null; onChange: (v: number | null) => void; hint?: string | null }) {
  const { t, lt } = useI18n();
  const { settings } = useSession();
  const { data: list } = useApi<BulletinTemplate[]>('/bulletin-templates');
  const def = list?.find((x) => x.id === settings?.default_bulletin_template_id) ?? list?.find((x) => x.builtin === 'full');
  return (
    <Field label={t('Bulletin template')} hint={hint === null ? undefined : hint ?? t('Decides which items print their full words.')}>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">{t('Church default')}{def ? ` — ${lt(def.name)}` : ''}</option>
        {list?.filter((x) => !x.hidden || x.id === value).map((x) => <option key={x.id} value={x.id}>{x.ref ? `${x.ref} · ` : ''}{lt(x.name)}</option>)}
      </select>
    </Field>
  );
}

type Choice = 'hidden' | 'default' | 'title' | 'full';

/** "In bulletin" for one item: hidden, as the template says, title only, or full text. */
export function BulletinChoice({ item, onPatch }: { item: ServiceItem; onPatch: (p: Partial<ServiceItem>, immediate?: boolean) => void }) {
  const { t } = useI18n();
  const value: Choice = !item.in_bulletin ? 'hidden' : item.bulletin_text ?? 'default';
  const set = (c: Choice) =>
    onPatch(c === 'hidden' ? { in_bulletin: false } : { in_bulletin: true, bulletin_text: c === 'default' ? null : c }, true);
  // Sections and items without words only need shown / hidden.
  const wordless: ItemKind[] = ['section'];
  if (wordless.includes(item.kind)) {
    return (
      <label className="check"><input type="checkbox" checked={item.in_bulletin} onChange={(e) => onPatch({ in_bulletin: e.target.checked }, true)} />{t('In bulletin')}</label>
    );
  }
  const titleLabel = item.kind === 'scripture' ? t('Reference only') : t('Title only');
  return (
    <label className="bulletin-choice" title={t('Template default follows the bulletin template chosen for this service.')}>
      <span>{t('In bulletin')}</span>
      <select value={value} onChange={(e) => set(e.target.value as Choice)}>
        <option value="default">{t('Template default')}</option>
        <option value="full">{t('Full text')}</option>
        <option value="title">{titleLabel}</option>
        <option value="hidden">{t('Hidden')}</option>
      </select>
    </label>
  );
}
