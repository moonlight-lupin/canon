// The service planner: duplicate, save as template and e-mail reminders.
import { useState } from 'react';
import { hasAnyText } from '../../../shared/labels.ts';
import { Link, useNavigate } from 'react-router-dom';
import { api, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Field, L10nInput, Loading, ErrorBox, Modal, Seg, useAction, useDebounced, useSession } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import { langInfo, dateLocale } from '../../../shared/languages.ts';
import type { L10n, Lang, ServiceFull } from '../../types-client.ts';

export function DuplicateDialog({ svc, onClose }: { svc: ServiceFull; onClose: () => void }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const { run, busy } = useAction();
  const next = new Date(svc.date + 'T00:00:00');
  next.setDate(next.getDate() + 7);
  const [date, setDate] = useState(next.toISOString().slice(0, 10));
  const [roster, setRoster] = useState(false);
  return (
    <Modal title={t('Duplicate')} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" disabled={busy} onClick={async () => {
          const s = await run(() => api.post<ServiceFull>(`/services/${svc.id}/duplicate`, { date, with_roster: roster }));
          if (s) {
            onClose();
            nav(`/services/${s.id}`);
          }
        }}>{t('Duplicate')}</button>
      </>
    }>
      <div className="stack">
        <Field label={t('Date')}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <label className="check"><input type="checkbox" checked={roster} onChange={(e) => setRoster(e.target.checked)} />{t('Team & roster')}</label>
      </div>
    </Modal>
  );
}

export function SaveTemplateDialog({ svc, onClose }: { svc: ServiceFull; onClose: () => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [name, setName] = useState<L10n>(svc.title);
  return (
    <Modal title={t('Save as template')} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" disabled={busy || !hasAnyText(name)} onClick={async () => {
          if (await run(() => api.post(`/services/${svc.id}/save-as-template`, { name }), t('Saved.'))) onClose();
        }}>{t('Save')}</button>
      </>
    }>
      <Field label={t('Name')}><L10nInput value={name} onChange={setName} /></Field>
    </Modal>
  );
}

// ------------------------------------------------------------------ volunteer reminder e-mails (manual send only)

export type ReminderRecipient = {
  person_id: number;
  name: string;
  has_email: boolean;
  preferred_lang: string | null;
  langs: Lang[];
  roles: { role_id: number; name: L10n; team: L10n; status: string }[];
  items: { id: number; title: L10n; start: string; end: string }[];
  subject: string;
  text: string;
  html: string;
  last_sent: { at: string; ok: boolean; error: string | null } | null;
};

export type ReminderPreview = { smtp_configured: boolean; share_url: string | null; default_note: L10n; recipients: ReminderRecipient[] };

export type ReminderResult = { sent: number; failed: number; skipped: number; results: { person_id: number; name: string; ok: boolean; skipped?: boolean; code?: string; error?: string }[] };

export const sentAt = (s: string, lang: Lang) => {
  const d = new Date(/T/.test(s) ? s : s.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString(dateLocale(lang), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export function ReminderDialog({ svc, onClose }: { svc: ServiceFull; onClose: () => void }) {
  const { t, lt, lang } = useI18n();
  const { isAdmin } = useSession();
  const [note, setNote] = useState('');
  const dNote = useDebounced(note.trim(), 400);
  const { data, error, loading, reload } = useApi<ReminderPreview>(`/services/${svc.id}/reminders/preview${dNote ? `?note=${encodeURIComponent(dNote)}` : ''}`);
  const [sel, setSel] = useState<Set<number> | null>(null);
  const [step, setStep] = useState<'pick' | 'confirm' | 'done'>('pick');
  const [result, setResult] = useState<ReminderResult | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState('');
  const [view, setView] = useState<'html' | 'text'>('html');

  const recips = data?.recipients ?? [];
  const withEmail = recips.filter((r) => r.has_email);
  const selected = sel ?? new Set(withEmail.map((r) => r.person_id));
  const chosen = withEmail.filter((r) => selected.has(r.person_id));
  const pool = chosen.length ? chosen : withEmail.length ? withEmail : recips;
  const combos = [...new Set(pool.map((r) => r.langs.join('+')))];
  const key = combos.includes(previewKey) ? previewKey : combos[0] ?? '';
  const sample = pool.find((r) => r.langs.join('+') === key);
  const comboLabel = (k: string) => k.split('+').map((l) => langInfo(l).native).join(' + ');
  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSel(next);
  };

  const send = async () => {
    setSending(true);
    setSendError(null);
    try {
      const r = await api.post<ReminderResult>(`/services/${svc.id}/reminders`, { person_ids: chosen.map((x) => x.person_id), note: note.trim() || undefined });
      setResult(r);
      setStep('done');
      reload();
    } catch (e) {
      setSendError((e as Error).message);
      setStep('pick');
    } finally {
      setSending(false);
    }
  };

  const footer = step === 'done' ? (
    <button className="btn primary" onClick={onClose}>{t('Done')}</button>
  ) : step === 'confirm' ? (
    <>
      <button className="btn" onClick={() => setStep('pick')} disabled={sending}>{t('Back')}</button>
      <button className="btn primary" onClick={send} disabled={sending}><Icon name="mail" />{sending ? t('Sending…') : t('Send now')}</button>
    </>
  ) : (
    <>
      <button className="btn" onClick={onClose}>{t('Cancel')}</button>
      <button className="btn primary" disabled={!data?.smtp_configured || !chosen.length} onClick={() => setStep('confirm')}>
        <Icon name="mail" />{t('Send to')} {chosen.length}
      </button>
    </>
  );

  return (
    <Modal title={t('Send reminders')} onClose={sending ? () => {} : onClose} size="lg" footer={footer}>
      {error && <ErrorBox error={error} />}
      {!data && loading && <Loading />}
      {data && !data.smtp_configured && step !== 'done' && (
        <div className="callout warn" style={{ marginBottom: 12 }}>
          <strong>{t('E-mail is not set up yet.')}</strong>{' '}
          {isAdmin
            ? <>{t('Add the church’s SMTP server under')} <Link to="/settings" onClick={onClose}>{t('Settings')} → {t('E-mail')}</Link>.</>
            : t('Ask an administrator to add the SMTP server under Settings → E-mail.')}
        </div>
      )}
      {sendError && <div className="callout warn" style={{ marginBottom: 12 }}>{sendError}</div>}

      {step === 'done' && result && (
        <div className="stack">
          <div className={`callout ${result.failed ? 'warn' : 'lapis'}`}>
            {t('Sent')}: <strong>{result.sent}</strong> · {t('Failed')}: <strong>{result.failed}</strong> · {t('Not sent')}: <strong>{result.skipped}</strong>
          </div>
          <table className="t">
            <tbody>
              {result.results.map((r) => (
                <tr key={r.person_id}>
                  <td className="nowrap">{r.name}</td>
                  <td>
                    {r.ok ? <span className="badge ok">{t('Sent')}</span>
                      : r.skipped ? <span className="badge">{r.code === 'no_email' ? t('no e-mail') : t('Not sent')}</span>
                      : <span className="badge danger">{t('Failed')}</span>}
                    {!r.ok && r.error && r.code !== 'no_email' && <div className="small" style={{ color: 'var(--danger)' }}>{r.error}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {step === 'confirm' && (
        <div className="stack">
          <p>{t('Send reminder e-mails now to')} <strong>{chosen.length}</strong> {chosen.length === 1 ? t('person') : t('people')}?</p>
          <div className="small muted">{chosen.map((r) => r.name).join(', ')}</div>
          <div className="small muted">{t('E-mails cannot be recalled once sent.')}</div>
        </div>
      )}

      {step === 'pick' && data && (
        <div className="stack">
          {!recips.length ? (
            <div className="empty">{t('No one is scheduled for this service yet.')}</div>
          ) : (
            <div>
              <div className="row between" style={{ marginBottom: 4 }}>
                <strong>{t('Recipients')}</strong>
                <span className="row small">
                  <button className="btn ghost sm" onClick={() => setSel(new Set(withEmail.map((r) => r.person_id)))}>{t('All')}</button>
                  <button className="btn ghost sm" onClick={() => setSel(new Set())}>{t('None')}</button>
                </span>
              </div>
              <table className="t">
                <tbody>
                  {recips.map((r) => (
                    <tr key={r.person_id} style={r.has_email ? undefined : { opacity: 0.6 }}>
                      <td style={{ width: 28 }}>
                        <input type="checkbox" checked={r.has_email && selected.has(r.person_id)} disabled={!r.has_email} onChange={() => toggle(r.person_id)} aria-label={r.name} />
                      </td>
                      <td>
                        <div>
                          {r.name}{' '}
                          {r.langs.map((l) => <span key={l} className="badge" style={{ marginLeft: 2 }} title={langInfo(l).name}>{langInfo(l).short}</span>)}
                          {!r.has_email && (
                            <> <span className="badge warn">{t('no e-mail')}</span> <Link className="small" to={`/members?person=${r.person_id}`}>{t('Add address')} →</Link></>
                          )}
                        </div>
                        <div className="small muted">
                          {r.roles.map((x) => lt(x.name)).join(', ')}
                          {r.items.length > 0 && <> · {r.items.map((it) => `${it.start} ${lt(it.title)}`).join(', ')}</>}
                        </div>
                      </td>
                      <td className="nowrap small right">
                        {r.last_sent
                          ? r.last_sent.ok
                            ? <span className="muted" title={t('Last sent')}>✓ {sentAt(r.last_sent.at, lang)}</span>
                            : <span style={{ color: 'var(--danger)' }} title={r.last_sent.error ?? ''}>{t('Failed')} {sentAt(r.last_sent.at, lang)}</span>
                          : <span className="muted">{t('Not sent yet')}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Field label={t('Note')} hint={t('Replaces the standard arrival note. Leave empty to keep it.')}>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder={lt(data.default_note)} />
          </Field>
          {!data.share_url && <div className="small muted">{t('Tip: turn on the share link to include the order of service in the e-mail.')}</div>}

          {sample && (
            <div>
              <div className="row between" style={{ marginBottom: 6 }}>
                <strong>{t('Preview')}</strong>
                <span className="row">
                  {combos.length > 1 && <Seg<string> value={key} onChange={setPreviewKey} options={combos.map((k) => ({ value: k, label: comboLabel(k) }))} />}
                  <Seg<'html' | 'text'> value={view} onChange={setView} options={[{ value: 'html', label: t('Formatted') }, { value: 'text', label: t('Plain text') }]} />
                </span>
              </div>
              <div className="small muted" style={{ marginBottom: 4 }}>{t('To')}: {sample.name} · {t('Subject')}: <strong>{sample.subject}</strong></div>
              {view === 'html' ? (
                <iframe title={t('Preview')} sandbox="" srcDoc={sample.html} style={{ width: '100%', height: 380, border: '1px solid var(--rule)', borderRadius: 6, background: '#F3EEE2' }} />
              ) : (
                <pre className="serif" style={{ whiteSpace: 'pre-wrap', maxHeight: 380, overflow: 'auto', border: '1px solid var(--rule)', borderRadius: 6, padding: 12, margin: 0 }}>{sample.text}</pre>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
