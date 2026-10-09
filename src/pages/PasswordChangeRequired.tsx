// An administrator chose this account's password (a new account, or a reset): until the person chooses their own,
// this is all Canon shows (0.19.9).
import { useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Field, useSession } from '../components/ui.tsx';
import { ReedMark } from '../components/icons.tsx';

export default function PasswordChangeRequired() {
  const { t, lt } = useI18n();
  const { user, settings, logout, refresh } = useSession();
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pw.next.length < 8) return setError(t('The new password needs at least 8 characters.'));
    if (pw.next !== pw.confirm) return setError(t('The new passwords do not match.'));
    if (pw.next === pw.current) return setError(t('Choose a password of your own, not the one you were given.'));
    setBusy(true);
    try {
      await api.patch('/me', { current_password: pw.current, new_password: pw.next });
      await refresh();
    } catch (err) {
      setError(t((err as Error).message));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page" style={{ maxWidth: 560 }}>
      <div className="row" style={{ gap: 12, marginBottom: 8 }}>
        <ReedMark className="brand-mark" />
        <div>
          <div className="eyebrow">{t('Choose your password')}</div>
          <h1>{lt(settings?.church_name ?? {})}</h1>
        </div>
      </div>
      <p>{t('An administrator set the password you signed in with. Choose one of your own to continue: only you should know it.')}</p>
      <form className="card stack" onSubmit={save}>
        <input type="text" name="username" autoComplete="username" value={user.username} readOnly hidden />
        <Field label={t('The password you were given')}><input type="password" autoComplete="current-password" autoFocus value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
        <Field label={t('New password')} hint={t('At least 8 characters.')}><input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
        <Field label={t('Confirm new password')}><input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
        {error && <div className="callout warn">{error}</div>}
        <div className="row end"><button className="btn primary" type="submit" disabled={busy || !pw.current || !pw.next}>{t('Save and open Canon')}</button></div>
      </form>
      <div className="row end" style={{ marginTop: 12 }}><button className="btn ghost" onClick={logout}>{t('Sign out')}</button></div>
    </div>
  );
}
