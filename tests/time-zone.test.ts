// "Today" in the church's time zone (Settings → Church), from the Daedalus Workshop's code study of 0.19.10: it was
// the UTC date, a day behind in Singapore and Malaysia (UTC+8) between midnight and 8 am. Fictional data.
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-tz-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const { updateSettings } = await import('../server/repo/settings.ts');
const { churchToday } = await import('../server/lib/dates.ts');
const { dayIn, validZone } = await import('../shared/dates.ts');
const { db } = await import('../server/db.ts');

// 1:30 in the morning of 10 October in Singapore: still 9 October in UTC
const NIGHT = Date.parse('2026-10-09T17:30:00Z');

before(() => {
  mock.timers.enable({ apis: ['Date'], now: NIGHT });
});
after(() => {
  mock.timers.reset();
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('20. today is the church’s date: 10 October in Singapore at 1:30 am, though UTC still says the 9th', () => {
  assert.equal(dayIn('Asia/Singapore'), '2026-10-10');
  assert.equal(dayIn('UTC'), '2026-10-09');
  updateSettings({ time_zone: 'Asia/Singapore' } as never);
  assert.equal(churchToday(), '2026-10-10');
  updateSettings({ time_zone: 'Europe/London' } as never);
  assert.equal(churchToday(), '2026-10-09');
  assert.equal(validZone('Asia/Kuala_Lumpur'), true);
  assert.equal(validZone('Mars/Olympus_Mons'), false);
});

test('20. every “today” on the server is the church’s: reports, claims, AI tools, groups, the calendar', async () => {
  updateSettings({ time_zone: 'Asia/Kuala_Lumpur' } as never);
  const reports = await import('../server/repo/reports.ts');
  assert.equal(reports.period({}).to, '2026-10-10', 'a report’s period ends today');
  const { today } = await import('../server/mcp-tools/common.ts');
  assert.equal(today(), '2026-10-10');
  const { claimYear } = await import('../server/repo/bk-claims.ts');
  mock.timers.setTime(Date.parse('2026-12-31T17:00:00Z')); // 1 am on New Year's Day in Kuala Lumpur
  assert.equal(claimYear(), '2027', 'a claim submitted after midnight on 1 January is numbered in the new year');
  mock.timers.setTime(NIGHT);
});

test('20. no part of the server works out today from the UTC date any more', () => {
  const root = path.resolve(import.meta.dirname, '..', 'server');
  const files = fs.readdirSync(root, { recursive: true }).map(String).filter((f) => f.endsWith('.ts'));
  const offenders: string[] = [];
  for (const f of files) {
    const lines = fs.readFileSync(path.join(root, f), 'utf8').split('\n');
    lines.forEach((l, i) => {
      if (/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)|toLocaleDateString\('en-CA'\)\s*;?\s*$/.test(l) && !/date-ok/.test(l)) offenders.push(`server/${f}:${i + 1}: ${l.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], 'use churchToday() (server/lib/dates.ts)');
});
