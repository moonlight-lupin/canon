// When the church requires two-step sign-in (Settings → Security & privacy: for every account, or for
// administrators) and this account hasn't set it up, this is all Canon shows until it does.
import { useI18n } from '../i18n.tsx';
import { useSession } from '../components/ui.tsx';
import { ReedMark } from '../components/icons.tsx';
import { TwoStepCard } from './Settings.tsx';

export default function TwoStepRequired({ everyone }: { everyone: boolean }) {
  const { t, lt } = useI18n();
  const { settings, logout } = useSession();
  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <div className="row" style={{ gap: 12, marginBottom: 8 }}>
        <ReedMark className="brand-mark" />
        <div>
          <div className="eyebrow">{t('Two-step sign-in')}</div>
          <h1>{lt(settings?.church_name ?? {})}</h1>
        </div>
      </div>
      <p>{everyone
        ? t('This church requires two-step sign-in for every account. Set it up to continue: you need an authenticator app on your phone.')
        : t('This church requires two-step sign-in for administrators. Set it up to continue: you need an authenticator app on your phone.')}</p>
      <section className="card"><TwoStepCard forced /></section>
      <div className="row end" style={{ marginTop: 12 }}><button className="btn ghost" onClick={logout}>{t('Sign out')}</button></div>
    </div>
  );
}
