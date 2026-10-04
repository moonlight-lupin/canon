// CSV reading and writing for spreadsheet users (Excel, Numbers, Google Sheets, WPS).
//
// - parseCsv: RFC 4180 quoting, embedded newlines, CRLF / LF / CR, BOM; comma, semicolon or tab delimiter
//   (auto-detected: European Excel saves with semicolons; "Unicode text" saves with tabs).
// - writeCsv: UTF-8 WITH BOM and CRLF so Excel opens Chinese correctly; cells that Excel would run as a
//   formula (= + - @) are prefixed with an apostrophe, which readCell() removes again on import.
// - decodeCsv: UTF-8 (strict), UTF-16 (BOM), else GB18030 or Big5 for files Excel saved in a Chinese code page.
// - headerKey / matchHeaders: case-, space- and punctuation-insensitive header matching with aliases.

export type Delimiter = ',' | ';' | '\t';

/** Guess the delimiter from the first record (outside quotes). A leading `sep=;` line (Excel hint) wins. */
export function detectDelimiter(text: string): Delimiter {
  const s = text.replace(/^﻿/, '');
  const sep = s.match(/^sep=(.)\r?\n/i);
  if (sep && [',', ';', '\t'].includes(sep[1])) return sep[1] as Delimiter;
  const counts: Record<Delimiter, number> = { ',': 0, ';': 0, '\t': 0 };
  let q = false;
  for (let i = 0; i < s.length && i < 20000; i++) {
    const c = s[i];
    if (c === '"') q = !q;
    else if (!q && (c === '\n' || c === '\r')) break;
    else if (!q && (c === ',' || c === ';' || c === '\t')) counts[c]++;
  }
  if (counts['\t'] > counts[','] && counts['\t'] >= counts[';']) return '\t';
  if (counts[';'] > counts[',']) return ';';
  return ',';
}

export interface CsvRecord {
  /** spreadsheet row number (the header is row 1) */
  row: number;
  cells: string[];
}

/** Parse CSV into records, keeping spreadsheet row numbers. Blank records are dropped. */
export function parseRecords(text: string, delimiter?: Delimiter): CsvRecord[] {
  let s = text.replace(/^﻿/, '');
  const d = delimiter ?? detectDelimiter(s);
  const sep = s.match(/^sep=.\r?\n/i);
  let row = 1;
  if (sep) s = s.slice(sep[0].length);
  const out: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let q = false;
  const end = () => {
    cells.push(cell);
    cell = '';
    if (cells.some((x) => x.trim() !== '')) out.push({ row, cells });
    cells = [];
    row++;
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"' && cell.trim() === '') {
      cell = '';
      q = true;
    } else if (c === d) {
      cells.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      end();
    } else cell += c;
  }
  if (cell !== '' || cells.length) end();
  // embedded newlines inside quotes normalise to \n
  for (const r of out) r.cells = r.cells.map((x) => x.replace(/\r\n?/g, '\n'));
  return out;
}

/** Parse CSV into rows of cells (blank rows dropped). */
export function parseCsv(text: string, delimiter?: Delimiter): string[][] {
  return parseRecords(text, delimiter).map((r) => r.cells);
}

/** Excel runs cells starting with these as formulas (CSV injection); guard them with an apostrophe. */
const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(v: unknown, delimiter: Delimiter = ','): string {
  let s = v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v);
  if (FORMULA.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return s.includes(delimiter) || /["\n\r]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV text with a UTF-8 BOM and CRLF line ends, ready for Excel. */
export function writeCsv(rows: unknown[][], delimiter: Delimiter = ','): string {
  return '﻿' + rows.map((r) => r.map((c) => csvCell(c, delimiter)).join(delimiter)).join('\r\n') + '\r\n';
}

/** Trim a cell and undo the formula guard added by writeCsv ('+60 12… → +60 12…). */
export function readCell(s: string | undefined): string {
  const t = (s ?? '').replace(/ /g, ' ').trim();
  return /^'[=+\-@]/.test(t) ? t.slice(1) : t;
}

// ---------------------------------------------------------------- decoding

export type Encoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'gb18030' | 'big5';

export interface Decoded {
  text: string;
  encoding: Encoding;
}

// Frequent characters in everyday Chinese (both scripts) and church vocabulary. A wrong legacy decoding
// still produces CJK characters, but rarely these ones, so they decide between GB18030 and Big5.
const COMMON = new Set(
  ('的一是不了人我在有他这中大来上国个到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可她里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样现分将外但身些与高意进把法此实回二理美点月明其种声全工己话儿者向情部正名定女问力机给等几很业最间新什打便位因重被走电四第门相次东海口使教西再平真听世气信北少关并内加化由代产入先山五太水万市眼体别处总才场师书比住员九笑性通目华报立马命张活难神数件安表原车白应路期叫死常提感金何更反合放做系计或司利受光王果亲界及今京务制解各任至清物台象记边共风战接它许八特觉望直服林题建南度统色字请交爱让认算论百吃义科怎元社术结六功指思非流每青管夫连远资队跟带花快条院变联言权往展该领传近留红治决周保达办运武半候七必城父强步完深区即求品士转量空众技轻程告江语英基派满式李息写呢识极令黄德收钱未持取设始版双历越史商千片容研像找友孩站广改议形委早房音火际则首单据导影失拿网香似专石若兵弟谁校读志飞观争究包组造落视济喜离虽坏兴切拉复乎米须夜团福母器朋' +
    '這個來說們為國對過還後樣現兩開關長門問間聽體實點將無從見種應進麼動學經發當頭機樂愛給讓認義題書員東號親邊產電變華報話車條歲區導傳順選漢語歡讀響識團復與萬時會個從長頭還說種應實體華裡後經學國說當來為們這過對開關門問間聽' +
    '耶稣穌基督圣聖灵靈恩罪救赞讚颂頌诗詩歌拜崇敬祷禱礼禮牧师師长長执執事弟兄姐妹团契小组組诗班敬拜主日崇拜程序服事同工会友會友教堂陈陳林黄黃吴吳郑鄭刘劉张張杨楊许許何梁谢謝李王')
    .split(''),
);

function score(text: string) {
  let cjk = 0;
  let common = 0;
  let bad = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x4e00 && c <= 0x9fff) {
      cjk++;
      if (COMMON.has(ch)) common++;
    } else if (c === 0xfffd || (c >= 0xe000 && c <= 0xf8ff)) bad++; // replacement / private use (unmapped)
  }
  return { cjk, common, value: common * 4 + cjk - bad * 10 };
}

/**
 * Decode an uploaded file. Strict UTF-8 first; a UTF-16 BOM means Excel "Unicode text"; otherwise the file
 * was saved in a Chinese code page, so try GB18030 (GBK) and Big5 and keep the decoding that reads most like Chinese.
 */
export function decodeCsv(buf: Uint8Array): Decoded {
  if (buf[0] === 0xff && buf[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(buf.subarray(2)), encoding: 'utf-16le' };
  if (buf[0] === 0xfe && buf[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(buf.subarray(2)), encoding: 'utf-16be' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''), encoding: 'utf-8' };
  } catch {
    /* not UTF-8 */
  }
  const candidates: (Decoded & { s: number })[] = [];
  for (const label of ['gb18030', 'big5'] as const) {
    try {
      const text = new TextDecoder(label, { fatal: true }).decode(buf);
      candidates.push({ text, encoding: label, s: score(text).value });
    } catch {
      /* not this encoding */
    }
  }
  candidates.sort((a, b) => b.s - a.s);
  if (candidates[0]) return { text: candidates[0].text, encoding: candidates[0].encoding };
  // last resort: keep what we can read
  return { text: new TextDecoder('utf-8').decode(buf), encoding: 'utf-8' };
}

// ---------------------------------------------------------------- headers

/** Normalised header for matching: "First Name", "first_name", "FIRST-NAME " → "first_name". */
export const headerKey = (h: string) =>
  h.normalize('NFKC').replace(/^﻿/, '').trim().toLowerCase().replace(/[\s_\-.:/]+/g, '_').replace(/^_|_$/g, '');

/** Language code from a header suffix: "zh_hant" → "zh-Hant", "zh_cn" → "zh", "en" → "en". */
export function langFromSuffix(s: string): string | null {
  const k = s.toLowerCase().replace(/-/g, '_');
  if (/^zh_(hant|tw|hk|mo)$/.test(k) || k === 'tc') return 'zh-Hant';
  if (/^zh(_(hans|cn|sg|my))?$/.test(k) || k === 'sc') return 'zh';
  if (/^[a-z]{2,3}$/.test(k)) return k;
  const m = k.match(/^([a-z]{2,3})_([a-z]{2,4})$/);
  return m ? `${m[1]}-${m[2][0].toUpperCase()}${m[2].slice(1)}` : null;
}

/**
 * Map file headers to column keys. `cols` lists each column's key and extra aliases.
 * Returns the column key per header position (null = not recognised).
 */
export function matchHeaders(headers: string[], cols: { key: string; aliases?: string[] }[]): (string | null)[] {
  const lookup = new Map<string, string>();
  for (const c of cols) lookup.set(headerKey(c.key), c.key);
  for (const c of cols) for (const a of c.aliases ?? []) if (!lookup.has(headerKey(a))) lookup.set(headerKey(a), c.key);
  const used = new Set<string>();
  return headers.map((h) => {
    const k = lookup.get(headerKey(h));
    if (!k || used.has(k)) return null;
    used.add(k);
    return k;
  });
}
