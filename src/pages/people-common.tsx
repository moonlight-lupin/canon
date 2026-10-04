// Small helpers shared by the people screens (Members, Co-workers, Volunteers).
import { useMemo, useState } from 'react';
import type { MemberStatus, Person } from '../types-client.ts';
import { useI18n } from '../i18n.tsx';
import { SearchBox } from '../components/ui.tsx';
import './people.css';

export const STATUSES: MemberStatus[] = ['member', 'regular', 'visitor', 'inactive', 'transferred', 'deceased'];
export const STATUS_LABEL: Record<MemberStatus, string> = {
  member: 'Member', regular: 'Regular', visitor: 'Visitor', inactive: 'Inactive', transferred: 'Transferred', deceased: 'Deceased',
};
const STATUS_BADGE: Record<MemberStatus, string> = {
  member: 'ok', regular: 'lapis', visitor: 'reed', inactive: '', transferred: '', deceased: '',
};
/** People who can still be scheduled to serve. */
export const isActive = (p: Pick<Person, 'status'>) => p.status === 'member' || p.status === 'regular' || p.status === 'visitor';

export function StatusBadge({ status }: { status: MemberStatus }) {
  const { t } = useI18n();
  return <span className={`badge ${STATUS_BADGE[status]}`}>{t(STATUS_LABEL[status])}</span>;
}

/** "David Tan" — preferred (or first) name + surname. */
export const latinName = (p: Pick<Person, 'first_name' | 'last_name' | 'preferred_name'>) =>
  `${p.preferred_name || p.first_name} ${p.last_name ?? ''}`.trim();

/** "David Tan 陈伟明" — as the server's person_name. */
export const fullName = (p: Pick<Person, 'first_name' | 'last_name' | 'preferred_name' | 'native_name'>) =>
  p.native_name ? `${latinName(p)} ${p.native_name}` : latinName(p);

/** Name with the Chinese name set beside it in a muted tone. */
export function PersonName({ p }: { p: Pick<Person, 'first_name' | 'last_name' | 'preferred_name' | 'native_name'> }) {
  return (
    <span className="pname">
      <span>{latinName(p)}</span>
      {p.native_name && <span className="cn">{p.native_name}</span>}
    </span>
  );
}

/** Empty strings become null so optional columns are cleared rather than stored blank. */
export function nullify<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k] = typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? v.trim() : v;
  return out as T;
}

/** Searchable checkbox list for picking several people. */
export function PeopleMultiSelect({
  people, value, onChange, disabled, height = 260,
}: { people: Person[]; value: number[]; onChange: (ids: number[]) => void; disabled?: boolean; height?: number }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const sel = useMemo(() => new Set(value), [value]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? people.filter((p) => `${fullName(p)} ${p.first_name} ${p.email ?? ''}`.toLowerCase().includes(s)) : people;
    // selected first, then by name
    return [...list].sort((a, b) => Number(sel.has(b.id)) - Number(sel.has(a.id)) || latinName(a).localeCompare(latinName(b)));
  }, [people, q, sel]);
  const toggle = (id: number) => onChange(sel.has(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="pick">
      <div className="row between">
        <div className="grow"><SearchBox value={q} onChange={setQ} /></div>
        <span className="muted small nowrap">{value.length} {t('selected')}</span>
      </div>
      <div className="pick-list" style={{ maxHeight: height }}>
        {shown.map((p) => (
          <label key={p.id} className={`check pick-row${sel.has(p.id) ? ' on' : ''}`}>
            <input type="checkbox" checked={sel.has(p.id)} disabled={disabled} onChange={() => toggle(p.id)} />
            <PersonName p={p} />
            {!isActive(p) && <StatusBadge status={p.status} />}
          </label>
        ))}
        {!shown.length && <div className="muted small" style={{ padding: 8 }}>{t('No matches.')}</div>}
      </div>
    </div>
  );
}

export const ageOn = (birth: string, on: string) => {
  const [by, bm, bd] = birth.split('-').map(Number);
  const [y, m, d] = on.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
};
