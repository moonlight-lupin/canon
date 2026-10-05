import { useState, type FormEvent } from 'react';
import { api, setCsrf } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Field, L10nInput, Seg } from '../components/ui.tsx';
import { ChurchMark, Tagline } from '../components/brand.tsx';
import { LanguagePicker } from '../components/LanguagePicker.tsx';
import { UI_LANGS, langInfo } from '../../shared/languages.ts';
import type { L10n, Lang } from '../../shared/types.ts';

/** Only follow ?next= into the OAuth consent flow (avoids an open redirect). */
function safeNext(): string | null {
  const n = new URLSearchParams(location.search).get('next');
  return n && n.startsWith('/oauth/authorize') ? n : null;
}

export default function Login({ needsSetup, onDone }: { needsSetup: boolean; onDone: () => void }) {
  const { t, lang, setLang } = useI18n();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [church, setChurch] = useState<L10n>({});
  const [langs, setLangs] = useState<Lang[]>(['en', 'zh']);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // two-step sign-in: after the password, the code from the authenticator app (or a recovery code)
  const [ticket, setTicket] = useState<string | null>(null);
  const [code, setCode] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      type Reply = { csrf: string; second_step?: boolean; ticket?: string };
      const r: Reply = needsSetup
        ? await api.post<Reply>('/setup', {
            username, password, display_name: displayName || username, languages: langs, ui_lang: lang,
            church_name: Object.values(church).some((v) => v?.trim()) ? church : undefined,
          })
        : ticket
          ? await api.post<Reply>('/login/code', { ticket, code })
          : await api.post<Reply>('/login', { username, password });
      if (r.second_step && r.ticket) {
        setTicket(r.ticket);
        return;
      }
      setCsrf(r.csrf);
      const next = safeNext();
      if (next) {
        // The consent page is rendered by the server: do a full navigation.
        location.href = next;
        return;
      }
      if (location.pathname === '/login') history.replaceState(null, '', '/');
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className={`card stack${needsSetup ? ' setup' : ''}`} onSubmit={submit}>
        <div className="row between">
          <div className="login-brand">
            <ChurchMark className="brand-mark" />
            <div className="brand-name">Canon</div>
          </div>
          <Seg<Lang> value={lang} onChange={setLang} options={UI_LANGS.map((l) => ({ value: l, label: langInfo(l).short === 'EN' ? 'EN' : langInfo(l).native }))} />
        </div>
        {needsSetup ? (
          <>
            <div>
              <h2>{t('Welcome to Canon')}</h2>
              <p className="muted">{t('Set up the first administrator account.')}</p>
            </div>
            <Field label={t('Worship languages')} hint={t('Primary language first. You can change this later.')}>
              <LanguagePicker value={langs} onChange={setLangs} />
            </Field>
            <Field label={t('Church name')}>
              <L10nInput langs={langs} value={church} onChange={setChurch} placeholder={{ en: 'Grace Presbyterian Church', zh: '恩典长老会', 'zh-Hant': '恩典長老會' }} />
            </Field>
            <Field label={t('Display name')}>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" />
            </Field>
          </>
        ) : (
          safeNext() && <div className="callout lapis small">Sign in to approve an AI connector. / 登入以批准 AI 连接。</div>
        )}
        <Field label={t('Username')}>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required autoFocus />
        </Field>
        <Field label={t('Password')} hint={needsSetup ? '8+' : undefined}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={needsSetup ? 'new-password' : 'current-password'} required minLength={needsSetup ? 8 : 1} />
        </Field>
        {ticket && (
          <Field label={t('Code from your authenticator app')} hint={t('Or one of your recovery codes.')}>
            <input value={code} onChange={(e) => setCode(e.target.value)} autoFocus inputMode="numeric" autoComplete="one-time-code" required />
          </Field>
        )}
        {error && <div className="callout warn">{error}</div>}
        <button className="btn primary" disabled={busy}>{needsSetup ? t('Create administrator') : ticket ? t('Continue') : t('Sign in')}</button>
        <Tagline />
      </form>
    </div>
  );
}
