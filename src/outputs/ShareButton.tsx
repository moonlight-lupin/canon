// Turn the read-only team share link on/off and copy it. Used by the service editor.
import { useState } from 'react';
import { api } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { useAction, useToast } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import './outputs.css';

export function shareUrl(token: string) {
  return `${location.origin}/share/${token}`;
}

export function ShareButton({
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
