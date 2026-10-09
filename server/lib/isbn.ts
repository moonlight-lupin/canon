// ISBN lookup for the lending library (0.15): fills in a book's details from Open Library, else Google Books. Only the
// ISBN is sent. Without internet the librarian types the details; nothing else depends on this.
import { cleanIsbn } from '../repo/lending.ts';

export interface IsbnResult {
  isbn: string;
  title: string;
  subtitle: string | null;
  authors: string | null;
  publisher: string | null;
  year: number | null;
  language: string | null;
  description: string | null;
  cover_url: string | null;
  source: 'Open Library' | 'Google Books';
}

const TIMEOUT_MS = 8000;
/** Where a cover may be downloaded from (the lookup's own image servers). */
const COVER_HOSTS = /^(covers\.openlibrary\.org|books\.google\.com|books\.googleusercontent\.com)$/;
const MAX_COVER_BYTES = 2 * 1024 * 1024;

// MARC language codes (Open Library) → the languages Canon knows
const MARC: Record<string, string> = { eng: 'en', chi: 'zh', zho: 'zh', may: 'ms', msa: 'ms', ind: 'id', tam: 'ta', kor: 'ko', jpn: 'ja', spa: 'es', tgl: 'tl', fil: 'tl', vie: 'vi' };
/** A MARC language code ("eng", or Open Library's "/languages/eng") as Canon's language code; null when unknown. */
export const marcLanguage = (code: string | null | undefined) => (code ? MARC[code.replace(/^\/languages\//, '').toLowerCase()] ?? null : null);

const yearOf = (s: unknown) => {
  const m = String(s ?? '').match(/\b(1[5-9]\d\d|20\d\d|21\d\d)\b/);
  return m ? Number(m[1]) : null;
};

async function getJson(url: string): Promise<unknown> {
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json', 'User-Agent': 'Canon church library (ISBN lookup)' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function openLibrary(isbn: string): Promise<IsbnResult | null> {
  const data = (await getJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`)) as Record<string, Record<string, unknown>>;
  const b = data[`ISBN:${isbn}`];
  if (!b || typeof b.title !== 'string') return null;
  const names = (v: unknown) => (Array.isArray(v) ? v.map((x) => (x as { name?: string }).name).filter(Boolean).join(', ') : '') || null;
  const cover = b.cover as { medium?: string; large?: string } | undefined;
  // the language is on the edition record only (0.19.10: it was left empty)
  const edition = (await getJson(`https://openlibrary.org/isbn/${isbn}.json`).catch(() => null)) as { languages?: { key?: string }[] } | null;
  return {
    isbn, title: b.title, subtitle: typeof b.subtitle === 'string' ? b.subtitle : null, authors: names(b.authors), publisher: names(b.publishers),
    year: yearOf(b.publish_date), language: marcLanguage(edition?.languages?.[0]?.key), description: null, cover_url: cover?.medium ?? cover?.large ?? null, source: 'Open Library',
  };
}

async function googleBooks(isbn: string): Promise<IsbnResult | null> {
  const data = (await getJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`)) as { items?: { volumeInfo?: Record<string, unknown> }[] };
  const v = data.items?.[0]?.volumeInfo;
  if (!v || typeof v.title !== 'string') return null;
  const img = (v.imageLinks as { thumbnail?: string; smallThumbnail?: string } | undefined);
  const lang = typeof v.language === 'string' ? v.language : null;
  return {
    isbn, title: v.title, subtitle: typeof v.subtitle === 'string' ? v.subtitle : null,
    authors: Array.isArray(v.authors) ? v.authors.join(', ') : null, publisher: typeof v.publisher === 'string' ? v.publisher : null,
    year: yearOf(v.publishedDate), language: lang ? (lang.startsWith('zh') ? (/tw|hk|hant/i.test(lang) ? 'zh-Hant' : 'zh') : lang.slice(0, 2)) : null,
    description: typeof v.description === 'string' ? v.description.slice(0, 2000) : null,
    cover_url: (img?.thumbnail ?? img?.smallThumbnail ?? null)?.replace(/^http:/, 'https:') ?? null, source: 'Google Books',
  };
}

/** The book with this ISBN, or null when neither source knows it. Throws when there is no internet. */
export async function lookupIsbn(raw: string): Promise<IsbnResult | null> {
  const isbn = cleanIsbn(raw);
  if (!isbn) throw Object.assign(new Error(`“${raw}” is not an ISBN (10 or 13 digits).`), { status: 400 });
  let failed: unknown = null;
  for (const source of [openLibrary, googleBooks]) {
    try {
      const r = await source(isbn);
      if (r) return r;
    } catch (e) {
      failed = e;
    }
  }
  if (failed) throw Object.assign(new Error('The book details could not be looked up (no internet?). Type them in instead.'), { status: 502 });
  return null;
}

/** Download a cover found by the lookup (only from the lookup's image servers). */
export async function fetchCover(url: string): Promise<{ mime: string; data: Buffer }> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw Object.assign(new Error('That cover address is not valid.'), { status: 400 });
  }
  if (u.protocol !== 'https:' || !COVER_HOSTS.test(u.hostname)) throw Object.assign(new Error('Covers come from the ISBN lookup only.'), { status: 400 });
  const r = await fetch(u, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': 'Canon church library (cover)' } });
  const mime = (r.headers.get('content-type') ?? '').split(';')[0].trim();
  if (!r.ok || !/^image\/(jpeg|png|webp|gif)$/.test(mime)) throw Object.assign(new Error('The cover could not be downloaded.'), { status: 502 });
  const data = Buffer.from(await r.arrayBuffer());
  if (data.length > MAX_COVER_BYTES || data.length < 200) throw Object.assign(new Error('The cover could not be downloaded.'), { status: 502 });
  return { mime, data };
}
