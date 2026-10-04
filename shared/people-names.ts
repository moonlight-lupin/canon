// How a person's name is printed in worship content, per language, with their honorific title.
//  - Chinese, Japanese, Korean: native name (else the Latin name) + title after it → "陈以诺传道", "林美恩姐妹".
//  - Other languages: title before the name + preferred/first name + surname → "Ps. Chen Yi Nuo", "Sis. Grace Tan".
import type { L10n, Lang, Person } from './types.ts';

export type NamedPerson = Pick<Person, 'first_name' | 'last_name' | 'preferred_name' | 'native_name'> & { honorific?: L10n | null };

const EAST_ASIAN = (lang: Lang) => lang === 'zh' || lang.startsWith('zh-') || lang === 'ja' || lang === 'ko';
const LATIN_END = /[A-Za-z0-9.)]$/;

/** The honorific for a language; the other Chinese script is a fallback (弟兄 / 姐妹 are the same in both). */
function title(h: L10n | null | undefined, lang: Lang, eastAsian: boolean): string {
  if (!h) return '';
  const own = h[lang]?.trim();
  if (own) return own;
  if (lang === 'zh' || lang.startsWith('zh-')) {
    const other = Object.entries(h).find(([k, v]) => (k === 'zh' || k.startsWith('zh-')) && v?.trim())?.[1];
    if (other) return other.trim();
  }
  // a Latin-script language without its own title borrows the English one ("Bro.")
  return eastAsian ? '' : (h.en?.trim() ?? '');
}

/** "陈以诺传道" (zh) / "Ps. Chen Yi Nuo" (en). */
export function personDisplay(p: NamedPerson, lang: Lang): string {
  const latin = `${p.preferred_name?.trim() || p.first_name.trim()} ${p.last_name?.trim() ?? ''}`.trim();
  if (EAST_ASIAN(lang)) {
    const name = p.native_name?.trim() || latin;
    const t = title(p.honorific, lang, true);
    if (!t) return name;
    return LATIN_END.test(name) ? `${name} ${t}` : `${name}${t}`;
  }
  const t = title(p.honorific, lang, false);
  return t ? `${t} ${latin}` : latin;
}

/** The person's display name in each language. */
export const personL10n = (p: NamedPerson, langs: Lang[]): L10n => Object.fromEntries(langs.map((l) => [l, personDisplay(p, l)]));

/** Several names joined the way the language writes lists: "李约翰弟兄、张保罗弟兄" / "Bro. Li, Bro. Zhang". */
export function joinNames(names: L10n[], langs: Lang[]): L10n {
  return Object.fromEntries(
    langs.map((l) => [l, names.map((n) => n[l] ?? Object.values(n).find(Boolean) ?? '').filter(Boolean).join(EAST_ASIAN(l) ? '、' : ', ')]),
  );
}
