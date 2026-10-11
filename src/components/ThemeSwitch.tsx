// Light, dark, or as this computer (or phone) is set (0.20.1), remembered in this browser: three buttons in the
// sidebar; one button that steps through them on members' own pages, where a phone's header has little room (0.20.2).
import { useI18n } from '../i18n.tsx';
import { useTheme, type ThemeChoice } from '../theme.ts';
import { Icon } from './icons.tsx';
import { Seg } from './ui.tsx';

const ORDER: ThemeChoice[] = ['auto', 'light', 'dark'];
const ICON = { auto: 'monitor', light: 'sun', dark: 'moon' } as const;

export function ThemeSwitch({ compact }: { compact?: boolean }) {
  const { t } = useI18n();
  const [theme, setTheme] = useTheme();
  const label: Record<ThemeChoice, string> = { auto: t('As this computer is set'), light: t('Light'), dark: t('Dark') };
  if (compact) {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    const title = `${t('Appearance')}: ${label[theme]} → ${label[next]}`;
    return (
      <button type="button" className="btn ghost icon theme-step" onClick={() => setTheme(next)} title={title} aria-label={title}>
        <Icon name={ICON[theme]} />
      </button>
    );
  }
  return <Seg value={theme} onChange={setTheme} label={t('Appearance')} options={ORDER.map((v) => ({ value: v, label: <Icon name={ICON[v]} />, title: label[v] }))} />;
}
