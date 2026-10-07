// UI internationalisation and the church's content languages.
//
// UI strings: English text is the key. Each language's translation is locales/<code>/ui.json (see
// CONTRIBUTING-TRANSLATIONS.md); a language is loaded the first time it is used. A phrase a language lacks comes
// from its fallback (UI_FALLBACK, e.g. Traditional ⇄ Simplified Chinese), then English.
//
// Content languages: the languages the church worships in (Settings → Languages) are provided by
// <ChurchLanguages>; bilingual inputs and labels read them from useContentLangs().
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { L10n, Lang } from '../shared/types.ts';
import { UI_LANGS, langInfo } from '../shared/languages.ts';
import { UI_FALLBACK } from '../shared/locales.generated.ts';

// every locales/<code>/ui.json, each its own file in the build, fetched only when that language is used
const LOADERS = import.meta.glob<Record<string, string>>('../locales/*/ui.json', { import: 'default' });

/** The interface translations loaded so far (English is the key, so it needs none). */
export const DICTS: Partial<Record<Lang, Record<string, string>>> = { en: {} };

/** Load a language's translation (and its fallback's) if it isn't yet. */
export async function loadLocale(lang: Lang): Promise<void> {
  for (const l of [lang, UI_FALLBACK[lang]]) {
    if (!l || DICTS[l]) continue;
    const load = LOADERS[`../locales/${l}/ui.json`];
    if (load) DICTS[l] = await load();
  }
}

/** Translate a UI string into a specific language (also used for printed labels in another language). */
export const tr = (s: string, lang: Lang) => DICTS[lang]?.[s] ?? (UI_FALLBACK[lang] ? DICTS[UI_FALLBACK[lang]]?.[s] : undefined) ?? s;

/** Make sure these languages' translations are loaded (e.g. a run sheet's label languages); re-renders when they are. */
export function useLocales(langs: Lang[]) {
  const [, loaded] = useState(0);
  const key = langs.join(',');
  useEffect(() => {
    let live = true;
    if (langs.some((l) => l !== 'en' && !DICTS[l])) Promise.all(langs.map(loadLocale)).then(() => live && loaded((n) => n + 1));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/**
 * Pick a localised value for `lang`: exact, then the other Chinese script, then English, then anything.
 * (Script conversion of content is done on the server; here we only fall back.)
 */
export function pickL10n(v: L10n | null | undefined, lang: Lang): string {
  if (!v) return '';
  const order = [lang, lang === 'zh' ? 'zh-Hant' : lang === 'zh-Hant' ? 'zh' : '', 'en'].filter(Boolean);
  for (const l of order) if (v[l]?.trim()) return v[l]!;
  return Object.values(v).find((x) => x?.trim()) ?? '';
}

interface I18n {
  /** UI language */
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (s: string) => string;
  /** pick a localised value in the UI language, with fallbacks */
  lt: (v: L10n | null | undefined) => string;
}

const Ctx = createContext<I18n>(null!);

export function initialLang(): Lang {
  try {
    const s = localStorage.getItem('canon.lang');
    if (s && UI_LANGS.includes(s)) return s;
  } catch {
    /* storage unavailable */
  }
  const nav = navigator.language.toLowerCase();
  if (nav.startsWith('zh')) return /tw|hk|mo|hant/.test(nav) ? 'zh-Hant' : 'zh';
  return 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const value = useMemo<I18n>(() => {
    document.documentElement.lang = langInfo(lang).htmlLang;
    return {
      lang,
      setLang: (l) => {
        const ui = UI_LANGS.includes(l) ? l : 'en';
        // switch once its words are here (no flash of English)
        loadLocale(ui).then(() => setLangState(ui));
        try {
          localStorage.setItem('canon.lang', ui);
        } catch {
          /* ignore */
        }
      },
      t: (s) => tr(s, lang),
      lt: (v) => pickL10n(v, lang),
    };
  }, [lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);

// ---------------------------------------------------------------- church content languages

const LangsCtx = createContext<Lang[]>(['en', 'zh']);

/** Provide the church's configured content languages (from settings) to everything below. */
export function ChurchLanguages({ langs, children }: { langs: Lang[] | undefined; children: ReactNode }) {
  return <LangsCtx.Provider value={langs?.length ? langs : ['en', 'zh']}>{children}</LangsCtx.Provider>;
}

/** The church's content languages, primary first. */
export const useContentLangs = () => useContext(LangsCtx);

/** Values joined in language order, e.g. "Call to Worship 宣召". Defaults to all values present. */
export const both = (v: L10n | null | undefined, langs?: Lang[], sep = ' ') => {
  if (!v) return '';
  const order = langs ?? Object.keys(v);
  return [...new Set(order.map((l) => v[l]?.trim()).filter(Boolean))].join(sep);
};
