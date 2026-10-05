// Settings → Visitor form (administrators): switch the form on for the church, the welcome and consent texts,
// whether to offer a prayer request box, and how long after a service entries are accepted.
import { useEffect, useState } from 'react';
import { api, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Field, L10nInput, Loading, useAction, L10nEditScope, L10nSwitcher } from '../../components/ui.tsx';
import { InfoTip } from '../../components/InfoTip.tsx';
import { Icon } from '../../components/icons.tsx';
import type { VisitorFormSettings } from '../../../shared/visitor-form.ts';
import type { L10n } from '../../types-client.ts';

export function VisitorFormTab() {
  const { t } = useI18n();
  const { data, setData } = useApi<VisitorFormSettings>('/visitor-form-settings');
  const [d, setD] = useState<VisitorFormSettings | null>(null);
  const { run, busy } = useAction();
  useEffect(() => {
    if (data) setD(data);
  }, [data]);
  if (!d) return <Loading />;
  const save = () => run(async () => {
    setData(await api.put<VisitorFormSettings>('/visitor-form-settings', d));
  }, t('Saved.'));
  return (
    <L10nEditScope>
    <div className="card stack">
      <div className="small muted">{t('A short form visitors fill in on their phone, from a QR code on the bulletin, a slide or a printed card. Each service has its own form (its Visitor form tab). Entries wait for an editor to accept them into the service record.')}</div>
      <div className="l10n-section-head">
        <label className="switch"><input type="checkbox" checked={d.enabled} onChange={(e) => setD({ ...d, enabled: e.target.checked })} /><strong>{t('Visitor form')}</strong><span className={`badge ${d.enabled ? 'ok' : ''}`}>{d.enabled ? t('On') : t('Off')}</span></label>
        <L10nSwitcher min={2} />
      </div>
      <div className="callout small">{t('The form is a public page: anyone with a service’s link or QR code can open it, without signing in. It shows only the church name and the service’s title and date, and accepts entries only from the day before the service until the days set below.')}</div>
      <Field label={t('Welcome text')}><L10nInput value={d.welcome} onChange={(v) => setD({ ...d, welcome: v })} /></Field>
      <Field label={<>{t('Consent text')} <InfoTip text={t('Ticked by visitors who leave contact details or a prayer request (PDPA). Say what the church does with them.')} /></>}><L10nInput value={d.consent} onChange={(v) => setD({ ...d, consent: v })} /></Field>
      <label className="check"><input type="checkbox" checked={d.prayer} onChange={(e) => setD({ ...d, prayer: e.target.checked })} />{t('Offer a prayer request box (optional for visitors; kept as private as contact details)')}</label>
      <Field label={<>{t('“Which describes you best?” answers')} <InfoTip text={t('For example: interested in the Christian faith, a believer not yet baptised, a baptised Christian, visiting. Visitors may choose one or none. Remove them all to leave the question out. Kept as private as contact details.')} /></>}>
        <AnswerList value={d.abouts} onChange={(abouts) => setD({ ...d, abouts })} />
      </Field>
      <Field label={<>{t('“How did you hear about us?” answers')} <InfoTip text={t('Shown as choices on the form, with “Other” and a box always added. The answer is kept in the church’s first language, so the New visitors report counts the same answer together.')} /></>}>
        <AnswerList value={d.sources} onChange={(sources) => setD({ ...d, sources })} />
      </Field>
      <Field label={t('Accept entries until how many days after the service')}>
        <input type="number" min={0} max={14} value={d.days_after} onChange={(e) => setD({ ...d, days_after: Math.max(0, Math.min(14, Math.floor(Number(e.target.value) || 0))) })} style={{ width: 90 }} />
      </Field>
      <div><button className="btn primary" onClick={save} disabled={busy}>{t('Save')}</button></div>
    </div>
    </L10nEditScope>
  );
}

/** A short list of answers in the church's languages: edit, reorder, remove, add (up to 12). */
function AnswerList({ value, onChange }: { value: L10n[]; onChange: (v: L10n[]) => void }) {
  const { t } = useI18n();
  return (
    <div className="stack" style={{ gap: 6 }}>
      {value.map((o, i) => (
        <div key={i} className="row" style={{ gap: 6, alignItems: 'flex-start' }}>
          <div className="grow"><L10nInput value={o} onChange={(v) => onChange(value.map((x, j) => (j === i ? v : x)))} /></div>
          <button className="btn sm ghost icon" disabled={i === 0} onClick={() => { const a = [...value]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; onChange(a); }} aria-label={t('Move up')}>↑</button>
          <button className="btn sm ghost icon danger" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={t('Remove')}><Icon name="trash" /></button>
        </div>
      ))}
      {value.length < 12 && <div><button className="btn sm" onClick={() => onChange([...value, {}])}><Icon name="plus" />{t('Add answer')}</button></div>}
    </div>
  );
}
