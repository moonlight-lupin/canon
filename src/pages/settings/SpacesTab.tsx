// Settings → Spaces (administrators): the church's halls, rooms and other places. Services, meetings and calendar
// events can each be in one; a double booking shows as a warning on them and in Reports → Spaces. A space in use is
// archived (its bookings keep it) instead of deleted.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Field, L10nInput, Loading, Modal, confirmAction, useAction, useSession } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import { InfoTip } from '../../components/InfoTip.tsx';
import { CardMenu, type CardAction } from '../template-ui.tsx';
import { useSpaces, type Space } from '../../components/Spaces.tsx';
import type { L10n } from '../../types-client.ts';

export function SpacesTab() {
  const { t, lt } = useI18n();
  const { isAdmin } = useSession();
  const { data, reload } = useSpaces();
  const { run } = useAction();
  const [editing, setEditing] = useState<Partial<Space> | null>(null);
  if (!data) return <Loading />;
  const shown = data.spaces.filter((s) => !s.archived);
  const archived = data.spaces.filter((s) => s.archived);
  const setArchived = (s: Space, on: boolean) => run(async () => {
    await api.patch(`/spaces/${s.id}`, { archived: on });
    reload();
  }, on ? t('Archived.') : t('Restored.'));
  const remove = async (s: Space) => {
    if (!await confirmAction(t('Delete this space?'), { danger: true, ok: t('Delete') })) return;
    run(async () => {
      await api.del(`/spaces/${s.id}`);
      reload();
    }, t('Deleted.'));
  };
  const actions = (s: Space): CardAction[] => {
    const used = data.use[s.id] ?? 0;
    return [
      { label: t('Edit'), onClick: () => setEditing(s) },
      s.archived ? { label: t('Restore'), onClick: () => setArchived(s, false) } : { label: t('Archive'), onClick: () => setArchived(s, true), title: t('Keep it, but stop offering it for new bookings. Bookings already in it keep it.') },
      ...(used ? [] : [{ label: t('Delete'), onClick: () => remove(s), danger: true }]),
    ];
  };
  const table = (list: Space[]) => (
    <div className="table-wrap">
      <table className="t">
        <thead><tr><th>{t('Space')}</th><th className="right">{t('Capacity')}</th><th>{t('Notes')}</th><th className="right">{t('Bookings')}</th><th /></tr></thead>
        <tbody>
          {list.map((s) => (
            <tr key={s.id}>
              <td><strong>{lt(s.name)}</strong></td>
              <td className="right">{s.capacity ?? '—'}</td>
              <td className="small muted">{s.notes}</td>
              <td className="right">{data.use[s.id] ?? 0}</td>
              <td className="right">{isAdmin && <CardMenu label={t('More actions')} actions={actions(s)} fixed />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <section className="card stack">
      <div className="row between">
        <h3 style={{ margin: 0 }}>{t('Spaces')} <InfoTip text={t('The church’s halls, rooms and other places. Choose one on a service, a meeting or a calendar event: when the same space is booked at the same time, both show a warning, and Reports → Spaces lists the clashes and what is booked in the coming weeks.')} /></h3>
        {isAdmin && <button className="btn sm" onClick={() => setEditing({ name: {} })}><Icon name="plus" />{t('New space')}</button>}
      </div>
      {!shown.length && !archived.length ? <p className="muted small" style={{ margin: 0 }}>{t('No spaces yet. Add the sanctuary, the hall, the rooms you use…')}</p> : table(shown)}
      {archived.length > 0 && (
        <details className="tp-hidden">
          <summary>{t('Archived spaces')} <span className="badge">{archived.length}</span></summary>
          {table(archived)}
        </details>
      )}
      <p className="small muted" style={{ margin: 0 }}><Link to="/reports?tab=spaces">{t('Reports → Spaces')}</Link></p>
      {editing && <SpaceEditor space={editing} onClose={() => setEditing(null)} onSaved={reload} />}
    </section>
  );
}

function SpaceEditor({ space, onClose, onSaved }: { space: Partial<Space>; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [name, setName] = useState<L10n>(space.name ?? {});
  const [capacity, setCapacity] = useState<string>(space.capacity != null ? String(space.capacity) : '');
  const [notes, setNotes] = useState(space.notes ?? '');
  const save = () => run(async () => {
    const body = { name, capacity: capacity.trim() ? Number(capacity) : null, notes: notes.trim() || null };
    if (space.id) await api.patch(`/spaces/${space.id}`, body);
    else await api.post('/spaces', body);
    onSaved();
    onClose();
  }, t('Saved.'));
  return (
    <Modal title={space.id ? t('Edit space') : t('New space')} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" onClick={save} disabled={busy || !Object.values(name).some((v) => v?.trim())}>{t('Save')}</button>
      </>
    }>
      <div className="stack">
        <Field label={t('Name')}><L10nInput value={name} onChange={setName} placeholder={{ en: 'Fellowship hall', zh: '团契厅' }} /></Field>
        <div className="form-grid">
          <Field label={t('Capacity')} hint={t('people (optional)')}><input type="number" min={0} value={capacity} onChange={(e) => setCapacity(e.target.value)} /></Field>
        </div>
        <Field label={t('Notes')}><textarea rows={2} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder={t('e.g. projector, piano, level 2')} /></Field>
      </div>
    </Modal>
  );
}
