// Library: categories, hymnal numbers and language badges shared by its tabs.
import { matchesHymnNumber } from '../../../shared/parts.ts';
import { useContentLangs } from '../../i18n.tsx';
import { langInfo } from '../../../shared/languages.ts';
import type { Hymnal, L10n, Song, SongCategory, TextCategory } from '../../types-client.ts';

export const SONG_CATS: SongCategory[] = ['hymn', 'psalm', 'song', 'doxology', 'response'];

export const SONG_CAT_LABEL: Record<SongCategory, L10n> = {
  hymn: { en: 'Hymn', zh: '圣诗' }, psalm: { en: 'Psalm', zh: '诗篇' }, song: { en: 'Song', zh: '诗歌' },
  doxology: { en: 'Doxology', zh: '颂荣' }, response: { en: 'Response', zh: '回应' },
};

export const TEXT_CATS: TextCategory[] = ['call_to_worship', 'invocation', 'confession', 'assurance', 'creed', 'catechism', 'prayer', 'sacrament', 'benediction', 'liturgy', 'other'];

export const TEXT_CAT_LABEL: Record<TextCategory, L10n> = {
  call_to_worship: { en: 'Call to worship', zh: '宣召' }, invocation: { en: 'Invocation', zh: '祈祷' },
  confession: { en: 'Confession of sin', zh: '认罪' }, assurance: { en: 'Assurance of pardon', zh: '赦罪宣告' },
  creed: { en: 'Creed', zh: '信经' }, catechism: { en: 'Catechism', zh: '要理问答' }, prayer: { en: 'Prayer', zh: '祷文' },
  sacrament: { en: 'Sacrament', zh: '圣礼' }, benediction: { en: 'Benediction', zh: '祝福' }, liturgy: { en: 'Liturgy', zh: '礼文' },
  other: { en: 'Other', zh: '其他' },
};

export type HymnalRow = Hymnal & { song_count: number };

export const STANDARD_KEYS = ['wsc', 'wlc', 'wcf'];

/** "HP 123 · TH 100" */
export const numbersOf = (s: Song) => (s.hymnals ?? []).map((h) => `${h.abbr} ${h.number}`).join(' · ');

/** Does a song match a search: words anywhere, or a hymnal number ("HP 123", "#123", "123")? */
export function songMatches(s: Song, q: string): boolean {
  const ql = q.trim().toLowerCase();
  if (!ql) return true;
  if (matchesHymnNumber(s.hymnals, ql)) return true;
  return JSON.stringify([s.title, s.author, s.tune, s.tags, s.psalm, s.stanzas[0]]).toLowerCase().includes(ql);
}

/** Languages that have text in any of the given localised values. */
export const langsIn = (vs: (L10n | undefined)[]) => [...new Set(vs.flatMap((v) => Object.keys(v ?? {}).filter((k) => v?.[k]?.trim())))];

/** One badge per church language: filled when text exists, warning "?" when missing. */
export function LangBadges({ present }: { present: string[] }) {
  const langs = useContentLangs();
  const chinese = present.some((l) => l === 'zh' || l === 'zh-Hant');
  return (
    <span className="row" style={{ gap: 3, flexWrap: 'nowrap' }}>
      {langs.map((l) => {
        const ok = present.includes(l) || ((l === 'zh' || l === 'zh-Hant') && chinese);
        return <span key={l} className={`badge ${ok ? 'lapis' : 'warn'}`} title={langInfo(l).name}>{langInfo(l).short}{ok ? '' : ' ?'}</span>;
      })}
    </span>
  );
}
