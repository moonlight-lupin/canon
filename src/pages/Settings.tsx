// Settings: my profile (everyone), church settings, users & access, and AI / MCP exposure control (admins).
import { useState } from 'react';
import { api } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { UI_LANGS, langInfo } from '../../shared/languages.ts';
import { LanguagesPanel } from './Onboarding.tsx';
import EmailTab from './settings/EmailTab.tsx';
import BackupsTab from './settings/BackupsTab.tsx';
import { Field, PageHead, Seg, useAction, useSession } from '../components/ui.tsx';
import type { Lang } from '../types-client.ts';
import { OfferingsTab } from './settings/OfferingsTab.tsx';
import { MemberFieldsTab } from './settings/MemberFieldsTab.tsx';
import { SecurityTab } from './settings/SecurityTab.tsx';
import { VisitorFormTab } from './settings/VisitorFormTab.tsx';
import './people.css';
import { ChangeLogTab } from './settings/ChangeLogTab.tsx';
import { ChurchTab } from './settings/ChurchTab.tsx';
import { McpTab } from './settings/McpTab.tsx';
import { UsersTab } from './settings/UsersTab.tsx';
import { ModulesPanel } from './settings/ModulesTab.tsx';
import { InfoTip } from '../components/InfoTip.tsx';
import { Icon } from '../components/icons.tsx';

type Tab = 'profile' | 'church' | 'languages' | 'modules' | 'users' | 'member-fields' | 'offerings' | 'visitor-form' | 'email' | 'backups' | 'security' | 'mcp' | 'changelog';

export default function Settings() {
  const { t } = useI18n();
  const { isAdmin, settings, reloadSettings } = useSession();
  // ?tab=email etc. opens a specific tab (used by links from other screens)
  const [tab, setTab] = useState<Tab>(() => {
    const q = new URLSearchParams(location.search).get('tab');
    return q && ['profile', 'church', 'languages', 'modules', 'users', 'member-fields', 'offerings', 'visitor-form', 'email', 'backups', 'security', 'changelog', 'mcp'].includes(q) ? (q as Tab) : 'profile';
  });
  // the tabs in groups (a thin line between groups): my own account; the church; people and access; records; Canon itself
  const groups: [Tab, string][][] = [
    [['profile', 'My profile']],
    [['church', 'Church'], ['languages', 'Languages'], ['modules', 'Modules']],
    [['users', 'Users & access'], ['member-fields', 'Member fields']],
    [['offerings', 'Offerings'], ['visitor-form', 'Visitor form']],
    [['email', 'E-mail'], ['backups', 'Backups'], ['security', 'Security & privacy'], ['changelog', 'Change log'], ['mcp', 'AI / MCP']],
  ];
  const shown = (k: Tab) => k !== 'visitor-form' || settings?.modules?.visitor_form !== false;
  return (
    <div className="page people-page">
      <PageHead eyebrow={t('Admin')} title={t('Settings')} />
      <div className="stack">
        {!isAdmin && <ProfileCard />}
        {isAdmin && (
          <div>
            <div className="tabs" role="tablist">
              {groups.map((g, gi) => [
                gi > 0 && <span key={`sep-${gi}`} className="tab-sep" aria-hidden="true" />,
                ...g.filter(([k]) => shown(k)).map(([k, l]) => (
                  <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t(l)}</button>
                )),
              ])}
            </div>
            {tab === 'profile' && <ProfileCard />}
            {tab === 'church' && <ChurchTab />}
            {tab === 'changelog' && <ChangeLogTab />}
            {tab === 'languages' && settings && <LanguagesPanel settings={settings} onSaved={reloadSettings} />}
            {tab === 'modules' && settings && <div className="card"><ModulesPanel initial={settings.modules} onSaved={reloadSettings} /></div>}
            {tab === 'users' && <UsersTab />}
            {tab === 'member-fields' && <MemberFieldsTab />}
            {tab === 'offerings' && <OfferingsTab />}
            {tab === 'visitor-form' && <VisitorFormTab />}
            {tab === 'email' && <EmailTab />}
            {tab === 'backups' && <BackupsTab />}
            {tab === 'security' && <SecurityTab />}
            {tab === 'mcp' && <McpTab />}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- my profile

/** Two-step sign-in for my account: an authenticator app's code after the password, and recovery codes. */
function TwoStepCard() {
  const { t } = useI18n();
  const { user, refresh } = useSession();
  const { run, busy } = useAction();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [pw, setPw] = useState('');
  const start = () => run(async () => setSetup(await api.post<{ secret: string; qr: string }>('/me/two-step/setup', {})));
  const enable = () => run(async () => {
    const r = await api.post<{ recovery_codes: string[] }>('/me/two-step/enable', { code });
    setCodes(r.recovery_codes);
    setSetup(null);
    setCode('');
    await refresh();
  }, t('Two-step sign-in is on.'));
  const disable = () => run(async () => {
    await api.post('/me/two-step/disable', { password: pw });
    setPw('');
    await refresh();
  }, t('Two-step sign-in is off.'));
  return (
    <div className="stack tight">
      <h3 className="sect" style={{ marginBottom: 0 }}>{t('Two-step sign-in')} <InfoTip text={t('After your password, Canon asks for a 6-digit code from an authenticator app on your phone (Google or Microsoft Authenticator, 1Password …), so a stolen password alone can’t sign in.')} /></h3>
      {codes && (
        <div className="callout">
          <strong>{t('Your recovery codes')}</strong> — {t('keep them somewhere safe: each signs you in once if you lose your phone. They are shown only now.')}
          <pre className="small" style={{ margin: '6px 0 0' }}>{codes.join('\n')}</pre>
        </div>
      )}
      {user.totp_enabled ? (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="badge ok">{t('On')}</span>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t('Your password')} autoComplete="current-password" style={{ maxWidth: 200 }} />
          <button className="btn sm" onClick={disable} disabled={busy || !pw}>{t('Turn off')}</button>
        </div>
      ) : setup ? (
        <div className="stack tight">
          <p className="small" style={{ margin: 0 }}>{t('Scan this with your authenticator app (or type the key), then enter the code it shows.')}</p>
          <img src={setup.qr} alt="" width={180} height={180} />
          <code className="small">{setup.secret}</code>
          <div className="row" style={{ gap: 8 }}>
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" style={{ width: 120 }} />
            <button className="btn primary sm" onClick={enable} disabled={busy || code.trim().length < 6}>{t('Turn on')}</button>
          </div>
        </div>
      ) : (
        <div><button className="btn sm" onClick={start} disabled={busy}><Icon name="lock" />{t('Set up two-step sign-in')}</button></div>
      )}
    </div>
  );
}

function ProfileCard() {
  const { t, lang, setLang } = useI18n();
  const { user, refresh } = useSession();
  const { run, busy } = useAction();
  const [name, setName] = useState(user.display_name);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });

  const changeLang = (l: Lang) => {
    setLang(l);
    api.patch('/me', { lang: l }).catch(() => {});
  };
  const saveName = () =>
    run(async () => {
      if (!name.trim()) throw new Error(t('Name is required.'));
      await api.patch('/me', { display_name: name.trim() });
      await refresh();
      return true;
    }, t('Saved.'));
  const savePw = async () => {
    const ok = await run(async () => {
      if (pw.next.length < 8) throw new Error(t('The new password needs at least 8 characters.'));
      if (pw.next !== pw.confirm) throw new Error(t('The new passwords do not match.'));
      return api.patch('/me', { current_password: pw.current, new_password: pw.next }).catch((e: Error) => {
        throw new Error(t(e.message));
      });
    }, t('Password changed.'));
    if (ok) setPw({ current: '', next: '', confirm: '' });
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>{t('My profile')}</h2>
        <span className="muted small">{user.username} · {t(user.role[0].toUpperCase() + user.role.slice(1))}</span>
      </div>
      <div className="grid cols-2">
        <div className="stack">
          <Field label={t('Display name')}>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input value={name} onChange={(e) => setName(e.target.value)} />
              <button className="btn" onClick={saveName} disabled={busy || name === user.display_name}>{t('Save')}</button>
            </div>
          </Field>
          <Field label={t('Language')}>
            <div><Seg<Lang> value={lang} onChange={changeLang} options={UI_LANGS.map((l) => ({ value: l, label: langInfo(l).native }))} /></div>
          </Field>
        </div>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); savePw(); }}>
          <h3 className="sect" style={{ marginBottom: 0 }}>{t('Change password')}</h3>
          <input type="text" name="username" autoComplete="username" value={user.username} readOnly hidden />
          <div className="form-grid">
            <Field label={t('Current password')}><input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
            <Field label={t('New password')}><input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
            <Field label={t('Confirm new password')}><input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
          </div>
          <div className="row end"><button className="btn" type="submit" disabled={busy || !pw.current || !pw.next}>{t('Change password')}</button></div>
        </form>
        <TwoStepCard />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- church
