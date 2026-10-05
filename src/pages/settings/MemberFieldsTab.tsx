// Settings → Member fields (administrators): the church's own fields on the member register — text, a date, yes / no
// or a choice — each optionally marked sensitive (hidden from read-only accounts and AI agents).
import { useEffect, useState } from 'react';
import { api } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Field, L10nInput, useAction, useSession, L10nEditScope, L10nSwitcher } from '../../components/ui.tsx';
import { InfoTip } from '../../components/InfoTip.tsx';
import { Icon } from '../../components/icons.tsx';
import { MAX_MEMBER_FIELDS, MEMBER_FIELD_TYPES, type MemberField, type MemberFieldType } from '../../../shared/member-fields.ts';

const TYPE_LABEL: Record<MemberFieldType, string> = { text: 'Text', date: 'Date', yesno: 'Yes / no', choice: 'Choice from a list' };

export function MemberFieldsTab() {
  const { t } = useI18n();
  const { settings, reloadSettings } = useSession();
  const [fields, setFields] = useState<MemberField[]>([]);
  const { run, busy } = useAction();
  useEffect(() => {
    setFields(settings?.member_fields ?? []);
  }, [settings?.member_fields]);
  const upd = (i: number, p: Partial<MemberField>) => setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...p } : f)));
  const move = (i: number, d: -1 | 1) => setFields((fs) => {
    const a = [...fs];
    [a[i], a[i + d]] = [a[i + d], a[i]];
    return a;
  });
  const save = () => run(async () => {
    await api.put('/member-fields', fields);
    reloadSettings();
  }, t('Saved.'));
  return (
    <L10nEditScope>
    <div className="card stack">
      <div className="l10n-section-head">
        <div className="small muted">{t('Your own fields on the member register, e.g. “Cell group leader?”, “Joined via”, “Dietary needs”. They show on each member’s page, can filter the members list, and are columns in the members CSV (custom_…).')}</div>
        <L10nSwitcher min={2} />
      </div>
      {!fields.length && <div className="small muted">{t('No fields yet.')}</div>}
      {fields.map((f, i) => (
        <div key={f.key || `new-${i}`} className="card sub-card stack mf-row">
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="grow" style={{ minWidth: 260 }}><Field label={t('Label')}><L10nInput value={f.label} onChange={(v) => upd(i, { label: v })} /></Field></div>
            <Field label={t('Type')}>
              <select value={f.type} onChange={(e) => upd(i, { type: e.target.value as MemberFieldType, ...(e.target.value === 'choice' && !f.options?.length ? { options: [{}] } : {}) })}>
                {MEMBER_FIELD_TYPES.map((x) => <option key={x} value={x}>{t(TYPE_LABEL[x])}</option>)}
              </select>
            </Field>
            <label className="check" title={t('Hidden from read-only accounts and from AI assistants unless the church shares personal data.')}>
              <input type="checkbox" checked={!!f.sensitive} onChange={(e) => upd(i, { sensitive: e.target.checked })} />{t('Sensitive')}
            </label>
            <div className="row" style={{ gap: 4 }}>
              <button className="btn sm ghost icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('Move up')}>↑</button>
              <button className="btn sm ghost icon" disabled={i === fields.length - 1} onClick={() => move(i, 1)} aria-label={t('Move down')}>↓</button>
              <button className="btn sm ghost icon danger" onClick={() => setFields(fields.filter((_, j) => j !== i))} aria-label={t('Remove')}><Icon name="trash" /></button>
            </div>
          </div>
          {f.type === 'choice' && (
            <Field label={t('Choices')}>
              <div className="stack" style={{ gap: 6 }}>
                {(f.options ?? []).map((o, k) => (
                  <div key={k} className="row" style={{ gap: 6 }}>
                    <div className="grow"><L10nInput value={o} onChange={(v) => upd(i, { options: (f.options ?? []).map((x, j) => (j === k ? v : x)) })} /></div>
                    <button className="btn sm ghost icon danger" onClick={() => upd(i, { options: (f.options ?? []).filter((_, j) => j !== k) })} aria-label={t('Remove')}><Icon name="trash" /></button>
                  </div>
                ))}
                <div><button className="btn sm" onClick={() => upd(i, { options: [...(f.options ?? []), {}] })}><Icon name="plus" />{t('Add choice')}</button></div>
              </div>
            </Field>
          )}
          {f.key && <div className="small muted">{t('CSV column')}: <code>custom_{f.key}</code></div>}
        </div>
      ))}
      <div className="row" style={{ gap: 8 }}>
        {fields.length < MAX_MEMBER_FIELDS && <button className="btn" onClick={() => setFields([...fields, { key: '', label: {}, type: 'text' }])}><Icon name="plus" />{t('Add field')}</button>}
        <button className="btn primary" onClick={save} disabled={busy}>{t('Save')}</button>
        <InfoTip text={t('Removing a field hides it everywhere; values already entered are kept and come back if a field with the same name is added again.')} />
      </div>
    </div>
    </L10nEditScope>
  );
}
