// Turn the read-only team share link on/off and copy it. Used by the service editor.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { useAction, useToast } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import './outputs.css';

export function shareUrl(token: string) {
  return `${location.origin}/share/${token}`;
}

export function ShareButton({
  serviceId, shareToken, onChange, compact,
}: { serviceId: number; shareToken: string | null; onChange?: (token: string | null) => void; compact?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
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
  if (!compact) return <ShareBox serviceId={serviceId} shareToken={shareToken} onChange={onChange} />;
  // a planner toolbar: one button (showing whether the link is on) that opens the link controls
  return (
    <div className="tp-menu" ref={ref}>
      <button type="button" className={`btn sm${open ? ' on' : ''}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        title={t('Share with team (read-only, no contact details)')}>
        <Icon name="link" />{t('Share')}{shareToken && <span className="badge ok" style={{ marginLeft: 4 }}>{t('On')}</span>}
      </button>
      {open && <div className="tp-menu-list down share-pop" role="dialog" aria-label={t('Share link')}><ShareBox serviceId={serviceId} shareToken={shareToken} onChange={onChange} /></div>}
    </div>
  );
}

/** The share link itself: enable, copy, open, disable. */
function ShareBox({
  serviceId, shareToken, onChange,
}: { serviceId: number; shareToken: string | null; onChange?: (token: string | null) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { run, busy } = useAction();
  const [copied, setCopied] = useState(false);

  const toggle = async (enabled: boolean) => {
    const res = await run(() => api.post<{ token: string | null }>(`/services/${serviceId}/share`, { enabled }));
    if (res) onChange?.(res.token);
  };

  const copy = async (url: string) => {
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
    setCopied(true);
    toast(t('Copied.'));
    setTimeout(() => setCopied(false), 2000);
  };

  const url = shareToken ? shareUrl(shareToken) : '';
  return (
    <div className="share-box">
      <div className="share-label"><Icon name="link" /> {t('Share with team (read-only, no contact details)')}</div>
      {shareToken ? (
        <div className="share-row">
          <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label={t('Share link')} />
          <button type="button" className="btn sm" onClick={() => copy(url)}>
            <Icon name={copied ? 'check' : 'copy'} />
            {copied ? t('Copied.') : t('Copy')}
          </button>
          <a className="btn sm ghost" href={url} target="_blank" rel="noreferrer"><Icon name="eye" />{t('Open')}</a>
          <button type="button" className="btn sm ghost danger" disabled={busy} onClick={() => toggle(false)}>{t('Disable link')}</button>
        </div>
      ) : (
        <button type="button" className="btn sm" disabled={busy} onClick={() => toggle(true)}><Icon name="link" />{t('Enable link')}</button>
      )}
    </div>
  );
}

export default ShareButton;
