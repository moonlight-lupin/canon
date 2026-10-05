// The printed order of service. Content is laid out as a flow of small blocks, measured in a hidden
// container at the page width, paginated into fixed page boxes and — for booklets — imposed onto
// landscape sheets for duplex printing (fold in half to read).
//
// The bulletin template's page layout decides the shape: an ordered list of sections (cover or banner, the order
// as a list or a three-column table, full texts, the weekly announcements, a pastor's note, fixed texts, serving
// tables, QR codes …) with page breaks and a back-cover group that always lands on the last page.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { ErrorBox, Loading, Seg } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import type { L10n, Lang, PaperSize, RenderedItem, RenderedService } from '../types-client.ts';
import {
  Bi, LABEL, LANG_ATTR, biParts, biText, dateParts, hasAny, itemPieces, itemSubtitles, langOptions, langsFor, modeFor, timeRange,
  type LangMode, type Layout, type Piece,
} from './content.tsx';
import { CrossMark, logoUrl, useLogo } from '../components/brand.tsx';
import {
  ANNOUNCEMENTS_KEY, DEFAULT_BULLETIN_OPTIONS, blockImageUrl, blockQrSrc, blockQrUrl, bracket, bracketL10n, bulletinDecision, firstStanza, hasSection, hymnLine,
  padBooklet, withVersion,
  type BulletinBlock, type BulletinFull, type BulletinOptions, type BulletinSection, type BulletinTemplate,
} from '../../shared/presentation.ts';
import { postureL10n, roleMatches, servingOnLabel } from '../../shared/labels.ts';
import { langInfo } from '../../shared/languages.ts';
import './outputs.css';
import './bulletin-layout.css';

// ---------------------------------------------------------------- paper geometry (mm)

const IN = 25.4;
const PX_PER_MM = 96 / 25.4;
const FOOT_MM = 7;

export interface PaperSpec {
  page: [number, number];
  margin: number;
  /** landscape sheet that two pages are imposed on (booklets only) */
  sheet?: [number, number];
  css: string;
  font: number;
  label: string;
}
export const PAPERS: Record<PaperSize, PaperSpec> = {
  'a4-booklet': { page: [148.5, 210], margin: 12, sheet: [297, 210], css: 'A4 landscape', font: 9.5, label: 'A4 landscape, folded (A5 booklet)' },
  a4: { page: [210, 297], margin: 18, css: 'A4 portrait', font: 11, label: 'A4 portrait' },
  a5: { page: [148, 210], margin: 12, css: 'A5 portrait', font: 9.5, label: 'A5 single pages' },
  'letter-booklet': { page: [5.5 * IN, 8.5 * IN], margin: 0.5 * IN, sheet: [11 * IN, 8.5 * IN], css: 'letter landscape', font: 9.5, label: 'US Letter, folded (booklet)' },
  letter: { page: [8.5 * IN, 11 * IN], margin: 0.75 * IN, css: 'letter portrait', font: 11, label: 'US Letter portrait' },
};
export const PAPER_ORDER: PaperSize[] = ['a4-booklet', 'a4', 'a5', 'letter-booklet', 'letter'];

// ---------------------------------------------------------------- blocks

export interface Block {
  key: string;
  node: ReactNode;
  /** keep with the following block (headings, a section kept together) */
  keep?: boolean;
  /** start a new page with this block (a page break, or a section that starts a new page) */
  breakBefore?: boolean;
  split?: () => Block[];
  /** a whole page on its own: the cover page or a ruled sermon-notes page */
  page?: 'cover' | 'notes';
  /** the page holding this block has no page number (the banner on page 1) */
  nonum?: boolean;
}

type PageSpec =
  | { kind: 'flow'; keys: string[] }
  | { kind: 'blank'; notes: boolean };

/** Sheets for saddle-stitch imposition: front = [N-2k, 2k+1], back = [2k+2, N-2k-1] (1-based). */
export function impose(n: number): { side: 'front' | 'back'; pages: [number, number] }[] {
  const out: { side: 'front' | 'back'; pages: [number, number] }[] = [];
  for (let k = 0; k < n / 4; k++) {
    out.push({ side: 'front', pages: [n - 2 * k, 2 * k + 1] });
    out.push({ side: 'back', pages: [2 * k + 2, n - 2 * k - 1] });
  }
  return out;
}

/** Greedy pagination with keep-with-next chains, forced page breaks and whole-page blocks. Returns groups of block indices. */
function paginate(heights: number[], keep: boolean[], cap: number, brk: boolean[] = [], whole: boolean[] = []): number[][] {
  const pages: number[][] = [];
  let cur: number[] = [];
  let used = 0;
  for (let i = 0; i < heights.length; i++) {
    if (whole[i]) {
      if (cur.length) pages.push(cur);
      pages.push([i]);
      cur = [];
      used = 0;
      continue;
    }
    let need = heights[i];
    for (let j = i; keep[j] && j + 1 < heights.length && !whole[j + 1] && !brk[j + 1]; j++) need += heights[j + 1];
    if (need > cap) need = heights[i];
    if (cur.length && (brk[i] || used + need > cap)) {
      pages.push(cur);
      cur = [];
      used = 0;
    }
    cur.push(i);
    used += heights[i];
  }
  if (cur.length) pages.push(cur);
  return pages;
}

function pieceBlock(p: Piece, prefix: string): Block {
  return {
    key: prefix + p.key,
    node: <div className="ic">{p.node}</div>,
    split: p.split ? () => p.split!().map((q) => pieceBlock(q, prefix)) : undefined,
  };
}

function SectionHead({ v, langs }: { v: L10n; langs: Lang[] }) {
  return (
    <div className="bl-section">
      <span><Bi v={v} langs={langs} sep="  ·  " /></span>
    </div>
  );
}

/** What to show around each item (from the bulletin template). */
export interface ItemShow {
  leaders: boolean;
  times: boolean;
  /** print the posture (All stand / 众立) */
  posture?: boolean;
}

/** How the order is laid out (from the bulletin template and its page layout). */
export interface FlowFormat {
  order_style: BulletinOptions['order_style'];
  hymn_number: BulletinOptions['hymn_number'];
  sermon_brackets: boolean;
  /** the layout has a full-texts section: the words are gathered there instead of under each item */
  separateText: boolean;
  /** the layout has an announcements section: the Announcements item prints its title only */
  separateAnn: boolean;
  /** the banner (dark band) opens page 1 instead of a cover page: no "Order of service" heading */
  bannerCover: boolean;
}

/** The secondary lines of an item as the template wants them: hymn numbers, 【sermon】 and 【creed】 titles. */
function whatLines(it: RenderedItem, r: RenderedService, langs: Lang[], f: FlowFormat, skip: Set<string>): L10n[] {
  // a subtitle deliberately blank in every printed language (e.g. the same as the item title) is not borrowed from another language
  let subs = itemSubtitles(it, r, langs).filter((s) => !langs.every((l) => l in s && !s[l]?.trim()));
  // a reading always carries its Bible version code: "雅各书 3:13-18 (CUVS)"
  if (it.kind === 'scripture' && subs.length && biText(subs[0], langs) === biText(it.subtitle, langs)) subs = [withVersion(subs[0], it.scripture, langs), ...subs.slice(1)];
  if (it.song && f.hymn_number !== 'abbr') {
    const line = hymnLine(it.song, it.subtitle, langs, f.hymn_number);
    subs = biText(line, langs) === biText(it.title, langs) ? subs.slice(1) : [line, ...subs.slice(1)];
  }
  if (f.sermon_brackets && subs.length) {
    if (it.kind === 'sermon' && hasAny(r.sermon_title) && biText(subs[0], langs) === biText(r.sermon_title, langs)) {
      subs = [bracketL10n(subs[0], undefined, langs), ...subs.slice(1)];
    } else if (it.kind === 'text' && it.text_title) {
      subs = [bracketL10n(subs[0], it.text_title, langs), ...subs.slice(1)];
    }
  }
  // a sermon reference already printed as its own reading is not repeated under the sermon
  return subs.filter((s, i) => !(it.kind === 'sermon' && i > 0 && skip.has(biText(s, langs))));
}

/** Who leads the item, else (when asked) the posture. */
function whoOf(it: RenderedItem, langs: Lang[], show: ItemShow): L10n | null {
  if (show.leaders && it.leader) return it.leader_l10n ?? { [langs[0]]: it.leader };
  if (show.posture && it.posture) return postureL10n(it.posture, langs);
  return null;
}

function ItemHead({ it, subs, langs, compact, show }: { it: RenderedItem; subs: L10n[]; langs: Lang[]; compact: boolean; show: ItemShow }) {
  const leader = show.leaders && it.leader ? it.leader_l10n ?? { [langs[0]]: it.leader } : null;
  return (
    <div className={`bl-item${compact ? ' compact' : ''}`}>
      <div className="bl-item-row">
        {show.times && <span className="bl-time">{it.start}</span>}
        <Bi className="bl-item-title" v={it.title} langs={langs} />
        {leader && <Bi className="bl-leader" v={leader} langs={langs} sep=" · " />}
        {show.posture && it.posture && <Bi className="bl-posture" v={postureL10n(it.posture, langs)} langs={langs} sep=" · " />}
      </div>
      {subs.map((s, i) => (
        <div key={i} className="bl-sub"><Bi v={s} langs={langs} sep="  ·  " /></div>
      ))}
    </div>
  );
}

function TableRow({ it, subs, who, langs, alt, time }: { it: RenderedItem; subs: L10n[]; who: L10n | null; langs: Lang[]; alt: boolean; time: boolean }) {
  return (
    <div className={`bl-tr${alt ? ' alt' : ''}`}>
      <div className="t1">{time && <span className="bl-time">{it.start}</span>}<Bi v={it.title} langs={langs} /></div>
      <div className="t2">{subs.map((s, i) => <div key={i}><Bi v={s} langs={langs} sep="  ·  " /></div>)}</div>
      <div className="t3">{who && <Bi v={who} langs={langs} sep=" · " />}</div>
    </div>
  );
}

/** The dark band that opens page 1 when the template has no cover page. */
function Banner({ r, langs, colours }: { r: RenderedService; langs: Lang[]; colours: { bg: string; fg: string } }) {
  const logoVersion = useLogo();
  const logo = r.has_logo && logoVersion ? logoUrl(logoVersion) : null;
  const lines = langs
    .map((l) => {
      const name = (r.church.name[l] ?? '').trim();
      const title = (r.title[l] ?? '').trim();
      return { l, text: [name, title].filter(Boolean).join(langInfo(l).cjk ? '' : ' · ') };
    })
    .filter((x, i, a) => x.text && a.findIndex((y) => y.text === x.text) === i);
  const address = r.church.address?.replace(/\s*\n\s*/g, ', ').trim();
  return (
    <div className="bl-banner" style={{ background: colours.bg, color: colours.fg }}>
      {logo && <img className="bl-banner-logo" src={logo} alt="" />}
      <div className="bl-banner-text">
        {lines.map((x) => <div key={x.l} className="bl-banner-title" lang={LANG_ATTR[x.l]}>{x.text}</div>)}
        {address && <div className="bl-banner-addr">{address}</div>}
      </div>
    </div>
  );
}

export const isNumberedLine = (s: string) => /^\s*(\d+|[一二三四五六七八九十]+|[A-Za-z])\s*[.)、．）]/.test(s);

/** Text as typed, one paragraph per line, numbered lines with a hanging indent; the languages one after another. */
function textLines(v: L10n | undefined, langs: Lang[], prefix: string): Block[] {
  const out: Block[] = [];
  const present = langs.filter((l) => v?.[l]?.trim());
  present.forEach((l, li) => {
    if (li > 0) out.push({ key: `${prefix}gap${l}`, node: <div className="ic-langgap" /> });
    v![l]!.replace(/\r/g, '').split('\n').filter((x) => x.trim()).forEach((ln, i) =>
      out.push({ key: `${prefix}${l}-${i}`, node: <p className={`bl-an${isNumberedLine(ln) ? ' num' : ''}`} lang={LANG_ATTR[l]}>{ln.trim()}</p> }),
    );
  });
  return out;
}

/** The service's Notes box, one paragraph per line. */
function notesLines(notes: string | null, prefix: string): Block[] {
  return (notes ?? '')
    .replace(/\r/g, '')
    .split('\n')
    .filter((p) => p.trim())
    .map((p, i) => ({ key: `${prefix}n${i}`, node: <p className={`bl-an${isNumberedLine(p) ? ' num' : ''}`}>{p.trim()}</p> }));
}

/**
 * The order of service as blocks, and the words gathered for a full-texts section. `decide` says per item whether
 * its words are printed (true), only its title / reference (false) or, for hymns, the first stanza only.
 */
export function buildOrder(
  r: RenderedService, langs: Lang[], layout: Layout, decide: (it: RenderedItem) => BulletinFull, show: ItemShow, f: FlowFormat,
): { order: Block[]; fullText: Block[] } {
  const table = f.order_style === 'table';
  const blocks: Block[] = [];
  if (!f.bannerCover) blocks.push({ key: 'oos', node: <div className="bl-oos"><Bi v={LABEL.orderOfService} langs={langs} sep="  ·  " /></div>, keep: true });
  // readings already in the order: the sermon row doesn't repeat their reference
  const readings = new Set(r.items.filter((x) => x.in_bulletin && x.kind === 'scripture').map((x) => biText(x.subtitle, langs)));
  const fullText: Block[] = [];
  let row = 0;
  for (const it of r.items) {
    if (!it.in_bulletin) continue;
    if (it.kind === 'section') {
      blocks.push({ key: `s${it.id}`, node: table ? <div className="bl-tr sec"><SectionHead v={it.title} langs={langs} /></div> : <SectionHead v={it.title} langs={langs} />, keep: true });
      continue;
    }
    const subs = whatLines(it, r, langs, f, readings);
    let pieces: Piece[] = [];
    // with an announcements section the item stays in the order (a timed item) but its words print there
    if (!(it.kind === 'announcements' && f.separateAnn)) {
      const full = decide(it);
      const shown = full === 'first_stanza' && it.song ? { ...it, song: { ...it.song, stanzas: firstStanza(it.song.stanzas) } } : it;
      pieces = full ? itemPieces(shown, langs, layout) : [];
      if (f.separateText && pieces.length) {
        // 【尼西亚信经】 — the words gathered in the full-texts section, each under its own title
        const head = it.text_title && hasAny(it.text_title) ? it.text_title : it.song ? it.song.title : hasAny(it.subtitle) ? it.subtitle : it.title;
        const titled = Object.fromEntries(langs.map((l) => [l, f.sermon_brackets && langInfo(l).cjk ? bracket(head[l] ?? '', l) : (head[l] ?? '')]));
        fullText.push({ key: `fh${it.id}`, node: <div className="bl-fthead"><Bi v={titled} langs={langs} sep="  ·  " /></div>, keep: true });
        for (const p of pieces) {
          if (p.glue) fullText[fullText.length - 1].keep = true;
          fullText.push(pieceBlock(p, `f${it.id}-`));
        }
        pieces = [];
      }
    }
    if (table) {
      blocks.push({ key: `h${it.id}`, node: <TableRow it={it} subs={subs} who={whoOf(it, langs, show)} langs={langs} alt={row++ % 2 === 1} time={show.times} />, keep: pieces.length > 0 });
    } else {
      blocks.push({ key: `h${it.id}`, node: <ItemHead it={it} subs={subs} langs={langs} compact={!pieces.length} show={show} />, keep: pieces.length > 0 });
    }
    for (const p of pieces) {
      if (p.glue) blocks[blocks.length - 1].keep = true;
      blocks.push(pieceBlock(p, `i${it.id}-`));
    }
  }
  return { order: blocks, fullText };
}

// ---------------------------------------------------------------- serving tables, blocks, notices

/** Names per language joined the way the language lists them. */
const joinPeople = (people: L10n[], langs: Lang[]): L10n =>
  Object.fromEntries(langs.map((l) => [l, people.map((p) => p[l] ?? Object.values(p).find(Boolean) ?? '').filter(Boolean).join(langInfo(l).cjk ? '、' : ', ')]));

/** A serving table: one column per role, names underneath. */
function RoleTable({ cols, langs }: { cols: { role: L10n; people: L10n }[]; langs: Lang[] }) {
  return (
    <div className="bl-rtable" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
      {cols.map((c, i) => <div key={`h${i}`} className={`h${i === 0 ? ' first' : ''}`}><Bi v={c.role} langs={langs} sep=" · " /></div>)}
      {cols.map((c, i) => <div key={`p${i}`} className={i === 0 ? 'first' : ''}>{hasAny(c.people) ? <Bi v={c.people} langs={langs} sep=" / " /> : '—'}</div>)}
    </div>
  );
}

function roleColumns(names: string[], rows: { role: L10n; people: L10n[] }[], r: RenderedService, langs: Lang[]) {
  const cols = names.map((n) => {
    const row = rows.find((x) => roleMatches(x.role, n));
    const role = row?.role ?? r.role_names?.find((x) => roleMatches(x, n)) ?? { [langs[0]]: n };
    return { role, people: joinPeople(row?.people ?? [], langs) };
  });
  return cols.some((c) => hasAny(c.people)) ? cols : [];
}

/** Caption lines of a block in each language (several lines allowed). */
function Caption({ v, langs }: { v: L10n | undefined; langs: Lang[] }) {
  const parts = biParts(v, langs);
  if (!parts.length) return null;
  return (
    <figcaption>
      {parts.flatMap((p) => p.text.split('\n').map((ln, i) => <div key={`${p.lang}${i}`} lang={LANG_ATTR[p.lang]}>{ln}</div>))}
    </figcaption>
  );
}

function blockBlocks(ids: number[], all: BulletinBlock[], langs: Lang[], prefix: string): Block[] {
  const out: Block[] = [];
  let row: ReactNode[] = [];
  const flush = () => {
    if (!row.length) return;
    out.push({ key: `${prefix}${out.length}`, node: <div className="bl-blocks">{row}</div> });
    row = [];
  };
  for (const id of ids) {
    const b = all.find((x) => x.id === id);
    if (!b) continue;
    if (b.kind === 'text') {
      flush();
      if (hasAny(b.data.text)) {
        out.push({
          key: `${prefix}${out.length}`,
          node: (
            <div className={`bl-bnote${b.data.bold !== false ? ' b' : ''}${b.data.align === 'left' ? ' left' : ''}`}>
              {biParts(b.data.text, langs).map((p) => <div key={p.lang} lang={LANG_ATTR[p.lang]} style={{ whiteSpace: 'pre-wrap' }}>{p.text}</div>)}
            </div>
          ),
        });
      }
      continue;
    }
    const src = b.kind === 'qr' ? (b.data.value ? blockQrSrc(b.id, b.updated_at, b.data.value) : null) : b.data.image ? blockImageUrl(b.id, b.data.image) : null;
    if (!src) continue;
    if (row.length === 3) flush();
    row.push(
      <figure key={b.id} className="bl-qr">
        <img src={src} alt="" />
        <Caption v={b.data.caption} langs={langs} />
      </figure>,
    );
  }
  flush();
  return out;
}

type CoverStyle = RenderedService['cover']['style'];
const COVER_STYLES: CoverStyle[] = ['plain', 'cross', 'logo', 'verse', 'banner'];
export const COVER_LABEL: Record<CoverStyle, string> = {
  plain: 'Plain', cross: 'Cross', logo: 'Church logo', verse: 'Verse of the week', banner: 'Banner on page 1 (no cover page)',
};

/** The cover: church, ornament (cross / logo / verse), title, date, theme and sermon. */
function Cover({ r, langs, style }: { r: RenderedService; langs: Lang[]; style: CoverStyle }) {
  const logoVersion = useLogo();
  const date = dateParts(r.date, langs);
  const lines = (v: L10n, cls: string) =>
    biParts(v, langs).map((p) => (
      <div key={p.lang} className={`${cls} ${cls}-${p.lang}`} lang={LANG_ATTR[p.lang]}>{p.text}</div>
    ));
  const hasSermon = hasAny(r.sermon_title) || hasAny(r.sermon_ref) || !!r.preacher;
  const accent = r.season.color ?? '#A8893C';
  const logo = style === 'logo' && r.has_logo && logoVersion ? logoUrl(logoVersion) : null;
  const verse = style === 'verse' && r.cover.verse && hasAny(r.cover.verse.text) ? r.cover.verse : null;
  const verseParts = verse ? biParts(verse.text, langs) : [];
  return (
    <div className={`bl-cover cv-${logo ? 'logo' : verse ? 'verse' : style === 'cross' ? 'cross' : 'plain'}`}>
      <div className="bl-cover-top">
        {logo && <img className="bl-clogo" src={logo} alt="" />}
        {lines(r.church.name, 'bl-church')}
        <div className="bl-hair" />
      </div>
      <div className="bl-cover-mid">
        {style === 'cross' && <CrossMark className="bl-cross" color={accent} />}
        {lines(r.title, 'bl-ctitle')}
        <div className="bl-cdate">
          {langs.map((l) => <div key={l} lang={LANG_ATTR[l]}>{date[l]}</div>)}
          <div className="bl-ctime">{timeRange(r)}</div>
        </div>
        {hasAny(r.theme) && (
          <div className="bl-ctheme">
            <div className="bl-clabel"><Bi v={LABEL.theme} langs={langs} sep=" · " /></div>
            {lines(r.theme, 'bl-cval')}
          </div>
        )}
        {hasSermon && (
          <div className="bl-csermon">
            <div className="bl-clabel"><Bi v={LABEL.sermon} langs={langs} sep=" · " /></div>
            {lines(r.sermon_title, 'bl-cval')}
            {hasAny(r.sermon_ref) && <div className="bl-cref"><Bi v={r.sermon_ref} langs={langs} sep="  ·  " /></div>}
            {r.preacher && <div className="bl-cpreacher">{r.preacher}</div>}
          </div>
        )}
      </div>
      <div className="bl-cover-foot">
        {verse ? (
          <figure className="bl-cverse">
            {verseParts.map((p) => (
              <blockquote key={p.lang} lang={LANG_ATTR[p.lang]} className={`bl-vtext${langs.length > 2 ? ' small' : ''}`}>{p.text}</blockquote>
            ))}
            <figcaption className="bl-vref"><Bi v={verse.ref} langs={langs} sep="  ·  " /></figcaption>
          </figure>
        ) : (
          <div className="bl-hair short" />
        )}
      </div>
    </div>
  );
}

function NotesPage({ langs }: { langs: Lang[] }) {
  return (
    <div className="bl-notespage">
      <div className="bl-backhead"><Bi v={LABEL.sermonNotes} langs={langs} sep="  ·  " /></div>
      <div className="bl-ruled" />
    </div>
  );
}

// ---------------------------------------------------------------- the page layout → blocks

/** Everything the page layout needs to turn sections into blocks. */
export interface BulletinBuild {
  r: RenderedService;
  langs: Lang[];
  layout: Layout;
  decide: (it: RenderedItem) => BulletinFull;
  show: ItemShow;
  options: BulletinOptions;
  /** the cover style in effect ('banner' = the dark band on page 1, no cover page) */
  cover: CoverStyle;
  /** the Library's QR codes, pictures and notes (falls back to those the render carries) */
  blocks: BulletinBlock[];
  /** one-off toolbar switches: serving tables / roster, announcements and service notes */
  include?: { serving: boolean; announcements: boolean };
}

/** The weekly texts of the bulletin (announcements, pastor's note …) per section key. */
export const bulletinContent = (r: RenderedService): Record<string, L10n> => r.bulletin.content ?? {};

/**
 * Walk the page layout: each section becomes blocks; page breaks and "starts a new page" force a break before the
 * next printed block (an empty section prints nothing and makes no blank page); "keep together" chains the
 * section's blocks. Sections marked for the last page make up the back cover (`back`).
 */
export function buildBulletin(b: BulletinBuild): { main: Block[]; back: Block[]; spareNotes: boolean } {
  const { r, langs, options: o } = b;
  const L = o.page_layout ?? DEFAULT_BULLETIN_OPTIONS.page_layout;
  const inc = b.include ?? { serving: true, announcements: true };
  const banner = b.cover === 'banner';
  const fmt: FlowFormat = {
    order_style: o.order_style, hymn_number: o.hymn_number, sermon_brackets: o.sermon_brackets,
    separateText: hasSection(L, 'full_texts'), separateAnn: hasSection(L, 'announcements'), bannerCover: banner && hasSection(L, 'cover'),
  };
  const ord = buildOrder(r, langs, b.layout, b.decide, b.show, fmt);
  const content = bulletinContent(r);
  // the library's blocks (live while editing), plus blocks Canon adds for this service (negative ids, e.g. the visitor form's QR)
  const blockList = [...(b.blocks.length ? b.blocks : r.bulletin.blocks ?? []).filter((x) => x.id > 0), ...(r.bulletin.blocks ?? []).filter((x) => x.id < 0)];
  const heading = (v: L10n | undefined, dflt: L10n | null, key: string): Block[] => {
    const h = hasAny(v) ? v! : dflt;
    return h ? [{ key, keep: true, node: <div className="bl-anhead"><Bi v={h} langs={langs} sep="  ·  " /></div> }] : [];
  };
  let spareNotes = false;

  const sectionBlocks = (s: BulletinSection): Block[] => {
    const p = `${s.id}:`;
    switch (s.type) {
      case 'cover': {
        if (!banner) return [{ key: `${p}cover`, page: 'cover', node: <Cover r={r} langs={langs} style={b.cover} /> }];
        const date = dateParts(r.date, langs);
        return [
          { key: `${p}banner`, nonum: true, node: <Banner r={r} langs={langs} colours={o.banner} /> },
          { key: `${p}bdate`, keep: true, node: <div className="bl-banner-date">{[...new Set(langs.map((l) => date[l]))].map((d, i) => <Fragment key={i}>{i > 0 && '  ·  '}<span>{d}</span></Fragment>)}</div> },
        ];
      }
      case 'order':
        return ord.order;
      case 'full_texts':
        return ord.fullText;
      case 'announcements': {
        if (!inc.announcements) return [];
        const body = [...textLines(content[ANNOUNCEMENTS_KEY], langs, `${p}a-`), ...(s.service_notes ? notesLines(r.notes, `${p}sn-`) : [])];
        return body.length ? [...heading(s.heading, LABEL.announcements, `${p}h`), ...body] : [];
      }
      case 'weekly_text': {
        const body = textLines(s.key ? content[s.key] : undefined, langs, `${p}t-`);
        return body.length ? [...heading(s.heading, null, `${p}h`), ...body] : [];
      }
      case 'fixed_text': {
        const body = textLines(s.text, langs, `${p}t-`);
        return body.length ? [...heading(s.heading, null, `${p}h`), ...body] : [];
      }
      case 'service_notes': {
        if (!inc.announcements || !r.notes?.trim()) return [];
        const h = hasAny(s.heading) ? s.heading! : LABEL.announcements;
        return [
          { key: `${p}h`, keep: true, node: <div className="bl-backhead"><Bi v={h} langs={langs} sep="  ·  " /></div> },
          ...r.notes.replace(/\r/g, '').split(/\n\s*\n/).filter((x) => x.trim()).map((x, i) => ({ key: `${p}n${i}`, node: <p className="bl-note">{x.trim()}</p> })),
        ];
      }
      case 'serving_this_week': {
        if (!inc.serving) return [];
        if (!s.roles?.length) {
          // the whole roster as a list ("Serving today")
          if (!r.roster.length) return [];
          return [
            { key: `${p}h`, keep: true, node: <div className="bl-backhead"><Bi v={LABEL.servingToday} langs={langs} sep="  ·  " /></div> },
            ...r.roster.map((row, i) => ({
              key: `${p}r${i}`,
              node: (
                <div className="bl-roster">
                  <Bi className="bl-role" v={row.role} langs={langs} />
                  {row.people_l10n ? <Bi className="bl-names" v={joinPeople(row.people_l10n, langs)} langs={langs} sep=" / " /> : <span className="bl-names">{row.people.join(', ')}</span>}
                </div>
              ),
            })),
          ];
        }
        const rows = r.roster.map((x) => ({ role: x.role, people: x.people_l10n ?? x.people.map((n) => ({ [langs[0]]: n })) }));
        const cols = roleColumns(s.roles, rows, r, langs);
        return cols.length ? [{ key: `${p}t`, node: <RoleTable cols={cols} langs={langs} /> }] : [];
      }
      case 'serving_next_week': {
        if (!inc.serving || !s.roles?.length || !r.next_roster) return [];
        const cols = roleColumns(s.roles, r.next_roster.roles, r, langs);
        if (!cols.length) return [];
        const head = Object.fromEntries(langs.map((l) => [l, servingOnLabel(r.next_roster!.date, l)]));
        return [
          { key: `${p}h`, keep: true, node: <div className="bl-rhead"><Bi v={head} langs={langs} sep="  ·  " /></div> },
          { key: `${p}t`, node: <RoleTable cols={cols} langs={langs} /> },
        ];
      }
      case 'note':
        return hasAny(s.text) ? [{ key: `${p}n`, node: <div className="bl-bnote b">{biParts(s.text, langs).map((x) => <div key={x.lang} lang={LANG_ATTR[x.lang]}>{x.text}</div>)}</div> }] : [];
      case 'blocks':
        return blockBlocks(s.blocks ?? [], blockList, langs, `${p}b`);
      case 'sermon_notes':
        if (s.spare_only) {
          spareNotes = true;
          return [];
        }
        return [{ key: `${p}notes`, page: 'notes', node: <NotesPage langs={langs} /> }];
      case 'ccli_contact': {
        const out: Block[] = [];
        if (s.ccli !== false && (r.notices.length || r.church.ccli_license)) {
          out.push({
            key: `${p}ccli`,
            node: (
              <div className="bl-notices">
                {r.notices.map((n, i) => <div key={i}>{n}</div>)}
                {r.church.ccli_license && <div className="b">CCLI Licence #{r.church.ccli_license}</div>}
              </div>
            ),
          });
        }
        const contact = [r.church.address, r.church.contact].map((x) => x?.trim()).filter(Boolean) as string[];
        if (s.contact !== false && contact.length) {
          out.push({
            key: `${p}contact`,
            node: (
              <div className="bl-contact">
                <div className="b"><Bi v={r.church.name} langs={langs} sep="  ·  " /></div>
                {contact.flatMap((c) => c.split('\n')).map((l, i) => <div key={i}>{l}</div>)}
              </div>
            ),
          });
        }
        return out;
      }
      default:
        return [];
    }
  };

  const main: Block[] = [];
  const back: Block[] = [];
  let pending = false;
  for (const s of L) {
    if (s.type === 'page_break') {
      pending = true;
      continue;
    }
    const bs = sectionBlocks(s).map((x) => ({ ...x }));
    if (!bs.length) continue;
    if (pending || s.new_page) bs[0].breakBefore = true;
    pending = false;
    if (s.keep_together) for (let i = 0; i < bs.length - 1; i++) bs[i].keep = true;
    (s.last_page ? back : main).push(...bs);
  }
  return { main, back, spareNotes };
}

// ---------------------------------------------------------------- screen

export default function Bulletin() {
  const { id } = useParams();
  const { t, lt } = useI18n();
  const { data: r, error } = useApi<RenderedService>(`/services/${id}/render`);
  const { data: templates } = useApi<BulletinTemplate[]>('/bulletin-templates');
  const { data: blockList } = useApi<BulletinBlock[]>('/bulletin-blocks');

  // The bulletin template sets everything below (service → church default → "Full words booklet"). Another template
  // can be picked here for this printout, and each toolbar control is a one-off override on top of it.
  const [tplSel, setTplSel] = useState<number | null>(null);
  const [ov, setOv] = useState<Overrides>({});
  const [showSheets, setShowSheets] = useState(false);
  const picked = tplSel != null ? templates?.find((x) => x.id === tplSel) : undefined;
  const o: BulletinOptions = picked?.options ?? r?.bulletin.options ?? DEFAULT_BULLETIN_OPTIONS;
  const set = (p: Overrides) => setOv((x) => ({ ...x, ...p }));

  const paper: PaperSize = ov.paper ?? (PAPERS[o.paper] ? o.paper : 'a4-booklet');
  const spec = PAPERS[paper];
  const booklet = !!spec.sheet;
  const pt = ov.pt ?? o.font_pt ?? spec.font;
  const svcLangs = useMemo(() => r?.languages ?? ['en'], [r]);
  const mode: LangMode = ov.mode ?? (o.languages === 'primary' ? svcLangs[0] : modeFor(svcLangs));
  const langs = useMemo(() => langsFor(mode, svcLangs), [mode, svcLangs]);
  // Three languages side by side only fit on a full portrait page; on A5 they are stacked.
  const wide = paper === 'a4' || paper === 'letter';
  const canParallel = langs.length > 1 && (langs.length < 3 || wide);
  const layout: Layout = canParallel ? ov.layout ?? (langs.length > 2 ? 'stacked' : o.layout) : 'stacked';
  const cover: CoverStyle = ov.cover ?? (picked && picked.options.cover !== 'default' ? picked.options.cover : r?.cover.style ?? 'plain');
  const roster = ov.roster ?? true;
  const notes = ov.notes ?? true;
  // Per item: the item's own choice beats the template's rule for its kind (computed by the server for the
  // service's template; recomputed here when another template is picked).
  const decide = useMemo(
    () => (it: RenderedItem): BulletinFull => (picked ? bulletinDecision(it.kind, it.bulletin_text, picked.options) : it.bulletin_full ?? true),
    [picked],
  );
  const show = useMemo<ItemShow>(() => ({ leaders: o.show_leaders, times: o.show_times, posture: o.show_posture }), [o.show_leaders, o.show_times, o.show_posture]);
  const L = o.page_layout ?? [];
  const hasServing = L.some((s) => s.type === 'serving_this_week' || s.type === 'serving_next_week');
  const hasAnn = L.some((s) => s.type === 'announcements' || s.type === 'service_notes');

  if (error) return <div className="out-page"><ErrorBox error={error} /></div>;
  if (!r) return <Loading />;

  const currentTpl = tplSel ?? r.bulletin.template_id;
  return (
    <div className="out bl">
      <div className="out-bar no-print">
        <Link to={`/services/${id}`} className="btn ghost sm"><Icon name="chevronLeft" />{t('Back')}</Link>
        <div className="out-bar-title"><Bi v={r.title} langs={langs} /> <span className="muted">· {t('Bulletin')}</span></div>
        <label className="out-ctl" title={t('Bulletin templates decide which items print their full words. Manage them in Service Planner → Bulletin templates.')}>
          <span>{t('Template')}</span>
          {templates?.length && currentTpl != null ? (
            <select value={currentTpl} onChange={(e) => { const v = Number(e.target.value); setTplSel(v === r.bulletin.template_id ? null : v); setOv({}); }}>
              {templates.filter((x) => !x.hidden || x.id === currentTpl || x.id === r.bulletin.template_id).map((x) => <option key={x.id} value={x.id}>{lt(x.name)}{x.id === r.bulletin.template_id ? ' ✓' : ''}</option>)}
            </select>
          ) : (
            <strong>{lt(r.bulletin.name)}</strong>
          )}
        </label>
        <label className="out-ctl">
          <span>{t('Paper')}</span>
          <select value={paper} onChange={(e) => set({ paper: e.target.value as PaperSize, pt: undefined })}>
            {PAPER_ORDER.map((p) => <option key={p} value={p}>{t(PAPERS[p].label)}</option>)}
          </select>
        </label>
        {r.languages.length > 1 && <Seg<LangMode> value={mode} onChange={(m) => set({ mode: m })} options={langOptions(r.languages, t)} />}
        {canParallel && (
          <Seg<Layout> value={layout} onChange={(v) => set({ layout: v })} options={[{ value: 'parallel', label: t('Side by side') }, { value: 'stacked', label: t('Stacked') }]} />
        )}
        <label className="out-ctl">
          <span>{t('Font size')} {pt}pt</span>
          <input type="range" min={7} max={16} step={0.5} value={pt} onChange={(e) => set({ pt: Number(e.target.value) })} />
        </label>
        <label className="out-ctl">
          <span>{t('Cover')}</span>
          <select value={cover} onChange={(e) => set({ cover: e.target.value as CoverStyle })} title={t('For this printout only')}>
            {COVER_STYLES.map((c) => <option key={c} value={c}>{t(COVER_LABEL[c])}{c === r.cover.style ? ' ✓' : ''}</option>)}
          </select>
        </label>
        {hasServing && <label className="check"><input type="checkbox" checked={roster} onChange={(e) => set({ roster: e.target.checked })} />{t('Roster')}</label>}
        {hasAnn && <label className="check"><input type="checkbox" checked={notes} onChange={(e) => set({ notes: e.target.checked })} />{t('Announcements')}</label>}
        {booklet && <label className="check"><input type="checkbox" checked={showSheets} onChange={(e) => setShowSheets(e.target.checked)} />{t('Show print sheets')}</label>}
        <button className="btn primary sm" onClick={() => window.print()}><Icon name="print" />{t('Print')}</button>
      </div>
      <BulletinPages
        r={r}
        spec={spec}
        langs={langs}
        layout={layout}
        cover={cover}
        pt={pt}
        decide={decide}
        show={show}
        options={o}
        blocks={blockList ?? []}
        include={{ serving: roster, announcements: notes }}
        showSheets={booklet && showSheets}
      />
    </div>
  );
}

/** One-off toolbar changes on top of the bulletin template (undefined = follow the template). */
interface Overrides {
  paper?: PaperSize;
  pt?: number;
  mode?: LangMode;
  layout?: Layout;
  cover?: CoverStyle;
  roster?: boolean;
  notes?: boolean;
}

/** "5 pages — 3 blank pages will be added to make a folded booklet (8 pages)." */
export function paddingWarning(t: (s: string) => string, total: number, blanks: number): string {
  return t(blanks === 1
    ? '{content} pages — 1 blank page will be added to make a folded booklet ({total} pages).'
    : '{content} pages — {n} blank pages will be added to make a folded booklet ({total} pages).')
    .replace('{content}', String(total - blanks))
    .replace('{n}', String(blanks))
    .replace('{total}', String(total));
}

/**
 * The bulletin's pages. `variant` 'print' (the bulletin screen: page previews plus the print sheets) or 'sample'
 * (the template editor: pages only, drawn at `scale`).
 */
export function BulletinPages({
  r, spec, langs, layout, cover, pt, decide, show, options, blocks, include, showSheets = false, variant = 'print', scale = 1,
}: {
  r: RenderedService; spec: PaperSpec; langs: Lang[]; layout: Layout; cover: CoverStyle; pt: number;
  decide: (it: RenderedItem) => BulletinFull; show: ItemShow; options: BulletinOptions; blocks: BulletinBlock[];
  include?: { serving: boolean; announcements: boolean }; showSheets?: boolean; variant?: 'print' | 'sample'; scale?: number;
}) {
  const { t } = useI18n();
  const booklet = !!spec.sheet;
  const [pw, ph] = spec.page;
  const bodyW = pw - 2 * spec.margin;
  const capPx = (ph - 2 * spec.margin - FOOT_MM) * PX_PER_MM * 0.985;

  const [splitKeys, setSplitKeys] = useState<Set<string>>(() => new Set());
  const [fontTick, setFontTick] = useState(0);
  useEffect(() => {
    document.fonts?.ready.then(() => setFontTick((n) => n + 1)).catch(() => {});
  }, []);

  const { main, back, spareNotes } = useMemo(() => {
    const expand = (bs: Block[]): Block[] => bs.flatMap((b) => (splitKeys.has(b.key) && b.split ? expand(b.split()).map((x, i) => (i === 0 ? { ...x, breakBefore: b.breakBefore } : x)) : [b]));
    const built = buildBulletin({ r, langs, layout, decide, show, options, cover, blocks, include });
    return { main: expand(built.main), back: expand(built.back), spareNotes: built.spareNotes };
  }, [r, langs, layout, decide, show, options, cover, blocks, include?.serving, include?.announcements, splitKeys]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMemo(() => [...main, ...back], [main, back]);
  const byKey = useMemo(() => new Map(all.map((b) => [b.key, b])), [all]);

  const measureRef = useRef<HTMLDivElement>(null);
  const [plan, setPlan] = useState<{ pages: PageSpec[]; oversize: boolean; blanks: number } | null>(null);
  const hasSermon = spareNotes && r.items.some((i) => i.kind === 'sermon');

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const hs = Array.from(el.children).map((c) => (c as HTMLElement).getBoundingClientRect().height);
    const tooTall = all.filter((b, i) => hs[i] > capPx && b.split);
    if (tooTall.length) {
      setSplitKeys((s) => new Set([...s, ...tooTall.map((b) => b.key)]));
      return;
    }
    const oversize = hs.some((h, i) => h > capPx && !all[i].page);
    const keep = all.map((b) => !!b.keep);
    const brk = all.map((b) => !!b.breakBefore);
    const whole = all.map((b) => !!b.page);
    const nm = main.length;
    const toPages = (idx: number[][], offset: number): PageSpec[] => idx.map((p) => ({ kind: 'flow' as const, keys: p.map((i) => all[i + offset].key) }));
    const combined = toPages(paginate(hs, keep, capPx, brk, whole), 0);
    let pages = combined;
    let blanks = 0;
    if (booklet) {
      const mainPages = toPages(paginate(hs.slice(0, nm), keep.slice(0, nm), capPx, brk.slice(0, nm), whole.slice(0, nm)), 0);
      const backPages = back.length ? toPages(paginate(hs.slice(nm), keep.slice(nm), capPx, brk.slice(nm), whole.slice(nm)), nm) : [];
      // spare pages go before the back cover; the first one carries the sermon notes when the layout asks for it
      const padded = padBooklet<PageSpec>(mainPages, backPages, (i) => ({ kind: 'blank', notes: i === 0 && hasSermon }), { strict: !!back[0]?.breakBefore || !!back[0]?.page, combined });
      pages = padded.pages;
      blanks = padded.added - (padded.added > 0 && hasSermon ? 1 : 0);
    }
    setPlan({ pages, oversize, blanks });
  }, [all, main.length, back, capPx, booklet, hasSermon, fontTick, pt, bodyW]);

  // Season colour (when turned on) accents the cover rule and section headings; ink stays the text colour.
  const docStyle = {
    fontSize: `${pt}pt`,
    ...(r.season.color ? { '--bl-accent': r.season.color, '--bl-accent-text': r.season.color } : {}),
  } as CSSProperties;
  const renderPage = (n: number, key: string) => {
    const p = plan!.pages[n - 1];
    const blocksOn = p.kind === 'flow' ? p.keys.map((k) => byKey.get(k)).filter((b): b is Block => !!b) : [];
    const coverPage = blocksOn.length === 1 && blocksOn[0].page === 'cover';
    const numbered = !coverPage && !blocksOn.some((b) => b.nonum);
    return (
      <div key={key} className={`bl-page${coverPage ? ' cover' : ''}`} style={{ width: `${pw}mm`, height: `${ph}mm`, padding: `${spec.margin}mm ${spec.margin}mm 0` }}>
        <div className="bl-body" style={{ height: `${ph - 2 * spec.margin - FOOT_MM}mm` }}>
          {p.kind === 'blank' && p.notes && <NotesPage langs={langs} />}
          {blocksOn.map((b) => <div key={b.key} className={b.page ? 'bb bb-page' : 'bb'}>{b.node}</div>)}
        </div>
        <div className="bl-foot" style={{ height: `${FOOT_MM + spec.margin}mm` }}>{numbered && n}</div>
      </div>
    );
  };

  const sheets = plan && booklet ? impose(plan.pages.length) : [];
  const [sw, sh] = spec.sheet ?? spec.page;
  const printCss = `
@page { size: ${spec.css}; margin: 0; }
@media print {
  html, body, #root { height: auto !important; background: #fff !important; }
  body { margin: 0; }
  .bl-print { display: block !important; }
  .bl-screen, .out-bar { display: none !important; }
}`;
  const info = plan && (
    <div className="bl-info">
      {booklet && plan.blanks > 0 ? (
        <span className="badge warn bl-padwarn">{paddingWarning(t, plan.pages.length, plan.blanks)}</span>
      ) : (
        <>{plan.pages.length} {t('pages')}</>
      )}
      {booklet && variant === 'print' && <> · {plan.pages.length / 4} {t(plan.pages.length === 4 ? 'sheet' : 'sheets')} · {t('Print double-sided, flip on short edge, then fold.')}</>}
      {plan.oversize && <span className="badge warn" style={{ marginLeft: 8 }}>{t('Some content is taller than a page — reduce the font size.')}</span>}
    </div>
  );

  const measure = (
    // hidden measuring column at the page body width (whole-page blocks are measured as nothing)
    <div ref={measureRef} className="bl-doc bl-measure" style={{ ...docStyle, width: `${bodyW}mm` }} aria-hidden="true">
      {all.map((b) => <div key={b.key} className="bb">{b.page ? null : b.node}</div>)}
    </div>
  );

  if (variant === 'sample') {
    return (
      <div className="bl-sample">
        {measure}
        {!plan ? <Loading /> : (
          <>
            {info}
            <div className="bl-doc bl-sample-pages" style={{ ...docStyle, zoom: scale } as CSSProperties}>
              {plan.pages.map((_, i) => renderPage(i + 1, `p${i + 1}`))}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <style>{printCss}</style>
      {measure}
      {!plan ? (
        <Loading />
      ) : (
        <>
          <div className="bl-screen no-print">
            {info}
            <div className="bl-doc bl-preview" style={docStyle}>
              {showSheets
                ? sheets.map((s, i) => (
                    <div key={i} className="bl-sheet-wrap">
                      <div className="bl-sheet-label">
                        {t('Sheet')} {Math.floor(i / 2) + 1} · {t(s.side === 'front' ? 'front' : 'back')} · {s.pages.join(' | ')}
                      </div>
                      <div className="bl-sheet" style={{ width: `${sw}mm`, height: `${sh}mm` }}>
                        {s.pages.map((n) => renderPage(n, `p${n}`))}
                      </div>
                    </div>
                  ))
                : plan.pages.map((_, i) => renderPage(i + 1, `p${i + 1}`))}
            </div>
          </div>
          <div className="bl-doc bl-print" style={docStyle}>
            {booklet
              ? sheets.map((s, i) => (
                  <div key={i} className="bl-sheet" style={{ width: `${sw}mm`, height: `${sh}mm` }}>
                    {s.pages.map((n) => renderPage(n, `p${n}`))}
                  </div>
                ))
              : plan.pages.map((_, i) => (
                  <Fragment key={i}>
                    <div className="bl-sheet" style={{ width: `${pw}mm`, height: `${ph}mm` }}>{renderPage(i + 1, 'p')}</div>
                  </Fragment>
                ))}
          </div>
        </>
      )}
    </>
  );
}
