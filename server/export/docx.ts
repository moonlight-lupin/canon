// Word (.docx) order of service / bulletin, built with the `docx` package.
// A5 portrait pages: the church prints A4 landscape folded into an A5 booklet (Word: "Book fold").
import { AlignmentType, BorderStyle, Document, Footer, Packer, PageNumber, Paragraph, Table, TextRun } from 'docx';
import type { Lang } from '../../shared/types.ts';
import type { RenderedService } from '../../shared/render-types.ts';
import { OUTPUT_LABEL } from '../../shared/output-labels.ts';
import {
  ANNOUNCEMENTS_KEY, DEFAULT_BULLETIN_OPTIONS, bracket, firstStanza, hasSection, type BulletinSection,
} from '../../shared/presentation.ts';
import {
  ACCENT, setDocStyle, bi, centered, DOC, fontsFor, GREY, has, isCjk, lineRuns, MARGIN, MAX_COLUMNS, MM, PAGE_H,
  PAGE_W, pageBreak, pick, RULE, run, splitLines, SZ,
} from './docx-base.ts';
import {
  announcementParas, backMatter, bannerBlock, blockParas, headerBlock, itemContent, itemHeader, OrderTable,
  rosterBlock, sectionHeading, sermonNotesPage, servingNextWeek, servingThisWeek, textHeading, textLinesOf, whatLines,
  whoText,
} from './docx-blocks.ts';

// ---------------------------------------------------------------- page geometry (twips: 1 mm = 56.7)

export async function serviceDocx(r: RenderedService): Promise<Buffer> {
  // The bulletin template decides languages, layout, the page layout (sections and page breaks) and (per item) full
  // words or title only. Word has no booklet padding: it prints the pages in order ("Book fold" folds them).
  const o = r.bulletin?.options ?? DEFAULT_BULLETIN_OPTIONS;
  const L = o.page_layout ?? DEFAULT_BULLETIN_OPTIONS.page_layout;
  const all: Lang[] = r.languages.length ? r.languages : ['en'];
  const langs = o.languages === 'primary' ? all.slice(0, 1) : all;
  const parallel = o.layout === 'parallel' && langs.length > 1 && langs.length <= MAX_COLUMNS;
  setDocStyle(fontsFor(langs), r.season?.color ? r.season.color.replace('#', '').toUpperCase() : '1E2430');

  const banner = r.cover?.style === 'banner';
  const table = o.order_style === 'table';
  const separateText = hasSection(L, 'full_texts');
  const separateAnn = hasSection(L, 'announcements');
  const content = r.bulletin?.content ?? {};
  const readings = new Set(r.items.filter((x) => x.in_bulletin && x.kind === 'scripture').map((x) => bi(x.subtitle, langs)));

  // the order of service, and the words gathered for a full-texts section
  const order: (Paragraph | Table)[] = [];
  const fullText: (Paragraph | Table)[] = [];
  const rows = new OrderTable();
  for (const it of r.items) {
    if (!it.in_bulletin) continue;
    if (it.kind === 'section') {
      if (table) rows.section(bi(it.title, langs, '  ·  '));
      else order.push(...sectionHeading(it, langs));
      continue;
    }
    let body: (Paragraph | Table)[] = [];
    // with an announcements section the item stays in the order, its words print in that section
    if (!(it.kind === 'announcements' && separateAnn)) {
      const full = it.bulletin_full ?? true;
      const shown = full === 'first_stanza' && it.song ? { ...it, song: { ...it.song, stanzas: firstStanza(it.song.stanzas) } } : it;
      body = full ? itemContent(shown, langs, parallel) : [];
      if (separateText && body.length) {
        const head = it.text_title && has(it.text_title, langs) ? it.text_title : it.song ? it.song.title : has(it.subtitle, langs) ? it.subtitle : it.title;
        const title = bi(Object.fromEntries(langs.map((l) => [l, o.sermon_brackets && isCjk(l) ? bracket(pick(head, l), l) : pick(head, l)])), langs, '  ·  ');
        fullText.push(new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: fullText.length ? 200 : 0, after: 60 }, children: [run(title, { bold: true, size: SZ.item, font: DOC.head })] }));
        fullText.push(...body);
        body = [];
      }
    }
    const subs = whatLines(it, langs, r, o, readings);
    if (table) {
      rows.item(bi(it.title, langs), subs, whoText(it, langs, o), o.show_times ? it.start : null);
      if (body.length) order.push(...rows.flush(), ...body);
    } else {
      order.push(...itemHeader(it, langs, subs, body.length > 0, o));
      order.push(...body);
    }
  }
  order.push(...rows.flush());

  const section = async (s: BulletinSection): Promise<(Paragraph | Table)[]> => {
    switch (s.type) {
      case 'cover':
        return banner ? bannerBlock(r, langs, o) : headerBlock(r, langs);
      case 'order':
        return order;
      case 'full_texts':
        return fullText;
      case 'announcements': {
        const lines = [...textLinesOf(content[ANNOUNCEMENTS_KEY], langs), ...(s.service_notes ? splitLines(r.notes ?? '').map((text) => ({ text: text.trim() })) : [])];
        return lines.length ? [textHeading(has(s.heading, langs) ? s.heading! : OUTPUT_LABEL.announcements, langs), ...announcementParas(lines)] : [];
      }
      case 'weekly_text':
      case 'fixed_text': {
        const lines = textLinesOf(s.type === 'weekly_text' ? (s.key ? content[s.key] : undefined) : s.text, langs);
        return lines.length ? [...(has(s.heading, langs) ? [textHeading(s.heading!, langs)] : []), ...announcementParas(lines)] : [];
      }
      case 'service_notes': {
        if (!r.notes?.trim()) return [];
        const head = has(s.heading, langs) ? s.heading! : OUTPUT_LABEL.announcements;
        return [
          new Paragraph({
            alignment: AlignmentType.CENTER, spacing: { before: 200, after: 80 }, keepNext: true,
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 2 } },
            children: [run(bi(head, langs, ' / '), { smallCaps: true, bold: true, size: SZ.section, font: DOC.head, color: ACCENT })],
          }),
          ...r.notes.replace(/\r/g, '').split(/\n\s*\n/).filter((p) => p.trim()).map((p) => new Paragraph({ spacing: { after: 80 }, children: lineRuns(splitLines(p)) })),
        ];
      }
      case 'serving_this_week':
        return s.roles?.length ? servingThisWeek(r, langs, s.roles) : rosterBlock(r, langs);
      case 'serving_next_week':
        return servingNextWeek(r, langs, s.roles ?? []);
      case 'note':
        return has(s.text, langs) ? [centered([run(bi(s.text, langs, '  ·  '), { bold: true, size: SZ.item })], 120, 240)] : [];
      case 'blocks':
        return blockParas(s.blocks ?? [], langs, r.bulletin?.blocks);
      case 'sermon_notes':
        // a spare-page notes page belongs to folded booklets printed from the browser
        // under the section before it: a heading and a few lines (Word flows on by itself)
        return s.spare_only ? [] : s.fill ? sermonNotesPage(langs, 10) : sermonNotesPage(langs);
      case 'ccli_contact':
        return backMatter(r, langs, { ccli: s.ccli !== false, contact: s.contact !== false });
      default:
        return [];
    }
  };

  // Walk the layout: a page break (or "starts a new page") becomes a Word page break before the next printed
  // section; a section that prints nothing makes no blank page. A cover page (not a banner) is a page of its own.
  const body: (Paragraph | Table)[] = [];
  let pending = false;
  for (const s of L) {
    if (s.type === 'page_break') {
      pending = true;
      continue;
    }
    const els = await section(s);
    if (!els.length) continue;
    if ((pending || s.new_page) && body.length) body.push(pageBreak());
    pending = s.type === 'cover' && !banner;
    body.push(...els);
  }

  const doc = new Document({
    creator: 'Canon',
    title: bi(r.title, langs) || 'Order of Service',
    description: `Order of service ${r.date}`,
    styles: {
      default: {
        document: {
          run: { font: DOC.body, size: SZ.body, language: DOC.language },
          paragraph: { spacing: { after: 0, line: 252 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_W, height: PAGE_H },
            margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN, header: Math.round(6 * MM), footer: Math.round(6 * MM) },
          },
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: SZ.tiny, color: GREY, font: DOC.body })] })],
          }),
        },
        children: body,
      },
    ],
  });
  return Packer.toBuffer(doc);
}
