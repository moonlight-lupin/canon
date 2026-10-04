// Language registry: which content languages Canon knows about, which have a translated UI,
// how they are written, and which public-domain Bibles can be imported for them.
//
// Codes are BCP-47 style. For backward compatibility 'zh' means Simplified Chinese (zh-Hans);
// Traditional Chinese is 'zh-Hant'. Content in one Chinese script is converted to the other
// automatically when a translation is missing (see server/lib/chinese.ts).

export interface BibleSource {
  /** translation code stored in bible_verses.translation */
  code: string;
  name: string;
  /** file name in scrollmapper/bible_databases formats/json */
  file: string;
  /** post-processing applied on import */
  transform?: 'cjk' | 'cjk-s' | 'none';
  year?: number;
}

export interface LanguageInfo {
  code: string;
  /** English name */
  name: string;
  /** name in the language itself */
  native: string;
  /** short label for toggles, e.g. EN, 简, 繁 */
  short: string;
  /** UI dictionary shipped for this language */
  ui: boolean;
  /** CJK script: affects slide text budgets, fonts and line breaking */
  cjk: boolean;
  /** CSS font stack hint for content in this language */
  font: 'latin' | 'sc' | 'tc' | 'ta' | 'ko' | 'ja';
  /** BCP-47 tag for the HTML lang attribute */
  htmlLang: string;
  bibles: BibleSource[];
}

export const LANGUAGE_CATALOG: LanguageInfo[] = [
  {
    code: 'en', name: 'English', native: 'English', short: 'EN', ui: true, cjk: false, font: 'latin', htmlLang: 'en',
    bibles: [
      { code: 'KJV', name: 'King James Version', file: 'KJV.json', year: 1769 },
      { code: 'ASV', name: 'American Standard Version', file: 'ASV.json', year: 1901 },
      { code: 'BSB', name: 'Berean Standard Bible', file: 'BSB.json', year: 2023 },
    ],
  },
  {
    code: 'zh', name: 'Chinese (Simplified)', native: '简体中文', short: '简', ui: true, cjk: true, font: 'sc', htmlLang: 'zh-Hans',
    bibles: [{ code: 'CUVS', name: '和合本（简体）', file: 'ChiUn.json', transform: 'cjk-s', year: 1919 }],
  },
  {
    code: 'zh-Hant', name: 'Chinese (Traditional)', native: '繁體中文', short: '繁', ui: true, cjk: true, font: 'tc', htmlLang: 'zh-Hant',
    bibles: [{ code: 'CUVT', name: '和合本（繁體）', file: 'ChiUn.json', transform: 'cjk', year: 1919 }],
  },
  { code: 'ms', name: 'Malay', native: 'Bahasa Melayu', short: 'BM', ui: false, cjk: false, font: 'latin', htmlLang: 'ms', bibles: [] },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia', short: 'ID', ui: false, cjk: false, font: 'latin', htmlLang: 'id', bibles: [] },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்', short: 'த', ui: false, cjk: false, font: 'ta', htmlLang: 'ta', bibles: [] },
  { code: 'ko', name: 'Korean', native: '한국어', short: '한', ui: false, cjk: true, font: 'ko', htmlLang: 'ko', bibles: [] },
  { code: 'tl', name: 'Tagalog', native: 'Tagalog', short: 'TL', ui: false, cjk: false, font: 'latin', htmlLang: 'tl', bibles: [{ code: 'TAGAB', name: 'Ang Biblia', file: 'TagAngBiblia.json', year: 1905 }] },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt', short: 'VI', ui: false, cjk: false, font: 'latin', htmlLang: 'vi', bibles: [{ code: 'VIET', name: 'Kinh Thánh 1926', file: 'Viet.json', year: 1926 }] },
  { code: 'es', name: 'Spanish', native: 'Español', short: 'ES', ui: false, cjk: false, font: 'latin', htmlLang: 'es', bibles: [{ code: 'RV1909', name: 'Reina-Valera 1909', file: 'SpaRV.json', year: 1909 }] },
  { code: 'ja', name: 'Japanese', native: '日本語', short: '日', ui: false, cjk: true, font: 'ja', htmlLang: 'ja', bibles: [] },
];

const BY_CODE = new Map(LANGUAGE_CATALOG.map((l) => [l.code, l]));

/** Look up a language; unknown codes get a sensible generic entry. */
export function langInfo(code: string): LanguageInfo {
  return (
    BY_CODE.get(code) ?? {
      code, name: code, native: code, short: code.toUpperCase().slice(0, 3), ui: false, cjk: false, font: 'latin', htmlLang: code, bibles: [],
    }
  );
}

export const isCJK = (code: string) => langInfo(code).cjk;
export const isChinese = (code: string) => code === 'zh' || code.startsWith('zh-');

/** Languages that have a translated UI. */
export const UI_LANGS = LANGUAGE_CATALOG.filter((l) => l.ui).map((l) => l.code);

export const LANG_CODE_RE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

/** Maximum languages printed/projected together in one service. */
export const MAX_SERVICE_LANGS = 3;

/** Every Bible source in the catalog keyed by translation code. */
export const BIBLE_SOURCES: Record<string, BibleSource & { lang: string }> = Object.fromEntries(
  LANGUAGE_CATALOG.flatMap((l) => l.bibles.map((b) => [b.code, { ...b, lang: l.code }])),
);
