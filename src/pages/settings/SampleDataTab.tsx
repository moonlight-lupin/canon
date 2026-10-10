// Settings → Sample data (administrators, 0.15.8): add a fictional church to try Canon with, and take it out again.
// From 0.19.7 the church also does things in every part of Canon that is switched on — services from Canon's own
// templates with their rotas and records, meetings, the calendar, the library, the asset register, the books and
// claims — so everything can be seen working together. Canon marks each row it adds, so removing it never touches
// what people typed.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Loading, confirmAction, useAction, useSession } from '../../components/ui.tsx';
import { OPTIONAL_LABEL } from '../../../shared/modules.ts';

type Status =
  | { present: false }
  | {
    present: true; added_at: string; people: number; households: number; groups: number; services: number; assignments: number;
    events?: number; books?: number; equipment?: number; journals?: number; claims?: number;
  };

export function SampleDataTab() {
  const { t } = useI18n();
  const { settings } = useSession();
  const { data, reload } = useApi<Status>('/sample-data');
  const { run, busy } = useAction();
  const [rota, setRota] = useState(true);
  const [activity, setActivity] = useState(true);
  if (!data) return <Loading />;
  const modules = settings?.modules;
  const off = (['meetings', 'lending', 'equipment', 'bookkeeping'] as const).filter((m) => modules && modules[m] === false);
  const booksStarted = !!settings?.bookkeeping?.start_date;
  const add = () => run(async () => {
    const r = await api.post<{ library_added?: boolean }>('/sample-data', { rota, activity });
    reload();
    if (r?.library_added) window.alert(t('Canon’s library (hymns, liturgical texts and service templates) was added first: the sample’s services are made from its templates. It stays when the sample is removed.'));
  }, t('Sample data added.'));
  const remove = async () => {
    if (!await confirmAction(t('Remove all the sample data? Everything else stays as it is.'), { danger: true, ok: t('Remove') })) return;
    run(async () => {
      const r = await api.del<{ kept?: { what: string; name: string; why: string[] }[] }>('/sample-data');
      reload();
      // what gained real records stays, and is listed
      if (r?.kept?.length) window.alert(`${t('Kept, because real records now belong to them:')}\n${r.kept.map((k) => `• ${k.name} — ${k.why.join(', ')}`).join('\n')}`);
    }, t('Sample data removed.'));
  };
  return (
    <div className="card stack">
      <h3 style={{ margin: 0 }}>{t('Sample data')}</h3>
      <p className="muted" style={{ margin: 0 }}>
        {t('A fictional church to try Canon with: about 40 people in households, with English and Chinese names and birthdays; cell groups by area, committees, fellowships and a Sunday school; people on every serving team. Their notes say they are sample data.')}
      </p>
      {data.present ? (
        <>
          <p style={{ margin: 0 }}>
            {t('Added on {d}: {p} people, {h} households, {g} groups, {a} rota places.')
              .replace('{d}', new Date(data.added_at).toLocaleDateString()).replace('{p}', String(data.people))
              .replace('{h}', String(data.households)).replace('{g}', String(data.groups)).replace('{a}', String(data.assignments))}
            {' '}
            {(data.services || data.events || data.books || data.equipment || data.journals || data.claims) ? t('Also {s} services and meetings, {e} events, {b} library books, {q} assets, {j} journals and {c} claims.')
              .replace('{s}', String(data.services)).replace('{e}', String(data.events ?? 0)).replace('{b}', String(data.books ?? 0))
              .replace('{q}', String(data.equipment ?? 0)).replace('{j}', String(data.journals ?? 0)).replace('{c}', String(data.claims ?? 0)) : null}
          </p>
          <p className="small muted" style={{ margin: 0 }}>
            {t('Removing takes out exactly what was added — the people with their places in groups, teams and rotas, their households and groups, the services and meetings with their records, the events, books, assets, journals, bank statement and claims — and nothing anyone typed. When the sample started the books and nothing real is in them, they go back to not started.')}
          </p>
          <div className="row"><button className="btn danger" disabled={busy} onClick={remove}>{t('Remove sample data')}</button></div>
        </>
      ) : (
        <>
          <label className="check">
            <input type="checkbox" checked={rota} onChange={(e) => setRota(e.target.checked)} />
            {t('Also put them on the rota of the next service, and of a copy of it a week later (only empty places)')}
          </label>
          <label className="check">
            <input type="checkbox" checked={activity} onChange={(e) => setActivity(e.target.checked)} />
            {t('Also what the church does, in every part of Canon that is switched on: the last eight Sundays and the next two from Canon’s service templates, with rotas and service records (offerings counted and verified); cell-group and Sunday school meetings; events and spaces; library books with loans; the asset register; and, if the books aren’t started, the books with offerings, bills, a bank statement and claims in every state')}
          </label>
          {activity && off.length > 0 && (
            <p className="small muted" style={{ margin: 0 }}>
              {t('Switched off, so left out: {list}. Switch them on in Settings → Modules first to include them.').replace('{list}', off.map((m) => t(OPTIONAL_LABEL[m].name)).join(', '))}
              {' '}<Link to="/settings?tab=modules">{t('Modules')}</Link>
            </p>
          )}
          {activity && modules?.bookkeeping !== false && booksStarted && (
            <p className="small muted" style={{ margin: 0 }}>{t('The books are already started, so the sample leaves them (and claims) alone.')}</p>
          )}
          <div className="row"><button className="btn primary" disabled={busy} onClick={add}>{t('Add sample church')}</button></div>
        </>
      )}
    </div>
  );
}
