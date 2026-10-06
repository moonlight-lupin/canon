// Bulletin: the cover, and building a bulletin from its template's page layout.
import { Fragment } from 'react';
import type { L10n, Lang, RenderedItem, RenderedService } from '../types-client.ts';
import { Bi, LABEL, LANG_ATTR, biParts, dateParts, hasAny, timeRange, type Layout } from './content.tsx';
import { CrossMark, logoUrl, useLogo } from '../components/brand.tsx';
import {
  ANNOUNCEMENTS_KEY, DEFAULT_BULLETIN_OPTIONS, hasSection, type BulletinBlock, type BulletinFull, type BulletinOptions,
  type BulletinSection,
} from '../../shared/presentation.ts';
import { servingOnLabel } from '../../shared/labels.ts';
import {
  Banner, blockBlocks, buildOrder, type FlowFormat, type ItemShow, joinPeople, notesLines, roleColumns, RoleTable,
  textLines,
} from './bulletin-order.tsx';
import type { Block } from './bulletin-paper.tsx';
import './outputs.css';
import './bulletin-layout.css';

export type CoverStyle = RenderedService['cover']['style'];

export const COVER_STYLES: CoverStyle[] = ['plain', 'cross', 'logo', 'verse', 'banner'];

export const COVER_LABEL: Record<CoverStyle, string> = {
  plain: 'Plain', cross: 'Cross', logo: 'Church logo', verse: 'Verse of the week', banner: 'Banner on page 1 (no cover page)',
};

/** The cover: church, ornament (cross / logo / verse), title, date, theme and sermon. */
export function Cover({ r, langs, style }: { r: RenderedService; langs: Lang[]; style: CoverStyle }) {
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

export function NotesPage({ langs }: { langs: Lang[] }) {
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
        // the rest of the page, under the section before it (heading and a few lines at least, else the next page)
        if (s.fill) return [{ key: `${p}notes`, fill: true, node: <NotesPage langs={langs} /> }];
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
