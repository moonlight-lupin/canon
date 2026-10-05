// Bulletin: the order of service and the other blocks a bulletin is made of.
import type { ReactNode } from 'react';
import type { L10n, Lang, RenderedItem, RenderedService } from '../types-client.ts';
import { Bi, LABEL, LANG_ATTR, biParts, biText, hasAny, itemPieces, itemSubtitles, type Layout, type Piece } from './content.tsx';
import { logoUrl, useLogo } from '../components/brand.tsx';
import {
  blockImageUrl, blockQrSrc, bracket, bracketL10n, firstStanza, hymnLine, withVersion, type BulletinBlock,
  type BulletinFull, type BulletinOptions,
} from '../../shared/presentation.ts';
import { postureL10n, roleMatches } from '../../shared/labels.ts';
import { langInfo } from '../../shared/languages.ts';
import { type Block, pieceBlock } from './bulletin-paper.tsx';
import './outputs.css';
import './bulletin-layout.css';

export function SectionHead({ v, langs }: { v: L10n; langs: Lang[] }) {
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
export function whatLines(it: RenderedItem, r: RenderedService, langs: Lang[], f: FlowFormat, skip: Set<string>): L10n[] {
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
export function whoOf(it: RenderedItem, langs: Lang[], show: ItemShow): L10n | null {
  if (show.leaders && it.leader) return it.leader_l10n ?? { [langs[0]]: it.leader };
  if (show.posture && it.posture) return postureL10n(it.posture, langs);
  return null;
}

export function ItemHead({ it, subs, langs, compact, show }: { it: RenderedItem; subs: L10n[]; langs: Lang[]; compact: boolean; show: ItemShow }) {
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

export function TableRow({ it, subs, who, langs, alt, time }: { it: RenderedItem; subs: L10n[]; who: L10n | null; langs: Lang[]; alt: boolean; time: boolean }) {
  return (
    <div className={`bl-tr${alt ? ' alt' : ''}`}>
      <div className="t1">{time && <span className="bl-time">{it.start}</span>}<Bi v={it.title} langs={langs} /></div>
      <div className="t2">{subs.map((s, i) => <div key={i}><Bi v={s} langs={langs} sep="  ·  " /></div>)}</div>
      <div className="t3">{who && <Bi v={who} langs={langs} sep=" · " />}</div>
    </div>
  );
}

/** The dark band that opens page 1 when the template has no cover page. */
export function Banner({ r, langs, colours }: { r: RenderedService; langs: Lang[]; colours: { bg: string; fg: string } }) {
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
export function textLines(v: L10n | undefined, langs: Lang[], prefix: string): Block[] {
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
export function notesLines(notes: string | null, prefix: string): Block[] {
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
export const joinPeople = (people: L10n[], langs: Lang[]): L10n =>
  Object.fromEntries(langs.map((l) => [l, people.map((p) => p[l] ?? Object.values(p).find(Boolean) ?? '').filter(Boolean).join(langInfo(l).cjk ? '、' : ', ')]));

/** A serving table: one column per role, names underneath. */
export function RoleTable({ cols, langs }: { cols: { role: L10n; people: L10n }[]; langs: Lang[] }) {
  return (
    <div className="bl-rtable" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
      {cols.map((c, i) => <div key={`h${i}`} className={`h${i === 0 ? ' first' : ''}`}><Bi v={c.role} langs={langs} sep=" · " /></div>)}
      {cols.map((c, i) => <div key={`p${i}`} className={i === 0 ? 'first' : ''}>{hasAny(c.people) ? <Bi v={c.people} langs={langs} sep=" / " /> : '—'}</div>)}
    </div>
  );
}

export function roleColumns(names: string[], rows: { role: L10n; people: L10n[] }[], r: RenderedService, langs: Lang[]) {
  const cols = names.map((n) => {
    const row = rows.find((x) => roleMatches(x.role, n));
    const role = row?.role ?? r.role_names?.find((x) => roleMatches(x, n)) ?? { [langs[0]]: n };
    return { role, people: joinPeople(row?.people ?? [], langs) };
  });
  return cols.some((c) => hasAny(c.people)) ? cols : [];
}

/** Caption lines of a block in each language (several lines allowed). */
export function Caption({ v, langs }: { v: L10n | undefined; langs: Lang[] }) {
  const parts = biParts(v, langs);
  if (!parts.length) return null;
  return (
    <figcaption>
      {parts.flatMap((p) => p.text.split('\n').map((ln, i) => <div key={`${p.lang}${i}`} lang={LANG_ATTR[p.lang]}>{ln}</div>))}
    </figcaption>
  );
}

export function blockBlocks(ids: number[], all: BulletinBlock[], langs: Lang[], prefix: string): Block[] {
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
