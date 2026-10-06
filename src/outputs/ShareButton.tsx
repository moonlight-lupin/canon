// The planner's Share button: the read-only team link, and the attendees' bulletin link (with its QR code for the
// bulletin and the slides). Links point at the church's public address, else this computer's network address
// (GET /api/link-base) — never "localhost", which other people's phones cannot open.
import { useEffect, useRef, useState } from 'react';
import { api, useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { useAction, useToast } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import { qrPreviewUrl } from '../../shared/presentation.ts';
import './outputs.css';

export type LinkBase = { base: string; public: boolean };
/** Where links for other people point: the public address, else this computer's network address. */
export const useLinkBase = () => useApi<LinkBase>('/link-base').data;

export function shareUrl(token: string, base?: string) {
  return `${base ?? location.origin}/share/${token}`;
}

interface AttendeeInfo { token?: string; bulletin?: boolean; slides?: boolean; url: string | null; public_address: boolean; local_only: boolean }

export function ShareButton({
  serviceId, shareToken, onChange, compact,
}: { serviceId: number; shareToken: string | null; onChange?: (token: string | null) => void; compact?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const attendee = useApi<AttendeeInfo>(`/services/${serviceId}/attendee-link`);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);
  const link = useLinkBase();
  const boxes = (
    <div className="stack">
      <ShareBox serviceId={serviceId} shareToken={shareToken} onChange={onChange} />
      <AttendeeBox serviceId={serviceId} info={attendee.data} setInfo={attendee.setData} />
      {link && !link.public && (shareToken || attendee.data?.token) && <div className="small muted">{t('No public address is set (Settings → AI / MCP): these links open only on the church’s own network.')}</div>}
    </div>
  );
  if (!compact) return boxes;
  // a planner toolbar: one button (showing whether a link is on) that opens the link controls
  const on = !!shareToken || !!attendee.data?.token;
  return (
    <div className="tp-menu" ref={ref}>
      <button type="button" className={`btn sm${open ? ' on' : ''}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        title={t('Share links: the team’s, and the bulletin for the congregation')}>
        <Icon name="link" />{t('Share')}{on && <span className="badge ok" style={{ marginLeft: 4 }}>{t('On')}</span>}
      </button>
      {open && <div className="tp-menu-list down share-pop" role="dialog" aria-label={t('Share link')}>{boxes}</div>}
    </div>
  );
}

async function copyText(url: string) {
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // Clipboard API unavailable (e.g. plain http on the LAN): fall back to a hidden textarea.
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } finally {
      ta.remove();
    }
  }
}

/** A link with Copy and Open. */
function LinkRow({ url, label, extra }: { url: string; label: string; extra?: React.ReactNode }) {
  const { t } = useI18n();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await copyText(url);
    setCopied(true);
    toast(t('Copied.'));
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="share-row">
      <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label={label} />
      <button type="button" className="btn sm" onClick={copy}>
        <Icon name={copied ? 'check' : 'copy'} />
        {copied ? t('Copied.') : t('Copy')}
      </button>
      <a className="btn sm ghost" href={url} target="_blank" rel="noreferrer"><Icon name="eye" />{t('Open')}</a>
      {extra}
    </div>
  );
}

/** The team's share link: enable, copy, open, disable. */
function ShareBox({
  serviceId, shareToken, onChange,
}: { serviceId: number; shareToken: string | null; onChange?: (token: string | null) => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const link = useLinkBase();
  const toggle = async (enabled: boolean) => {
    const res = await run(() => api.post<{ token: string | null }>(`/services/${serviceId}/share`, { enabled }));
    if (res) onChange?.(res.token);
  };
  return (
    <div className="share-box">
      <div className="share-label"><Icon name="link" /> {t('Share with team (read-only, no contact details)')}</div>
      {shareToken ? (
        <>
          <LinkRow url={shareUrl(shareToken, link?.base)} label={t('Share link')}
            extra={<button type="button" className="btn sm ghost danger" disabled={busy} onClick={() => toggle(false)}>{t('Disable link')}</button>} />
        </>
      ) : (
        <button type="button" className="btn sm" disabled={busy} onClick={() => toggle(true)}><Icon name="link" />{t('Enable link')}</button>
      )}
    </div>
  );
}

/** The attendees' bulletin link: one per service, with its QR code on the bulletin and / or a slide. */
function AttendeeBox({ serviceId, info, setInfo }: { serviceId: number; info: AttendeeInfo | undefined; setInfo: (d: AttendeeInfo) => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  if (!info) return null;
  const save = (p: { enabled: boolean; bulletin?: boolean; slides?: boolean }) => run(async () => {
    setInfo(await api.put<AttendeeInfo>(`/services/${serviceId}/attendee-link`, p));
  });
  return (
    <div className="share-box share-attendee">
      <div className="share-label"><Icon name="users" /> {t('Bulletin for the congregation (order, words and announcements; no serving team)')}</div>
      {info.token && info.url ? (
        <>
          <LinkRow url={info.url} label={t('Bulletin link')}
            extra={<button type="button" className="btn sm ghost danger" disabled={busy} onClick={() => save({ enabled: false })}>{t('Disable link')}</button>} />
          <div className="share-qr-row">
            <img className="share-qr" src={qrPreviewUrl(info.url)} alt={t('QR code of the bulletin link')} />
            <fieldset disabled={busy} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
              <label className="check"><input type="checkbox" checked={!!info.bulletin} onChange={(e) => save({ enabled: true, bulletin: e.target.checked })} />{t('Print the QR code on the bulletin’s back page')}</label>
              <label className="check"><input type="checkbox" checked={!!info.slides} onChange={(e) => save({ enabled: true, slides: e.target.checked })} />{t('Show the QR code on a slide at the start, after the title slide')}</label>
              <a className="btn sm ghost" href={qrPreviewUrl(info.url, 'png', true)} download><Icon name="download" />{t('Download QR code')}</a>
            </fieldset>
          </div>
          {info.local_only
            && <div className="callout warn small">{t('This link points at this computer only, so phones cannot open it. Set a public address in Settings → AI / MCP, or connect this computer to the church network.')}</div>}
        </>
      ) : (
        <button type="button" className="btn sm" disabled={busy} onClick={() => save({ enabled: true })}><Icon name="link" />{t('Enable link')}</button>
      )}
    </div>
  );
}

export default ShareButton;
