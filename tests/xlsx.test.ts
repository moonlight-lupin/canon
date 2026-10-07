// The Excel reader (0.17.2) with workbooks made outside Canon (openpyxl): dates in both of Excel's date systems
// (v0.17.2 review, F7: a 1904-system workbook was read four years and a day early).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
