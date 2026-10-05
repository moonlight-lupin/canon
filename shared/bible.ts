// Bible book table and scripture-reference parsing (English + Simplified Chinese).
import type { Lang } from './types.ts';

export interface Book {
  n: number; // 1..66
  en: string;
  zh: string;
  zhAbbr: string;
  /** Traditional Chinese name and abbreviation */
  zhT: string;
  zhTAbbr: string;
  aliases: string[]; // extra normalised English abbreviations
}

const RAW: [string, string, string, string?][] = [
  ['Genesis', '创世记', '创', 'gn'],
  ['Exodus', '出埃及记', '出', 'ex'],
  ['Leviticus', '利未记', '利', 'lv'],
  ['Numbers', '民数记', '民', 'nm,nb'],
  ['Deuteronomy', '申命记', '申', 'dt'],
  ['Joshua', '约书亚记', '书', 'jos,jsh'],
  ['Judges', '士师记', '士', 'jdg,jg'],
  ['Ruth', '路得记', '得', 'rt'],
  ['1 Samuel', '撒母耳记上', '撒上', '1sm'],
  ['2 Samuel', '撒母耳记下', '撒下', '2sm'],
  ['1 Kings', '列王纪上', '王上', '1kgs'],
  ['2 Kings', '列王纪下', '王下', '2kgs'],
  ['1 Chronicles', '历代志上', '代上', '1chr'],
  ['2 Chronicles', '历代志下', '代下', '2chr'],
  ['Ezra', '以斯拉记', '拉'],
  ['Nehemiah', '尼希米记', '尼'],
  ['Esther', '以斯帖记', '斯'],
  ['Job', '约伯记', '伯', 'jb'],
  ['Psalms', '诗篇', '诗', 'ps,psa,psalm,pss'],
  ['Proverbs', '箴言', '箴', 'prv,pr'],
  ['Ecclesiastes', '传道书', '传', 'eccl,qoh'],
  ['Song of Solomon', '雅歌', '歌', 'song,sos,songofsongs,canticles'],
  ['Isaiah', '以赛亚书', '赛'],
  ['Jeremiah', '耶利米书', '耶'],
  ['Lamentations', '耶利米哀歌', '哀'],
  ['Ezekiel', '以西结书', '结', 'ezk'],
  ['Daniel', '但以理书', '但', 'dn'],
  ['Hosea', '何西阿书', '何'],
  ['Joel', '约珥书', '珥', 'jl'],
  ['Amos', '阿摩司书', '摩'],
  ['Obadiah', '俄巴底亚书', '俄'],
  ['Jonah', '约拿书', '拿', 'jnh'],
  ['Micah', '弥迦书', '弥'],
  ['Nahum', '那鸿书', '鸿'],
  ['Habakkuk', '哈巴谷书', '哈'],
  ['Zephaniah', '西番雅书', '番'],
  ['Haggai', '哈该书', '该'],
  ['Zechariah', '撒迦利亚书', '亚'],
  ['Malachi', '玛拉基书', '玛'],
  ['Matthew', '马太福音', '太', 'mt'],
  ['Mark', '马可福音', '可', 'mk,mrk'],
  ['Luke', '路加福音', '路', 'lk'],
  ['John', '约翰福音', '约', 'jn,jhn'],
  ['Acts', '使徒行传', '徒'],
  ['Romans', '罗马书', '罗', 'rm'],
  ['1 Corinthians', '哥林多前书', '林前'],
  ['2 Corinthians', '哥林多后书', '林后'],
  ['Galatians', '加拉太书', '加'],
  ['Ephesians', '以弗所书', '弗'],
  ['Philippians', '腓立比书', '腓', 'php,phil'],
  ['Colossians', '歌罗西书', '西'],
  ['1 Thessalonians', '帖撒罗尼迦前书', '帖前'],
  ['2 Thessalonians', '帖撒罗尼迦后书', '帖后'],
  ['1 Timothy', '提摩太前书', '提前'],
  ['2 Timothy', '提摩太后书', '提后'],
  ['Titus', '提多书', '多'],
  ['Philemon', '腓利门书', '门', 'phm,phlm,philem'],
  ['Hebrews', '希伯来书', '来'],
  ['James', '雅各书', '雅', 'jas,jm'],
  ['1 Peter', '彼得前书', '彼前', '1pt'],
  ['2 Peter', '彼得后书', '彼后', '2pt'],
  ['1 John', '约翰一书', '约一', '1jn'],
  ['2 John', '约翰二书', '约二', '2jn'],
  ['3 John', '约翰三书', '约三', '3jn'],
  ['Jude', '犹大书', '犹', 'jud'],
  ['Revelation', '启示录', '启', 'rev,rv,apocalypse,revelations'],
];

const TRAD: [string, string][] = [["創世記", "創"], ["出埃及記", "出"], ["利未記", "利"], ["民數記", "民"], ["申命記", "申"], ["約書亞記", "書"], ["士師記", "士"], ["路得記", "得"], ["撒母耳記上", "撒上"], ["撒母耳記下", "撒下"], ["列王紀上", "王上"], ["列王紀下", "王下"], ["歷代志上", "代上"], ["歷代志下", "代下"], ["以斯拉記", "拉"], ["尼希米記", "尼"], ["以斯帖記", "斯"], ["約伯記", "伯"], ["詩篇", "詩"], ["箴言", "箴"], ["傳道書", "傳"], ["雅歌", "歌"], ["以賽亞書", "賽"], ["耶利米書", "耶"], ["耶利米哀歌", "哀"], ["以西結書", "結"], ["但以理書", "但"], ["何西阿書", "何"], ["約珥書", "珥"], ["阿摩司書", "摩"], ["俄巴底亞書", "俄"], ["約拿書", "拿"], ["彌迦書", "彌"], ["那鴻書", "鴻"], ["哈巴谷書", "哈"], ["西番雅書", "番"], ["哈該書", "該"], ["撒迦利亞書", "亞"], ["瑪拉基書", "瑪"], ["馬太福音", "太"], ["馬可福音", "可"], ["路加福音", "路"], ["約翰福音", "約"], ["使徒行傳", "徒"], ["羅馬書", "羅"], ["哥林多前書", "林前"], ["哥林多後書", "林後"], ["加拉太書", "加"], ["以弗所書", "弗"], ["腓立比書", "腓"], ["歌羅西書", "西"], ["帖撒羅尼迦前書", "帖前"], ["帖撒羅尼迦後書", "帖後"], ["提摩太前書", "提前"], ["提摩太後書", "提後"], ["提多書", "多"], ["腓利門書", "門"], ["希伯來書", "來"], ["雅各書", "雅"], ["彼得前書", "彼前"], ["彼得後書", "彼後"], ["約翰一書", "約一"], ["約翰二書", "約二"], ["約翰三書", "約三"], ["猶大書", "猶"], ["啟示錄", "啟"]];

/** Chapters per book, Genesis … Revelation (1,189 in all: 929 Old Testament, 260 New Testament). */
export const CHAPTERS: number[] = [
  50, 40, 27, 36, 34, 24, 21, 4, 31, 24, 22, 25, 29, 36, 10, 13, 10, 42, 150, 31, 12, 8, 66, 52, 5, 48, 12, 14, 3, 9, 1, 4, 7, 3, 3, 3, 2, 14, 4,
  28, 16, 24, 21, 28, 16, 16, 13, 6, 6, 4, 4, 5, 3, 6, 4, 3, 1, 13, 5, 5, 3, 5, 1, 1, 1, 22,
];

export const BOOKS: Book[] = RAW.map(([en, zh, zhAbbr, al], i) => ({
  n: i + 1,
  en,
  zh,
  zhAbbr,
  zhT: TRAD[i][0],
  zhTAbbr: TRAD[i][1],
  aliases: al ? al.split(',') : [],
}));

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/^(i{1,3})\s+/, (_, r: string) => String(r.length)) // "II Kings" -> "2kings"
    .replace(/^(first|second|third)\s+/, (_, w: string) => String(['first', 'second', 'third'].indexOf(w) + 1))
    .replace(/[\s.]/g, '');

/** Resolve a book name/abbreviation in English or Chinese. */
export function findBook(name: string): Book | null {
  const raw = name.trim();
  if (!raw) return null;
  // Chinese: exact full name or abbreviation, then prefix of full name
  if (/[一-鿿]/.test(raw)) {
    const s = raw.replace(/\s/g, '');
    return (
      BOOKS.find((b) => b.zh === s || b.zhAbbr === s || b.zhT === s || b.zhTAbbr === s) ??
      BOOKS.find((b) => b.zh.startsWith(s) || b.zhT.startsWith(s)) ??
      null
    );
  }
  const s = norm(raw);
  if (s.length < 2 && !/^\d/.test(s)) return null;
  return (
    BOOKS.find((b) => norm(b.en) === s) ??
    BOOKS.find((b) => b.aliases.includes(s)) ??
    BOOKS.find((b) => norm(b.en).startsWith(s)) ??
    null
  );
}

export interface RefSegment {
  book: number;
  startCh: number;
  startV: number | null; // null = whole chapter(s)
  endCh: number;
  endV: number | null;
}

export class RefError extends Error {}

/**
 * Parse references such as
 *   "John 3:16", "Rom 8:28-39", "Ps 23", "Ps 23-24", "Gen 1:1-2:3",
 *   "John 3:16,18; 4:1-5", "1 Cor 13; Eph 4:1-6",
 *   "约翰福音 3:16-18", "约3：16", "诗篇23", "诗 23篇".
 */
export function parseRef(input: string): RefSegment[] {
  const text = input
    .replace(/[：]/g, ':')
    .replace(/[，、]/g, ',')
    .replace(/[；]/g, ';')
    .replace(/[–—~～至]/g, '-')
    .replace(/[章篇]/g, ' ')
    .replace(/[节節]/g, '')
    .trim();
  if (!text) throw new RefError('Empty reference');
  const segs: RefSegment[] = [];
  let book: Book | null = null;
  let chapter: number | null = null;

  for (const partRaw of text.split(';')) {
    const part = partRaw.trim();
    if (!part) continue;
    // Optional leading book name: everything up to the first digit that is followed by ':' / end / '-'
    const m = part.match(/^((?:[1-3]\s*)?[^\d]+?)\s*(\d.*)?$/);
    let rest = part;
    if (m && m[1] && /[A-Za-z一-鿿]/.test(m[1])) {
      const b = findBook(m[1]);
      if (!b) throw new RefError(`Unknown book: "${m[1].trim()}"`);
      book = b;
      chapter = null;
      rest = (m[2] ?? '').trim();
    }
    if (!book) throw new RefError(`Missing book in "${part}"`);
    if (!rest) {
      // single-chapter books like Jude: whole book = chapter 1
      segs.push({ book: book.n, startCh: 1, startV: null, endCh: 999, endV: null });
      continue;
    }
    const pieces = rest.split(',').map((p) => p.replace(/\s/g, ''));
    for (const p of pieces) {
      if (!p) continue;
      const [a, b] = p.split('-');
      const pa = parsePoint(a, chapter, !!chapter && !a.includes(':'));
      if (b === undefined) {
        segs.push({ book: book.n, startCh: pa.ch, startV: pa.v, endCh: pa.ch, endV: pa.v });
        chapter = pa.v !== null ? pa.ch : null;
        continue;
      }
      // end point: "18" means verse if start had a verse, chapter otherwise; "2:3" is chapter:verse
      let endCh: number;
      let endV: number | null;
      if (b.includes(':')) {
        const [c, v] = b.split(':').map(Number);
        endCh = c;
        endV = v;
      } else if (pa.v !== null) {
        endCh = pa.ch;
        endV = Number(b);
      } else {
        endCh = Number(b);
        endV = null;
      }
      if (!Number.isFinite(endCh) || (endV !== null && !Number.isFinite(endV))) {
        throw new RefError(`Bad range "${p}"`);
      }
      segs.push({ book: book.n, startCh: pa.ch, startV: pa.v, endCh, endV });
      chapter = endV !== null ? endCh : null;
    }
  }
  if (!segs.length) throw new RefError('No passage found');
  return segs;
}

function parsePoint(s: string, chapter: number | null, verseOnly: boolean): { ch: number; v: number | null } {
  if (s.includes(':')) {
    const [c, v] = s.split(':').map(Number);
    if (!Number.isFinite(c) || !Number.isFinite(v)) throw new RefError(`Bad reference "${s}"`);
    return { ch: c, v };
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) throw new RefError(`Bad reference "${s}"`);
  // after "John 3:16," a bare number is another verse of chapter 3
  if (verseOnly && chapter !== null) return { ch: chapter, v: n };
  return { ch: n, v: null };
}

/** Book name in a language: Chinese scripts have their own names; other languages use English for now. */
export const bookName = (b: Book, lang: Lang) => (lang === 'zh' ? b.zh : lang === 'zh-Hant' ? b.zhT : b.en);

/** Human-readable reference in the given language. */
export function formatRef(segs: RefSegment[], lang: Lang): string {
  const out: string[] = [];
  let prevBook = -1;
  for (const s of segs) {
    const b = BOOKS[s.book - 1];
    const name = bookName(b, lang);
    let r: string;
    if (s.startV === null) {
      r = s.endCh === 999 || s.endCh === s.startCh ? (s.endCh === 999 ? '' : `${s.startCh}`) : `${s.startCh}-${s.endCh}`;
    } else if (s.endCh !== s.startCh) {
      r = `${s.startCh}:${s.startV}-${s.endCh}:${s.endV}`;
    } else if (s.endV !== s.startV) {
      r = `${s.startCh}:${s.startV}-${s.endV}`;
    } else {
      r = `${s.startCh}:${s.startV}`;
    }
    out.push(s.book === prevBook ? r : `${name} ${r}`.trim());
    prevBook = s.book;
  }
  return out.join('; ');
}
