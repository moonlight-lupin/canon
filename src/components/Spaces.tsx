// The church's spaces (0.15.4): the picker used by services, meetings and calendar events, and the warning when the
// same space is booked at the same time (Settings → Spaces; Reports → Spaces).
import { Link } from 'react-router-dom';
import { useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Bi, Field, fmtDate } from './ui.tsx';
import type { L10n } from '../types-client.ts';

export interface Space { id: number; name: L10n; capacity: number | null; notes: string | null; archived: boolean; sort: number }
export interface Booking { type: 'service' | 'meeting' | 'event'; id: number; space_id: number; date: string; end_date: string; start_time: string | null; end_time: string | null; title: L10n }

export const useSpaces = () => useApi<{ spaces: Space[]; use: Record<number, number> }>('/spaces');

/** Where a booking opens in Canon. */
export const bookingLink = (b: Pick<Booking, 'type' | 'id'>) => (b.type === 'meeting' ? `/meetings/${b.id}` : b.type === 'event' ? '/calendar' : `/services/${b.id}`);

/** Pick one of the church's spaces (archived ones only when already chosen). Hidden when the church has none. */
export function SpaceField({ value, onChange }: { value: number | null | undefined; onChange: (id: number | null) => void }) {
  const { t, lt } = useI18n();
  const list = useSpaces().data?.spaces ?? [];
  const options = list.filter((s) => !s.archived || s.id === value);
  if (!options.length) return null;
  return (
    <Field label={t('Space')}>
      <select value={value ?? ''} onChange={(e) => onChange(Number(e.target.value) || null)}>
        <option value="">{t('— none —')}</option>
        {options.map((s) => <option key={s.id} value={s.id}>{lt(s.name)}{s.capacity ? ` (${s.capacity})` : ''}</option>)}
      </select>
    </Field>
  );
}

/** "Also booked at this time": what else is in the same space while this one is (saved values). */
export function SpaceClashes({ type, id, version }: { type: Booking['type']; id: number; version?: unknown }) {
  const { t, lang } = useI18n();
  const { data } = useApi<Booking[]>(`/spaces/clashes?type=${type}&id=${id}&v=${encodeURIComponent(String(version ?? ''))}`);
  if (!data?.length) return null;
  return (
    <div className="callout warn small" role="status">
      <strong>{t('This space is also booked at this time:')}</strong>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
        {data.map((b) => (
          <li key={`${b.type}-${b.id}`}>
            <Link to={bookingLink(b)}><Bi v={b.title} /></Link> · {fmtDate(b.date, lang)}{b.start_time ? ` ${b.start_time}–${b.end_time}` : ` · ${t('all day')}`}
          </li>
        ))}
      </ul>
    </div>
  );
}
