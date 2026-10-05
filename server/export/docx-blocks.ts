// Word export: the parts of a bulletin — the order of service, texts, songs, Scripture, tables and notes.
import {
  AlignmentType, BorderStyle, ImageRun, VerticalAlign, Paragraph, Table, TableCell, TableLayoutType, TableRow,
  TabStopType, TextRun, WidthType,
} from 'docx';
import type { L10n, Lang } from '../../shared/types.ts';
import type { Line, Paras, RenderedItem, RenderedService, RenderedVerse } from '../../shared/render-types.ts';
import { langInfo } from '../../shared/languages.ts';
import { speakerLabel } from '../../shared/labels.ts';
import { OUTPUT_LABEL, formatDate, isRefrain, stanzaLabel } from '../../shared/output-labels.ts';
import { bracketL10n, hymnLine, withVersion, type BulletinBlock, type BulletinOptions } from '../../shared/presentation.ts';
import { postureL10n, roleMatches, servingOnLabel } from '../../shared/labels.ts';
import { assetRow, listBlocks, qrPng } from '../repo/presentation.ts';
import {
  ACCENT, bi, bodyFor, centered, columns, CONTENT_W, DOC, GREY, has, headFor, hex, isCjk, joinPeople, lineRuns,
  MAX_COLUMNS, MM, NO_BORDERS, pick, PX, RULE, rule, run, type RunOpts, splitLines, SZ,
} from './docx-base.ts';

export function songBlocks(it: RenderedItem, langs: Lang[], parallel: boolean): (Paragraph | Table)[] {
  const song = it.song!;
  const out: (Paragraph | Table)[] = [];
  const seenRefrain = new Set<string>();
  const stanzaPara = (label: string, lines: string[], lang: Lang, refrain: boolean) =>
    new Paragraph({
      spacing: { after: 70 },
      indent: { left: 260, hanging: 260 },
      tabStops: [{ type: TabStopType.LEFT, position: 260 }],
      keepLines: true,
      children: [
        run(/^\d+$/.test(label.trim()) ? label.trim() : '', { bold: true, size: SZ.label, color: GREY }),
        run('\t'),
        ...(refrain && !/^\d+$/.test(label.trim())
          ? [run(stanzaLabel(label, lang), { size: SZ.label, color: GREY, italics: true, font: headFor(lang) }), run('', { break: 1 })]
          : []),
        ...lineRuns(lines, { italics: refrain && lang === 'en', font: bodyFor(lang) }),
      ],
    });

  for (const st of song.stanzas) {
    const present = langs.filter((l) => st.text[l]?.trim());
    if (!present.length) continue;
    const refrain = isRefrain(st.label);
    const key = `${st.label}|${bi(st.text, langs)}`;
    if (refrain && seenRefrain.has(key)) {
      // A repeated refrain is printed once; later occurrences are a cue only.
      out.push(
        new Paragraph({
          spacing: { after: 70 },
          indent: { left: 260 },
          children: [run(`(${langs.map((l) => stanzaLabel(st.label, l)).filter((v, i, a) => a.indexOf(v) === i).join(' ')})`, { italics: true, size: SZ.small, color: GREY })],
        }),
      );
      continue;
    }
    if (refrain) seenRefrain.add(key);
    if (parallel && present.length > 1 && present.length <= MAX_COLUMNS) {
      out.push(columns(present.map((l) => [stanzaPara(st.label, splitLines(st.text[l]), l, refrain)])));
    } else {
      for (const l of present) out.push(stanzaPara(st.label, splitLines(st.text[l]), l, refrain));
    }
  }
  const credit = [song.author && `Words: ${song.author}`, song.composer && `Music: ${song.composer}`, song.tune && `Tune: ${song.tune}${song.meter ? ` (${song.meter})` : ''}`]
    .filter(Boolean)
    .join(' · ');
  if (credit) out.push(new Paragraph({ spacing: { after: 40 }, indent: { left: 260 }, children: [run(credit, { size: SZ.tiny, color: GREY })] }));
  return out;
}

// ---------------------------------------------------------------- content: scripture

export function verseParagraph(verses: RenderedVerse[], lang?: Lang): Paragraph {
  const children: TextRun[] = [];
  let lastChapter = verses[0]?.chapter;
  verses.forEach((v, i) => {
    const num = v.chapter !== lastChapter ? `${v.chapter}:${v.verse}` : String(v.verse);
    lastChapter = v.chapter;
    children.push(run(`${i ? ' ' : ''}${num}`, { superScript: true, color: GREY, bold: true }));
    children.push(run(` ${v.text.trim()}`, { font: bodyFor(lang) }));
  });
  return new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 70 }, children });
}

export function translationLabel(code: string) {
  return new Paragraph({ spacing: { after: 20 }, children: [run(code, { size: SZ.tiny, color: GREY, smallCaps: true, font: DOC.head })] });
}

export function scriptureBlocks(it: RenderedItem, langs: Lang[], parallel: boolean): (Paragraph | Table)[] {
  const cells: Paragraph[][] = [];
  for (const l of langs) {
    const p = it.scripture?.passages[l];
    if (p?.verses.length) {
      cells.push([...(langs.length > 1 ? [translationLabel(p.translation)] : []), verseParagraph(p.verses, l)]);
    } else if (it.paras?.[l]?.length) {
      cells.push(parasParagraphs(it.paras[l]!, l, false));
    }
  }
  if (!cells.length) return [];
  if (parallel && cells.length > 1 && cells.length <= MAX_COLUMNS) return [columns(cells, false)];
  return cells.flat();
}

// ---------------------------------------------------------------- content: liturgical text

export function paraParagraph(para: Line[], lang: Lang, showMarkers: boolean): Paragraph {
  const children: TextRun[] = [];
  let prev: Line['who'] | undefined;
  para.forEach((ln, i) => {
    const strong = ln.who === 'C' || ln.who === 'A';
    if (i) children.push(run('', { break: 1 }));
    if (showMarkers && ln.who && ln.who !== prev) {
      children.push(run(`${speakerLabel(ln.who, lang)} `, { bold: true, size: SZ.label, color: GREY, font: headFor(lang) }));
    }
    prev = ln.who;
    children.push(run(ln.text, { bold: strong, font: bodyFor(lang) }));
  });
  return new Paragraph({ spacing: { after: 80 }, keepLines: true, children });
}

export function parasParagraphs(paras: Paras, lang: Lang, showMarkers = true): Paragraph[] {
  return paras.map((p) => paraParagraph(p, lang, showMarkers));
}

export function parasBlocks(it: RenderedItem, langs: Lang[], parallel: boolean): (Paragraph | Table)[] {
  const present = langs.filter((l) => it.paras?.[l]?.length);
  if (!present.length) return [];
  if (parallel && present.length > 1 && present.length <= MAX_COLUMNS) {
    // Pair paragraph i of each language so responses line up across the columns.
    const n = Math.max(...present.map((l) => it.paras![l]!.length));
    const out: Table[] = [];
    for (let i = 0; i < n; i++) {
      out.push(columns(present.map((l) => (it.paras![l]![i] ? [paraParagraph(it.paras![l]![i], l, true)] : []))));
    }
    return out;
  }
  return present.flatMap((l) => parasParagraphs(it.paras![l]!, l));
}

// ---------------------------------------------------------------- items

export function sectionHeading(it: RenderedItem, langs: Lang[]): Paragraph[] {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 80 },
      keepNext: true,
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 2 } },
      children: [run(bi(it.title, langs, '  ·  '), { smallCaps: true, bold: true, size: SZ.section, characterSpacing: 20, font: DOC.head, color: ACCENT })],
    }),
  ];
}

/** The secondary lines of an item as the template wants them: hymn numbers, 【sermon】 and 【creed】 titles. */
export function whatLines(it: RenderedItem, langs: Lang[], r: RenderedService, o: BulletinOptions, readings: Set<string>): string[] {
  const subs: L10n[] = [];
  // a reading always carries its Bible version code: "雅各书 3:13-18 (CUVS)"
  const blank = langs.every((l) => l in it.subtitle && !it.subtitle[l]?.trim());
  if (!blank && has(it.subtitle, langs) && bi(it.subtitle, langs) !== bi(it.title, langs)) subs.push(it.kind === 'scripture' ? withVersion(it.subtitle, it.scripture, langs) : it.subtitle);
  if (it.kind === 'sermon' && has(r.sermon_ref, langs) && bi(r.sermon_ref, langs) !== bi(it.subtitle, langs) && !readings.has(bi(r.sermon_ref, langs))) subs.push(r.sermon_ref);
  if (it.song && o.hymn_number !== 'abbr' && subs.length && subs[0] === it.subtitle) {
    const line = hymnLine(it.song, it.subtitle, langs, o.hymn_number);
    if (bi(line, langs) === bi(it.title, langs)) subs.shift();
    else subs[0] = line;
  }
  if (o.sermon_brackets && subs.length && subs[0] === it.subtitle) {
    if (it.kind === 'sermon' && has(r.sermon_title, langs)) subs[0] = bracketL10n(subs[0], undefined, langs);
    else if (it.kind === 'text' && it.text_title) subs[0] = bracketL10n(subs[0], it.text_title, langs);
  }
  return subs.map((x) => bi(x, langs, '  ·  '));
}

/** Who leads the item (with honorifics), else the posture when the template prints it. */
export function whoText(it: RenderedItem, langs: Lang[], o: BulletinOptions): string {
  if (o.show_leaders && it.leader) return it.leader_l10n ? bi(it.leader_l10n, langs, ' / ') : it.leader;
  if (o.show_posture && it.posture) return bi(postureL10n(it.posture, langs), langs, ' / ');
  return '';
}

export function itemHeader(it: RenderedItem, langs: Lang[], subs: string[], hasContent: boolean, o: BulletinOptions): Paragraph[] {
  const leader = o.show_leaders && it.leader ? (it.leader_l10n ? bi(it.leader_l10n, langs, ' / ') : it.leader) : '';
  const posture = o.show_posture && it.posture ? bi(postureL10n(it.posture, langs), langs, ' / ') : '';
  const right = [leader, posture].filter(Boolean).join('  ·  ');
  // Keep the header with what follows it, but don't chain content-less items together
  // (that would drag whole runs of short items onto the next page).
  const out: Paragraph[] = [
    new Paragraph({
      spacing: { before: 140, after: 10 },
      keepNext: subs.length > 0 || hasContent,
      tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
      children: [
        ...(o.show_times ? [run(`${it.start}  `, { size: SZ.small, color: GREY })] : []),
        run(bi(it.title, langs), { bold: true, size: SZ.item, font: DOC.head }),
        ...(right ? [run('\t'), run(right, { size: SZ.small, color: GREY, italics: true })] : []),
      ],
    }),
  ];
  subs.forEach((s, i) => {
    out.push(new Paragraph({ spacing: { after: 10 }, keepNext: i < subs.length - 1 || hasContent, children: [run(s, { italics: true, size: SZ.small, color: GREY })] }));
  });
  return out;
}

export function itemContent(it: RenderedItem, langs: Lang[], parallel: boolean): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [];
  if (it.song?.stanzas.length) blocks.push(...songBlocks(it, langs, parallel));
  else if (it.kind === 'scripture') blocks.push(...scriptureBlocks(it, langs, parallel));
  else if (it.paras) blocks.push(...parasBlocks(it, langs, parallel));
  if (blocks.length) blocks.unshift(new Paragraph({ spacing: { after: 40 }, keepNext: true, children: [] }));
  return blocks;
}

// ---------------------------------------------------------------- header & back matter

export function headerBlock(r: RenderedService, langs: Lang[]): Paragraph[] {
  const out: Paragraph[] = [];
  for (const l of langs) {
    const name = pick(r.church.name, l);
    if (name) out.push(centered([run(name, { smallCaps: !langInfo(l).cjk, size: SZ.church, characterSpacing: langInfo(l).cjk ? 0 : 30, font: headFor(l), color: '333333' })]));
  }
  out.push(rule(40, 120));
  for (const l of langs) {
    const t = pick(r.title, l);
    if (t) out.push(centered([run(t, { bold: true, size: SZ.title, font: bodyFor(l) })], 20));
  }
  if (!langs.some((l) => pick(r.title, l)) && bi(r.title, Object.keys(r.title))) out.push(centered([run(bi(r.title, Object.keys(r.title)), { bold: true, size: SZ.title })], 20));
  // one line per language when there are three, otherwise "date · 日期"
  if (langs.length > 2) for (const l of langs) out.push(centered([run(formatDate(r.date, [l]), { size: SZ.body, font: bodyFor(l) })], 0, l === langs[0] ? 60 : 0));
  else out.push(centered([run(formatDate(r.date, langs), { size: SZ.body })], 0, 60));
  out.push(centered([run(`${r.start_time}${r.end_time ? ` – ${r.end_time}` : ''}`, { size: SZ.small, color: GREY })], 60));

  const meta: [L10n, string][] = [];
  if (has(r.theme, langs)) meta.push([OUTPUT_LABEL.theme, bi(r.theme, langs, '  ·  ')]);
  if (has(r.sermon_title, langs)) meta.push([OUTPUT_LABEL.sermon, bi(r.sermon_title, langs, '  ·  ') + (has(r.sermon_ref, langs) ? ` (${bi(r.sermon_ref, langs, ' / ')})` : '')]);
  if (r.preacher) meta.push([OUTPUT_LABEL.preacher, r.preacher]);
  for (const [label, value] of meta) {
    out.push(
      centered([run(`${bi(label, langs)}  `, { size: SZ.label, color: GREY, smallCaps: true, font: DOC.head }), run(value, { size: SZ.small, italics: true })], 10),
    );
  }
  out.push(rule(80, 40));
  return out;
}

export function rosterBlock(r: RenderedService, langs: Lang[]): (Paragraph | Table)[] {
  if (!r.roster.length) return [];
  const roleW = Math.round(CONTENT_W * 0.42);
  const thin = { style: BorderStyle.SINGLE, size: 2, color: 'D0D0D0' };
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 280, after: 80 },
      keepNext: true,
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 2 } },
      children: [run(bi(OUTPUT_LABEL.servingToday, langs, ' / '), { smallCaps: true, bold: true, size: SZ.section, font: DOC.head, color: ACCENT })],
    }),
    new Table({
      width: { size: CONTENT_W, type: WidthType.DXA },
      columnWidths: [roleW, CONTENT_W - roleW],
      layout: TableLayoutType.FIXED,
      borders: { ...NO_BORDERS, insideHorizontal: thin },
      rows: r.roster.map(
        (row) =>
          new TableRow({
            cantSplit: true,
            children: [
              new TableCell({
                width: { size: roleW, type: WidthType.DXA },
                margins: { top: 20, bottom: 20, left: 0, right: 80 },
                children: [new Paragraph({ children: [run(bi(row.role, langs), { size: SZ.small, color: GREY })] })],
              }),
              new TableCell({
                width: { size: CONTENT_W - roleW, type: WidthType.DXA },
                margins: { top: 20, bottom: 20, left: 80, right: 0 },
                children: [new Paragraph({ children: [run(row.people_l10n ? joinPeople(row.people_l10n, langs) : row.people.join(', '), { size: SZ.small })] })],
              }),
            ],
          }),
      ),
    }),
  ];
}

export function backMatter(r: RenderedService, langs: Lang[], show: { ccli: boolean; contact: boolean }): Paragraph[] {
  const out: Paragraph[] = [];
  const small = (text: string, o: RunOpts = {}) => run(text, { size: SZ.tiny, color: GREY, ...o });
  if (show.ccli && (r.notices.length || r.church.ccli_license)) {
    out.push(rule(200, 60));
    for (const n of r.notices) out.push(new Paragraph({ spacing: { after: 10 }, children: [small(n)] }));
    if (r.church.ccli_license) {
      out.push(new Paragraph({ spacing: { before: 30, after: 10 }, children: [small(`CCLI Licence #${r.church.ccli_license}`, { bold: true })] }));
    }
  }
  const contact = [r.church.address, r.church.contact].map((s) => s?.trim()).filter(Boolean) as string[];
  if (show.contact && (contact.length || has(r.church.name, langs))) {
    out.push(rule(120, 60));
    if (has(r.church.name, langs)) out.push(centered([small(bi(r.church.name, langs, '  ·  '), { bold: true, color: '444444' })], 10));
    for (const c of contact) out.push(centered(splitLines(c).flatMap((l, i) => [small(l, { break: i ? 1 : undefined })]), 10));
  }
  return out;
}

// ---------------------------------------------------------------- banner, order table, separate sections, back page

/** The dark band opening page 1 (logo, church name + service title, address), then the date. */
export function bannerBlock(r: RenderedService, langs: Lang[], o: BulletinOptions): (Paragraph | Table)[] {
  const fg = hex(o.banner.fg);
  const lines = [...new Set(langs.map((l) => [pick(r.church.name, l), pick(r.title, l)].filter(Boolean).join(isCjk(l) ? '' : ' · ')).filter(Boolean))];
  const address = (r.church.address ?? '').replace(/\s*\n\s*/g, ', ').trim();
  const text: Paragraph[] = [
    ...lines.map((t) => centered([run(t, { bold: true, size: 26, color: fg, font: DOC.head })], 20)),
    ...(address ? [centered([run(address, { size: SZ.tiny, color: fg })], 0, 30)] : []),
  ];
  const logo = assetRow('logo');
  const type = logo?.mime === 'image/png' ? 'png' : logo?.mime === 'image/jpeg' ? 'jpg' : null;
  const logoW = Math.round(26 * MM);
  const shade = { fill: hex(o.banner.bg), color: 'auto' };
  const cells: TableCell[] = [];
  if (logo && type) {
    cells.push(new TableCell({
      width: { size: logoW, type: WidthType.DXA },
      shading: shade,
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 100, bottom: 100, left: 140, right: 60 },
      children: [new Paragraph({ children: [new ImageRun({ type, data: Buffer.from(logo.data), transformation: { width: PX(18), height: PX(14) } })] })],
    }));
  }
  cells.push(new TableCell({
    width: { size: CONTENT_W - (cells.length ? logoW : 0), type: WidthType.DXA },
    shading: shade,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 120, bottom: 120, left: 100, right: 100 },
    children: text.length ? text : [new Paragraph({ children: [] })],
  }));
  return [
    new Table({
      width: { size: CONTENT_W, type: WidthType.DXA },
      columnWidths: cells.length > 1 ? [logoW, CONTENT_W - logoW] : [CONTENT_W],
      layout: TableLayoutType.FIXED,
      borders: NO_BORDERS,
      rows: [new TableRow({ cantSplit: true, children: cells })],
    }),
    centered([run(formatDate(r.date, langs, '  ·  '), { bold: true })], 100, 120),
  ];
}

/** Rows of the three-column order (item | what | who), shaded every other row. */
export class OrderTable {
  rows: TableRow[] = [];
  n = 0;
  w = [Math.round(CONTENT_W * 0.25), Math.round(CONTENT_W * 0.5), CONTENT_W - Math.round(CONTENT_W * 0.25) - Math.round(CONTENT_W * 0.5)];
  section(title: string) {
    this.rows.push(new TableRow({
      cantSplit: true,
      children: [new TableCell({
        columnSpan: 3,
        width: { size: CONTENT_W, type: WidthType.DXA },
        margins: { top: 100, bottom: 30, left: 0, right: 0 },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(title, { smallCaps: true, bold: true, size: SZ.section, font: DOC.head, color: ACCENT })] })],
      })],
    }));
  }
  item(title: string, what: string[], who: string, time: string | null) {
    const shade = this.n++ % 2 === 1 ? { fill: 'E9E9E9', color: 'auto' } : undefined;
    const cell = (i: number, children: Paragraph[]) => new TableCell({
      width: { size: this.w[i], type: WidthType.DXA },
      shading: shade,
      margins: { top: 40, bottom: 40, left: 90, right: 90 },
      children: children.length ? children : [new Paragraph({ children: [] })],
    });
    this.rows.push(new TableRow({
      cantSplit: true,
      children: [
        cell(0, [new Paragraph({ children: [...(time ? [run(`${time}  `, { size: SZ.small, color: GREY })] : []), run(title, { bold: true, font: DOC.head })] })]),
        cell(1, what.map((w) => new Paragraph({ alignment: AlignmentType.CENTER, children: [run(w)] }))),
        cell(2, who ? [new Paragraph({ alignment: AlignmentType.RIGHT, children: [run(who, { size: SZ.small })] })] : []),
      ],
    }));
  }
  /** The rows so far as a table (and start afresh), or nothing. */
  flush(): Table[] {
    if (!this.rows.length) return [];
    const t = new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: this.w, layout: TableLayoutType.FIXED, borders: NO_BORDERS, rows: this.rows });
    this.rows = [];
    return [t];
  }
}

export const NUMBERED = /^\s*(\d+|[一二三四五六七八九十]+|[A-Za-z])\s*[.)、．）]/;

/** Announcements as typed, numbered lines with a hanging indent. */
export function announcementParas(lines: { text: string; lang?: Lang }[]): Paragraph[] {
  return lines.map((l) => new Paragraph({
    spacing: { after: 60 },
    indent: NUMBERED.test(l.text) ? { left: 360, hanging: 360 } : undefined,
    children: [run(l.text, { font: bodyFor(l.lang) })],
  }));
}

/** A serving table: one column per role, names underneath. */
export function roleTable(cols: { role: string; people: string }[]): Table {
  const w = Math.floor(CONTENT_W / cols.length);
  const line = { style: BorderStyle.SINGLE, size: 4, color: '9A9A9A' };
  return new Table({
    width: { size: w * cols.length, type: WidthType.DXA },
    columnWidths: Array(cols.length).fill(w),
    layout: TableLayoutType.FIXED,
    borders: { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line },
    rows: [
      new TableRow({ cantSplit: true, children: cols.map((c) => new TableCell({ width: { size: w, type: WidthType.DXA }, shading: { fill: 'E9E9E9', color: 'auto' }, margins: { top: 40, bottom: 40, left: 60, right: 60 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(c.role, { bold: true, size: SZ.small })] })] })) }),
      new TableRow({ cantSplit: true, children: cols.map((c) => new TableCell({ width: { size: w, type: WidthType.DXA }, margins: { top: 40, bottom: 40, left: 60, right: 60 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(c.people || '—', { size: SZ.small })] })] })) }),
    ],
  });
}

export function roleColumns(names: string[], rows: { role: L10n; people: L10n[] }[], r: RenderedService, langs: Lang[]) {
  const cols = names.map((n) => {
    const row = rows.find((x) => roleMatches(x.role, n));
    const role = row?.role ?? r.role_names?.find((x) => roleMatches(x, n)) ?? { [langs[0]]: n };
    return { role: bi(role, langs, ' / '), people: joinPeople(row?.people ?? [], langs) };
  });
  return cols.some((c) => c.people) ? cols : [];
}

/** A serving table for this service's roles (one column per role). */
export function servingThisWeek(r: RenderedService, langs: Lang[], roles: string[]): (Paragraph | Table)[] {
  const rows = r.roster.map((x) => ({ role: x.role, people: x.people_l10n ?? x.people.map((p) => ({ [langs[0]]: p })) }));
  const cols = roleColumns(roles, rows, r, langs);
  return cols.length ? [new Paragraph({ spacing: { before: 120 }, children: [] }), roleTable(cols)] : [];
}

/** The next service's roster table ("Serving on 11 Oct"). */
export function servingNextWeek(r: RenderedService, langs: Lang[], roles: string[]): (Paragraph | Table)[] {
  if (!roles.length || !r.next_roster) return [];
  const cols = roleColumns(roles, r.next_roster.roles, r, langs);
  if (!cols.length) return [];
  const head = bi(Object.fromEntries(langs.map((l) => [l, servingOnLabel(r.next_roster!.date, l)])), langs, '  ·  ');
  return [centered([run(head, { bold: true, font: DOC.head })], 60, 240), roleTable(cols)];
}

/** QR codes, pictures (three to a row) and notes from Library → QR codes & notes. */
export async function blockParas(ids: number[], langs: Lang[], known: BulletinBlock[] | undefined): Promise<(Paragraph | Table)[]> {
  const out: (Paragraph | Table)[] = [];
  if (!ids.length) return out;
  const all = known?.length ? known : listBlocks();
  let row: { img: ImageRun | null; caption: string[] }[] = [];
  const flush = () => {
    if (!row.length) return;
    const w = Math.floor(CONTENT_W / 3);
    out.push(new Paragraph({ spacing: { before: 160 }, children: [] }));
    out.push(new Table({
      width: { size: w * row.length, type: WidthType.DXA },
      columnWidths: Array(row.length).fill(w),
      layout: TableLayoutType.FIXED,
      alignment: AlignmentType.CENTER,
      borders: NO_BORDERS,
      rows: [new TableRow({
        cantSplit: true,
        children: row.map((c) => new TableCell({
          width: { size: w, type: WidthType.DXA },
          children: [
            ...(c.img ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [c.img] })] : []),
            ...c.caption.map((t) => centered([run(t, { size: SZ.small })])),
          ],
        })),
      })],
    }));
    row = [];
  };
  for (const id of ids) {
    const b: BulletinBlock | undefined = all.find((x) => x.id === id);
    if (!b) continue;
    const caption = langs.flatMap((l) => (pick(b.data.caption, l) ? pick(b.data.caption, l).split('\n') : [])).filter((x, i, a) => a.indexOf(x) === i);
    if (b.kind === 'text') {
      flush();
      if (has(b.data.text, langs)) {
        const lines = [...new Set(langs.map((l) => pick(b.data.text, l)).filter(Boolean))];
        out.push(new Paragraph({
          alignment: b.data.align === 'left' ? AlignmentType.LEFT : AlignmentType.CENTER,
          spacing: { before: 160, after: 80 },
          children: lines.flatMap((t, i) => t.split('\n').map((ln, j) => run(ln, { bold: b.data.bold !== false, break: i || j ? 1 : undefined }))),
        }));
      }
      continue;
    }
    let img: ImageRun | null = null;
    const size = { width: PX(28), height: PX(28) };
    if (b.kind === 'qr' && b.data.value) {
      img = new ImageRun({ type: 'png', data: await qrPng(b.data.value, 400), transformation: size });
    } else if (b.kind === 'image' && b.data.image) {
      const a = assetRow(`bulletin-block-${b.id}`);
      // Word cannot show WebP: those pictures print in the browser bulletin only
      const type = a?.mime === 'image/png' ? 'png' : a?.mime === 'image/jpeg' ? 'jpg' : null;
      if (a && type) img = new ImageRun({ type, data: Buffer.from(a.data), transformation: size });
    }
    if (!img && !caption.length) continue;
    if (row.length === 3) flush();
    row.push({ img, caption });
  }
  flush();
  return out;
}

/** A centred bold heading of an announcements / weekly / fixed-text section. */
export const textHeading = (v: L10n, langs: Lang[]) =>
  new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { after: 160 }, children: [run(bi(v, langs, '  ·  '), { bold: true, size: SZ.title - 4, font: DOC.head })] });

/** Lines of a text per language, one after another (blank lines dropped). */
export const textLinesOf = (v: L10n | undefined, langs: Lang[]) =>
  langs.flatMap((l) => splitLines(v?.[l]).map((text) => ({ text: text.trim(), lang: l })));

/** A ruled page for sermon notes. */
export function sermonNotesPage(langs: Lang[]): Paragraph[] {
  const line = { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D0D0D0', space: 1 } };
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 2 } },
      children: [run(bi(OUTPUT_LABEL.sermonNotes, langs, ' / '), { smallCaps: true, bold: true, size: SZ.section, font: DOC.head, color: ACCENT })],
    }),
    ...Array.from({ length: 22 }, () => new Paragraph({ spacing: { before: 200 }, border: line, children: [] })),
  ];
}
