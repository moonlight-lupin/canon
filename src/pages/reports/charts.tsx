// Reports: the building blocks every report uses — figures, sections, charts and the data hook.
import type { ReactNode } from 'react';
import { useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Icon } from '../../components/icons.tsx';
import { InfoTip } from '../../components/InfoTip.tsx';
import { useCongregations } from '../../components/Congregations.tsx';
import { movingAverage, type ReportKind } from '../../../shared/reports.ts';
import { downloadTable, withTitle, type TableMeta } from '../../components/xlsx-download.ts';
import type { L10n } from '../../types-client.ts';
import '../records.css';
import '../reports.css';

/** L10n → "English 中文" for CSV files. */
/** A name in English and its first other language (any language, e.g. "Ushers 招待"), for report labels. */
export const both = (v: L10n | null | undefined) => {
  if (!v) return '';
  const other = Object.entries(v).find(([l, x]) => l !== 'en' && x?.trim())?.[1];
  return [...new Set([v.en, other].filter((x): x is string => !!x?.trim()))].join(' ') || Object.values(v).find(Boolean) || '';
};

/** A report table as an Excel file with its title block (the section's title, the page's period and filters). */
export function download(name: string, rows: (string | number | null | undefined)[][], meta?: TableMeta) {
  downloadTable(name, rows, meta);
}

export interface Ctx { q: string; from: string; to: string; cong: number | null; congs: ReturnType<typeof useCongregations> }

// ================================================================= building blocks

export function Stat({ label, value, sub, tip }: { label: string; value: ReactNode; sub?: ReactNode; tip?: string }) {
  return (
    <div className="card rep-stat">
      <div className="small muted">{label}{tip && <InfoTip text={tip} />}</div>
      <div className="rep-big">{value ?? '—'}</div>
      {sub && <div className="small muted">{sub}</div>}
    </div>
  );
}

/** A report section; with an Excel download it says whether the file holds anyone's personal data (names included). */
export function Section({ title, tip, csv, pii, children }: { title: string; tip?: string; children: ReactNode } & ({ csv?: undefined; pii?: undefined } | { csv: () => void; pii: boolean })) {
  const { t } = useI18n();
  return (
    <section className="card stack rep-sect">
      <div className="row between">
        <h2 className="h3">{title}{tip && <InfoTip text={tip} />}</h2>
        {csv && <button className="btn sm ghost no-print" onClick={() => withTitle({ title, pii }, csv)}><Icon name="download" />{t('Excel')}</button>}
      </div>
      {children}
    </section>
  );
}

/** Horizontal bars: label, bar, value. */
export function Bars({ items, fmt = String }: { items: { key: string; label: ReactNode; value: number; note?: ReactNode }[]; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <table className="rep-bars">
      <tbody>
        {items.map((i) => (
          <tr key={i.key}>
            <th>{i.label}</th>
            <td className="rep-bar-cell"><div className="rep-bar" style={{ width: `${(i.value / max) * 100}%` }} /></td>
            <td className="right nowrap">{fmt(i.value)}{i.note && <span className="small muted"> {i.note}</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Line chart of values per point, with a dashed moving average. */
export function LineChart({ points, label }: { points: { x: string; y: number | null }[]; label: string }) {
  const { t } = useI18n();
  const W = 720;
  const H = 220;
  const pad = { l: 40, r: 12, t: 12, b: 26 };
  const ys = points.map((p) => p.y).filter((v): v is number => v != null);
  if (ys.length < 2) return <div className="small muted">{t('Not enough recorded services for a chart yet.')}</div>;
  const max = Math.ceil(Math.max(...ys) * 1.1);
  const min = Math.max(0, Math.floor(Math.min(...ys) * 0.8));
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, points.length - 1);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - (v - min) / Math.max(1, max - min));
  const path = (vals: (number | null)[]) => {
    let d = '';
    vals.forEach((v, i) => {
      if (v == null) return;
      d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    });
    return d;
  };
  const avg = movingAverage(points.map((p) => p.y), 4);
  const ticks = [min, Math.round((min + max) / 2), max];
  const every = Math.max(1, Math.ceil(points.length / 8));
  return (
    <svg className="rep-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="grid" />
          <text x={pad.l - 6} y={y(v) + 4} textAnchor="end">{v}</text>
        </g>
      ))}
      {points.map((p, i) => (i % every === 0 ? <text key={i} x={x(i)} y={H - 6} textAnchor="middle">{p.x.slice(5)}</text> : null))}
      <path d={path(points.map((p) => p.y))} className="line" />
      <path d={path(avg)} className="avg" />
      {points.map((p, i) => (p.y != null ? <circle key={i} cx={x(i)} cy={y(p.y)} r={2.6} className="dot"><title>{`${p.x}: ${p.y}`}</title></circle> : null))}
    </svg>
  );
}

/** Columns per month. */
export function Columns({ items, fmt = String }: { items: { label: string; value: number }[]; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="rep-cols" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((i) => (
        <div key={i.label} className="rep-col" title={`${i.label}: ${fmt(i.value)}`}>
          <span className="v">{i.value ? fmt(i.value) : ''}</span>
          <div className="b" style={{ height: `${(i.value / max) * 100}%` }} />
          <span className="l">{i.label.slice(2)}</span>
        </div>
      ))}
    </div>
  );
}

export function useReport<T>(kind: ReportKind, q: string) {
  return useApi<T>(`/reports/${kind}${q}`);
}

export const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '');

// ================================================================= attendance
