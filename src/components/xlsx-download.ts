// Excel downloads made in the browser (0.17.2): Reports, the book-keeping reports. Every table gets the title block —
// the church and the report, the period and filters, when and by whom it was exported, and a note when it holds
// personal data. The church, the person and the wording come from the signed-in session (set once by the Layout);
// the page sets its period and filters; the section its title.
import { buildXlsx, titleLines, type XCell } from '../../shared/xlsx.ts';

interface Context { church: string; who: string; lang: string; exported: string; pii: string }
let context: Context = { church: '', who: '', lang: 'en', exported: 'Exported {at} by {who}', pii: 'Contains personal data: keep it where only the office can open it.' };
/** The church, the person (with their role) and the title block's wording, in the interface language. */
export const setExportContext = (c: Context) => {
  context = c;
};

interface Scope { report?: string; period?: string; filters?: string[] }
let scope: Scope = {};
/** The page's report name, period and filters (e.g. Reports: "Attendance", "1 Jan – 30 Sep 2026", "Mandarin"). */
export const setExportScope = (s: Scope) => {
  scope = s;
};

export interface TableMeta { title?: string; period?: string | null; filters?: string[]; pii?: boolean; money?: number[] }
let pending: TableMeta | null = null;
/** A section's download button: its title (and whether it holds personal data) for the file made inside `fn`. */
export function withTitle(meta: TableMeta, fn: () => void) {
  pending = meta;
  try {
    fn();
  } finally {
    pending = null;
  }
}

const stamp = (lang: string) => new Date().toLocaleString(lang === 'en' ? 'en-GB' : lang === 'zh' ? 'zh-CN' : lang === 'zh-Hant' ? 'zh-TW' : lang, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Download a table (first row = headings) as an .xlsx file with its title block. */
export function downloadTable(fileName: string, rows: XCell[][], meta: TableMeta = {}) {
  const m = { ...pending, ...meta };
  const [header, ...data] = rows;
  const title = [scope.report, m.title].filter(Boolean).join(' — ') || fileName;
  const bytes = buildXlsx([{
    name: m.title || scope.report || 'Canon',
    lines: titleLines({
      church: context.church, title, period: m.period ?? scope.period, filters: m.filters ?? scope.filters,
      exported: context.exported.replace('{at}', stamp(context.lang)).replace('{who}', context.who), pii: m.pii ? context.pii : null,
    }),
    header: (header ?? []).map((h) => String(h ?? '')), rows: data, money: m.money,
  }]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = fileName.replace(/\.csv$/i, '').replace(/\.xlsx$/i, '') + '.xlsx';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
