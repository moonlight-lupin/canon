// Members → Birthdays.
import { useMemo } from 'react';
import { useI18n } from '../../i18n.tsx';
import { Empty, Loading, addDays, fmtDate, today, useSession } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import type { PersonRow } from '../../types-client.ts';
import { PersonName, ageOn } from '../people-common.tsx';

export function BirthdaysTab({ people, onOpen }: { people?: PersonRow[]; onOpen: (id: number) => void }) {
  const { t, lang } = useI18n();
  // read-only accounts get only the birthday (day and month): no age, no phone
  const { canEdit } = useSession();
  const list = useMemo(() => {
    if (!people) return [];
    const start = today();
    const end = addDays(start, 30);
    const y = Number(start.slice(0, 4));
    return people
      .filter((p) => (p.birth_date || p.birthday) && p.status !== 'deceased' && p.status !== 'transferred')
      .map((p) => {
        const md = p.birth_date ? p.birth_date.slice(5) : p.birthday!;
        let next = `${y}-${md}`;
        if (md === '02-29' && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) next = `${y}-03-01`;
        if (next < start) next = `${y + 1}-${md}`;
        const days = Math.round((new Date(next + 'T00:00:00').getTime() - new Date(start + 'T00:00:00').getTime()) / 86400000);
        return { p, next, days, age: p.birth_date ? ageOn(p.birth_date, next) : null };
      })
      .filter((x) => x.next <= end)
      .sort((a, b) => a.days - b.days);
  }, [people]);

  if (!people) return <Loading />;
  if (!list.length) return <div className="card"><Empty title={t('No birthdays in the next 30 days.')} /></div>;
  return (
    <div className="card flush table-wrap">
      <table className="t">
        <thead>
          <tr><th>{t('Date')}</th><th>{t('Name')}</th>{canEdit && <th>{t('Turning')}</th>}<th>{t('Days away')}</th>{canEdit && <th>{t('Phone')}</th>}</tr>
        </thead>
        <tbody>
          {list.map(({ p, next, days, age }) => (
            <tr key={p.id} className="click" onClick={() => onOpen(p.id)}>
              <td className="nowrap"><Icon name="cake" className="ico-inline" /> {fmtDate(next, lang, { weekday: 'short', day: 'numeric', month: 'short' })}</td>
              <td className="nowrap"><PersonName p={p} /></td>
              {canEdit && <td>{age}</td>}
              <td className="nowrap">{days === 0 ? <span className="badge reed">{t('Today')}</span> : `${days} ${t(days === 1 ? 'day' : 'days')}`}</td>
              {canEdit && <td className="nowrap">{p.phone ?? ''}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- honorific title
