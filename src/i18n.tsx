// UI internationalisation and the church's content languages.
//
// UI strings: English text is the key. Simplified Chinese lives in src/i18n/*.ts; Traditional Chinese is
// generated from it (src/i18n/zh-Hant.generated.ts, `npm run i18n`). Other UI languages fall back to English.
//
// Content languages: the languages the church worships in (Settings → Languages) are provided by
// <ChurchLanguages>; bilingual inputs and labels read them from useContentLangs().
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { L10n, Lang } from '../shared/types.ts';
import { UI_LANGS, langInfo } from '../shared/languages.ts';
import zhCore from './i18n/zh.ts';
import zhOutputs from './i18n/outputs.ts';
import zhPeople from './i18n/people.ts';
import zhWorship from './i18n/worship.ts';
import zhEmail from './i18n/email.ts';
import zhPresentation from './i18n/presentation.ts';
import zhGuide from './i18n/guide.ts';
import zhResources from './i18n/resources.ts';
import zhHant from './i18n/zh-Hant.generated.ts';

export const DICTS: Record<Lang, Record<string, string>> = {
  en: {},
  // the newest file first: a word already translated elsewhere keeps its translation
  zh: { ...zhResources, ...zhCore, ...zhOutputs, ...zhPeople, ...zhWorship, ...zhEmail, ...zhPresentation, ...zhGuide },
  'zh-Hant': zhHant,
};

/** Translate a UI string into a specific language (used for printed labels in another language). */
export const tr = (s: string, lang: Lang) => DICTS[lang]?.[s] ?? (lang === 'zh-Hant' ? DICTS.zh[s] : undefined) ?? s;

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

function initialLang(): Lang {
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
    const dict = DICTS[lang] ?? {};
    document.documentElement.lang = langInfo(lang).htmlLang;
    return {
      lang,
      setLang: (l) => {
        const ui = UI_LANGS.includes(l) ? l : 'en';
        setLangState(ui);
        try {
          localStorage.setItem('canon.lang', ui);
        } catch {
          /* ignore */
        }
      },
      t: (s) => dict[s] ?? s,
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
