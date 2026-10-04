// Small fixed labels printed inside worship content (bulletins, slides, exports), per language.
// Languages without an entry fall back to English; Traditional Chinese falls back to converted Simplified.
import type { L10n, Lang } from './types.ts';

const SPEAKER: Record<'L' | 'C' | 'A', L10n> = {
  L: { en: 'Leader', zh: '领', 'zh-Hant': '領', ms: 'Pemimpin', id: 'Pemimpin', es: 'Líder', tl: 'Pinuno', vi: 'Chủ lễ' },
  C: { en: 'People', zh: '会众', 'zh-Hant': '會眾', ms: 'Jemaah', id: 'Jemaat', es: 'Pueblo', tl: 'Kongregasyon', vi: 'Hội chúng' },
  A: { en: 'All', zh: '齐', 'zh-Hant': '齊', ms: 'Semua', id: 'Semua', es: 'Todos', tl: 'Lahat', vi: 'Tất cả' },
};

const REFRAIN: L10n = { en: 'Refrain', zh: '副歌', 'zh-Hant': '副歌', ms: 'Korus', id: 'Refrein', es: 'Coro', tl: 'Koro', vi: 'Điệp khúc' };

const get = (v: L10n, lang: Lang) => v[lang] ?? v.en!;

export const speakerLabel = (who: 'L' | 'C' | 'A', lang: Lang) => get(SPEAKER[who], lang);
export const refrainLabel = (lang: Lang) => get(REFRAIN, lang);

/** "Verse 1" style label for a stanza label in a language. */
export function stanzaName(label: string, lang: Lang): string {
  if (label === 'R' || label === 'C') return refrainLabel(lang);
  if (lang === 'zh' || lang === 'zh-Hant') return `第${label}节`.replace('节', lang === 'zh' ? '节' : '節');
  return label;
}

/** True when any language has non-blank text. */
export const hasAnyText = (v: L10n | null | undefined) => !!v && Object.values(v).some((x) => !!x?.trim());

const QUESTIONS: L10n = { en: 'Q.{n}', zh: '第{n}问', 'zh-Hant': '第{n}問', ja: '問{n}', ko: '제{n}문' };

/**
 * Selected parts of a long text, e.g. runs ["1–3"] → "Q.1–3" / "第1–3问" for a catechism, or
 * ["I.1–3"] → "I.1–3" for a confession. Runs come from partRuns() in shared/parts.ts.
 */
export function partsLabel(runs: string[], lang: Lang, catechism: boolean): string {
  const cjk = lang === 'zh' || lang === 'zh-Hant' || lang === 'ja';
  const n = runs.join(cjk ? '、' : ', ');
  return catechism ? get(QUESTIONS, lang).replace('{n}', n) : n;
}

/**
 * When several languages are joined on one line, a shared leading prefix such as a hymn number
 * ("HP 123 · ") is shown once: "HP 123 · Holy, Holy, Holy · 圣哉，圣哉，圣哉".
 */
export function dropRepeatedPrefix(parts: string[]): string[] {
  if (parts.length < 2) return parts;
  const m = parts[0].match(/^(.+?) · /);
  if (!m) return parts;
  const prefix = m[0];
  return [parts[0], ...parts.slice(1).map((p) => (p.startsWith(prefix) ? p.slice(prefix.length) : p))];
}

const POSTURE: Record<'stand' | 'sit' | 'kneel', L10n> = {
  stand: { en: 'All stand', zh: '众立', 'zh-Hant': '眾立' },
  sit: { en: 'All sit', zh: '众坐', 'zh-Hant': '眾坐' },
  kneel: { en: 'Kneel', zh: '跪下', 'zh-Hant': '跪下' },
};

/** What the congregation does during an item ("All stand" / 众立 / 眾立); other languages fall back to English. */
export const postureLabel = (p: 'stand' | 'sit' | 'kneel', lang: Lang) => get(POSTURE[p], lang);
/** The posture in every language, e.g. { en: 'All stand', zh: '众立' }. */
export const postureL10n = (p: 'stand' | 'sit' | 'kneel', langs: Lang[]): L10n => Object.fromEntries(langs.map((l) => [l, postureLabel(p, l)]));

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Heading of next week's roster: "10月11日 服事人员" / "10月11日 服事人員" / "Serving on 11 Oct". */
export function servingOnLabel(date: string, lang: Lang): string {
  const m = date.match(/^\d{4}-(\d{2})-(\d{2})/);
  if (!m) return date;
  const [mo, d] = [Number(m[1]), Number(m[2])];
  if (lang === 'zh') return `${mo}月${d}日 服事人员`;
  if (lang === 'zh-Hant') return `${mo}月${d}日 服事人員`;
  if (lang === 'ja') return `${mo}月${d}日の奉仕者`;
  if (lang === 'ko') return `${mo}월 ${d}일 봉사자`;
  return `Serving on ${d} ${MONTH_SHORT[mo - 1]}`;
}

/** Does a role (its name in any language) match a name typed in a bulletin template ("Usher" ≈ "Ushers", case-insensitive)? */
export function roleMatches(role: L10n, name: string): boolean {
  const norm = (s: string) => s.trim().toLowerCase().replace(/s$/, '');
  const want = norm(name);
  return !!want && Object.values(role).some((v) => !!v && norm(v) === want);
}
