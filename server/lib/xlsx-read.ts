// Reading an Excel (.xlsx) file's first sheet as rows of text, for imports (members, songs, the books, bank
// statements …): the same rows a CSV file would give. Dates come back as YYYY-MM-DD, numbers as they are written.
// No library: an .xlsx is a zip of XML parts. Only what imports need is read (values, not formatting or formulas'
// workings — a formula's last calculated value is used).
import zlib from 'node:zlib';

/** An .xlsx (or other zip) file starts with "PK". */
export const isXlsx = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

function unzip(b: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  // the end of central directory record, searched from the end
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This is not an Excel file (.xlsx).');
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k++) {
    if (b.readUInt32LE(p) !== 0x02014b50) break;
    const method = b.readUInt16LE(p + 10);
    const csize = b.readUInt32LE(p + 20);
    const nlen = b.readUInt16LE(p + 28);
    const xlen = b.readUInt16LE(p + 30);
    const clen = b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nlen).toString('utf8');
    const lnlen = b.readUInt16LE(local + 26);
    const lxlen = b.readUInt16LE(local + 28);
    const start = local + 30 + lnlen + lxlen;
    const raw = b.subarray(start, start + csize);
    if (/^(xl\/|\[Content_Types\])/.test(name)) out.set(name, method === 8 ? zlib.inflateRawSync(raw) : method === 0 ? Buffer.from(raw) : Buffer.alloc(0));
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
/** All the text runs inside an element (<t>…</t>, rich text included). */
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unesc(m[1])).join('');
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
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
  const files = unzip(Buffer.from(data));
  const wb = files.get('xl/workbook.xml')?.toString('utf8');
  const rels = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';
  if (!wb) throw new Error('This is not an Excel file (.xlsx).');
  // Excel's 1904 date system (older Mac workbooks): day numbers count from 1 Jan 1904
  const date1904 = /<workbookPr\s[^>]*date1904="(1|true)"/.test(wb);
  const firstId = /<sheet\s[^>]*r:id="([^"]+)"/.exec(wb)?.[1];
  const target = firstId ? new RegExp(`<Relationship[^>]*Id="${firstId}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ?? new RegExp(`<Relationship[^>]*Target="([^"]+)"[^>]*Id="${firstId}"`).exec(rels)?.[1] : null;
  const path = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`) : 'xl/worksheets/sheet1.xml';
  const sheet = (files.get(path) ?? files.get('xl/worksheets/sheet1.xml'))?.toString('utf8');
  if (!sheet) throw new Error('The workbook has no sheet.');
  const shared = [...(files.get('xl/sharedStrings.xml')?.toString('utf8') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  // which cell styles are dates
  const styles = files.get('xl/styles.xml')?.toString('utf8') ?? '';
  const custom = new Map([...styles.matchAll(/<numFmt\s[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)].map((m) => [Number(m[1]), unesc(m[2])]));
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
  const dateStyle = [...xfs.matchAll(/<xf\s[^>]*?\/?>/g)].map((m) => {
    const id = Number(attr(m[0], 'numFmtId') ?? 0);
    const code = custom.get(id);
    return BUILTIN_DATES.has(id) || (!!code && /[dy]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]/g, '')) && !/^[#0.,%\s]+$/.test(code));
  });
  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    const rowNo = Number(attr(rm[1] ?? rm[3] ?? '', 'r') ?? rows.length + 1);
    const cells: string[] = [];
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = cm[1];
      const body = cm[2] ?? '';
      const ref = attr(tag, 'r');
      const i = ref ? colIndex(ref) : cells.length;
      const t = attr(tag, 't');
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let s = '';
      if (t === 's') s = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') s = texts(body);
      else if (t === 'str' || t === 'e') s = v !== undefined ? unesc(v) : '';
      else if (t === 'b') s = v === '1' ? 'TRUE' : 'FALSE';
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
