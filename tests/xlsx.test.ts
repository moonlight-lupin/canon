// The Excel reader (0.17.2) with workbooks made outside Canon (openpyxl): dates in both of Excel's date systems
// (v0.17.2 review, F7: a 1904-system workbook was read four years and a day early).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { readXlsx } from '../server/lib/xlsx-read.ts';

const fixture = (name: string) => new Uint8Array(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', name)));

test('dates read the same in the 1900 and the 1904 date system', () => {
  for (const f of ['dates-1900.xlsx', 'dates-1904.xlsx']) {
    const rows = readXlsx(fixture(f));
    assert.deepEqual(rows[0], ['Date', 'Description', 'Amount'], f);
    assert.equal(rows[1][0], '2030-10-07', f);
    assert.equal(rows[1][2], '12.5', f);
  }
});

// Files people upload (0.18.0 review): a small .xlsx that unpacks to gigabytes, or XML with thousands of tags never
// closed, must not stop Canon. The reader unpacks only the parts it needs, within limits, and scans in one pass.
function zip(parts: Record<string, { data: Buffer; deflate?: boolean }>): Uint8Array {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, p] of Object.entries(parts)) {
    const body = p.deflate ? zlib.deflateRawSync(p.data, { level: 9 }) : p.data;
    const n = Buffer.from(name);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(p.deflate ? 8 : 0, 8); l.writeUInt32LE(body.length, 18); l.writeUInt32LE(p.data.length, 22); l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(p.deflate ? 8 : 0, 10); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(p.data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(l, n, body);
    central.push(c, n);
    offset += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(central);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Object.keys(parts).length, 8); e.writeUInt16LE(Object.keys(parts).length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, e]));
}
const workbook = { data: Buffer.from('<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>') };
const rels = { data: Buffer.from('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>') };

test('a zip bomb is refused, not unpacked', () => {
  const bomb = zip({ 'xl/workbook.xml': workbook, 'xl/_rels/workbook.xml.rels': rels, 'xl/worksheets/sheet1.xml': { data: Buffer.alloc(80 * 1024 * 1024, 32), deflate: true } });
  assert.ok(bomb.length < 200_000, 'small on disk');
  assert.throws(() => readXlsx(bomb), /too large/);
  // parts the reader doesn't need are never unpacked
  const unused = zip({
    'xl/workbook.xml': workbook, 'xl/_rels/workbook.xml.rels': rels, 'xl/media/huge.bin': { data: Buffer.alloc(80 * 1024 * 1024, 0), deflate: true },
    'xl/worksheets/sheet1.xml': { data: Buffer.from('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>ok</t></is></c></row></sheetData></worksheet>') },
  });
  assert.deepEqual(readXlsx(unused), [['ok']]);
});

test('tags never closed take time in proportion to the file, not its square', () => {
  for (const junk of ['<row>', '<row r="1"><c>', '<row r="1"><c r="A1"><v>']) {
    const sheet = `<worksheet><sheetData>${junk.repeat(200_000)}</sheetData></worksheet>`;
    const f = zip({
      'xl/workbook.xml': workbook, 'xl/_rels/workbook.xml.rels': rels, 'xl/worksheets/sheet1.xml': { data: Buffer.from(sheet) },
      'xl/sharedStrings.xml': { data: Buffer.from('<sst>' + '<si><t>'.repeat(100_000) + '</sst>') },
    });
    const t0 = performance.now();
    try { readXlsx(f); } catch { /* "damaged" is a fine answer */ }
    assert.ok(performance.now() - t0 < 2000, `${junk}: ${Math.round(performance.now() - t0)} ms`);
  }
});
