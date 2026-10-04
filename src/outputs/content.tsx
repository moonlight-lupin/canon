// Shared renderers for the outputs (bulletin, share page): bilingual item content split into
// small "pieces" (a stanza, a verse, a paragraph) so the bulletin can paginate at those boundaries.
import { Fragment, type ReactNode } from 'react';
import type { L10n, Lang, Line, Paras, RenderedItem, RenderedService } from '../types-client.ts';
import type { RenderedVerse } from '../../shared/render-types.ts';
import { langInfo } from '../../shared/languages.ts';
import { speakerLabel } from '../../shared/labels.ts';
import { OUTPUT_LABEL, dateIn, formatDate, isNumbered, isRefrain, stanzaLabel } from '../../shared/output-labels.ts';
import './outputs.css';

export { dateIn, formatDate, isNumbered, isRefrain, stanzaLabel };

export type Layout = 'parallel' | 'stacked';
/** A single language code, or 'both' = every language of the service (in its order). */
export type LangMode = Lang | 'both';

/** HTML lang attribute for a content language. */
export const LANG_ATTR = new Proxy({} as Record<Lang, string>, { get: (_t, code) => (typeof code === 'string' ? langInfo(code).htmlLang : undefined) });

/** Languages to show, in the service's order, for a toolbar choice. */
export function langsFor(mode: LangMode, serviceLangs: Lang[]): Lang[] {
  if (mode !== 'both') return [mode];
  return serviceLangs.length ? serviceLangs : ['en'];
}
export const modeFor = (langs: Lang[]): LangMode => (langs.length === 1 ? langs[0] : 'both');

/** Toolbar choices for a service: each of its languages, plus "Both" / "All languages" when there are several. */
export function langOptions(serviceLangs: Lang[], t: (s: string) => string): { value: LangMode; label: ReactNode }[] {
  const ls = serviceLangs.length ? serviceLangs : ['en'];
  const opts: { value: LangMode; label: ReactNode }[] = ls.map((l) => ({
    value: l,
    label: <span title={langInfo(l).native} lang={langInfo(l).htmlLang}>{langInfo(l).short}</span>,
  }));
  if (ls.length > 1) opts.push({ value: 'both', label: ls.length > 2 ? t('All languages') : t('Both') });
  return opts;
}

// ---------------------------------------------------------------- text helpers

// pick, hasAny, biParts and biText live in shared/output-labels.ts so the slide model also runs on the server / in tests
import { biParts, biText, hasAny, pick } from '../../shared/output-labels.ts';

export { biParts, biText, hasAny, pick };

/** Bilingual label as spans with proper lang attributes. */
export function Bi({ v, langs, sep = ' ', className }: { v: L10n | null | undefined; langs: Lang[]; sep?: string; className?: string }) {
  const parts = biParts(v, langs);
  if (!parts.length) return null;
  return (
    <span className={className}>
      {parts.map((p, i) => (
        <Fragment key={p.lang}>
          {i > 0 && sep}
          <span lang={LANG_ATTR[p.lang]} className={`bi-${p.lang}${langInfo(p.lang).cjk ? ' bi-cjk' : ''}${i > 0 ? ' bi-alt' : ''}`}>{p.text}</span>
        </Fragment>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------- dates & times

/** The date in every language of the service, keyed by language (see shared/output-labels.ts). */
export function dateParts(date: string, langs: Lang[]): Record<Lang, string> {
  return Object.fromEntries(langs.map((l) => [l, dateIn(date, l)]));
}
export const timeRange = (r: Pick<RenderedService, 'start_time' | 'end_time'>) =>
  `${r.start_time}${r.end_time ? `–${r.end_time}` : ''}`;

// ---------------------------------------------------------------- labels

/** Speaker marker (Leader / People / All) in a language. */
export const speaker = (who: 'L' | 'C' | 'A', lang: Lang) => speakerLabel(who, lang);

/** Fixed multilingual labels printed in outputs (not UI chrome, so not tied to the UI language). */
export const LABEL = OUTPUT_LABEL;

const splitLines = (s: string | undefined) =>
  (s ?? '').replace(/\r/g, '').split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());

// ---------------------------------------------------------------- pieces

/** An atomic piece of content. `split` breaks an over-tall piece into smaller ones. */
export interface Piece {
  key: string;
  node: ReactNode;
  split?: () => Piece[];
  /** keep on the same page as the previous piece (credits, refrain cues) */
  glue?: boolean;
}

/** A row of language cells: two columns when parallel, otherwise a single cell. */
function Row({ cells, cls }: { cells: { lang: Lang; node: ReactNode }[]; cls?: string }) {
  if (cells.length === 1) {
    return <div className={`ic-one ${cls ?? ''}`} lang={LANG_ATTR[cells[0].lang]}>{cells[0].node}</div>;
  }
  return (
    <div className={`ic-row ${cls ?? ''}`} style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
      {cells.map((c) => (
        <div key={c.lang} className="ic-cell" lang={LANG_ATTR[c.lang]}>{c.node}</div>
      ))}
    </div>
  );
}

function LangTag({ lang, text }: { lang: Lang; text: string }) {
  return <div className="ic-tag" lang={LANG_ATTR[lang]}>{text}</div>;
}

// ---- songs

function StanzaNode({ label, text, lang }: { label: string; text: string; lang: Lang }) {
  const refrain = isRefrain(label);
  const num = isNumbered(label);
  const lines = splitLines(text);
  return (
    <div className={`ic-stanza${refrain ? ' refrain' : ''}`}>
      {num && <span className="ic-num">{label.trim()}</span>}
      {!num && label.trim() && <div className="ic-stanza-label">{stanzaLabel(label, lang)}</div>}
      {lines.map((l, i) => (
        <div key={i} className="ic-l">{l}</div>
      ))}
    </div>
  );
}

function songPieces(it: RenderedItem, langs: Lang[], layout: Layout, compactRefrain: boolean): Piece[] {
  const song = it.song!;
  const songLangs = langs.filter((l) => song.stanzas.some((s) => s.text[l]?.trim()));
  if (!songLangs.length) return [];
  const pieces: Piece[] = [];
  const parallel = layout === 'parallel' && songLangs.length > 1;

  const run = (ls: Lang[], prefix: string) => {
    const seen = new Set<string>();
    song.stanzas.forEach((st, i) => {
      const present = ls.filter((l) => st.text[l]?.trim());
      if (!present.length) return;
      const refrain = isRefrain(st.label);
      const key = `${st.label}|${ls.map((l) => st.text[l] ?? '').join('|')}`;
      if (refrain && compactRefrain && seen.has(key)) {
        const cue = [...new Set(ls.map((l) => stanzaLabel(st.label, l)))].join(' ');
        pieces.push({ key: `${prefix}s${i}`, node: <div className="ic-cue">({cue})</div>, glue: true });
        return;
      }
      if (refrain) seen.add(key);
      pieces.push({
        key: `${prefix}s${i}`,
        node: <Row cells={ls.map((l) => ({ lang: l, node: st.text[l]?.trim() ? <StanzaNode label={st.label} text={st.text[l]!} lang={l} /> : null }))} />,
      });
    });
  };
  if (parallel) run(songLangs, 'p');
  else
    songLangs.forEach((l, li) => {
      if (li > 0) pieces.push({ key: `gap${l}`, node: <div className="ic-langgap" /> });
      run([l], l);
    });

  const credit = [
    song.author && `Words: ${song.author}`,
    song.composer && `Music: ${song.composer}`,
    song.tune && `Tune: ${song.tune}${song.meter ? ` (${song.meter})` : ''}`,
  ].filter(Boolean).join(' · ');
  const copy = !song.public_domain ? [song.copyright, song.ccli && `CCLI Song #${song.ccli}`].filter(Boolean).join('. ') : '';
  if (credit || copy) {
    pieces.push({
      key: 'credit',
      glue: true,
      node: (
        <div className="ic-credit">
          {credit}
          {credit && copy && <br />}
          {copy}
        </div>
      ),
    });
  }
  return pieces;
}

// ---- scripture

function verseNum(v: RenderedVerse, first: RenderedVerse | undefined) {
  return first && v.chapter !== first.chapter ? `${v.chapter}:${v.verse}` : String(v.verse);
}
function VerseNode({ v, first }: { v: RenderedVerse; first?: RenderedVerse }) {
  return (
    <p className="ic-verse">
      <sup>{verseNum(v, first)}</sup>
      {v.text.trim()}
    </p>
  );
}

function scripturePieces(it: RenderedItem, langs: Lang[], layout: Layout): Piece[] {
  const sc = it.scripture;
  const verseLangs = langs.filter((l) => sc?.passages[l]?.verses.length);
  const paraLangs = langs.filter((l) => !verseLangs.includes(l) && it.paras?.[l]?.length);
  const present = langs.filter((l) => verseLangs.includes(l) || paraLangs.includes(l));
  if (!present.length) return [];
  const pieces: Piece[] = [];
  const showTag = present.length > 1;
  const tagText = (l: Lang) => sc?.passages[l]?.translation ?? '';

  if (layout === 'parallel' && verseLangs.length > 1 && paraLangs.length === 0) {
    // Align verse by verse across the columns.
    const keys: string[] = [];
    const by: Record<string, Partial<Record<Lang, RenderedVerse>>> = {};
    for (const l of verseLangs) {
      for (const v of sc!.passages[l]!.verses) {
        const k = `${v.chapter}:${v.verse}`;
        if (!by[k]) {
          by[k] = {};
          keys.push(k);
        }
        by[k][l] = v;
      }
    }
    pieces.push({ key: 'tags', node: <Row cls="ic-tags" cells={verseLangs.map((l) => ({ lang: l, node: <LangTag lang={l} text={tagText(l)} /> }))} /> });
    for (const k of keys) {
      pieces.push({
        key: `v${k}`,
        node: <Row cls="ic-vrow" cells={verseLangs.map((l) => ({ lang: l, node: by[k][l] ? <VerseNode v={by[k][l]!} first={sc!.passages[l]!.verses[0]} /> : null }))} />,
      });
    }
    return pieces;
  }

  present.forEach((l, li) => {
    if (li > 0) pieces.push({ key: `gap${l}`, node: <div className="ic-langgap" /> });
    if (verseLangs.includes(l)) {
      const verses = sc!.passages[l]!.verses;
      if (showTag) pieces.push({ key: `tag${l}`, node: <Row cls="ic-tags" cells={[{ lang: l, node: <LangTag lang={l} text={tagText(l)} /> }]} /> });
      verses.forEach((v) => {
        pieces.push({ key: `${l}v${v.chapter}:${v.verse}`, node: <Row cls="ic-vrow" cells={[{ lang: l, node: <VerseNode v={v} first={verses[0]} /> }]} /> });
      });
    } else {
      pieces.push(...parasPieces(it.paras![l]!, [l], 'stacked', false, l));
    }
  });
  return pieces;
}

// ---- liturgical text

function ParaNode({ para, lang, markers }: { para: Line[]; lang: Lang; markers: boolean }) {
  let prev: Line['who'] | undefined;
  return (
    <div className="ic-para">
      {para.map((ln, i) => {
        const show = markers && ln.who && ln.who !== prev;
        prev = ln.who;
        const strong = ln.who === 'C' || ln.who === 'A';
        return (
          <div key={i} className={`ic-l${strong ? ' strong' : ''}`}>
            {show && <span className="ic-who">{speakerLabel(ln.who!, lang)}</span>}
            {ln.text}
          </div>
        );
      })}
    </div>
  );
}

function parasPieces(parasBy: Paras | Partial<Record<Lang, Paras>>, langs: Lang[], layout: Layout, markers = true, prefix = ''): Piece[] {
  const get = (l: Lang): Paras => (Array.isArray(parasBy) ? (parasBy as Paras) : ((parasBy as Partial<Record<Lang, Paras>>)[l] ?? []));
  const present = langs.filter((l) => get(l).length);
  if (!present.length) return [];
  const pieces: Piece[] = [];
  const lineSplit = (ls: Lang[], i: number, key: string) => () => {
    const n = Math.max(...ls.map((l) => get(l)[i]?.length ?? 0));
    const out: Piece[] = [];
    for (let j = 0; j < n; j++) {
      out.push({
        key: `${key}l${j}`,
        node: <Row cells={ls.map((l) => ({ lang: l, node: get(l)[i]?.[j] ? <ParaNode para={[get(l)[i][j]]} lang={l} markers={markers} /> : null }))} cls="ic-tight" />,
      });
    }
    return out;
  };
  if (layout === 'parallel' && present.length > 1) {
    // Pair paragraph i of each language so responses line up across the columns.
    const n = Math.max(...present.map((l) => get(l).length));
    for (let i = 0; i < n; i++) {
      const key = `${prefix}p${i}`;
      pieces.push({
        key,
        node: <Row cells={present.map((l) => ({ lang: l, node: get(l)[i] ? <ParaNode para={get(l)[i]} lang={l} markers={markers} /> : null }))} />,
        split: lineSplit(present, i, key),
      });
    }
    return pieces;
  }
  present.forEach((l, li) => {
    if (li > 0) pieces.push({ key: `${prefix}gap${l}`, node: <div className="ic-langgap" /> });
    get(l).forEach((para, i) => {
      const key = `${prefix}${l}p${i}`;
      pieces.push({ key, node: <Row cells={[{ lang: l, node: <ParaNode para={para} lang={l} markers={markers} /> }]} />, split: lineSplit([l], i, key) });
    });
  });
  return pieces;
}

// ---------------------------------------------------------------- public API

/** Does the item carry printable words (hymn, passage, liturgy) in any of these languages? */
export function hasContent(it: RenderedItem, langs: Lang[]): boolean {
  if (it.song) return it.song.stanzas.some((s) => langs.some((l) => s.text[l]?.trim()));
  if (it.kind === 'scripture') return langs.some((l) => it.scripture?.passages[l]?.verses.length || it.paras?.[l]?.length);
  return langs.some((l) => it.paras?.[l]?.length);
}

/** The item's words as pieces that may be laid out across pages. */
export function itemPieces(it: RenderedItem, langs: Lang[], layout: Layout, compactRefrain = true): Piece[] {
  if (it.song?.stanzas.length) return songPieces(it, langs, layout, compactRefrain);
  if (it.kind === 'scripture') return scripturePieces(it, langs, layout);
  if (it.paras) return parasPieces(it.paras, langs, layout);
  return [];
}

/** The item's words (hymn stanzas, scripture, liturgy) in one or two languages. */
export function ItemContent({ item, langs, layout, compactRefrain = true }: { item: RenderedItem; langs: Lang[]; layout: Layout; compactRefrain?: boolean }) {
  const pieces = itemPieces(item, langs, layout, compactRefrain);
  if (!pieces.length) return null;
  return (
    <div className="ic">
      {pieces.map((p) => (
        <Fragment key={p.key}>{p.node}</Fragment>
      ))}
    </div>
  );
}

/** Secondary lines under an item title: hymn / passage / text title, plus the sermon reference. */
export function itemSubtitles(it: RenderedItem, r: RenderedService, langs: Lang[]): L10n[] {
  const subs: L10n[] = [];
  const same = (a: L10n, b: L10n) => biText(a, langs) === biText(b, langs);
  if (hasAny(it.subtitle) && !same(it.subtitle, it.title)) subs.push(it.subtitle);
  if (it.kind === 'sermon' && hasAny(r.sermon_ref) && biText(r.sermon_ref, langs) !== biText(it.subtitle, langs)) subs.push(r.sermon_ref);
  return subs;
}
