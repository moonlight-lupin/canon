// Choose and order the church's content languages from the catalog (first = primary).
import { LANGUAGE_CATALOG, langInfo } from '../../shared/languages.ts';
import { UI_COVERAGE } from '../../shared/locales.generated.ts';
import type { Lang } from '../../shared/types.ts';
import { useI18n } from '../i18n.tsx';
import { Icon } from './icons.tsx';

export function LanguagePicker({ value, onChange }: { value: Lang[]; onChange: (v: Lang[]) => void }) {
  const { t } = useI18n();
  const toggle = (code: Lang) => onChange(value.includes(code) ? value.filter((l) => l !== code) : [...value, code]);
  const move = (i: number, d: number) => {
    const a = [...value];
    const [x] = a.splice(i, 1);
    a.splice(i + d, 0, x);
    onChange(a);
  };
  const others = LANGUAGE_CATALOG.filter((l) => !value.includes(l.code));
  return (
    <div className="stack tight">
      {value.map((code, i) => {
        const l = langInfo(code);
        return (
          <div key={code} className="row lang-row on">
            <input type="checkbox" checked onChange={() => toggle(code)} disabled={value.length === 1} aria-label={l.name} />
            <strong className="grow">{l.native} <span className="muted small">{l.name}</span></strong>
            {i === 0 && <span className="badge reed">{t('Primary')}</span>}
            {l.ui && (
              <span className="badge" title={t('Canon’s own screens are translated into this language (how much of them: the percentage).')}>
                UI{(UI_COVERAGE[code] ?? 1) < 0.995 ? ` ${Math.floor((UI_COVERAGE[code] ?? 0) * 100)}%` : ''}
              </span>
            )}
            {l.bibles.length > 0 && <span className="badge ok" title={l.bibles.map((b) => b.name).join(', ')}>{t('Bible')}</span>}
            <button type="button" className="btn sm ghost icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Up"><Icon name="chevronDown" style={{ transform: 'rotate(180deg)' }} /></button>
            <button type="button" className="btn sm ghost icon" disabled={i === value.length - 1} onClick={() => move(i, 1)} aria-label="Down"><Icon name="chevronDown" /></button>
          </div>
        );
      })}
      <div className="row" style={{ marginTop: 6 }}>
        {others.map((l) => (
          <button key={l.code} type="button" className="btn sm" onClick={() => toggle(l.code)}>
            <Icon name="plus" />{l.native}
          </button>
        ))}
      </div>
    </div>
  );
}
