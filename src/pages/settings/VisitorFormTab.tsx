// Settings → Visitor form (administrators): switch the form on for the church, the welcome and consent texts,
// whether to offer a prayer request box, and how long after a service entries are accepted.
import { useEffect, useState } from 'react';
import { api, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Field, L10nInput, Loading, useAction } from '../../components/ui.tsx';
import { InfoTip } from '../../components/InfoTip.tsx';
import type { VisitorFormSettings } from '../../../shared/visitor-form.ts';

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
    <div className="card stack">
      <div className="small muted">{t('A short form visitors fill in on their phone, from a QR code on the bulletin, a slide or a printed card. Each service has its own form (its Visitor form tab). Entries wait for an editor to accept them into the service record.')}</div>
      <label className="switch"><input type="checkbox" checked={d.enabled} onChange={(e) => setD({ ...d, enabled: e.target.checked })} /><strong>{t('Visitor form')}</strong><span className={`badge ${d.enabled ? 'ok' : ''}`}>{d.enabled ? t('On') : t('Off')}</span></label>
      <div className="callout small">{t('The form is a public page: anyone with a service’s link or QR code can open it, without signing in. It shows only the church name and the service’s title and date, and accepts entries only from the day before the service until the days set below.')}</div>
      <Field label={t('Welcome text')}><L10nInput value={d.welcome} onChange={(v) => setD({ ...d, welcome: v })} /></Field>
      <Field label={<>{t('Consent text')} <InfoTip text={t('Ticked by visitors who leave contact details or a prayer request (PDPA). Say what the church does with them.')} /></>}><L10nInput value={d.consent} onChange={(v) => setD({ ...d, consent: v })} /></Field>
      <label className="check"><input type="checkbox" checked={d.prayer} onChange={(e) => setD({ ...d, prayer: e.target.checked })} />{t('Offer a prayer request box (optional for visitors; kept as private as contact details)')}</label>
      <Field label={t('Accept entries until how many days after the service')}>
        <input type="number" min={0} max={14} value={d.days_after} onChange={(e) => setD({ ...d, days_after: Math.max(0, Math.min(14, Math.floor(Number(e.target.value) || 0))) })} style={{ width: 90 }} />
      </Field>
      <div><button className="btn primary" onClick={save} disabled={busy}>{t('Save')}</button></div>
    </div>
  );
}
