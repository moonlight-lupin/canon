// Members → New family (0.19.7, from an adversarial UX test): a family new to the church in one form — the household
// and a row for each person (names, Chinese name, place in the household, gender, birthday, status) — saved together.
// Before, it was a household and then one "Add person" form per person, picking the household each time. The details
// that only some people have (contact, baptism, the church's own fields) are filled in afterwards on each person.
import { useState } from 'react';
import { api } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Field, Modal, useAction } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import type { MemberStatus } from '../../types-client.ts';
import { HH_ROLE_LABEL, HH_ROLES, type HhRole } from './common.ts';

interface Row { first_name: string; last_name: string; native_name: string; household_role: HhRole; gender: '' | 'M' | 'F'; birth_date: string; status: MemberStatus }
const STATUSES: MemberStatus[] = ['member', 'regular', 'visitor'];
const STATUS_LABEL: Record<string, string> = { member: 'Member', regular: 'Regular', visitor: 'Visitor' };

const blank = (role: HhRole, last = ''): Row => ({ first_name: '', last_name: last, native_name: '', household_role: role, gender: '', birth_date: '', status: 'member' });

export function FamilyEditor({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [rows, setRows] = useState<Row[]>([blank('head'), blank('spouse')]);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const surname = rows[0].last_name.trim();
  // the household's name follows the first person's surname until it is typed
  const householdName = nameTouched ? name : surname ? t('{name} family').replace('{name}', surname) : '';
  // the others' surname is the first person's unless typed (shown greyed in their row)
  const setRow = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const people = rows.filter((r) => r.first_name.trim());
  const save = () => run(async () => {
    if (!householdName.trim()) throw new Error(t('Give the household a name.'));
    if (!people.length) throw new Error(t('Add at least one person with a first name.'));
    await api.post('/households/family', {
      household: { name: householdName.trim(), address: address.trim() || null, phone: phone.trim() || null },
      people: people.map((r) => ({
        first_name: r.first_name.trim(), last_name: (r.last_name.trim() || surname), native_name: r.native_name.trim() || null,
        household_role: r.household_role, gender: r.gender || null, birth_date: r.birth_date || null, status: r.status,
      })),
    });
    onSaved();
    onClose();
  }, t('Saved.'));

  return (
    <Modal title={t('New family')} onClose={onClose} size="lg" footer={
      <>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" onClick={save} disabled={busy || !people.length}>{t('Save family ({n})').replace('{n}', String(people.length))}</button>
      </>
    }>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>{t('One row for each person. Contact details, baptism and the rest can be added afterwards on each person.')}</p>
        <div className="table-wrap">
          <table className="t family-rows">
            <thead>
              <tr><th>{t('First name')} *</th><th>{t('Last name')}</th><th>{t('Chinese name')}</th><th>{t('In the household')}</th><th>{t('Gender')}</th><th>{t('Birth date')}</th><th>{t('Status')}</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td data-label={t('First name')}><input value={r.first_name} onChange={(e) => setRow(i, { first_name: e.target.value })} autoFocus={i === 0} /></td>
                  <td data-label={t('Last name')}><input value={r.last_name} placeholder={i > 0 ? surname : ''} onChange={(e) => setRow(i, { last_name: e.target.value })} /></td>
                  <td data-label={t('Chinese name')}><input value={r.native_name} onChange={(e) => setRow(i, { native_name: e.target.value })} /></td>
                  <td data-label={t('In the household')}>
                    <select value={r.household_role} onChange={(e) => setRow(i, { household_role: e.target.value as HhRole })}>
                      {HH_ROLES.map((x) => <option key={x} value={x}>{t(HH_ROLE_LABEL[x])}</option>)}
                    </select>
                  </td>
                  <td data-label={t('Gender')}>
                    <select value={r.gender} onChange={(e) => setRow(i, { gender: e.target.value as Row['gender'] })}>
                      <option value="">—</option><option value="M">{t('Male')}</option><option value="F">{t('Female')}</option>
                    </select>
                  </td>
                  <td data-label={t('Birth date')}><input type="date" value={r.birth_date} onChange={(e) => setRow(i, { birth_date: e.target.value })} /></td>
                  <td data-label={t('Status')}>
                    <select value={r.status} onChange={(e) => setRow(i, { status: e.target.value as MemberStatus })}>
                      {STATUSES.map((x) => <option key={x} value={x}>{t(STATUS_LABEL[x])}</option>)}
                    </select>
                  </td>
                  <td>{rows.length > 1 && <button className="btn ghost sm icon" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={t('Remove')} title={t('Remove')}><Icon name="x" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row"><button className="btn sm" onClick={() => setRows((rs) => [...rs, blank('child')])}><Icon name="plus" />{t('Another person')}</button></div>
        <div className="grid cols-3" style={{ gap: 12 }}>
          <Field label={t('Household name')}><input value={householdName} onChange={(e) => { setName(e.target.value); setNameTouched(true); }} placeholder={t('e.g. Tan family')} /></Field>
          <Field label={t('Address')}><input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
          <Field label={t('Home phone')}><input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        </div>
      </div>
    </Modal>
  );
}
