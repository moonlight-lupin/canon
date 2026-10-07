// Sending an Excel export (0.17.2): the table with its title block — the church and the report, the period and
// filters, when and by whom it was exported, and a note when it holds personal data — in the person's language.
import type { Request, Response } from 'express';
import { buildXlsx, titleLines, XLSX_MIME, type XCell, type XSheet } from '../../shared/xlsx.ts';
import { getSettings } from '../repo/settings.ts';
import { roleDef } from './permissions.ts';
import { st } from './server-text.ts';
import { dateLocale } from '../../shared/languages.ts';
import type { L10n, Lang } from '../../shared/types.ts';

export interface TableExport {
  /** the file name without its extension, e.g. "canon-change-log-2026-10-08" */
  file: string;
  /** what the table is (in English: translated with the server's wording) */
  title: string;
  header: string[];
  rows: XCell[][];
  period?: string | null;
  filters?: (string | null | undefined)[];
  /** holds members' or visitors' personal data */
  pii?: boolean;
  money?: number[];
  /** the tab's name (default: the title) */
  sheet?: string;
}

const pick = (v: L10n | undefined, lang: Lang) => (v ? v[lang] || v.en || Object.values(v).find(Boolean) || '' : '');

/** "8 Oct 2026, 14:05" in the person's language (this computer's time). */
export const exportTime = (lang: Lang, d = new Date()) => d.toLocaleString(dateLocale(lang), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** The title block for a person's export. */
export function exportLines(req: Request, lang: Lang, t: Pick<TableExport, 'title' | 'period' | 'filters' | 'pii'>): string[] {
  const u = req.user;
  const role = u ? pick(roleDef(u.role).name, lang) : '';
  const who = u ? `${u.display_name}${role ? ` (${role})` : ''}` : 'Canon';
  return titleLines({
    church: pick(getSettings().church_name, lang),
    title: st(t.title, lang),
    period: t.period,
    filters: t.filters,
    exported: st('Exported {at} by {who}', lang).replace('{at}', exportTime(lang)).replace('{who}', who),
    pii: t.pii ? st('Contains personal data: keep it where only the office can open it.', lang) : null,
  });
}

/** The workbook for one table with its title block. */
export function tableXlsx(req: Request, lang: Lang, t: TableExport): Uint8Array {
  const sheet: XSheet = { name: t.sheet ?? st(t.title, lang), lines: exportLines(req, lang, t), header: t.header, rows: t.rows, money: t.money };
  return buildXlsx([sheet]);
}

/** Send one table as an .xlsx download. */
export function sendXlsx(req: Request, res: Response, lang: Lang, t: TableExport) {
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${t.file.replace(/[^\w.-]+/g, '_')}.xlsx"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(Buffer.from(tableXlsx(req, lang, t)));
}

/** A stored UTC time ("2026-10-08 06:05:00" or ISO) as this computer's local "2026-10-08 14:05". */
export function localTime(s: string | null | undefined): string {
  if (!s) return '';
  const d = new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return s;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
