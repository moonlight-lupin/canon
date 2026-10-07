// A small Excel (.xlsx) writer for Canon's exports, used by the server and the browser alike (no library). Each sheet
// starts with a title block (the church and the report, the period and filters, when and by whom it was exported, a
// note when it holds personal data), then the headings — bold, frozen and with filters — and the rows. Numbers stay
// numbers, ISO dates (YYYY-MM-DD) become real dates, and money columns get two decimals. The file is a zip of XML
// parts, stored uncompressed (no zlib needed in the browser; Excel opens it the same).

export type XCell = string | number | boolean | null | undefined;
export interface XSheet {
  /** the tab's name (cut to 31 characters) */
  name: string;
  /** the title block: the first line as the title, the others smaller, then an empty row */
  lines?: string[];
  header: string[];
  rows: XCell[][];
  /** columns (0-based) shown as money, 1,234.50 — numbers, or numeric text such as "12.50" */
  money?: number[];
}

/** The title block's lines: "<church> — <title>", the period and filters, "Exported … by …", the personal-data note. */
export function titleLines(m: { church: string; title: string; period?: string | null; filters?: (string | null | undefined)[]; exported: string; pii?: string | null }): string[] {
  const filters = (m.filters ?? []).filter((x): x is string => !!x && !!x.trim());
  return [
    [m.church, m.title].filter(Boolean).join(' — '),
    [m.period, ...filters].filter(Boolean).join(' · '),
    m.exported,
    m.pii ?? '',
  ].filter((x) => x);
}

// ---------------------------------------------------------------- the parts

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
// characters XML 1.0 can't hold (control characters other than tab and new lines) are dropped
// eslint-disable-next-line no-control-regex
const esc = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const col = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const NUMERIC = /^-?\d+(\.\d+)?$/;
/** Excel's day number for a date (days since 30 Dec 1899). */
const serial = (y: number, m: number, d: number) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
/** How wide a value looks (CJK characters take two places). */
const width = (s: string) => {
  let w = 0;
  for (const ch of s) w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1;
  return w;
};

// styles: 0 plain, 1 title, 2 subtitle, 3 heading, 4 date, 5 money, 6 wrapped text
const STYLES = `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF666666"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEDEAE2"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF999999"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function cellXml(ref: string, v: XCell, style: number | null, money: boolean): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${money ? ' s="5"' : style ? ` s="${style}"` : ''}><v>${v}</v></c>`;
  const s = String(v);
  if (money && NUMERIC.test(s.trim())) return `<c r="${ref}" s="5"><v>${Number(s)}</v></c>`;
  const d = style === null ? ISO.exec(s) : null;
  if (d) return `<c r="${ref}" s="4"><v>${serial(+d[1], +d[2], +d[3])}</v></c>`;
  const st = style ?? (s.includes('\n') ? 6 : 0);
  return `<c r="${ref}" t="inlineStr"${st ? ` s="${st}"` : ''}><is><t xml:space="preserve">${esc(s)}</t></is></c>`;
}

function sheetXml(sh: XSheet): { xml: string; filter: string | null } {
  const lines = (sh.lines ?? []).filter(Boolean);
  const top = lines.length ? lines.length + 1 : 0; // the title block and an empty row
  const headRow = top + 1;
  const money = new Set(sh.money ?? []);
  const ncol = Math.max(sh.header.length, ...sh.rows.map((r) => r.length), 1);
  const widths = Array.from({ length: ncol }, (_, i) => Math.max(8, width(sh.header[i] ?? '') + 2));
  for (const r of sh.rows) r.forEach((v, i) => {
    const s = v === null || v === undefined ? '' : typeof v === 'number' ? v.toFixed(2) : String(v).split('\n')[0];
    widths[i] = Math.min(60, Math.max(widths[i], width(s) + 2));
  });
  const out: string[] = [];
  lines.forEach((l, i) => out.push(`<row r="${i + 1}">${cellXml(`A${i + 1}`, l, i === 0 ? 1 : 2, false)}</row>`));
  out.push(`<row r="${headRow}">${sh.header.map((h, i) => cellXml(`${col(i)}${headRow}`, h, 3, false)).join('')}</row>`);
  sh.rows.forEach((r, k) => {
    const n = headRow + 1 + k;
    out.push(`<row r="${n}">${r.map((v, i) => cellXml(`${col(i)}${n}`, v, null, money.has(i))).join('')}</row>`);
  });
  const last = `${col(ncol - 1)}${headRow + sh.rows.length}`;
  const filter = sh.header.length ? `A${headRow}:${col(ncol - 1)}${headRow + Math.max(sh.rows.length, 1)}` : null;
  const xml = `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<dimension ref="A1:${last}"/>`
    + `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headRow}" topLeftCell="A${headRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + '<sheetFormatPr defaultRowHeight="15"/>'
    + `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    + `<sheetData>${out.join('')}</sheetData>`
    + (filter ? `<autoFilter ref="${filter}"/>` : '')
    + '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>'
    + '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
    + '</worksheet>';
  return { xml, filter };
}

const sheetName = (s: string, used: Set<string>) => {
  const base = (s.replace(/[[\]:*?/\\]/g, ' ').trim() || 'Sheet').slice(0, 31);
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 28)} ${i}`;
  used.add(name.toLowerCase());
  return name;
};

/** The workbook, as the bytes of an .xlsx file. */
export function buildXlsx(sheets: XSheet[]): Uint8Array {
  const used = new Set<string>();
  const names = sheets.map((s) => sheetName(s.name, used));
  const built = sheets.map(sheetXml);
  const files: [string, string][] = [
    ['[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><definedNames>${built.map((b, i) => (b.filter ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(names[i].replace(/'/g, "''"))}'!${b.filter.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}</definedName>` : '')).join('')}</definedNames></workbook>`],
    ['xl/_rels/workbook.xml.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', STYLES],
    ...built.map((b, i) => [`xl/worksheets/sheet${i + 1}.xml`, b.xml] as [string, string]),
  ];
  return storedZip(files.map(([name, text]) => ({ name, data: new TextEncoder().encode(text) })));
}

/** One sheet with a title block: the usual export. */
export const xlsxTable = (s: XSheet) => buildXlsx([s]);

// ---------------------------------------------------------------- a zip with stored (uncompressed) entries

let CRC: Uint32Array | null = null;
function crc32(b: Uint8Array) {
  if (!CRC) {
    CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function storedZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  // a fixed time (1 Jan 2020): the same content gives the same file
  const time = 0;
  const date = ((2020 - 1980) << 9) | (1 << 5) | 1;
  for (const f of files) {
    const name = new TextEncoder().encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, time, true);
    c.setUint16(14, date, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, f.data.length, true);
    c.setUint32(24, f.data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
