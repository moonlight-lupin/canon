// Reading an Excel (.xlsx) file's first sheet as rows of text, for imports (members, songs, the books, bank
// statements …): the same rows a CSV file would give. Dates come back as YYYY-MM-DD, numbers as they are written.
// No library: an .xlsx is a zip of XML parts. Only what imports need is read (values, not formatting or formulas'
// workings — a formula's last calculated value is used).
import zlib from 'node:zlib';

/** An .xlsx (or other zip) file starts with "PK". */
export const isXlsx = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

// Limits for files people upload: an .xlsx is compressed, and a small file could unpack to gigabytes (a "zip bomb").
const MAX_ENTRIES = 10_000;
const MAX_PART = 64 * 1024 * 1024;
const MAX_TOTAL = 160 * 1024 * 1024;
const tooBig = () => new Error('This Excel file is too large to read. Save only the sheet you need, or use CSV.');
const damaged = () => new Error('This Excel file is damaged.');

/** The zip's parts by name, each unpacked only when asked for (and only once), within the limits. */
function unzip(b: Buffer): (name: string) => Buffer | undefined {
  const at = new Map<string, { method: number; start: number; csize: number }>();
  // the end of central directory record, searched from the end
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This is not an Excel file (.xlsx).');
  const count = b.readUInt16LE(eocd + 10);
  if (count > MAX_ENTRIES) throw tooBig();
  let p = b.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) break;
    const method = b.readUInt16LE(p + 10);
    const csize = b.readUInt32LE(p + 20);
    const nlen = b.readUInt16LE(p + 28);
    const xlen = b.readUInt16LE(p + 30);
    const clen = b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nlen).toString('utf8');
    if (local + 30 <= b.length) {
      const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
      if (start + csize <= b.length) at.set(name, { method, start, csize });
    }
    p += 46 + nlen + xlen + clen;
  }
  const done = new Map<string, Buffer>();
  let total = 0;
  return (name) => {
    if (done.has(name)) return done.get(name);
    const e = at.get(name);
    if (!e) return undefined;
    const raw = b.subarray(e.start, e.start + e.csize);
    const room = Math.min(MAX_PART, MAX_TOTAL - total);
    if (room <= 0) throw tooBig();
    let out: Buffer;
    try {
      out = e.method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: room }) : e.method === 0 ? Buffer.from(raw) : Buffer.alloc(0);
    } catch (err) {
      if ((err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') throw tooBig();
      throw damaged();
    }
    total += out.length;
    if (out.length > room) throw tooBig();
    done.set(name, out);
    return out;
  };
}

/**
 * The <tag …>…</tag> (or <tag …/>) elements in XML, in order: found with indexOf, so a damaged or hostile file
 * (thousands of tags never closed) takes time in proportion to its size. Stops at the first one not closed.
 */
function* elements(xml: string, tag: string): Generator<{ attrs: string; body: string }> {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let i = 0;
  while ((i = xml.indexOf(open, i)) >= 0) {
    // the whole name: <c is not <col
    const next = xml[i + open.length];
    if (next !== ' ' && next !== '>' && next !== '/' && next !== '\t' && next !== '\n' && next !== '\r') { i += open.length; continue; }
    const end = xml.indexOf('>', i);
    if (end < 0) return;
    const attrs = xml.slice(i + open.length, end);
    if (attrs.endsWith('/')) {
      yield { attrs: attrs.slice(0, -1), body: '' };
      i = end + 1;
      continue;
    }
    const stop = xml.indexOf(close, end + 1);
    if (stop < 0) return;
    yield { attrs, body: xml.slice(end + 1, stop) };
    i = stop + close.length;
  }
}
const first = (xml: string, tag: string) => { for (const e of elements(xml, tag)) return e; return undefined; };

const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
/** All the text runs inside an element (<t>…</t>, rich text included). */
const texts = (xml: string) => [...elements(xml, 't')].map((e) => unesc(e.body)).join('');
/** An attribute of a tag's attribute text (one tag, so the search is short). */
const attr = (tag: string, name: string) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag)?.[1];
const colIndex = (ref: string) => {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};
const BUILTIN_DATES = new Set([14, 15, 16, 17, 22, 27, 30, 36, 50, 57]);
/** A date's day number to YYYY-MM-DD: from 30 Dec 1899, or from 1 Jan 1904 in a workbook using the 1904 date system (older Mac Excel). */
const fromSerial = (v: number, date1904: boolean) => {
  const d = new Date(Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30) + Math.round(v * 86_400_000));
  return d.toISOString().slice(0, 10);
};

/** The first sheet's rows, each cell as text (empty cells as ''). */
export function readXlsx(data: Uint8Array): string[][] {
  const part = unzip(Buffer.from(data));
  const text = (name: string) => part(name)?.toString('utf8');
  const wb = text('xl/workbook.xml');
  const rels = text('xl/_rels/workbook.xml.rels') ?? '';
  if (!wb) throw new Error('This is not an Excel file (.xlsx).');
  // Excel's 1904 date system (older Mac workbooks): day numbers count from 1 Jan 1904
  const date1904 = /^(1|true)$/.test(attr(first(wb, 'workbookPr')?.attrs ?? '', 'date1904') ?? '');
  const firstId = attr(first(wb, 'sheet')?.attrs ?? '', 'r:id');
  const rel = firstId ? [...elements(rels, 'Relationship')].find((e) => attr(e.attrs, 'Id') === firstId) : undefined;
  const target = rel ? attr(rel.attrs, 'Target') : undefined;
  const path = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`) : 'xl/worksheets/sheet1.xml';
  const sheet = text(path) ?? text('xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('The workbook has no sheet.');
  const shared = [...elements(text('xl/sharedStrings.xml') ?? '', 'si')].map((e) => texts(e.body));
  // which cell styles are dates
  const styles = text('xl/styles.xml') ?? '';
  const custom = new Map([...elements(styles, 'numFmt')].map((e) => [Number(attr(e.attrs, 'numFmtId')), unesc(attr(e.attrs, 'formatCode') ?? '')]));
  const dateStyle = [...elements(first(styles, 'cellXfs')?.body ?? '', 'xf')].map((e) => {
    const id = Number(attr(e.attrs, 'numFmtId') ?? 0);
    const code = custom.get(id);
    return BUILTIN_DATES.has(id) || (!!code && /[dy]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]/g, '')) && !/^[#0.,%\s]+$/.test(code));
  });
  const rows: string[][] = [];
  for (const rm of elements(sheet, 'row')) {
    const rowNo = Number(attr(rm.attrs, 'r') ?? rows.length + 1);
    // a damaged row number far beyond the rows read so far is no reason to make millions of empty rows
    if (!Number.isInteger(rowNo) || rowNo < 1 || rowNo > rows.length + 100_000) throw damaged();
    const cells: string[] = [];
    for (const cm of elements(rm.body, 'c')) {
      const tag = cm.attrs;
      const body = cm.body;
      const ref = attr(tag, 'r');
      const i = ref ? colIndex(ref) : cells.length;
      if (i > 16_384) throw damaged();
      const ty = attr(tag, 't');
      const v = first(body, 'v')?.body;
      let s = '';
      if (ty === 's') s = shared[Number(v)] ?? '';
      else if (ty === 'inlineStr') s = texts(body);
      else if (ty === 'str' || ty === 'e') s = v !== undefined ? unesc(v) : '';
      else if (ty === 'b') s = v === '1' ? 'TRUE' : 'FALSE';
      else if (v !== undefined) {
        const n = Number(v);
        s = dateStyle[Number(attr(tag, 's') ?? 0)] && Number.isFinite(n) ? fromSerial(n, date1904) : v;
      }
      while (cells.length < i) cells.push('');
      cells[i] = s;
    }
    while (rows.length < rowNo - 1) rows.push([]);
    rows.push(cells);
  }
  return rows;
}

/**
 * The table in an exported sheet: the title block above it (rows with fewer than two filled cells, then an empty
 * row) is left out, so a file exported by Canon imports back as it is.
 */
export function tableRows(rows: string[][]): string[][] {
  const filled = (r: string[]) => r.filter((c) => c.trim()).length;
  const start = rows.findIndex((r) => filled(r) >= 2);
  return start < 0 ? rows : rows.slice(start).filter((r, i, a) => i < a.length - 1 || filled(r) > 0);
}

/** Rows as CSV text (for importers that read CSV): quoted where needed, nothing else changed. */
export function rowsToCsv(rows: string[][]): string {
  const q = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return rows.map((r) => r.map((c) => q(c ?? '')).join(',')).join('\r\n') + '\r\n';
}
