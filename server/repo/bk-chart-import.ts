// Importing the chart of accounts and the funds (0.18.0) from an Excel or CSV file — the same columns as their export
// (Settings → Export data), so a church can set up its chart in Excel, or bring another Canon's. Rows are matched by
// code: a new code adds an account (or fund), a known one is updated. Previewed first; nothing is deleted, and an
// account already used in journals keeps its type (retire it and add a new one instead).
import { all } from '../db.ts';
import { decodeCsv, headerKey, parseCsv } from '../lib/csv.ts';
import { isXlsx, readXlsx, tableRows } from '../lib/xlsx-read.ts';
import { getSettings } from './settings.ts';
import { listAccounts, listFunds, saveAccount, saveFund } from './bookkeeping.ts';
import { ACCOUNT_KINDS, ACCOUNT_TYPES, FUND_RESTRICTIONS, type AccountKind, type AccountType, type FundRestriction } from '../../shared/bookkeeping.ts';
import type { L10n } from '../../shared/types.ts';

export type ChartPart = 'accounts' | 'funds';
export interface ChartRow { row: number; code: string; action: 'create' | 'update' | 'unchanged' | 'error'; errors: string[]; changes: string[] }

const ALIASES: Record<string, string[]> = {
  code: ['code', 'accountcode', 'fundcode'],
  name: ['name', 'nameen', 'english', 'account', 'fund'],
  other: ['nameotherlanguage', 'othername', 'namezh', 'chinese', 'name2'],
  type: ['type', 'accounttype'],
  kind: ['whatitisfor', 'kind', 'use'],
  restriction: ['restriction'],
  active: ['inuse', 'active'],
  description: ['description', 'purpose', 'notes'],
};
const TYPE_WORDS: Record<string, AccountType> = { asset: 'asset', assets: 'asset', liability: 'liability', liabilities: 'liability', equity: 'equity', funds: 'equity', fund: 'equity', income: 'income', expense: 'expense', expenses: 'expense', expenditure: 'expense' };
const yes = (s: string) => !/^(no|n|false|0|retired|inactive)$/i.test(s.trim());

function readRows(data: Uint8Array): string[][] {
  const rows = isXlsx(data) ? tableRows(readXlsx(data)) : parseCsv(decodeCsv(data).text);
  return rows.filter((r) => r.some((c) => c?.trim()));
}

/** Check (dryRun) or apply the file: each row with what it does. */
export function importChart(part: ChartPart, data: Uint8Array, dryRun: boolean): { fatal: string | null; rows: ChartRow[]; counts: Record<ChartRow['action'], number> } {
  const counts = { create: 0, update: 0, unchanged: 0, error: 0 };
  let rows: string[][];
  try {
    rows = readRows(data);
  } catch (e) {
    return { fatal: (e as Error).message, rows: [], counts };
  }
  if (rows.length < 2) return { fatal: 'The file has no rows below the headings.', rows: [], counts };
  // headings compared without spaces or punctuation: "Name (other language)" = "nameotherlanguage"
  const head = rows[0].map((h) => headerKey(h ?? '').replace(/[^\p{L}\p{N}]/gu, ''));
  const at: Record<string, number> = {};
  head.forEach((h, i) => {
    const k = Object.keys(ALIASES).find((key) => ALIASES[key].includes(h));
    if (k && at[k] === undefined) at[k] = i;
  });
  const needed = part === 'accounts' ? ['code', 'name', 'type'] : ['code', 'name'];
  const missing = needed.filter((k) => at[k] === undefined);
  if (missing.length) return { fatal: `These columns are missing: ${missing.join(', ')}. Start from the export (Settings → Export data).`, rows: [], counts };
  const other = getSettings().languages.find((l) => l !== 'en') ?? 'zh';
  const cell = (r: string[], k: string) => (at[k] === undefined ? undefined : (r[at[k]] ?? '').trim());
  const existing = new Map((part === 'accounts' ? listAccounts() : listFunds()).map((x) => [x.code.toLowerCase(), x as unknown as Record<string, unknown>]));
  const out: ChartRow[] = [];
  const seenCodes = new Set<string>();
  rows.slice(1).forEach((r, i) => {
    const row: ChartRow = { row: i + 2, code: cell(r, 'code') ?? '', action: 'unchanged', errors: [], changes: [] };
    const cur = existing.get(row.code.toLowerCase());
    const name: L10n = { ...(cur?.name as L10n | undefined ?? {}) };
    if (cell(r, 'name')) name.en = cell(r, 'name')!;
    if (cell(r, 'other')) name[other] = cell(r, 'other')!;
    if (!row.code) row.errors.push('No code.');
    else if (seenCodes.has(row.code.toLowerCase())) row.errors.push('The same code is on an earlier row.');
    seenCodes.add(row.code.toLowerCase());
    if (!Object.values(name).some((v) => v?.trim())) row.errors.push('No name.');
    const active = cell(r, 'active') === undefined || cell(r, 'active') === '' ? (cur?.active as boolean | undefined ?? true) : yes(cell(r, 'active')!);
    const description = cell(r, 'description') === undefined ? (cur?.description as string | null | undefined ?? null) : cell(r, 'description') || null;
    let input: Record<string, unknown>;
    if (part === 'accounts') {
      const t = TYPE_WORDS[(cell(r, 'type') ?? '').toLowerCase()] ?? (ACCOUNT_TYPES.includes(cell(r, 'type') as AccountType) ? cell(r, 'type') as AccountType : undefined);
      if (!t) row.errors.push(`“${cell(r, 'type')}” is not a type (asset, liability, equity, income, expense).`);
      const kraw = (cell(r, 'kind') ?? '').toLowerCase().replace(/[\s-]+/g, '_');
      const kind = (ACCOUNT_KINDS.includes(kraw as AccountKind) ? kraw : !kraw || kraw === '—' ? (cur?.kind ?? 'other') : null) as AccountKind | null;
      if (!kind) row.errors.push(`“${cell(r, 'kind')}” is not a kind (${ACCOUNT_KINDS.join(', ')}).`);
      if (cur && t && cur.type !== t && cur.used) row.errors.push(`Account ${row.code} has entries: its type can’t change (retire it and add a new one).`);
      input = { code: row.code, name, type: t, kind: kind ?? 'other', active, description };
    } else {
      const rraw = (cell(r, 'restriction') ?? '').toLowerCase();
      const restriction = (FUND_RESTRICTIONS.includes(rraw as FundRestriction) ? rraw : !rraw ? (cur?.restriction ?? 'unrestricted') : null) as FundRestriction | null;
      if (!restriction) row.errors.push(`“${cell(r, 'restriction')}” is not a restriction (${FUND_RESTRICTIONS.join(', ')}).`);
      input = { code: row.code, name, restriction: restriction ?? 'unrestricted', active, description };
    }
    if (row.errors.length) {
      row.action = 'error';
    } else if (!cur) {
      row.action = 'create';
    } else {
      for (const k of Object.keys(input)) {
        if (k === 'code') continue;
        if (JSON.stringify(input[k] ?? null) !== JSON.stringify(cur[k] ?? null)) row.changes.push(k);
      }
      row.action = row.changes.length ? 'update' : 'unchanged';
    }
    if (!dryRun && (row.action === 'create' || row.action === 'update')) {
      try {
        if (part === 'accounts') saveAccount(cur ? (cur.id as number) : null, input as Parameters<typeof saveAccount>[1]);
        else saveFund(cur ? (cur.id as number) : null, input as Parameters<typeof saveFund>[1]);
      } catch (e) {
        row.action = 'error';
        row.errors.push((e as Error).message);
      }
    }
    counts[row.action]++;
    out.push(row);
  });
  return { fatal: null, rows: out, counts };
}

/** For the preview: how many accounts / funds there are now. */
export const chartSize = () => ({ accounts: all('SELECT 1 FROM bk_accounts').length, funds: all('SELECT 1 FROM bk_funds').length });
