// Small fixed labels printed inside worship content (bulletins, slides, exports), per language. The wording is in
// locales/<code>/outputs.json (shared/printed.ts); a language without it falls back to English.
import type { L10n, Lang } from './types.ts';
import { hasPrinted, printed } from './printed.ts';

const SPEAKER = { L: 'Leader', C: 'People', A: 'All' } as const;

export const speakerLabel = (who: 'L' | 'C' | 'A', lang: Lang) => printed(SPEAKER[who], lang);
export const refrainLabel = (lang: Lang) => printed('Refrain', lang);

/** "Verse 1" style label for a stanza label in a language ("第1节"; English just the number). */
export function stanzaName(label: string, lang: Lang): string {
  if (label === 'R' || label === 'C') return refrainLabel(lang);
  return /^\d+$/.test(label.trim()) ? printed('Stanza {n}', lang).replace('{n}', label) : label;
}

/** True when any language has non-blank text. */
export const hasAnyText = (v: L10n | null | undefined) => !!v && Object.values(v).some((x) => !!x?.trim());

/**
 * Selected parts of a long text, e.g. runs ["1–3"] → "Q.1–3" / "第1–3问" for a catechism, or
 * ["I.1–3"] → "I.1–3" for a confession. Runs come from partRuns() in shared/parts.ts.
 */
export function partsLabel(runs: string[], lang: Lang, catechism: boolean): string {
  const cjk = lang === 'zh' || lang === 'zh-Hant' || lang === 'ja';
  const n = runs.join(cjk ? '、' : ', ');
  return catechism ? printed('Q.{n}', lang).replace('{n}', n) : n;
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

const POSTURE = { stand: 'All stand', sit: 'All sit', kneel: 'Kneel' } as const;

/** What the congregation does during an item ("All stand" / 众立 / 眾立); other languages fall back to English. */
export const postureLabel = (p: 'stand' | 'sit' | 'kneel', lang: Lang) => printed(POSTURE[p], lang);
/** The posture in every language, e.g. { en: 'All stand', zh: '众立' }. */
export const postureL10n = (p: 'stand' | 'sit' | 'kneel', langs: Lang[]): L10n => Object.fromEntries(langs.map((l) => [l, postureLabel(p, l)]));

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A month's short name in a language ("Oct", "okt", …); English for a language the system doesn't know. */
function monthShort(month: number, lang: Lang): string {
  if (lang === 'en') return MONTH_SHORT[month - 1];
  try {
    return new Intl.DateTimeFormat(lang, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, month - 1, 15)));
  } catch {
    return MONTH_SHORT[month - 1];
  }
}
/** Heading of next week's roster: "10月11日 服事人员" / "10月11日 服事人員" / "Serving on 11 Oct". */
export function servingOnLabel(date: string, lang: Lang): string {
  const m = date.match(/^\d{4}-(\d{2})-(\d{2})/);
  if (!m) return date;
  const [mo, d] = [Number(m[1]), Number(m[2])];
  // a language printed in English wording (no translation yet) gets the English month too
  const own = hasPrinted('Serving on {d} {mon}', lang);
  return printed('Serving on {d} {mon}', lang).replace('{d}', String(d)).replace('{mon}', monthShort(mo, own ? lang : 'en')).replace('{m}', String(mo));
}

/** Does a role (its name in any language) match a name typed in a bulletin template ("Usher" ≈ "Ushers", case-insensitive)? */
export function roleMatches(role: L10n, name: string): boolean {
  const norm = (s: string) => s.trim().toLowerCase().replace(/s$/, '');
  const want = norm(name);
  return !!want && Object.values(role).some((v) => !!v && norm(v) === want);
}
