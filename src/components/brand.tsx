// Brand pieces shared by the app shell, login, settings and outputs: the 1 Cor 14:40 tagline,
// the church logo (GET /api/assets/logo), the liturgical season chip and the cover cross.
import { isChinese, langInfo } from '../../shared/languages.ts';
import { useEffect, useState, type CSSProperties } from 'react';
import type { L10n, Lang, Season } from '../../shared/types.ts';
import { SEASONS, seasonInfo } from '../../shared/season.ts';
import { pickL10n, useI18n } from '../i18n.tsx';
import { ReedMark } from './icons.tsx';

// ---------------------------------------------------------------- tagline

/** Canon's tagline: 1 Corinthians 14:40 (KJV; 和合本). */
export const TAGLINE: { text: L10n; ref: L10n } = {
  text: {
    en: 'Let all things be done decently and in order.',
    zh: '凡事都要规规矩矩地按着次序行。',
    'zh-Hant': '凡事都要規規矩矩地按著次序行。',
  },
  ref: { en: '1 Corinthians 14:40', zh: '哥林多前书 14:40', 'zh-Hant': '哥林多前書 14:40' },
};

/** The tagline with its reference, in the given language (default: the UI language). */
export function Tagline({ lang: only, className }: { lang?: Lang; className?: string }) {
  const { lang: ui } = useI18n();
  const lang = only ?? ui;
  // the verse in the language when there is one (KJV; 和合本), else English
  const shown = TAGLINE.text[lang] || (isChinese(lang) && (TAGLINE.text.zh || TAGLINE.text['zh-Hant'])) ? lang : 'en';
  const cjk = langInfo(shown).cjk;
  return (
    <p className={`tagline${className ? ' ' + className : ''}`} lang={langInfo(shown).htmlLang}>
      <span className="tagline-text">{cjk ? '' : '“'}{pickL10n(TAGLINE.text, shown)}{cjk ? '' : '”'}</span>{' '}
      <span className="tagline-ref">— {pickL10n(TAGLINE.ref, shown)}</span>
    </p>
  );
}

// ---------------------------------------------------------------- church logo

/** Logo version: a content hash string, null = no logo, undefined = not loaded yet. */
let logoVersion: string | null | undefined;
let loading: Promise<void> | null = null;
const listeners = new Set<(v: string | null | undefined) => void>();

function loadLogo(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = fetch('/api/assets/logo/info', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : { version: null }))
    .then((j: { version: string | null }) => {
      logoVersion = j.version ?? null;
    })
    .catch(() => {
      logoVersion = null;
    })
    .finally(() => listeners.forEach((f) => f(logoVersion)));
  return loading;
}

/** Re-read the logo after an upload or removal; every mounted logo updates. */
export const refreshLogo = () => loadLogo(true);

/** The church logo's version (null when none has been uploaded). */
export function useLogo(): string | null | undefined {
  const [v, setV] = useState(logoVersion);
  useEffect(() => {
    listeners.add(setV);
    if (logoVersion === undefined) loadLogo();
    else setV(logoVersion);
    return () => {
      listeners.delete(setV);
    };
  }, []);
  return v;
}

/** Versioned URL: the server caches it for a year, and a new upload changes the version. */
export const logoUrl = (version: string) => `/api/assets/logo?v=${encodeURIComponent(version)}`;

/** The church logo if one was uploaded, otherwise Canon's reed mark. */
export function ChurchMark({ className, fallback = true, alt = '' }: { className?: string; fallback?: boolean; alt?: string }) {
  const v = useLogo();
  if (v) return <img className={`church-logo ${className ?? ''}`} src={logoUrl(v)} alt={alt} />;
  if (v === undefined || !fallback) return null;
  return <ReedMark className={className} />;
}

// ---------------------------------------------------------------- liturgical season

/** Small coloured dot + season name. `color` false = neutral dot (season colours turned off). */
export function SeasonChip({ date, season, color = true, dotOnly, className }: { date: string; season?: Season | null; color?: boolean; dotOnly?: boolean; className?: string }) {
  const { lang } = useI18n();
  const si = seasonInfo(date, season);
  const name = pickL10n(si.name, lang);
  const style = { '--season': color ? si.color : 'var(--ink-3)' } as CSSProperties;
  if (dotOnly) return <span className={`season-dot ${className ?? ''}`} style={style} title={name} aria-label={name} />;
  return (
    <span className={`season-chip ${className ?? ''}`} style={style} title={si.liturgical}>
      <span className="season-dot" aria-hidden="true" />
      {name}
    </span>
  );
}

export const SEASON_KEYS = Object.keys(SEASONS) as Season[];

// ---------------------------------------------------------------- cover cross

/** A slender Latin cross for the bulletin cover, drawn as two hairline-edged bars. */
export function CrossMark({ className, color = '#A8893C' }: { className?: string; color?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 60" aria-hidden="true">
      <path
        d="M17.6 2H22.4V15.6H34V20.4H22.4V58H17.6V20.4H6V15.6H17.6Z"
        fill={color}
        fillOpacity="0.16"
        stroke={color}
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}
