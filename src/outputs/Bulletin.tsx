// The printed order of service. Content is laid out as a flow of small blocks, measured in a hidden
// container at the page width, paginated into fixed page boxes and — for booklets — imposed onto
// landscape sheets for duplex printing (fold in half to read).
//
// The bulletin template decides the shape: a cover page or a banner on page 1, the order as a list or a
// three-column table, full texts under each item or gathered after the order, announcements inline or on a
// page of their own, and a back cover with serving tables, a note and QR codes / pictures (bulletin blocks).
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
  DEFAULT_BULLETIN_OPTIONS, blockImageUrl, blockQrUrl, bracket, bracketL10n, bulletinDecision, firstStanza, hymnLine, withVersion,
  type BulletinBackPage, type BulletinBlock, type BulletinFull, type BulletinOptions, type BulletinTemplate,
} from '../../shared/presentation.ts';
import { postureL10n, roleMatches, servingOnLabel } from '../../shared/labels.ts';
import { langInfo } from '../../shared/languages.ts';
import './outputs.css';

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
  /** keep with the following block (headings) */
  keep?: boolean;
  /** start a new page with this block (separate full-text / announcements sections) */
  breakBefore?: boolean;
  split?: () => Block[];
}

type PageSpec =
  | { kind: 'cover' }
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

/** Greedy pagination with keep-with-next chains and forced page breaks. Returns groups of block indices. */
function paginate(heights: number[], keep: boolean[], cap: number, brk: boolean[] = []): number[][] {
  const pages: number[][] = [];
  let cur: number[] = [];
  let used = 0;
  for (let i = 0; i < heights.length; i++) {
    let need = heights[i];
    for (let j = i; keep[j] && j + 1 < heights.length; j++) need += heights[j + 1];
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

/** How the order is laid out (from the bulletin template); missing fields keep the classic look. */
export type FlowFormat = Pick<
  BulletinOptions,
  'order_style' | 'hymn_number' | 'sermon_brackets' | 'full_text_section' | 'announcements_section' | 'announcements_heading' | 'banner'
> & {
  /** the banner (dark band) opens page 1 instead of a cover page */
  bannerCover: boolean;
  /** the service notes join the separate announcements page */
  serviceNotes: boolean;
};
const FLOW_DEFAULT: FlowFormat = {
  order_style: 'list', hymn_number: 'abbr', sermon_brackets: false, full_text_section: 'inline', announcements_section: 'inline',
  announcements_heading: {}, banner: DEFAULT_BULLETIN_OPTIONS.banner, bannerCover: false, serviceNotes: false,
};
export const flowFormat = (o: BulletinOptions, cover: string, serviceNotes: boolean): FlowFormat => ({
  order_style: o.order_style, hymn_number: o.hymn_number, sermon_brackets: o.sermon_brackets, full_text_section: o.full_text_section,
  announcements_section: o.announcements_section, announcements_heading: o.announcements_heading, banner: o.banner,
  bannerCover: cover === 'banner', serviceNotes,
});

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

const isNumberedLine = (s: string) => /^\s*(\d+|[一二三四五六七八九十]+|[A-Za-z])\s*[.)、．）]/.test(s);

/** Announcements as typed: one paragraph per line, numbered lines with a hanging indent. */
function announcementBlocks(it: RenderedItem | null, notes: string | null, langs: Lang[], prefix: string): Block[] {
  const out: Block[] = [];
  const present = langs.filter((l) => it?.paras?.[l]?.length);
  present.forEach((l, li) => {
    if (li > 0) out.push({ key: `${prefix}gap${l}`, node: <div className="ic-langgap" /> });
    it!.paras![l]!.forEach((para, pi) =>
      para.forEach((ln, i) =>
        out.push({
          key: `${prefix}${l}-${pi}-${i}`,
          node: <p className={`bl-an${isNumberedLine(ln.text) ? ' num' : ''}`} lang={LANG_ATTR[l]}>{ln.text}</p>,
        }),
      ),
    );
  });
  if (notes?.trim()) {
    notes
      .replace(/\r/g, '')
      .split('\n')
      .filter((p) => p.trim())
      .forEach((p, i) => out.push({ key: `${prefix}n${i}`, node: <p className={`bl-an${isNumberedLine(p) ? ' num' : ''}`}>{p.trim()}</p> }));
  }
  return out;
}

/**
 * The order of service as blocks. `decide` says per item whether its words are printed (true), only its title /
 * reference (false) or, for hymns, the first stanza only. `fmt` (from the template) shapes the order.
 */
export function buildFlow(
  r: RenderedService, langs: Lang[], layout: Layout, decide: (it: RenderedItem) => BulletinFull, show: ItemShow, fmt: Partial<FlowFormat> = {},
): Block[] {
  const f: FlowFormat = { ...FLOW_DEFAULT, ...fmt };
  const table = f.order_style === 'table';
  const separateText = f.full_text_section === 'separate';
  const separateAnn = f.announcements_section === 'separate';
  const blocks: Block[] = [];
  if (f.bannerCover) {
    const date = dateParts(r.date, langs);
    blocks.push({ key: 'banner', node: <Banner r={r} langs={langs} colours={f.banner} /> });
    blocks.push({
      key: 'bdate',
      keep: true,
      node: <div className="bl-banner-date">{[...new Set(langs.map((l) => date[l]))].map((d, i) => <Fragment key={i}>{i > 0 && '  ·  '}<span>{d}</span></Fragment>)}</div>,
    });
  } else {
    blocks.push({ key: 'oos', node: <div className="bl-oos"><Bi v={LABEL.orderOfService} langs={langs} sep="  ·  " /></div>, keep: true });
  }
  // readings already in the order: the sermon row doesn't repeat their reference
  const readings = new Set(r.items.filter((x) => x.in_bulletin && x.kind === 'scripture').map((x) => biText(x.subtitle, langs)));
  const fullText: Block[] = [];
  const ann: Block[] = [];
  let row = 0;
  for (const it of r.items) {
    if (!it.in_bulletin) continue;
    if (it.kind === 'section') {
      blocks.push({ key: `s${it.id}`, node: table ? <div className="bl-tr sec"><SectionHead v={it.title} langs={langs} /></div> : <SectionHead v={it.title} langs={langs} />, keep: true });
      continue;
    }
    const subs = whatLines(it, r, langs, f, readings);
    let pieces: Piece[] = [];
    if (it.kind === 'announcements' && separateAnn) {
      ann.push(...announcementBlocks(it, null, langs, `a${it.id}-`));
    } else {
      const full = decide(it);
      const shown = full === 'first_stanza' && it.song ? { ...it, song: { ...it.song, stanzas: firstStanza(it.song.stanzas) } } : it;
      pieces = full ? itemPieces(shown, langs, layout) : [];
      if (separateText && pieces.length) {
        // 【尼西亚信经】 — the words gathered after the order, each under its own title
        const head = it.text_title && hasAny(it.text_title) ? it.text_title : it.song ? it.song.title : hasAny(it.subtitle) ? it.subtitle : it.title;
        const bracketed = Object.fromEntries(langs.map((l) => [l, langInfo(l).cjk ? bracket(head[l] ?? '', l) : (head[l] ?? '')]));
        fullText.push({ key: `fh${it.id}`, node: <div className="bl-fthead"><Bi v={bracketed} langs={langs} sep="  ·  " /></div>, keep: true });
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
  if (fullText.length) {
    fullText[0].breakBefore = true;
    blocks.push(...fullText);
  }
  if (separateAnn) ann.push(...announcementBlocks(null, f.serviceNotes ? r.notes : null, langs, 'sn-'));
  if (ann.length) {
    const heading = hasAny(f.announcements_heading) ? f.announcements_heading : LABEL.announcements;
    blocks.push({ key: 'anh', breakBefore: true, keep: true, node: <div className="bl-anhead"><Bi v={heading} langs={langs} sep="  ·  " /></div> });
    blocks.push(...ann);
  }
  return blocks;
}

// ---------------------------------------------------------------- back page

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

function blockBlocks(ids: number[], all: BulletinBlock[], langs: Lang[]): Block[] {
  const out: Block[] = [];
  let row: ReactNode[] = [];
  const flush = () => {
    if (!row.length) return;
    out.push({ key: `bk${out.length}`, node: <div className="bl-blocks">{row}</div> });
    row = [];
  };
  for (const id of ids) {
    const b = all.find((x) => x.id === id);
    if (!b) continue;
    if (b.kind === 'text') {
      flush();
      if (hasAny(b.data.text)) {
        out.push({
          key: `bk${out.length}`,
          node: (
            <div className={`bl-bnote${b.data.bold !== false ? ' b' : ''}${b.data.align === 'left' ? ' left' : ''}`}>
              {biParts(b.data.text, langs).map((p) => <div key={p.lang} lang={LANG_ATTR[p.lang]} style={{ whiteSpace: 'pre-wrap' }}>{p.text}</div>)}
            </div>
          ),
        });
      }
      continue;
    }
    const src = b.kind === 'qr' ? (b.data.value ? blockQrUrl(b.id, b.updated_at) : null) : b.data.image ? blockImageUrl(b.id, b.data.image) : null;
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

export interface BackOptions {
  roster: boolean;
  notes: boolean;
  ccli: boolean;
  contact: boolean;
  page?: BulletinBackPage;
  blocks?: BulletinBlock[];
}

export function buildBack(r: RenderedService, langs: Lang[], opts: BackOptions): Block[] {
  const blocks: Block[] = [];
  if (opts.notes && r.notes?.trim()) {
    blocks.push({ key: 'nh', node: <div className="bl-backhead"><Bi v={LABEL.announcements} langs={langs} sep="  ·  " /></div>, keep: true });
    r.notes
      .replace(/\r/g, '')
      .split(/\n\s*\n/)
      .filter((p) => p.trim())
      .forEach((p, i) => blocks.push({ key: `n${i}`, node: <p className="bl-note">{p.trim()}</p> }));
  }
  if (opts.roster && r.roster.length) {
    blocks.push({ key: 'rh', node: <div className="bl-backhead"><Bi v={LABEL.servingToday} langs={langs} sep="  ·  " /></div>, keep: true });
    r.roster.forEach((row, i) =>
      blocks.push({
        key: `r${i}`,
        node: (
          <div className="bl-roster">
            <Bi className="bl-role" v={row.role} langs={langs} />
            {row.people_l10n ? <Bi className="bl-names" v={joinPeople(row.people_l10n, langs)} langs={langs} sep=" / " /> : <span className="bl-names">{row.people.join(', ')}</span>}
          </div>
        ),
      }),
    );
  }
  const bp = opts.page;
  if (bp?.this_week_roles.length) {
    const rows = r.roster.map((x) => ({ role: x.role, people: x.people_l10n ?? x.people.map((p) => ({ [langs[0]]: p })) }));
    const cols = roleColumns(bp.this_week_roles, rows, r, langs);
    if (cols.length) blocks.push({ key: 'tw', node: <RoleTable cols={cols} langs={langs} /> });
  }
  if (bp?.next_week_roles.length && r.next_roster) {
    const cols = roleColumns(bp.next_week_roles, r.next_roster.roles, r, langs);
    if (cols.length) {
      const head = Object.fromEntries(langs.map((l) => [l, servingOnLabel(r.next_roster!.date, l)]));
      blocks.push({ key: 'nwh', keep: true, node: <div className="bl-rhead"><Bi v={head} langs={langs} sep="  ·  " /></div> });
      blocks.push({ key: 'nw', node: <RoleTable cols={cols} langs={langs} /> });
    }
  }
  if (bp && hasAny(bp.note)) {
    blocks.push({ key: 'bnote', node: <div className="bl-bnote b">{biParts(bp.note, langs).map((p) => <div key={p.lang} lang={LANG_ATTR[p.lang]}>{p.text}</div>)}</div> });
  }
  if (bp?.blocks.length && opts.blocks) blocks.push(...blockBlocks(bp.blocks, opts.blocks, langs));
  if (opts.ccli && (r.notices.length || r.church.ccli_license)) {
    blocks.push({
      key: 'ccli',
      node: (
        <div className="bl-notices">
          {r.notices.map((n, i) => <div key={i}>{n}</div>)}
          {r.church.ccli_license && <div className="b">CCLI Licence #{r.church.ccli_license}</div>}
        </div>
      ),
    });
  }
  const contact = [r.church.address, r.church.contact].map((s) => s?.trim()).filter(Boolean) as string[];
  if (opts.contact && contact.length) {
    blocks.push({
      key: 'contact',
      node: (
        <div className="bl-contact">
          <div className="b"><Bi v={r.church.name} langs={langs} sep="  ·  " /></div>
          {contact.flatMap((c) => c.split('\n')).map((l, i) => <div key={i}>{l}</div>)}
        </div>
      ),
    });
  }
  return blocks;
}

/** Back-page content that belongs on the back cover itself (rather than flowing after the order). */
export const hasBackPage = (bp: BulletinBackPage | undefined) =>
  !!bp && (bp.this_week_roles.length > 0 || bp.next_week_roles.length > 0 || hasAny(bp.note) || bp.blocks.length > 0);

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
  const roster = ov.roster ?? o.sections.roster;
  const notes = ov.notes ?? o.sections.notes;
  // Per item: the item's own choice beats the template's rule for its kind (computed by the server for the
  // service's template; recomputed here when another template is picked).
  const decide = useMemo(
    () => (it: RenderedItem): BulletinFull => (picked ? bulletinDecision(it.kind, it.bulletin_text, picked.options) : it.bulletin_full ?? true),
    [picked],
  );
  const show = useMemo<ItemShow>(() => ({ leaders: o.show_leaders, times: o.show_times, posture: o.show_posture }), [o.show_leaders, o.show_times, o.show_posture]);

  if (error) return <div className="out-page"><ErrorBox error={error} /></div>;
  if (!r) return <Loading />;

  const currentTpl = tplSel ?? r.bulletin.template_id;
  return (
    <div className="out bl">
      <div className="out-bar no-print">
        <Link to={`/services/${id}`} className="btn ghost sm"><Icon name="chevronLeft" />{t('Back')}</Link>
        <div className="out-bar-title"><Bi v={r.title} langs={langs} /> <span className="muted">· {t('Bulletin')}</span></div>
        <label className="out-ctl" title={t('Bulletin templates decide which items print their full words. Manage them in Bulletin & slides.')}>
          <span>{t('Template')}</span>
          {templates?.length && currentTpl != null ? (
            <select value={currentTpl} onChange={(e) => { const v = Number(e.target.value); setTplSel(v === r.bulletin.template_id ? null : v); setOv({}); }}>
              {templates.map((x) => <option key={x.id} value={x.id}>{lt(x.name)}{x.id === r.bulletin.template_id ? ' ✓' : ''}</option>)}
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
        <label className="check"><input type="checkbox" checked={roster} onChange={(e) => set({ roster: e.target.checked })} />{t('Roster')}</label>
        <label className="check"><input type="checkbox" checked={notes} onChange={(e) => set({ notes: e.target.checked })} />{t('Announcements')}</label>
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
        sections={{ roster, notes, ccli: o.sections.ccli, contact: o.sections.contact, sermonNotes: o.sections.sermon_notes }}
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

interface Sections {
  roster: boolean;
  notes: boolean;
  ccli: boolean;
  contact: boolean;
  /** use the first spare booklet page for sermon notes */
  sermonNotes: boolean;
}

function BulletinPages({
  r, spec, langs, layout, cover, pt, decide, show, options, blocks, sections, showSheets,
}: {
  r: RenderedService; spec: PaperSpec; langs: Lang[]; layout: Layout; cover: CoverStyle; pt: number;
  decide: (it: RenderedItem) => BulletinFull; show: ItemShow; options: BulletinOptions; blocks: BulletinBlock[]; sections: Sections; showSheets: boolean;
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

  const banner = cover === 'banner';
  const annSeparate = options.announcements_section === 'separate';
  // The back cover is kept as the last page when the template designs one (serving tables, note, blocks), and
  // whenever page 1 is a banner (the booklet then reads front → inside → back).
  const strictBack = banner || annSeparate || hasBackPage(options.back_page);
  const { roster, notes, ccli, contact } = sections;
  const fmt = useMemo(() => flowFormat(options, cover, notes), [options, cover, notes]);
  const { flow, back } = useMemo(() => {
    const expand = (bs: Block[]): Block[] => bs.flatMap((b) => (splitKeys.has(b.key) && b.split ? expand(b.split()) : [b]));
    const backBlocks = buildBack(r, langs, { roster, notes: notes && !annSeparate, ccli, contact, page: options.back_page, blocks });
    if (strictBack && backBlocks.length) backBlocks[0] = { ...backBlocks[0], breakBefore: true };
    return { flow: expand(buildFlow(r, langs, layout, decide, show, fmt)), back: expand(backBlocks) };
  }, [r, langs, layout, decide, show, fmt, roster, notes, annSeparate, ccli, contact, options.back_page, blocks, strictBack, splitKeys]);
  const byKey = useMemo(() => new Map([...flow, ...back].map((b) => [b.key, b])), [flow, back]);

  const measureRef = useRef<HTMLDivElement>(null);
  const [plan, setPlan] = useState<{ pages: PageSpec[]; oversize: boolean } | null>(null);
  const hasSermon = sections.sermonNotes && r.items.some((i) => i.kind === 'sermon');

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const all = [...flow, ...back];
    const hs = Array.from(el.children).map((c) => (c as HTMLElement).getBoundingClientRect().height);
    const tooTall = all.filter((b, i) => hs[i] > capPx && b.split);
    if (tooTall.length) {
      setSplitKeys((s) => new Set([...s, ...tooTall.map((b) => b.key)]));
      return;
    }
    const oversize = hs.some((h) => h > capPx);
    const nf = flow.length;
    const keyPages = (idx: number[][], offset: number) => idx.map((p) => ({ kind: 'flow' as const, keys: p.map((i) => all[i + offset].key) }));
    const brk = all.map((b) => !!b.breakBefore);
    const combined = keyPages(paginate(hs, all.map((b) => !!b.keep), capPx, brk), 0);
    const lead: PageSpec[] = banner ? [] : [{ kind: 'cover' }];
    let pages: PageSpec[] = [...lead, ...combined];
    if (booklet) {
      const target = Math.ceil(pages.length / 4) * 4;
      const blanks = (n: number): PageSpec[] => Array.from({ length: n }, (_, i) => ({ kind: 'blank', notes: i === 0 && hasSermon }));
      const flowPages = keyPages(paginate(hs.slice(0, nf), flow.map((b) => !!b.keep), capPx, brk.slice(0, nf)), 0);
      const backPages = back.length ? keyPages(paginate(hs.slice(nf), back.map((b) => !!b.keep), capPx, brk.slice(nf)), nf) : [];
      const n = lead.length + flowPages.length + backPages.length;
      if (back.length && strictBack) {
        // The back cover is the last page; spare pages (sermon notes) go before it.
        pages = [...lead, ...flowPages, ...blanks(Math.ceil(n / 4) * 4 - n), ...backPages];
      } else if (back.length && pages.length % 4 !== 0 && n <= target) {
        // Keep the roster / notices on the back cover; put spare pages (sermon notes) before it.
        pages = [...lead, ...flowPages, ...blanks(target - n), ...backPages];
      } else {
        pages = [...pages, ...blanks(target - pages.length)];
      }
    }
    setPlan({ pages, oversize });
  }, [flow, back, capPx, booklet, banner, strictBack, hasSermon, fontTick, pt, bodyW]);

  // Season colour (when turned on) accents the cover rule and section headings; ink stays the text colour.
  const docStyle = {
    fontSize: `${pt}pt`,
    ...(r.season.color ? { '--bl-accent': r.season.color, '--bl-accent-text': r.season.color } : {}),
  } as CSSProperties;
  const renderPage = (n: number, key: string) => {
    const p = plan!.pages[n - 1];
    const numbered = p.kind !== 'cover' && !(banner && n === 1);
    return (
      <div key={key} className={`bl-page${p.kind === 'cover' ? ' cover' : ''}`} style={{ width: `${pw}mm`, height: `${ph}mm`, padding: `${spec.margin}mm ${spec.margin}mm 0` }}>
        <div className="bl-body" style={{ height: `${ph - 2 * spec.margin - FOOT_MM}mm` }}>
          {p.kind === 'cover' && <Cover r={r} langs={langs} style={cover} />}
          {p.kind === 'blank' && p.notes && <NotesPage langs={langs} />}
          {p.kind === 'flow' &&
            p.keys.map((k) => {
              const b = byKey.get(k);
              return b ? <div key={k} className="bb">{b.node}</div> : null;
            })}
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

  return (
    <>
      <style>{printCss}</style>
      {/* hidden measuring column at the page body width */}
      <div ref={measureRef} className="bl-doc bl-measure" style={{ ...docStyle, width: `${bodyW}mm` }} aria-hidden="true">
        {[...flow, ...back].map((b) => (
          <div key={b.key} className="bb">{b.node}</div>
        ))}
      </div>
      {!plan ? (
        <Loading />
      ) : (
        <>
          <div className="bl-screen no-print">
            <div className="bl-info">
              {plan.pages.length} {t('pages')}
              {booklet && <> · {plan.pages.length / 4} {t(plan.pages.length === 4 ? 'sheet' : 'sheets')} · {t('Print double-sided, flip on short edge, then fold.')}</>}
              {plan.oversize && <span className="badge warn" style={{ marginLeft: 8 }}>{t('Some content is taller than a page — reduce the font size.')}</span>}
            </div>
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
