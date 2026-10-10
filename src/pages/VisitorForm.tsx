// The visitor form in the web app: the service's Visitor form tab (switch it on, choose where its QR code shows,
// print cards), the review of visitors' entries (also on the service record), and the printable cards.
import { dateLocale } from '../../shared/languages.ts';
import { FitToScreen } from '../components/onscreen.ts';
import { useParams, Link } from 'react-router-dom';
import { api, useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Bi, ErrorBox, Loading, confirmAction, fmtDate, useAction, useSession, useToast } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import { InfoTip } from '../components/InfoTip.tsx';
import { qrPreviewUrl } from '../../shared/presentation.ts';
import type { VisitorCard } from '../../shared/visitor-form.ts';
import type { ServiceFull } from '../types-client.ts';
import './records.css';

interface FormInfo { token?: string; bulletin?: boolean; slides?: boolean; enabled_church: boolean; url: string | null; public_address: boolean; local_only: boolean; pending: number }

/** The service's Visitor form tab. */
export function VisitorFormPanel({ serviceId, canEdit, noSwitch }: { serviceId: number; canEdit: boolean; noSwitch?: boolean }) {
  const { t } = useI18n();
  const { isAdmin } = useSession();
  const { data, error, setData } = useApi<FormInfo>(`/services/${serviceId}/visitor-form`);
  const { run, busy } = useAction();
  const toast = useToast();
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const on = !!data.token;
  const save = (p: { enabled: boolean; bulletin?: boolean; slides?: boolean }) => run(async () => {
    setData(await api.put<FormInfo>(`/services/${serviceId}/visitor-form`, p));
  }, t('Saved.'));
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.url ?? '');
      toast(t('Copied.'));
    } catch {
      window.prompt(t('Copy'), data.url ?? '');
    }
  };
  if (!data.enabled_church) {
    return (
      <div className="card stack">
        <h3>{t('Visitor form')}</h3>
        <div className="small muted">{t('Visitors can fill in a short form on their phone from a QR code on the bulletin, a slide or a card; the entries wait for you to accept them into the service record.')}</div>
        <div className="callout small">{isAdmin ? <>{t('The visitor form is off for the church.')} <Link to="/settings?tab=visitor-form">{t('Settings → Visitor form')}</Link></> : t('The visitor form is off for the church. An administrator can switch it on in Settings → Visitor form.')}</div>
      </div>
    );
  }
  return (
    <div className="stack">
      <section className="card stack">
        <div className="row between">
          <h3>{t('Visitor form')} <InfoTip text={t('A short form visitors fill in on their phone: name, contact (optional), how they came, whether they would like to be contacted. Entries wait below until you accept them into the service record.')} /></h3>
          {canEdit && !noSwitch && <label className="switch"><input type="checkbox" checked={on} disabled={busy} onChange={(e) => save({ enabled: e.target.checked })} /><strong>{on ? t('On') : t('Off')}</strong></label>}
        </div>
        {on && data.url && (
          <div className="vf-grid">
            <img className="vf-qr" src={qrPreviewUrl(data.url)} alt={t('QR code of the visitor form')} />
            <div className="stack">
              <div className="endpoint"><span className="code">{data.url}</span><button className="btn sm" onClick={copy}><Icon name="copy" />{t('Copy')}</button></div>
              {data.local_only
                ? <div className="callout warn small">{t('This link points at this computer only (“localhost”), so phones cannot open it. Set a public address in Settings → AI / MCP, or open Canon by its network address (as other computers do) and switch the form off and on again.')}</div>
                : !data.public_address && <div className="callout warn small">{t('No public address is set (Settings → AI / MCP), so phones can only open this link on the church’s own network.')}</div>}
              <fieldset disabled={!canEdit || busy} className="bare stack">
                <label className="check"><input type="checkbox" checked={!!data.bulletin} onChange={(e) => save({ enabled: true, bulletin: e.target.checked })} />{t('Print the QR code on the bulletin’s back page')}</label>
                <label className="check"><input type="checkbox" checked={!!data.slides} onChange={(e) => save({ enabled: true, slides: e.target.checked })} />{t('Show the QR code on a slide after the Announcements')}</label>
              </fieldset>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Link className="btn sm" to={`/services/${serviceId}/visitor-cards`} target="_blank"><Icon name="print" />{t('Print cards')}</Link>
                <a className="btn sm ghost" href={data.url} target="_blank" rel="noreferrer"><Icon name="link" />{t('Open the form')}</a>
              </div>
              <div className="small muted">{t('The form accepts entries from the day before the service until a few days after (Settings → Visitor form).')}</div>
            </div>
          </div>
        )}
      </section>
      {canEdit && <VisitorCardsReview serviceId={serviceId} />}
    </div>
  );
}

/** Visitors' entries waiting for review: accept (into the service record's New visitors) or discard. */
export function VisitorCardsReview({ serviceId, onAccepted }: { serviceId: number; onAccepted?: () => void }) {
  const { t, lang } = useI18n();
  const { data, error, reload } = useApi<VisitorCard[]>(`/services/${serviceId}/visitor-cards`);
  const { run, busy } = useAction();
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const accept = (c: VisitorCard) => run(async () => {
    await api.post(`/visitor-cards/${c.id}/accept`, {});
    reload();
    onAccepted?.();
  }, t('Added to the new visitors.'));
  const discard = async (c: VisitorCard) => {
    if (!await confirmAction(t('Discard this entry? It is deleted and not kept anywhere.'))) return;
    run(async () => {
      await api.del(`/visitor-cards/${c.id}`);
      reload();
    }, t('Discarded.'));
  };
  return (
    <section className="card stack vf-review">
      <h3>{t('Visitor cards to review')} <span className="badge">{data.length}</span> <InfoTip text={t('Entries from the visitor form. Accept adds the visitor to this service’s New visitors (with “via visitor form”); Discard deletes spam or duplicates. Contact details and prayer requests are personal data (PDPA).')} /></h3>
      {!data.length ? <div className="small muted">{t('No entries waiting.')}</div> : data.map((c) => (
        <div key={c.id} className="vf-card">
          <div className="grow">
            <strong>{c.name}</strong>
            {c.contact && <span> · {c.contact}</span>}
            {c.wants_contact && <span className="badge lapis" style={{ marginLeft: 6 }}>{t('Would like to be contacted')}</span>}
            {c.about && <div className="small">{t('About them')}: {c.about}</div>}
            {c.source && <div className="small">{t('How they came')}: {c.source}</div>}
            {c.prayer && <div className="small vf-prayer"><strong>{t('Prayer request')}:</strong> {c.prayer}</div>}
            <div className="small muted">{new Date(c.created_at.replace(' ', 'T') + 'Z').toLocaleString(dateLocale(lang))}{c.consent ? ` · ${t('agreed to the church keeping these details')}` : ''}</div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm primary" onClick={() => accept(c)} disabled={busy}><Icon name="check" />{t('Accept')}</button>
            <button className="btn sm ghost danger" onClick={() => discard(c)} disabled={busy}><Icon name="trash" />{t('Discard')}</button>
          </div>
        </div>
      ))}
    </section>
  );
}

/** Printable cards with the form's QR code (eight to an A4 page). */
export function VisitorCardsPrint() {
  const { id } = useParams();
  const sid = Number(id);
  const { t, lt } = useI18n();
  const { settings } = useSession();
  const svc = useApi<ServiceFull>(`/services/${sid}`);
  const info = useApi<FormInfo>(`/services/${sid}/visitor-form`);
  if (svc.error || info.error) return <ErrorBox error={(svc.error ?? info.error)!} />;
  if (!svc.data || !info.data) return <Loading />;
  if (!info.data.url) return <div className="decl"><FitToScreen className="decl-page"><p>{t('Switch the visitor form on for this service first.')}</p></FitToScreen></div>;
  const url = info.data.url;
  return (
    <div className="decl">
      <div className="decl-bar no-print">
        <Link className="btn sm ghost" to={`/services/${sid}`}><Icon name="chevronLeft" />{t('Back')}</Link>
        <button className="btn sm primary" onClick={() => window.print()}><Icon name="print" />{t('Print')}</button>
      </div>
      <FitToScreen className="decl-page vf-sheet">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="vf-print-card">
            <div className="vf-church">{lt(settings?.church_name ?? { en: 'Church' })}</div>
            <div className="vf-hello">初次来访？请扫码留下资料<br />New here? Scan to say hello</div>
            <img src={qrPreviewUrl(url)} alt="" />
            <div className="vf-svc"><Bi v={svc.data!.title} /> · {fmtDate(svc.data!.date, 'en', { day: 'numeric', month: 'short' })}</div>
          </div>
        ))}
      </FitToScreen>
    </div>
  );
}
