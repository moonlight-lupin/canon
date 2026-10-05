// Settings → Offerings (administrators): the church's currency, the funds offerings go to, how counters sign the
// cash count (on paper or on screen) and how many counters at least must count and sign.
import { useState } from 'react';
import { api } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Field, Seg, useAction, useSession } from '../../components/ui.tsx';
import { InfoTip } from '../../components/InfoTip.tsx';
import { CURRENCIES } from '../../../shared/records.ts';

export function OfferingsTab() {
  const { t } = useI18n();
  const { settings, reloadSettings } = useSession();
  const { run, busy } = useAction();
  const cur = settings?.offering ?? { currency: 'SGD', funds: ['General'], signing: 'paper' as const, min_counters: 2 };
  const [currency, setCurrency] = useState(cur.currency);
  const [funds, setFunds] = useState(cur.funds.join('\n'));
  const [signing, setSigning] = useState<'paper' | 'screen'>(cur.signing ?? 'paper');
  const [min, setMin] = useState(cur.min_counters ?? 2);
  const [own, setOwn] = useState(!!(cur as { own_accounts?: boolean }).own_accounts);
  const save = () => run(async () => {
    await api.put('/offering-settings', { currency, funds: funds.split('\n').map((f) => f.trim()).filter(Boolean), signing, min_counters: min, own_accounts: signing === 'screen' && own });
    reloadSettings();
  }, t('Saved.'));
  return (
    <div className="card stack">
      <div className="small muted">{t('How offerings are recorded and the cash is counted on each service record (Records → Service records).')}</div>
      <div className="row" style={{ gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Field label={t('Currency')}>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        </Field>
        <Field label={<>{t('Funds')} <InfoTip text={t('One per line, e.g. General, Missions, Building. They appear in the offerings list of every record.')} /></>}>
          <textarea rows={4} value={funds} onChange={(e) => setFunds(e.target.value)} style={{ width: 240 }} />
        </Field>
        <Field label={<>{t('Signing the count')} <InfoTip text={t('On paper: print the declaration, the counters sign it, then mark the count as verified. On screen: each counter signs on the record with a finger, pen or mouse; when everyone has signed, Finish signing verifies the count and the signatures are printed on the declaration.')} /></>}>
          <Seg value={signing} onChange={setSigning} options={[{ value: 'paper', label: t('On paper') }, { value: 'screen', label: t('On screen') }]} />
        </Field>
        <Field label={<>{t('Minimum counters')} <InfoTip text={t('How many people at least must count the cash together: their names (on paper) or signatures (on screen) are needed before the count can be verified. More may always count and sign.')} /></>}>
          <select value={min} onChange={(e) => setMin(Number(e.target.value))} style={{ width: 90 }}>{[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select>
        </Field>
      </div>
      {signing === 'screen' && (
        <label className="check">
          <input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} />
          {t('Counters approve from their own accounts')} <InfoTip text={t('Each counter signs in to Canon on their own account and presses Approve: the record then shows that different people approved the count (signatures drawn on one device can’t show that). The minimum counters must approve this way before the count can be finished.')} />
        </label>
      )}
      <div><button className="btn primary" onClick={save} disabled={busy}>{t('Save')}</button></div>
    </div>
  );
}
