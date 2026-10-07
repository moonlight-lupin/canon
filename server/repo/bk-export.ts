// Book-keeping exports (0.17.0): the posted journals line by line (for the church's accountant or other accounting
// software — most import a "manual journal" CSV with these columns), the chart of accounts and the funds. Used by
// Book-keeping → Journals → Export and by Settings → Export data.
import { all, get } from '../db.ts';
import { bkSettings } from './bookkeeping.ts';
import { claimCounts } from './bk-claims.ts';

type Cell = string | number | null | undefined;
const money = (n: number | null) => (n ? (Number(n) / 100).toFixed(2) : '');
const name = (v: unknown) => {
  try {
    const o = JSON.parse(String(v)) as Record<string, string>;
    return o.en ?? Object.values(o)[0] ?? '';
  } catch {
    return String(v ?? '');
  }
};
const other = (v: unknown) => {
  try {
    const o = JSON.parse(String(v)) as Record<string, string>;
    return Object.entries(o).find(([l, x]) => l !== 'en' && x?.trim())?.[1] ?? '';
  } catch {
    return '';
  }
};

/** Every posted line between two dates (default: since the books started), one row each. */
export function journalsCsv(from?: string, to?: string): Cell[][] {
  const start = from ?? bkSettings().start_date ?? '0000-01-01';
  const end = to ?? '9999-12-31';
  const rows = all<Record<string, string | number | null>>(
    `SELECT j.number, j.date, j.memo AS journal_memo, j.kind, a.code AS account_code, a.name AS account_name, f.code AS fund, pr.code AS project, mi.code AS ministry,
       c.code AS congregation, l.debit, l.credit, l.memo, l.orig_currency, l.orig_amount
     FROM bk_lines l JOIN bk_journals j ON j.id = l.journal_id JOIN bk_accounts a ON a.id = l.account_id JOIN bk_funds f ON f.id = l.fund_id
     LEFT JOIN bk_projects pr ON pr.id = l.project_id LEFT JOIN bk_ministries mi ON mi.id = l.ministry_id LEFT JOIN congregations c ON c.id = l.congregation_id
     WHERE j.status = 'posted' AND j.date >= ? AND j.date <= ? ORDER BY j.date, j.number, l.position`, start, end,
  );
  return [
    ['Journal', 'Date', 'Narration', 'Kind', 'Account code', 'Account', 'Fund', 'Project', 'Ministry', 'Congregation', 'Debit', 'Credit', 'Line note', 'Original currency', 'Original amount'],
    ...rows.map((r) => [r.number, r.date, r.journal_memo, r.kind, r.account_code, name(r.account_name), r.fund, r.project, r.ministry, r.congregation, money(r.debit as number), money(r.credit as number), r.memo, r.orig_currency, r.orig_amount != null ? (Number(r.orig_amount) / 100).toFixed(2) : '']),
  ];
}

export function accountsCsv(): Cell[][] {
  const rows = all<{ code: string; name: string; type: string; kind: string; active: number; description: string | null }>('SELECT code, name, type, kind, active, description FROM bk_accounts ORDER BY code');
  return [['Code', 'Name', 'Name (other language)', 'Type', 'What it is for', 'In use', 'Description'], ...rows.map((r) => [r.code, name(r.name), other(r.name), r.type, r.kind, r.active ? 'yes' : 'no', r.description])];
}

export function fundsCsv(): Cell[][] {
  const rows = all<{ code: string; name: string; restriction: string; active: number; description: string | null }>('SELECT code, name, restriction, active, description FROM bk_funds ORDER BY sort, code');
  return [['Code', 'Name', 'Name (other language)', 'Restriction', 'In use', 'Purpose'], ...rows.map((r) => [r.code, name(r.name), other(r.name), r.restriction, r.active ? 'yes' : 'no', r.description])];
}

/** For the dashboard: drafts waiting, and bank statement lines still to match. */
export function bookkeepingCounts() {
  const n = (sql: string) => get<{ n: number }>(sql)!.n;
  return {
    started: !!bkSettings().start_date,
    drafts: n("SELECT COUNT(*) n FROM bk_journals WHERE status = 'draft'"),
    offering_drafts: n("SELECT COUNT(*) n FROM bk_journals WHERE status = 'draft' AND kind = 'offering'"),
    to_match: n("SELECT COUNT(*) n FROM bk_statement_lines sl JOIN bk_statements s ON s.id = sl.statement_id WHERE sl.status = 'open' AND s.done_at IS NULL"),
    claims: claimCounts(),
  };
}
