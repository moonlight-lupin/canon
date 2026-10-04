// Fixed labels and date formats printed in the outputs (bulletin, slides, run sheet, share page,
// Word, FreeShow) in any service language. Speaker and refrain labels come from ./labels.ts.
// Languages without an entry fall back to English.
import type { L10n, Lang } from './types.ts';
import { isChinese, langInfo } from './languages.ts';
import { dropRepeatedPrefix, refrainLabel } from './labels.ts';

/** Section labels printed in outputs (not UI chrome, so not tied to the UI language). */
export const OUTPUT_LABEL = {
  servingToday: { en: 'Serving today', zh: '今日事奉', 'zh-Hant': '今日事奉', ms: 'Bertugas hari ini', id: 'Melayani hari ini', es: 'Sirven hoy', tl: 'Naglilingkod ngayon', vi: 'Phục vụ hôm nay' },
  announcements: { en: 'Announcements', zh: '报告事项', 'zh-Hant': '報告事項', ms: 'Pengumuman', id: 'Pengumuman', es: 'Anuncios', tl: 'Mga Patalastas', vi: 'Thông báo' },
  sermon: { en: 'Sermon', zh: '讲道', 'zh-Hant': '講道', ms: 'Khutbah', id: 'Khotbah', es: 'Sermón', tl: 'Sermon', vi: 'Bài giảng' },
  preacher: { en: 'Preacher', zh: '讲员', 'zh-Hant': '講員', ms: 'Pengkhutbah', id: 'Pengkhotbah', es: 'Predicador', tl: 'Mangangaral', vi: 'Diễn giả' },
  theme: { en: 'Theme', zh: '主题', 'zh-Hant': '主題', ms: 'Tema', id: 'Tema', es: 'Tema', tl: 'Tema', vi: 'Chủ đề' },
  orderOfService: { en: 'Order of Service', zh: '聚会程序', 'zh-Hant': '聚會程序', ms: 'Aturan Ibadah', id: 'Tata Ibadah', es: 'Orden del culto', tl: 'Palatuntunan', vi: 'Chương trình thờ phượng' },
  sermonNotes: { en: 'Sermon notes', zh: '讲道笔记', 'zh-Hant': '講道筆記', ms: 'Catatan khutbah', id: 'Catatan khotbah', es: 'Notas del sermón', tl: 'Mga tala sa sermon', vi: 'Ghi chú bài giảng' },
} satisfies Record<string, L10n>;

/** Short, non-refrain stanza labels (B, P, T, Amen). Numbered stanzas print as numbers. */
const STANZA_LABEL: Record<string, L10n> = {
  B: { en: 'Bridge', zh: '桥段', 'zh-Hant': '橋段' },
  BRIDGE: { en: 'Bridge', zh: '桥段', 'zh-Hant': '橋段' },
  P: { en: 'Pre-chorus', zh: '导歌', 'zh-Hant': '導歌' },
  T: { en: 'Tag', zh: '尾句', 'zh-Hant': '尾句' },
  AMEN: { en: 'Amen', zh: '阿们', 'zh-Hant': '阿們', ms: 'Amin', id: 'Amin', es: 'Amén', vi: 'A-men' },
};
export const isNumbered = (label: string) => /^\d+$/.test(label.trim());
export const isRefrain = (label: string) => /^(R|C|REFRAIN|CHORUS)$/i.test(label.trim());

/** Label for a stanza in a language: "2", "Refrain", "副歌", "Bridge", … */
export function stanzaLabel(label: string, lang: Lang): string {
  const k = label.trim().toUpperCase();
  if (/^\d+$/.test(k)) return k;
  if (k === 'C' || k === 'CHORUS') return lang === 'en' ? 'Chorus' : refrainLabel(lang);
  if (k === 'R' || k === 'REFRAIN') return refrainLabel(lang);
  const v = STANZA_LABEL[k];
  return v ? (v[lang] ?? (lang === 'zh-Hant' ? v.zh : undefined) ?? v.en ?? label) : label;
}

// ---------------------------------------------------------------- dates

const WEEKDAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAY_ZH = ['主日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

/**
 * A service date in one language: "Sunday, 11 October 2026", "2026年10月11日 主日" (Simplified and
 * Traditional), otherwise the language's own long format via Intl.
 */
export function dateIn(date: string, lang: Lang): string {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return date;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  if (lang === 'en') return `${WEEKDAY_EN[wd]}, ${d} ${MONTH_EN[mo - 1]} ${y}`;
  if (isChinese(lang)) return `${y}年${mo}月${d}日 ${WEEKDAY_ZH[wd]}`;
  try {
    return new Intl.DateTimeFormat(langInfo(lang).htmlLang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(y, mo - 1, d)));
  } catch {
    return `${WEEKDAY_EN[wd]}, ${d} ${MONTH_EN[mo - 1]} ${y}`;
  }
}

/** The date in each language, deduplicated and joined. */
export const formatDate = (date: string, langs: Lang[] = ['en'], sep = ' · ') => [...new Set(langs.map((l) => dateIn(date, l)))].join(sep);

// ---------------------------------------------------------------- text budgets

/**
 * Width-weighted length for slide text budgets: in a CJK language (isCJK) a full-width character
 * takes about 2.2 Latin characters of room. Without a language, CJK characters are detected by range.
 */
export function textWeight(s: string, lang?: Lang): number {
  const wide = lang ? langInfo(lang).cjk : null;
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    const isWide = wide === null ? (c >= 0x3000 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af) || (c >= 0xff00 && c <= 0xffef) : wide && c > 0x2e7f;
    n += isWide ? 2.2 : 1;
  }
  return n;
}

// ---------------------------------------------------------------- picking text in the output languages

export const pick = (x: L10n | null | undefined, lang: Lang) => (x?.[lang] ?? '').trim();
export const hasAny = (x: L10n | null | undefined) => !!x && Object.values(x).some((v) => v?.trim());

/** Values of the requested languages (deduplicated), falling back to any language present. */
export function biParts(x: L10n | null | undefined, langs: Lang[]): { lang: Lang; text: string }[] {
  if (!x) return [];
  const seen = new Set<string>();
  const out: { lang: Lang; text: string }[] = [];
  for (const l of langs) {
    const t = pick(x, l);
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push({ lang: l, text: t });
    }
  }
  if (out.length) {
    const texts = dropRepeatedPrefix(out.map((p) => p.text));
    return out.map((p, i) => ({ ...p, text: texts[i] }));
  }
  for (const l of ['en', ...Object.keys(x)]) {
    const t = pick(x, l);
    if (t) return [{ lang: l, text: t }];
  }
  return [];
}
/** Joined string, e.g. "Call to Worship 宣召". */
export const biText = (x: L10n | null | undefined, langs: Lang[], sep = ' ') =>
  biParts(x, langs).map((p) => p.text).join(sep);
