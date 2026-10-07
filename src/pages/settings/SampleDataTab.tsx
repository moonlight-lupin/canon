// Settings → Sample data (administrators, 0.15.8): add a fictional church to try Canon with, and take it out again.
// Canon keeps a list of what it added, so removing it never touches what people typed.
import { useState } from 'react';
import { api, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Loading, confirmAction, useAction } from '../../components/ui.tsx';

type Status =
  | { present: false }
  | { present: true; added_at: string; people: number; households: number; groups: number; services: number; assignments: number };

export function SampleDataTab() {
  const { t } = useI18n();
  const { data, reload } = useApi<Status>('/sample-data');
  const { run, busy } = useAction();
  const [rota, setRota] = useState(true);
  if (!data) return <Loading />;
  const add = () => run(async () => {
    await api.post('/sample-data', { rota });
    reload();
  }, t('Sample data added.'));
  const remove = () => {
    if (!confirmAction(t('Remove all the sample data? Everything else stays as it is.'))) return;
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
          </p>
          <p className="small muted" style={{ margin: 0 }}>
            {t('Removing takes out exactly what was added — the people with their places in groups, teams and rotas, their households and groups, and the copied service — and nothing anyone typed.')}
          </p>
          <div className="row"><button className="btn danger" disabled={busy} onClick={remove}>{t('Remove sample data')}</button></div>
        </>
      ) : (
        <>
          <label className="check">
            <input type="checkbox" checked={rota} onChange={(e) => setRota(e.target.checked)} />
            {t('Also put them on the rota of the next service, and of a copy of it a week later (only empty places)')}
          </label>
          <div className="row"><button className="btn primary" disabled={busy} onClick={add}>{t('Add sample church')}</button></div>
        </>
      )}
    </div>
  );
}
